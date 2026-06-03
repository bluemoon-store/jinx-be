import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { createHmac, timingSafeEqual } from 'crypto';
import { FiatPaymentStatus, PaymentGateway } from '@prisma/client';

import { BaseFiatGateway } from './base-fiat-gateway';
import {
    CreateCheckoutParams,
    CreateCheckoutResult,
    GatewayStatusResult,
    GatewayWebhookEvent,
    IPaymentGateway,
} from '../interfaces/payment-gateway.interface';

/**
 * CHIME (Polapine) hosted payment gateway.
 *
 * NOTE: the exact request/response field names and the webhook signature
 * scheme are not published in the public docs. Everything provider-specific
 * is isolated in this file — defensive field extraction (`pick`) and the
 * status map below are the only places to adjust once verified against the
 * sandbox (`GET /info`, then a live `create-invoice` round-trip).
 */
@Injectable()
export class ChimeGateway extends BaseFiatGateway implements IPaymentGateway {
    private readonly brandSlug: string;
    private readonly webhookSecret: string;

    constructor(configService: ConfigService, logger: PinoLogger) {
        const chime =
            configService.get<Record<string, any>>('paymentGateway.chime') ??
            {};

        const baseUrl =
            chime.environment === 'production'
                ? chime.baseUrl
                : chime.sandboxUrl;

        super(configService, logger, 'CHIME', {
            baseUrl,
            headers: {
                'X-API-Key': chime.apiKey ?? '',
                'X-API-Secret': chime.apiSecret ?? '',
            },
        });

        this.brandSlug = chime.brandSlug ?? '';
        this.webhookSecret = chime.webhookSecret ?? '';
    }

    getGatewayName(): PaymentGateway {
        return PaymentGateway.CHIME;
    }

    async createCheckout(
        params: CreateCheckoutParams
    ): Promise<CreateCheckoutResult> {
        try {
            // POST /create-invoice — the RECOMMENDED endpoint (brand slug +
            // order_reference + metadata). Field names are provisional.
            const body: Record<string, unknown> = {
                brand: this.brandSlug || undefined,
                amount: params.amount,
                currency: params.currency,
                order_reference: params.orderNumber,
                return_url: params.returnUrl,
                metadata: { orderId: params.orderId },
            };

            const response = await this.httpClient.post(
                '/create-invoice',
                body
            );
            const data = this.unwrap(response.data);

            const externalId = this.pick<string>(data, [
                'id',
                'invoice_id',
                'payment_link_id',
                'link_id',
                'reference',
            ]);
            const checkoutUrl = this.pick<string>(data, [
                'url',
                'payment_url',
                'checkout_url',
                'invoice_url',
                'link',
                'hosted_url',
            ]);

            if (!externalId || !checkoutUrl) {
                throw new Error(
                    'CHIME create-invoice response missing id or checkout url'
                );
            }

            const expiresRaw = this.pick<string>(data, [
                'expires_at',
                'expiry',
                'expiresAt',
            ]);

            return {
                externalId,
                checkoutUrl,
                expiresAt: expiresRaw ? new Date(expiresRaw) : undefined,
                externalReference: params.orderNumber,
                raw: response.data,
            };
        } catch (error) {
            this.handleGatewayError(error, 'createCheckout');
        }
    }

    async getStatus(externalId: string): Promise<GatewayStatusResult> {
        try {
            const response = await this.httpClient.get(
                `/payment-link/${encodeURIComponent(externalId)}/status`
            );
            const data = this.unwrap(response.data);

            const rawStatus = this.pick<string>(data, [
                'status',
                'state',
                'payment_status',
            ]);
            const paidRaw = this.pick<string>(data, [
                'paid_at',
                'paidAt',
                'completed_at',
            ]);

            return {
                status: this.mapStatus(rawStatus),
                paidAt: paidRaw ? new Date(paidRaw) : undefined,
                raw: response.data,
            };
        } catch (error) {
            this.handleGatewayError(error, 'getStatus');
        }
    }

    verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
        if (!this.webhookSecret || !signature || !rawBody?.length) {
            return false;
        }

        // Assume HMAC-SHA256(rawBody, secret) hex; tolerate a "sha256=" prefix.
        const provided = signature.replace(/^sha256=/i, '').trim();
        const expected = createHmac('sha256', this.webhookSecret)
            .update(rawBody)
            .digest('hex');

        const a = Buffer.from(provided, 'hex');
        const b = Buffer.from(expected, 'hex');
        if (a.length !== b.length || a.length === 0) {
            return false;
        }
        return timingSafeEqual(a, b);
    }

    parseWebhookEvent(payload: unknown): GatewayWebhookEvent {
        const root = (payload ?? {}) as Record<string, any>;
        const data = this.unwrap(root);

        const externalId = this.pick<string>(data, [
            'id',
            'invoice_id',
            'payment_link_id',
            'link_id',
            'reference',
        ]);
        const rawStatus =
            this.pick<string>(root, ['event', 'type']) ??
            this.pick<string>(data, ['status', 'state', 'payment_status']);
        const paidRaw = this.pick<string>(data, [
            'paid_at',
            'paidAt',
            'completed_at',
        ]);

        return {
            externalId: externalId ?? '',
            status: this.mapStatus(rawStatus),
            paidAt: paidRaw ? new Date(paidRaw) : undefined,
            raw: payload,
        };
    }

    /** Map a CHIME status/event string to our FiatPaymentStatus enum. */
    private mapStatus(raw?: string | null): FiatPaymentStatus {
        const s = (raw ?? '').toString().toLowerCase();

        if (/(paid|completed|success|settled|payment\.?succeeded)/.test(s)) {
            return FiatPaymentStatus.PAID;
        }
        if (/(processing|pending\.?confirm|in_progress)/.test(s)) {
            return FiatPaymentStatus.PROCESSING;
        }
        if (/(expired)/.test(s)) {
            return FiatPaymentStatus.EXPIRED;
        }
        if (/(cancel)/.test(s)) {
            return FiatPaymentStatus.CANCELLED;
        }
        if (/(refund)/.test(s)) {
            return FiatPaymentStatus.REFUNDED;
        }
        if (/(fail|declin|error|reject)/.test(s)) {
            return FiatPaymentStatus.FAILED;
        }
        return FiatPaymentStatus.PENDING;
    }

    /** CHIME wraps payloads in a `data` envelope; fall back to the root. */
    private unwrap(payload: any): Record<string, any> {
        if (payload && typeof payload === 'object' && payload.data) {
            return payload.data as Record<string, any>;
        }
        return (payload ?? {}) as Record<string, any>;
    }

    /** Return the first present, non-empty value among candidate keys. */
    private pick<T>(obj: Record<string, any>, keys: string[]): T | undefined {
        for (const key of keys) {
            const value = obj?.[key];
            if (value !== undefined && value !== null && value !== '') {
                return value as T;
            }
        }
        return undefined;
    }
}
