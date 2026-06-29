import {
    Body,
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Post,
    UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { PublicRoute } from 'src/common/request/decorators/request.public.decorator';

import { TelegramStarsGateway } from '../gateways/telegram-stars-gateway.service';
import { FiatPaymentService } from '../services/fiat-payment.service';

/**
 * Telegram bot webhook for Stars payments.
 *
 * Separate from the generic `/webhooks/payment/:gateway` endpoint because a
 * Telegram update has its own shape and the `pre_checkout_query` MUST be
 * answered synchronously (within ~10s) — it cannot be deferred to a queue.
 *
 * Authentication is the secret token Telegram echoes in the
 * `X-Telegram-Bot-Api-Secret-Token` header (configured via setWebhook), not an
 * HMAC body signature.
 */
@Controller({ path: '/webhooks/telegram', version: '1' })
export class TelegramWebhookController {
    private readonly webhookSecret: string;

    constructor(
        private readonly telegramStarsGateway: TelegramStarsGateway,
        private readonly fiatPaymentService: FiatPaymentService,
        configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(TelegramWebhookController.name);
        this.webhookSecret =
            configService.get<string>(
                'paymentGateway.telegramStars.webhookSecret'
            ) ?? '';
    }

    @Post()
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    public async handleUpdate(
        @Headers('x-telegram-bot-api-secret-token') secretToken: string,
        @Body() update: unknown
    ): Promise<{ ok: boolean }> {
        // When a secret is configured, every legitimate Telegram call carries it.
        if (this.webhookSecret && secretToken !== this.webhookSecret) {
            this.logger.warn(
                { hasToken: !!secretToken },
                'Telegram webhook rejected: bad secret token'
            );
            throw new UnauthorizedException('Invalid webhook token');
        }

        // 1) Pre-checkout: authorise the charge synchronously or it times out.
        const preCheckout =
            this.telegramStarsGateway.extractPreCheckout(update);
        if (preCheckout) {
            await this.telegramStarsGateway.answerPreCheckoutQuery(
                preCheckout.id,
                true
            );
            return { ok: true };
        }

        // 2) Successful payment: persist charge id + complete the order.
        const success =
            this.telegramStarsGateway.extractSuccessfulPayment(update);
        if (success) {
            try {
                await this.fiatPaymentService.handleTelegramSuccessfulPayment(
                    success
                );
            } catch (error) {
                // Don't 500 back to Telegram (it would retry the whole update);
                // log and ack — the reconcile/expiry safety nets still apply.
                this.logger.error(
                    { error, invoicePayload: success.invoicePayload },
                    'Failed to process Telegram successful_payment'
                );
            }
            return { ok: true };
        }

        // 3) Any other update type (plain messages, etc.) — ignore.
        return { ok: true };
    }
}
