import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from 'src/common/database/services/database.service';
import { IEmailAttachment } from 'src/common/email/interfaces/smtp.service.interface';

interface OrderImageMeta {
    orderNumber: string;
    paymentMethod: string;
    amount: string;
    date: string;
}

@Injectable()
export class OrderImageService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(OrderImageService.name);
    }

    /**
     * Renders an order-summary PNG via the jinx-pdf service and returns it as an
     * email attachment. Returns null (never throws) when unconfigured or on any
     * error, so order-confirmation emails still send without the image.
     */
    async generateOrderImage(
        orderId: string | undefined,
        meta: OrderImageMeta
    ): Promise<IEmailAttachment | null> {
        const baseUrl = this.configService.get<string>('render.pdfServiceUrl');
        const secret = this.configService.get<string>('render.secret');
        if (!orderId || !baseUrl || !secret) {
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

            const res = await axios.post(
                `${baseUrl.replace(/\/$/, '')}/api/order-image`,
                dto,
                {
                    headers: { 'x-render-secret': secret },
                    responseType: 'arraybuffer',
                    timeout: 10000,
                }
            );

            return {
                filename: `order-${meta.orderNumber}.png`,
                content: Buffer.from(res.data),
                contentType: 'image/png',
            };
        } catch (error) {
            this.logger.warn(
                { orderId, error: error.message },
                'Failed to render order-summary image; sending email without it'
            );
            return null;
        }
    }
}
