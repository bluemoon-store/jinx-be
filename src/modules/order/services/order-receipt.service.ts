import { Injectable } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from 'src/common/database/services/database.service';
import { IEmailAttachment } from 'src/common/email/interfaces/smtp.service.interface';
import { OrderReceiptDocument } from '../reports/order-receipt.document';

interface OrderReceiptMeta {
    orderNumber: string;
    paymentMethod: string;
    amount: string;
    date: string;
}

@Injectable()
export class OrderReceiptService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(OrderReceiptService.name);
    }

    /**
     * Renders an order-summary PDF locally (via @react-pdf/renderer) and returns
     * it as an email attachment. Returns null (never throws) when there is no
     * order or on any error, so order-confirmation emails still send without it.
     */
    async generateOrderReceipt(
        orderId: string | undefined,
        meta: OrderReceiptMeta
    ): Promise<IEmailAttachment | null> {
        if (!orderId) {
            return null;
        }

        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: { items: { include: { product: true } } },
            });
            if (!order) return null;

            const dto = {
                orderNumber: meta.orderNumber,
                date: meta.date,
                paymentMethod: meta.paymentMethod,
                amount: meta.amount,
                currency: order.currency,
                items: order.items.map(item => ({
                    name: item.product?.name ?? 'Product',
                    variant: item.variantLabel ?? null,
                    quantity: item.quantity,
                    unitPrice: item.priceAtPurchase.toString(),
                })),
            };

            const content = await renderToBuffer(OrderReceiptDocument(dto));

            return {
                filename: `order-${meta.orderNumber}.pdf`,
                content,
                contentType: 'application/pdf',
            };
        } catch (error) {
            this.logger.warn(
                { orderId, error: error.message },
                'Failed to render order-summary PDF; sending email without it'
            );
            return null;
        }
    }
}
