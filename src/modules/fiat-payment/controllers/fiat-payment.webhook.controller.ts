import {
    BadRequestException,
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    Headers,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PinoLogger } from 'nestjs-pino';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PaymentGateway } from '@prisma/client';

import { PublicRoute } from 'src/common/request/decorators/request.public.decorator';

import { FIAT_PAYMENT_QUEUE } from '../fiat-payment.constants';
import { PaymentGatewayFactory } from '../gateways/payment-gateway.factory';

/** Header names different providers use to carry the signature. */
const SIGNATURE_HEADERS = [
    'x-signature',
    'x-webhook-signature',
    'x-chime-signature',
    'x-polapine-signature',
];

@Controller({ path: '/webhooks/payment', version: '1' })
export class FiatPaymentWebhookController {
    constructor(
        private readonly gatewayFactory: PaymentGatewayFactory,
        @InjectQueue(FIAT_PAYMENT_QUEUE)
        private readonly fiatPaymentQueue: Queue,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(FiatPaymentWebhookController.name);
    }

    @Post(':gateway')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    public async handleWebhook(
        @Param('gateway') gatewayParam: string,
        @Req() req: RawBodyRequest<Request>,
        @Headers() headers: Record<string, string>,
        @Body() body: unknown
    ): Promise<{ received: boolean }> {
        const gateway = this.resolveGateway(gatewayParam);
        const provider = this.gatewayFactory.getGateway(gateway);

        const signature = SIGNATURE_HEADERS.map(h => headers[h]).find(Boolean);
        const rawBody = req.rawBody;

        if (!rawBody || !signature) {
            this.logger.warn(
                { gateway, hasRawBody: !!rawBody, hasSignature: !!signature },
                'Webhook missing raw body or signature'
            );
            throw new BadRequestException('Missing webhook signature');
        }

        if (!provider.verifyWebhookSignature(rawBody, signature)) {
            this.logger.warn(
                { gateway },
                'Webhook signature verification failed'
            );
            throw new BadRequestException('Invalid webhook signature');
        }

        // Verified — enqueue for async processing and ack immediately.
        await this.fiatPaymentQueue.add(
            'process-webhook',
            { gateway, payload: body },
            {
                attempts: 5,
                backoff: { type: 'exponential', delay: 30_000 },
                removeOnComplete: true,
            }
        );

        return { received: true };
    }

    private resolveGateway(param: string): PaymentGateway {
        const upper = (param ?? '').toUpperCase();
        if (!(upper in PaymentGateway)) {
            throw new BadRequestException(`Unknown payment gateway: ${param}`);
        }
        return PaymentGateway[upper as keyof typeof PaymentGateway];
    }
}
