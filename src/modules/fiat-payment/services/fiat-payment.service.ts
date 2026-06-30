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
    P2PProvider,
    PaymentGateway,
    Prisma,
} from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import {
    ORDER_CONFIRMED_EMAIL_INCLUDE,
    buildOrderConfirmedEmailData,
} from 'src/common/email/order-confirmed-email.builder';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IOrderConfirmedPayload,
    IPaymentFailedPayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { OrderDeliveryService } from 'src/modules/order/services/order-delivery.service';
import { SettingsService } from 'src/modules/settings/services/settings.service';
import { StockLineService } from 'src/modules/stock-line/services/stock-line.service';

import { FIAT_PAYMENT_QUEUE } from '../fiat-payment.constants';
import { PaymentGatewayFactory } from '../gateways/payment-gateway.factory';
import { TelegramStarsGateway } from '../gateways/telegram-stars-gateway.service';
import { FiatPaymentResponseDto } from '../dtos/response/fiat-payment.response';
import { FiatPaymentStatusResponseDto } from '../dtos/response/fiat-payment-status.response';
import { generateP2PPaymentQRCode } from '../utils/qr-code.util';

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
        private readonly telegramStarsGateway: TelegramStarsGateway,
        private readonly deliveryService: OrderDeliveryService,
        private readonly stockLineService: StockLineService,
        private readonly settingsService: SettingsService,
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
        returnUrl?: string,
        method?:
            | 'card'
            | 'cashapp'
            | 'applepay'
            | 'googlepay'
            | 'chime'
            | 'venmo'
    ): Promise<FiatPaymentResponseDto> {
        this.logger.info(
            { orderId, gateway, method, userId },
            'Creating fiat payment'
        );

        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: { fiatPayment: true },
            });

            if (!order) {
                throw new NotFoundException(`Order not found: ${orderId}`);
            }
            this.assertOrderAccess(order, userId);

            // Reject a method an admin has disabled. Cash App, Apple Pay and
            // Google Pay all ride the CHIME (Polapine) gateway, so the
            // storefront's `method` is what maps each to its own admin toggle
            // (cashapp -> CASHAPP, applepay -> APPLEPAY, googlepay -> GOOGLEPAY).
            // Telegram Stars is its own gateway and maps to its own toggle.
            // MANUAL_P2P (self-hosted Chime/Venmo) selects its rail via `method`
            // and maps to its own admin toggle (chime -> CHIME_P2P, venmo -> VENMO).
            const isManualP2P = gateway === PaymentGateway.MANUAL_P2P;
            const p2pProvider: P2PProvider | undefined = isManualP2P
                ? method === 'venmo'
                    ? P2PProvider.VENMO
                    : P2PProvider.CHIME
                : undefined;

            const methodToCode: Record<string, string> = {
                cashapp: 'CASHAPP',
                applepay: 'APPLEPAY',
                googlepay: 'GOOGLEPAY',
            };
            const gatewayCode =
                gateway === PaymentGateway.TELEGRAM_STARS
                    ? 'TELEGRAM_STARS'
                    : isManualP2P
                      ? p2pProvider === P2PProvider.VENMO
                          ? 'VENMO'
                          : 'CHIME_P2P'
                      : ((method && methodToCode[method]) ?? 'CHIME');
            const { gateways: enabledGateways } =
                await this.settingsService.getEnabledPaymentMethods();
            if (!enabledGateways.includes(gatewayCode)) {
                throw new BadRequestException(
                    'This payment method is currently unavailable'
                );
            }

            if (order.status !== OrderStatus.PENDING) {
                throw new BadRequestException(
                    `Cannot create payment for order with status: ${order.status}. Order must be PENDING.`
                );
            }

            const now = new Date();
            const existing = order.fiatPayment;

            // Reuse an active checkout rather than creating a duplicate. A
            // hosted gateway has a checkoutUrl; a MANUAL_P2P payment has a
            // requiredNote instead. Only reuse when the buyer is still on the
            // same rail (gateway + P2P provider) — switching method falls
            // through and overwrites the record below.
            if (existing) {
                if (existing.status === FiatPaymentStatus.PAID) {
                    throw new BadRequestException(
                        'Order has already been paid'
                    );
                }
                const sameTarget =
                    existing.gateway === gateway &&
                    (!isManualP2P || existing.provider === p2pProvider);
                const hasArtifact =
                    !!existing.checkoutUrl || !!existing.requiredNote;
                const active =
                    ACTIVE_STATUSES.includes(existing.status) &&
                    now < existing.expiresAt &&
                    hasArtifact &&
                    sameTarget;
                if (active) {
                    return await this.mapToResponseDto(existing);
                }
            }

            const amountUsd = parseFloat(order.totalAmount.toString());
            if (amountUsd <= 0) {
                throw new BadRequestException(
                    'Order total amount must be greater than 0'
                );
            }

            const isTelegram = gateway === PaymentGateway.TELEGRAM_STARS;
            const expiryConfigPath = isTelegram
                ? 'paymentGateway.telegramStars.paymentExpiryMinutes'
                : isManualP2P
                  ? 'paymentGateway.manualP2P.paymentExpiryMinutes'
                  : 'paymentGateway.chime.paymentExpiryMinutes';
            const expiryMinutes =
                this.configService.get<number>(expiryConfigPath) ??
                (isManualP2P ? 60 : 30);
            const expiresAt = new Date(now.getTime() + expiryMinutes * 60_000);

            // Telegram charges an integer Stars (XTR) amount — resolve it from the
            // admin USD-per-Star rate (falling back to the env default) so the
            // gateway stays free of settings/config lookups.
            let starAmount: number | undefined;
            if (isTelegram) {
                const rate =
                    (await this.settingsService.getTelegramStarUsdRate()) ??
                    this.configService.get<number>(
                        'paymentGateway.telegramStars.starUsdRate'
                    ) ??
                    0.013;
                starAmount = Math.max(1, Math.ceil(amountUsd / rate));
            }

            // MANUAL_P2P: resolve the destination $tag/@handle the buyer pays to.
            // Reject early when the admin has not configured it.
            let destinationTag: string | undefined;
            if (isManualP2P && p2pProvider) {
                const tag =
                    await this.settingsService.getP2PDestinationTag(
                        p2pProvider
                    );
                if (!tag) {
                    throw new BadRequestException(
                        'This payment method is not configured yet. Please choose another.'
                    );
                }
                destinationTag = tag;
            }

            const gatewayImpl = this.gatewayFactory.getGateway(gateway);

            // The MANUAL_P2P required note is unique per active payment
            // (FiatPayment.noteKey is unique). On the rare collision, regenerate
            // by retrying the whole create-checkout + persist.
            const maxAttempts = isManualP2P ? 3 : 1;
            let payment: FiatPayment | undefined;
            let lastError: unknown;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const checkout = await gatewayImpl.createCheckout({
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    amount: amountUsd,
                    currency: order.currency,
                    returnUrl,
                    expiresAt,
                    starAmount,
                    provider: p2pProvider,
                    destinationTag,
                });

                const effectiveExpiry = checkout.expiresAt ?? expiresAt;
                const data = {
                    gateway,
                    amount: new Prisma.Decimal(amountUsd.toFixed(2)),
                    currency: order.currency,
                    externalId: checkout.externalId,
                    externalReference: checkout.externalReference,
                    checkoutUrl: checkout.checkoutUrl ?? null,
                    // MANUAL_P2P instruction fields (null for hosted gateways).
                    provider: checkout.instructions?.provider ?? null,
                    destinationTag: checkout.instructions?.tag ?? null,
                    requiredNote: checkout.instructions?.note ?? null,
                    noteKey: checkout.instructions?.noteKey ?? null,
                    status: FiatPaymentStatus.PENDING,
                    expiresAt: effectiveExpiry,
                    paidAt: null,
                    metadata: (checkout.raw ??
                        undefined) as Prisma.InputJsonValue,
                };

                try {
                    payment = existing
                        ? await this.databaseService.fiatPayment.update({
                              where: { id: existing.id },
                              data,
                          })
                        : await this.databaseService.fiatPayment.create({
                              data: { orderId: order.id, ...data },
                          });
                    break;
                } catch (err) {
                    // Unique violation on note_key -> regenerate and retry.
                    if (
                        err instanceof Prisma.PrismaClientKnownRequestError &&
                        err.code === 'P2002' &&
                        attempt < maxAttempts - 1
                    ) {
                        lastError = err;
                        continue;
                    }
                    throw err;
                }
            }
            if (!payment) {
                throw (
                    lastError ??
                    new Error('Failed to persist fiat payment after retries')
                );
            }
            const effectiveExpiry = payment.expiresAt;

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

            return await this.mapToResponseDto(payment);
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
        return await this.mapToResponseDto(order.fiatPayment);
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

    /**
     * Handle a verified Telegram `successful_payment` update. Persists the
     * charge id + payer id (needed to refund later) into metadata, then drives
     * the standard paid -> order-completed sequence. Idempotent: a duplicate
     * update is a no-op once the order is COMPLETED.
     */
    async handleTelegramSuccessfulPayment(success: {
        invoicePayload: string;
        telegramPaymentChargeId: string;
        telegramUserId: number;
        totalAmount: number;
    }): Promise<void> {
        const payment = await this.databaseService.fiatPayment.findFirst({
            where: {
                gateway: PaymentGateway.TELEGRAM_STARS,
                externalId: success.invoicePayload,
            },
        });
        if (!payment) {
            this.logger.warn(
                { invoicePayload: success.invoicePayload },
                'Telegram successful_payment references unknown fiat payment'
            );
            return;
        }

        const baseMeta =
            payment.metadata && typeof payment.metadata === 'object'
                ? (payment.metadata as Record<string, unknown>)
                : {};
        await this.databaseService.fiatPayment.update({
            where: { id: payment.id },
            data: {
                metadata: {
                    ...baseMeta,
                    telegram_payment_charge_id: success.telegramPaymentChargeId,
                    telegram_user_id: success.telegramUserId,
                    telegram_total_stars: success.totalAmount,
                } as Prisma.InputJsonValue,
            },
        });

        await this.applyStatus(payment, FiatPaymentStatus.PAID, new Date());
    }

    /**
     * Refund a paid Telegram Stars order by returning the Stars to the payer
     * via the Bot API, then mark the FiatPayment REFUNDED. No-op when the order
     * was not paid with Stars or lacks the charge id we need. Throws on Bot API
     * failure so the caller (admin refund) can surface it.
     */
    async refundTelegramStarsPayment(orderId: string): Promise<void> {
        const payment = await this.databaseService.fiatPayment.findUnique({
            where: { orderId },
        });
        if (
            !payment ||
            payment.gateway !== PaymentGateway.TELEGRAM_STARS ||
            payment.status !== FiatPaymentStatus.PAID
        ) {
            return;
        }

        const meta =
            payment.metadata && typeof payment.metadata === 'object'
                ? (payment.metadata as Record<string, unknown>)
                : {};
        const chargeId = meta.telegram_payment_charge_id as string | undefined;
        const userId = Number(meta.telegram_user_id ?? 0);

        if (!chargeId || !userId) {
            this.logger.warn(
                { orderId, paymentId: payment.id },
                'Cannot refund Telegram Stars payment: missing charge id / user id'
            );
            return;
        }

        await this.telegramStarsGateway.refundStarPayment(userId, chargeId);

        await this.databaseService.fiatPayment.update({
            where: { id: payment.id },
            data: { status: FiatPaymentStatus.REFUNDED },
        });

        this.logger.info(
            { orderId, paymentId: payment.id },
            'Telegram Stars payment refunded'
        );
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

    private async mapToResponseDto(
        payment: FiatPayment
    ): Promise<FiatPaymentResponseDto> {
        // MANUAL_P2P (Chime/Venmo): derive a QR from the destination tag on read.
        // Stateless (no column), and a generation failure must never break the
        // checkout response — the FE falls back to a placeholder.
        let qrCode: string | undefined;
        if (payment.provider && payment.destinationTag) {
            try {
                qrCode = await generateP2PPaymentQRCode(
                    payment.provider,
                    payment.destinationTag,
                    payment.amount.toString(),
                    payment.requiredNote ?? undefined
                );
            } catch (error) {
                this.logger.warn(
                    { error, paymentId: payment.id },
                    'P2P QR generation failed'
                );
            }
        }

        return {
            paymentId: payment.id,
            orderId: payment.orderId,
            gateway: payment.gateway,
            amount: payment.amount.toString(),
            currency: payment.currency,
            checkoutUrl: payment.checkoutUrl ?? '',
            provider: payment.provider ?? undefined,
            destinationTag: payment.destinationTag ?? undefined,
            requiredNote: payment.requiredNote ?? undefined,
            qrCode,
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
                include: ORDER_CONFIRMED_EMAIL_INCLUDE,
            });
            if (!order || !order.user) return;

            const frontendUrl =
                this.configService.get<string>('app.frontendUrl') ??
                'http://localhost:3000';
            const numeric = Number(amountUsd);

            this.emailQueue.add(EMAIL_TEMPLATES.ORDER_CONFIRMED, {
                data: buildOrderConfirmedEmailData(order, {
                    paymentMethod: gateway,
                    totalAmountUsd: Number.isFinite(numeric) ? numeric : 0,
                    frontendUrl,
                }),
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
