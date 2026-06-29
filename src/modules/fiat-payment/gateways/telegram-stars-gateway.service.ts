import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { FiatPaymentStatus, PaymentGateway } from '@prisma/client';

import { BaseFiatGateway } from './base-fiat-gateway';
import {
    CreateCheckoutParams,
    CreateCheckoutResult,
    GatewayStatusResult,
    GatewayWebhookEvent,
    IPaymentGateway,
} from '../interfaces/payment-gateway.interface';

/** A successful_payment extracted from a Telegram bot update. */
export interface TelegramSuccessfulPayment {
    invoicePayload: string; // echoes our payload -> our externalId
    telegramPaymentChargeId: string; // needed to refund
    telegramUserId: number; // payer, needed to refund
    totalAmount: number; // Stars actually charged (XTR)
}

/** A pre_checkout_query extracted from a Telegram bot update. */
export interface TelegramPreCheckout {
    id: string; // pre_checkout_query id to answer
    invoicePayload: string;
    totalAmount: number; // Stars the buyer is about to pay
}

/**
 * Telegram Stars (XTR) gateway.
 *
 * Telegram Stars is NOT a hosted-redirect gateway: there is no status-poll
 * endpoint and confirmation arrives only as a `successful_payment` bot update.
 * This class therefore:
 *   - createCheckout()  -> Bot API `createInvoiceLink` (currency XTR, empty
 *                          provider_token); the returned `t.me/$…` link is the
 *                          "checkout url" and our own `payload` is the externalId.
 *   - getStatus()       -> no-op (Telegram exposes no invoice status query).
 *   - verifyWebhookSignature() -> unused; the Telegram webhook controller
 *                          authenticates via the secret-token header instead.
 *   - parseWebhookEvent()-> maps a successful_payment update to a PAID event.
 * Pre-checkout answering and refunds are Telegram-specific helpers the
 * webhook/refund flows call directly (not part of IPaymentGateway).
 */
@Injectable()
export class TelegramStarsGateway
    extends BaseFiatGateway
    implements IPaymentGateway
{
    private readonly configuredStarUsdRate: number;

    constructor(configService: ConfigService, logger: PinoLogger) {
        const cfg =
            configService.get<Record<string, any>>(
                'paymentGateway.telegramStars'
            ) ?? {};

        const apiBaseUrl = (cfg.apiBaseUrl ||
            'https://api.telegram.org') as string;
        const botToken = (cfg.botToken ?? '') as string;

        super(configService, logger, 'TELEGRAM_STARS', {
            // All Bot API methods hang off https://api.telegram.org/bot<token>/
            baseUrl: `${apiBaseUrl}/bot${botToken}`,
            headers: {},
        });

        this.configuredStarUsdRate =
            typeof cfg.starUsdRate === 'number' && cfg.starUsdRate > 0
                ? cfg.starUsdRate
                : 0.013;
    }

    getGatewayName(): PaymentGateway {
        return PaymentGateway.TELEGRAM_STARS;
    }

    /**
     * Create a Telegram Stars invoice link for the order.
     *
     * The integer Stars amount is resolved upstream (FiatPaymentService) from
     * the admin/env USD-per-Star rate and passed via `params.starAmount`; we
     * fall back to the env rate here only as a safety net.
     */
    async createCheckout(
        params: CreateCheckoutParams
    ): Promise<CreateCheckoutResult> {
        try {
            const stars =
                params.starAmount && params.starAmount > 0
                    ? Math.ceil(params.starAmount)
                    : Math.max(
                          1,
                          Math.ceil(params.amount / this.configuredStarUsdRate)
                      );

            // Telegram echoes `payload` back on pre_checkout + successful_payment;
            // we use the stable order number as our externalId for lookups.
            const payload = params.orderNumber;

            const body = {
                title: `Order ${params.orderNumber}`.slice(0, 32),
                description: `Payment for order ${params.orderNumber}`.slice(
                    0,
                    255
                ),
                payload,
                provider_token: '', // MUST be empty for Telegram Stars
                currency: 'XTR',
                prices: [{ label: 'Total', amount: stars }],
            };

            const link = await this.callBotApi<string>(
                'createInvoiceLink',
                body
            );

            return {
                externalId: payload,
                checkoutUrl: link,
                externalReference: params.orderNumber,
                raw: { invoiceLink: link, stars, currency: 'XTR' },
            };
        } catch (error) {
            this.handleGatewayError(error, 'createCheckout');
        }
    }

    /**
     * Telegram has no invoice-status query — payment is confirmed only via the
     * `successful_payment` webhook update. Returning PENDING keeps the reconcile
     * cron a no-op so the invoice simply expires locally if never paid.
     */
    async getStatus(_externalId: string): Promise<GatewayStatusResult> {
        return { status: FiatPaymentStatus.PENDING };
    }

    /**
     * Not used: the Telegram webhook is authenticated by the secret-token header
     * (validated in TelegramWebhookController), not by an HMAC body signature.
     */
    verifyWebhookSignature(_rawBody: Buffer, _signature: string): boolean {
        return false;
    }

    /** Map a Telegram `successful_payment` update to a normalised PAID event. */
    parseWebhookEvent(payload: unknown): GatewayWebhookEvent {
        const success = this.extractSuccessfulPayment(payload);
        return {
            externalId: success?.invoicePayload ?? '',
            status: FiatPaymentStatus.PAID,
            paidAt: new Date(),
            raw: payload,
        };
    }

    /**
     * Pull the pre_checkout_query out of a bot update, if present. The webhook
     * controller answers this synchronously to authorise the charge.
     */
    extractPreCheckout(update: unknown): TelegramPreCheckout | null {
        const q = (update as any)?.pre_checkout_query;
        if (!q?.id) return null;
        return {
            id: String(q.id),
            invoicePayload: String(q.invoice_payload ?? ''),
            totalAmount: Number(q.total_amount ?? 0),
        };
    }

    /**
     * Pull a successful_payment out of a bot update's message, if present.
     * Carries the charge id + payer id we persist for later refunds.
     */
    extractSuccessfulPayment(
        update: unknown
    ): TelegramSuccessfulPayment | null {
        const message = (update as any)?.message ?? update;
        const sp = (message as any)?.successful_payment;
        if (!sp?.invoice_payload) return null;
        return {
            invoicePayload: String(sp.invoice_payload),
            telegramPaymentChargeId: String(
                sp.telegram_payment_charge_id ?? ''
            ),
            telegramUserId: Number((message as any)?.from?.id ?? 0),
            totalAmount: Number(sp.total_amount ?? 0),
        };
    }

    /** Authorise (or reject) a pending Stars charge. Must run within ~10s. */
    async answerPreCheckoutQuery(
        preCheckoutQueryId: string,
        ok: boolean,
        errorMessage?: string
    ): Promise<void> {
        try {
            await this.callBotApi('answerPreCheckoutQuery', {
                pre_checkout_query_id: preCheckoutQueryId,
                ok,
                ...(ok
                    ? {}
                    : {
                          error_message:
                              errorMessage ?? 'Payment could not be processed',
                      }),
            });
        } catch (error) {
            this.handleGatewayError(error, 'answerPreCheckoutQuery');
        }
    }

    /** Refund a completed Stars payment back to the payer. */
    async refundStarPayment(
        telegramUserId: number,
        telegramPaymentChargeId: string
    ): Promise<void> {
        try {
            await this.callBotApi('refundStarPayment', {
                user_id: telegramUserId,
                telegram_payment_charge_id: telegramPaymentChargeId,
            });
        } catch (error) {
            this.handleGatewayError(error, 'refundStarPayment');
        }
    }

    /**
     * Call a Bot API method and unwrap the `{ ok, result }` envelope. Telegram
     * returns non-2xx with `{ ok:false, description }` on failure, which axios
     * turns into an error handled by handleGatewayError; we also guard against a
     * 200 with `ok:false`.
     */
    private async callBotApi<T = unknown>(
        method: string,
        body: Record<string, unknown>
    ): Promise<T> {
        const response = await this.httpClient.post(`/${method}`, body);
        const data = response.data;
        if (!data?.ok) {
            throw new Error(
                `Telegram ${method} failed: ${data?.description ?? 'unknown error'}`
            );
        }
        return data.result as T;
    }
}
