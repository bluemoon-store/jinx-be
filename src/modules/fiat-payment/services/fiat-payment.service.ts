import {
    Injectable,
    BadRequestException,
    NotFoundException,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PinoLogger } from 'nestjs-pino';
import {
    FiatPayment,
    FiatPaymentStatus,
    OrderStatus,
    PaymentGateway,
    Prisma,
} from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IOrderConfirmedPayload,
    IPaymentFailedPayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { OrderDeliveryService } from 'src/modules/order/services/order-delivery.service';
import { StockLineService } from 'src/modules/stock-line/services/stock-line.service';

import { FIAT_PAYMENT_QUEUE } from '../fiat-payment.constants';
import { PaymentGatewayFactory } from '../gateways/payment-gateway.factory';
import { FiatPaymentResponseDto } from '../dtos/response/fiat-payment.response';
import { FiatPaymentStatusResponseDto } from '../dtos/response/fiat-payment-status.response';

/** Statuses considered "active" — a checkout the buyer can still complete. */
const ACTIVE_STATUSES: FiatPaymentStatus[] = [
    FiatPaymentStatus.PENDING,
    FiatPaymentStatus.PROCESSING,
];

/** Statuses that are terminal failures (stock should be released). */
const FAILED_STATUSES: FiatPaymentStatus[] = [
    FiatPaymentStatus.EXPIRED,
    FiatPaymentStatus.FAILED,
    FiatPaymentStatus.CANCELLED,
];

/**
 * Fiat Payment Service
 * Provider-agnostic orchestration for hosted fiat gateways (CHIME first).
 * Mirrors CryptoPaymentService for ownership/expiry handling, and reuses the
 * crypto order-completion + delivery sequence for paid payments.
 */
@Injectable()
export class FiatPaymentService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly gatewayFactory: PaymentGatewayFactory,
        private readonly deliveryService: OrderDeliveryService,
        private readonly stockLineService: StockLineService,
        private readonly configService: ConfigService,
        @InjectQueue(FIAT_PAYMENT_QUEUE)
        private readonly fiatPaymentQueue: Queue,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(FiatPaymentService.name);
    }

    private assertOrderAccess(order: { userId: string }, userId: string): void {
        if (!userId || order.userId !== userId) {
            throw new BadRequestException(
                'You do not have permission to access this order'
            );
        }
    }

    /**
     * Create (or reuse) a hosted fiat checkout for an order.
     */
    async createPayment(
        orderId: string,
        gateway: PaymentGateway,
        userId: string,
        returnUrl?: string
    ): Promise<FiatPaymentResponseDto> {
        this.logger.info({ orderId, gateway, userId }, 'Creating fiat payment');

        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: { fiatPayment: true },
            });

            if (!order) {
                throw new NotFoundException(`Order not found: ${orderId}`);
            }
            this.assertOrderAccess(order, userId);

            if (order.status !== OrderStatus.PENDING) {
                throw new BadRequestException(
                    `Cannot create payment for order with status: ${order.status}. Order must be PENDING.`
                );
            }

            const now = new Date();
            const existing = order.fiatPayment;

            // Reuse an active checkout rather than creating a duplicate.
            if (existing) {
                if (existing.status === FiatPaymentStatus.PAID) {
                    throw new BadRequestException(
                        'Order has already been paid'
                    );
                }
                const active =
                    ACTIVE_STATUSES.includes(existing.status) &&
                    now < existing.expiresAt &&
                    !!existing.checkoutUrl;
                if (active) {
                    return this.mapToResponseDto(existing);
                }
            }

            const amountUsd = parseFloat(order.totalAmount.toString());
            if (amountUsd <= 0) {
                throw new BadRequestException(
                    'Order total amount must be greater than 0'
                );
            }

            const expiryMinutes =
                this.configService.get<number>(
                    'paymentGateway.chime.paymentExpiryMinutes'
                ) ?? 30;
            const expiresAt = new Date(now.getTime() + expiryMinutes * 60_000);

            const provider = this.gatewayFactory.getGateway(gateway);
            const checkout = await provider.createCheckout({
                orderId: order.id,
                orderNumber: order.orderNumber,
                amount: amountUsd,
                currency: order.currency,
                returnUrl,
                expiresAt,
            });

            const effectiveExpiry = checkout.expiresAt ?? expiresAt;
            const data = {
                gateway,
                amount: new Prisma.Decimal(amountUsd.toFixed(2)),
                currency: order.currency,
                externalId: checkout.externalId,
                externalReference: checkout.externalReference,
                checkoutUrl: checkout.checkoutUrl,
                status: FiatPaymentStatus.PENDING,
                expiresAt: effectiveExpiry,
                paidAt: null,
                metadata: (checkout.raw ?? undefined) as Prisma.InputJsonValue,
            };

            const payment = existing
                ? await this.databaseService.fiatPayment.update({
                      where: { id: existing.id },
                      data,
                  })
                : await this.databaseService.fiatPayment.create({
                      data: { orderId: order.id, ...data },
                  });

            await this.stockLineService.syncReservationExpiryForOrder(
                this.databaseService,
                orderId,
                effectiveExpiry
            );

            // Reconciliation fallback in case the webhook never arrives.
            await this.fiatPaymentQueue.add(
                'reconcile',
                { paymentId: payment.id },
                {
                    delay: 60_000,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 60_000 },
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            );

            this.logger.info(
                { paymentId: payment.id, orderId, gateway },
                'Fiat payment created'
            );

            return this.mapToResponseDto(payment);
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            this.logger.error(
                { error, orderId, gateway, userId },
                'Failed to create fiat payment'
            );
            throw new HttpException(
                `Failed to create fiat payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async getPaymentByOrderId(
        orderId: string,
        userId: string
    ): Promise<FiatPaymentResponseDto> {
        const order = await this.databaseService.order.findUnique({
            where: { id: orderId },
            include: { fiatPayment: true },
        });
        if (!order) {
            throw new NotFoundException(`Order not found: ${orderId}`);
        }
        this.assertOrderAccess(order, userId);
        if (!order.fiatPayment) {
            throw new NotFoundException(
                `No fiat payment found for order: ${orderId}`
            );
        }
        return this.mapToResponseDto(order.fiatPayment);
    }

    async getPaymentStatusByOrderId(
        orderId: string,
        userId: string
    ): Promise<FiatPaymentStatusResponseDto> {
        const order = await this.databaseService.order.findUnique({
            where: { id: orderId },
            include: { fiatPayment: true },
        });
        if (!order) {
            throw new NotFoundException(`Order not found: ${orderId}`);
        }
        this.assertOrderAccess(order, userId);
        if (!order.fiatPayment) {
            throw new NotFoundException(
                `No fiat payment found for order: ${orderId}`
            );
        }

        const payment = order.fiatPayment;
        const now = new Date();
        const isExpired = now > payment.expiresAt;

        // Auto-expire a stale pending payment on read.
        if (
            isExpired &&
            payment.status === FiatPaymentStatus.PENDING &&
            order.status === OrderStatus.PENDING
        ) {
            await this.expirePayment(payment.id);
            const refreshed = await this.databaseService.fiatPayment.findUnique(
                { where: { id: payment.id }, include: { order: true } }
            );
            if (refreshed) {
                return this.mapToStatusResponseDto(refreshed, refreshed.order!);
            }
        }

        return this.mapToStatusResponseDto(payment, order);
    }

    /**
     * Mark a fiat payment as paid and complete + deliver the order.
     * Reuses the crypto confirmPayment sequence (minus forwarding).
     * Idempotent: a second call after completion is a no-op.
     */
    async markPaidAndComplete(paymentId: string): Promise<void> {
        const current = await this.databaseService.fiatPayment.findUnique({
            where: { id: paymentId },
            include: { order: true },
        });
        if (!current) {
            this.logger.warn({ paymentId }, 'Fiat payment not found for paid');
            return;
        }
        if (
            current.status === FiatPaymentStatus.PAID &&
            current.order.status === OrderStatus.COMPLETED
        ) {
            this.logger.debug({ paymentId }, 'Fiat payment already completed');
            return;
        }

        const payment = await this.databaseService.$transaction(async tx => {
            const p = await tx.fiatPayment.update({
                where: { id: paymentId },
                data: {
                    status: FiatPaymentStatus.PAID,
                    paidAt: current.paidAt ?? new Date(),
                },
                include: { order: true },
            });
            if (p.order.status !== OrderStatus.COMPLETED) {
                await this.stockLineService.markSoldForOrder(tx, p.orderId);
                // Clear the buyer's cart atomically with payment completion.
                await tx.cartItem.deleteMany({
                    where: { cart: { userId: p.order.userId } },
                });
                await tx.order.update({
                    where: { id: p.orderId },
                    data: {
                        status: OrderStatus.COMPLETED,
                        completedAt: new Date(),
                    },
                });
            }
            return p;
        });

        this.logger.info(
            { paymentId, orderId: payment.orderId },
            'Fiat payment confirmed, order completed'
        );

        await this.enqueueOrderConfirmedEmail(
            payment.orderId,
            payment.gateway,
            payment.amount.toString()
        );

        try {
            await this.deliveryService.processInstantDelivery(payment.orderId);
        } catch (deliveryError) {
            this.logger.error(
                { error: deliveryError, paymentId, orderId: payment.orderId },
                'Failed to trigger auto-delivery for fiat payment'
            );
        }
    }

    /**
     * Move a non-paid payment to a terminal failure status and release stock.
     */
    async failPayment(
        paymentId: string,
        status: FiatPaymentStatus
    ): Promise<void> {
        const payment = await this.databaseService.fiatPayment.findUnique({
            where: { id: paymentId },
        });
        if (!payment) return;
        if (!ACTIVE_STATUSES.includes(payment.status)) {
            return; // already terminal
        }

        await this.databaseService.$transaction(async tx => {
            await tx.fiatPayment.update({
                where: { id: paymentId },
                data: { status },
            });
            await this.stockLineService.releaseReservedForOrder(
                tx,
                payment.orderId
            );
        });

        this.logger.info({ paymentId, status }, 'Fiat payment marked failed');

        await this.enqueuePaymentFailedEmail(
            payment.orderId,
            payment.gateway,
            payment.amount.toString()
        );
    }

    /** Expire a stale pending payment. */
    async expirePayment(paymentId: string): Promise<void> {
        await this.failPayment(paymentId, FiatPaymentStatus.EXPIRED);
    }

    /**
     * Poll the gateway for the latest status and apply it locally.
     * Used both by the scheduled reconcile cron and the delayed per-payment job.
     */
    async reconcile(paymentId: string): Promise<void> {
        const payment = await this.databaseService.fiatPayment.findUnique({
            where: { id: paymentId },
        });
        if (!payment) return;
        if (!ACTIVE_STATUSES.includes(payment.status)) return; // terminal

        // Time-based expiry takes precedence — don't keep polling forever.
        if (new Date() > payment.expiresAt) {
            await this.expirePayment(paymentId);
            return;
        }
        if (!payment.externalId) return;

        try {
            const provider = this.gatewayFactory.getGateway(payment.gateway);
            const result = await provider.getStatus(payment.externalId);
            await this.applyStatus(payment, result.status, result.paidAt);
        } catch (error) {
            this.logger.error(
                { error, paymentId },
                'Failed to reconcile fiat payment'
            );
            throw error; // let Bull retry
        }
    }

    /**
     * Handle a verified inbound webhook payload for a gateway.
     */
    async processWebhookEvent(
        gateway: PaymentGateway,
        payload: unknown
    ): Promise<void> {
        const provider = this.gatewayFactory.getGateway(gateway);
        const event = provider.parseWebhookEvent(payload);

        if (!event.externalId) {
            this.logger.warn({ gateway }, 'Webhook event missing external id');
            return;
        }

        const payment = await this.databaseService.fiatPayment.findFirst({
            where: { gateway, externalId: event.externalId },
        });
        if (!payment) {
            this.logger.warn(
                { gateway, externalId: event.externalId },
                'Webhook references unknown fiat payment'
            );
            return;
        }

        await this.applyStatus(payment, event.status, event.paidAt);
    }

    /** Route a normalised status to the correct local transition. */
    private async applyStatus(
        payment: FiatPayment,
        status: FiatPaymentStatus,
        paidAt?: Date
    ): Promise<void> {
        if (status === FiatPaymentStatus.PAID) {
            if (paidAt) {
                await this.databaseService.fiatPayment.update({
                    where: { id: payment.id },
                    data: { paidAt },
                });
            }
            await this.markPaidAndComplete(payment.id);
            return;
        }
        if (FAILED_STATUSES.includes(status)) {
            await this.failPayment(payment.id, status);
            return;
        }
        if (
            status === FiatPaymentStatus.PROCESSING &&
            payment.status === FiatPaymentStatus.PENDING
        ) {
            await this.databaseService.fiatPayment.update({
                where: { id: payment.id },
                data: { status: FiatPaymentStatus.PROCESSING },
            });
        }
        // REFUNDED on an already-completed order: record but leave order as-is.
        if (
            status === FiatPaymentStatus.REFUNDED &&
            payment.status === FiatPaymentStatus.PAID
        ) {
            await this.databaseService.fiatPayment.update({
                where: { id: payment.id },
                data: { status: FiatPaymentStatus.REFUNDED },
            });
        }
    }

    private timeRemaining(expiresAt: Date): number {
        return Math.max(
            0,
            Math.floor((expiresAt.getTime() - Date.now()) / 1000)
        );
    }

    private mapToResponseDto(payment: FiatPayment): FiatPaymentResponseDto {
        return {
            paymentId: payment.id,
            orderId: payment.orderId,
            gateway: payment.gateway,
            amount: payment.amount.toString(),
            currency: payment.currency,
            checkoutUrl: payment.checkoutUrl ?? '',
            status: payment.status,
            expiresAt: payment.expiresAt,
            timeRemaining: this.timeRemaining(payment.expiresAt),
            createdAt: payment.createdAt,
        };
    }

    private mapToStatusResponseDto(
        payment: FiatPayment,
        order: { status: OrderStatus }
    ): FiatPaymentStatusResponseDto {
        const now = new Date();
        const isExpired = now > payment.expiresAt;
        return {
            paymentId: payment.id,
            orderId: payment.orderId,
            gateway: payment.gateway,
            status: payment.status,
            orderStatus: order.status,
            timeRemaining: isExpired
                ? 0
                : this.timeRemaining(payment.expiresAt),
            isExpired,
            paidAt: payment.paidAt ?? undefined,
            expiresAt: payment.expiresAt,
        };
    }

    private async enqueueOrderConfirmedEmail(
        orderId: string,
        gateway: PaymentGateway,
        amountUsd: string
    ): Promise<void> {
        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: { user: true },
            });
            if (!order || !order.user) return;

            const frontendUrl =
                this.configService.get<string>('app.frontendUrl') ??
                'http://localhost:3000';
            const dashboardLink = `${frontendUrl.replace(/\/$/, '')}/orders/${order.id}`;
            const formatted = this.formatUsd(amountUsd);
            const completedAt = order.completedAt ?? new Date();

            this.emailQueue.add(EMAIL_TEMPLATES.ORDER_CONFIRMED, {
                data: {
                    order_id: order.orderNumber,
                    payment_method: gateway,
                    amount: formatted,
                    date: completedAt.toISOString().slice(0, 10),
                    dashboard_link: dashboardLink,
                },
                toEmails: [order.user.email],
            } as ISendEmailBasePayload<IOrderConfirmedPayload>);
        } catch (error) {
            this.logger.error(
                { error, orderId },
                'Failed to enqueue order-confirmed email'
            );
        }
    }

    private async enqueuePaymentFailedEmail(
        orderId: string,
        gateway: PaymentGateway,
        amountUsd: string
    ): Promise<void> {
        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: { user: true },
            });
            if (!order || !order.user) return;

            this.emailQueue.add(EMAIL_TEMPLATES.PAYMENT_FAILED, {
                data: {
                    order_id: order.orderNumber,
                    payment_method: gateway,
                    amount: this.formatUsd(amountUsd),
                    date: new Date().toISOString().slice(0, 10),
                },
                toEmails: [order.user.email],
            } as ISendEmailBasePayload<IPaymentFailedPayload>);
        } catch (error) {
            this.logger.error(
                { error, orderId },
                'Failed to enqueue payment-failed email'
            );
        }
    }

    private formatUsd(amount: string): string {
        const numeric = Number(amount);
        return `$${(Number.isFinite(numeric) ? numeric : 0).toLocaleString(
            'en-US',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        )}`;
    }
}
