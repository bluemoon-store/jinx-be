import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
    FiatPaymentStatus,
    InboundPaymentStatus,
    PaymentGateway,
    Prisma,
} from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';

import { FiatPaymentService } from 'src/modules/fiat-payment/services/fiat-payment.service';

import {
    InboundPaymentListQueryDto,
    InboundPaymentResponseDto,
} from '../dtos/inbound-payment.dto';

/**
 * Admin operations over parsed inbound payment emails — the review queue for
 * Chime/Venmo notifications the auto-reconciler could not confidently match.
 */
@Injectable()
export class InboundPaymentAdminService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly fiatPaymentService: FiatPaymentService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(InboundPaymentAdminService.name);
    }

    private toDto(row: {
        id: string;
        provider: InboundPaymentResponseDto['provider'];
        amount: Prisma.Decimal;
        note: string | null;
        payerName: string | null;
        externalTxId: string | null;
        sentToHandle: string | null;
        status: InboundPaymentStatus;
        fiatPaymentId: string | null;
        fiatPayment?: { orderId: string } | null;
        receivedAt: Date;
        createdAt: Date;
    }): InboundPaymentResponseDto {
        return {
            id: row.id,
            provider: row.provider,
            amount: row.amount.toString(),
            note: row.note,
            payerName: row.payerName,
            externalTxId: row.externalTxId,
            sentToHandle: row.sentToHandle,
            status: row.status,
            fiatPaymentId: row.fiatPaymentId,
            orderId: row.fiatPayment?.orderId ?? null,
            receivedAt: row.receivedAt,
            createdAt: row.createdAt,
        };
    }

    async list(
        query: InboundPaymentListQueryDto
    ): Promise<ApiPaginatedDataDto<InboundPaymentResponseDto>> {
        const where: Prisma.InboundPaymentEmailWhereInput = {
            ...(query.status ? { status: query.status } : {}),
            ...(query.provider ? { provider: query.provider } : {}),
        };
        const [total, rows] = await this.databaseService.$transaction([
            this.databaseService.inboundPaymentEmail.count({ where }),
            this.databaseService.inboundPaymentEmail.findMany({
                where,
                include: { fiatPayment: { select: { orderId: true } } },
                orderBy: { receivedAt: 'desc' },
                skip: (query.page - 1) * query.limit,
                take: query.limit,
            }),
        ]);

        return {
            items: rows.map(r => this.toDto(r)),
            metadata: {
                currentPage: query.page,
                itemsPerPage: query.limit,
                totalItems: total,
                totalPages: Math.ceil(total / query.limit) || 1,
            },
        };
    }

    /**
     * Manually credit an UNMATCHED inbound email to an order's pending payment.
     * Accepts either the human-readable order number or the order id.
     */
    async matchToOrder(
        inboundId: string,
        orderRef: string
    ): Promise<InboundPaymentResponseDto> {
        const inbound =
            await this.databaseService.inboundPaymentEmail.findUnique({
                where: { id: inboundId },
            });
        if (!inbound) throw new NotFoundException('Inbound payment not found');
        if (inbound.status === InboundPaymentStatus.MATCHED) {
            throw new BadRequestException('Already matched');
        }

        const order = await this.databaseService.order.findFirst({
            where: { OR: [{ id: orderRef }, { orderNumber: orderRef }] },
            select: { id: true },
        });
        if (!order) throw new NotFoundException('Order not found');

        const payment = await this.databaseService.fiatPayment.findUnique({
            where: { orderId: order.id },
        });
        if (!payment || payment.gateway !== PaymentGateway.MANUAL_P2P) {
            throw new BadRequestException(
                'Order has no manual P2P payment to credit'
            );
        }
        if (payment.status === FiatPaymentStatus.PAID) {
            throw new BadRequestException('Order is already paid');
        }

        await this.databaseService.inboundPaymentEmail.update({
            where: { id: inboundId },
            data: {
                status: InboundPaymentStatus.MATCHED,
                fiatPaymentId: payment.id,
            },
        });

        await this.fiatPaymentService.markPaidAndComplete(payment.id);

        this.logger.info(
            { inboundId, orderId: order.id, paymentId: payment.id },
            'Inbound payment manually matched and order completed'
        );

        const refreshed =
            await this.databaseService.inboundPaymentEmail.findUniqueOrThrow({
                where: { id: inboundId },
                include: { fiatPayment: { select: { orderId: true } } },
            });
        return this.toDto(refreshed);
    }

    /** Dismiss an inbound email (spam/duplicate/unrelated). */
    async ignore(inboundId: string): Promise<InboundPaymentResponseDto> {
        const inbound =
            await this.databaseService.inboundPaymentEmail.findUnique({
                where: { id: inboundId },
            });
        if (!inbound) throw new NotFoundException('Inbound payment not found');
        if (inbound.status === InboundPaymentStatus.MATCHED) {
            throw new BadRequestException('Cannot ignore a matched payment');
        }

        const updated = await this.databaseService.inboundPaymentEmail.update({
            where: { id: inboundId },
            data: { status: InboundPaymentStatus.IGNORED },
            include: { fiatPayment: { select: { orderId: true } } },
        });
        return this.toDto(updated);
    }
}
