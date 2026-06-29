import { BadRequestException, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { FiatPaymentStatus, PaymentGateway } from '@prisma/client';

import {
    CreateCheckoutParams,
    CreateCheckoutResult,
    GatewayStatusResult,
    GatewayWebhookEvent,
    IPaymentGateway,
} from '../interfaces/payment-gateway.interface';
import { generatePaymentNote } from '../utils/note-generator';

/**
 * MANUAL_P2P gateway — self-hosted Chime/Venmo "pay to a $tag/@handle" flow.
 *
 * Unlike hosted gateways (CHIME/Polapine, Telegram Stars) this calls NO external
 * API: there is no Chime/Venmo payments API. `createCheckout` only mints a
 * unique required note and packages the buyer-facing instructions; the actual
 * "did money arrive?" signal comes from parsing the provider's notification
 * email (see the email-reconciliation module), which flips the local
 * FiatPayment to PAID directly. Hence `getStatus` just reports PENDING (the
 * reconcile cron relies on local expiry, not a remote poll) and the webhook
 * hooks are inert.
 */
@Injectable()
export class ManualP2PGateway implements IPaymentGateway {
    constructor(private readonly logger: PinoLogger) {
        this.logger.setContext(ManualP2PGateway.name);
    }

    getGatewayName(): PaymentGateway {
        return PaymentGateway.MANUAL_P2P;
    }

    async createCheckout(
        params: CreateCheckoutParams
    ): Promise<CreateCheckoutResult> {
        if (!params.provider) {
            throw new BadRequestException(
                'MANUAL_P2P checkout requires a provider (CHIME or VENMO)'
            );
        }
        if (!params.destinationTag) {
            throw new BadRequestException(
                'This payment method is not configured (missing tag/handle)'
            );
        }

        const { note, noteKey } = generatePaymentNote();

        // No external invoice exists; mint a local reference so the rest of the
        // pipeline (reconcile job, status reads) has a stable externalId.
        const externalId = `p2p_${params.provider.toLowerCase()}_${randomUUID()}`;

        return {
            externalId,
            externalReference: params.orderNumber,
            expiresAt: params.expiresAt,
            instructions: {
                provider: params.provider,
                tag: params.destinationTag,
                note,
                noteKey,
            },
        };
    }

    // No remote system to poll — the email reconciler is the source of truth and
    // updates the FiatPayment directly. Reporting PENDING keeps the reconcile
    // cron a no-op (it still applies time-based expiry separately).
    async getStatus(): Promise<GatewayStatusResult> {
        return { status: FiatPaymentStatus.PENDING };
    }

    verifyWebhookSignature(): boolean {
        return false;
    }

    parseWebhookEvent(): GatewayWebhookEvent {
        return { externalId: '', status: FiatPaymentStatus.PENDING };
    }
}
