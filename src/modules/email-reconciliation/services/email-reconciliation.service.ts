import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import {
    FiatPaymentStatus,
    InboundPaymentStatus,
    P2PProvider,
    PaymentGateway,
    Prisma,
} from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';

import { FiatPaymentService } from 'src/modules/fiat-payment/services/fiat-payment.service';
import { normalizeNote } from 'src/modules/fiat-payment/utils/note-generator';

import { GmailClient, GmailMessage } from '../gmail/gmail.client';
import { EmailVerifier } from './email-verifier';
import { VenmoParser } from '../parsers/venmo.parser';
import { ChimeParser } from '../parsers/chime.parser';
import { IReceiptParser, ParsedReceipt } from '../parsers/parser.types';

// Amounts are compared in cents to avoid float noise.
const AMOUNT_EPSILON = 0.005;

/** Strip $/@ and non-alphanumerics, lowercase — for comparing tags/handles. */
function normalizeHandle(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Polls the notification mailbox and reconciles Chime/Venmo payments.
 *
 * For each new provider email: verify sender authenticity, parse it, then
 * auto-complete the matching PENDING MANUAL_P2P payment ONLY when ALL of these
 * hold — DKIM/SPF + trusted From domain (verifier), destination handle matches,
 * unique required note matches, exact amount matches, and the transaction id /
 * Gmail message id has not been seen (idempotency). Anything short of that is
 * stored UNMATCHED for the admin review queue, never auto-credited.
 */
@Injectable()
export class EmailReconciliationService {
    private readonly parsers: IReceiptParser[];

    constructor(
        private readonly gmail: GmailClient,
        private readonly verifier: EmailVerifier,
        private readonly venmoParser: VenmoParser,
        private readonly chimeParser: ChimeParser,
        private readonly databaseService: DatabaseService,
        private readonly fiatPaymentService: FiatPaymentService,
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(EmailReconciliationService.name);
        this.parsers = [this.venmoParser, this.chimeParser];
    }

    private cfg<T>(key: string, fallback: T): T {
        return (
            this.configService.get<T>(`paymentGateway.manualP2PEmail.${key}`) ??
            fallback
        );
    }

    /** One poll cycle. Safe no-op when disabled or unconfigured. */
    async poll(): Promise<void> {
        if (!this.cfg<boolean>('enabled', false)) return;
        if (!this.gmail.isConfigured()) {
            this.logger.warn(
                'P2P email reconciliation enabled but Gmail OAuth is not configured'
            );
            return;
        }

        const venmoDomain = this.cfg<string>('venmoFromDomain', 'venmo.com');
        const chimeDomain = this.cfg<string>('chimeFromDomain', 'chime.com');
        const lookbackHours = this.cfg<number>('pollLookbackHours', 48);
        const maxResults = this.cfg<number>('maxMessagesPerPoll', 25);
        const lookbackDays = Math.max(1, Math.ceil(lookbackHours / 24));

        const query = `from:(${venmoDomain} OR ${chimeDomain}) newer_than:${lookbackDays}d`;

        let ids: string[];
        try {
            ids = await this.gmail.listMessageIds(query, maxResults);
        } catch (error) {
            this.logger.error({ error }, 'Gmail list failed');
            return;
        }

        for (const id of ids) {
            try {
                await this.processMessage(id, { venmoDomain, chimeDomain });
            } catch (error) {
                this.logger.error(
                    { error, gmailMessageId: id },
                    'Failed to process inbound payment email'
                );
            }
        }
    }

    private async processMessage(
        gmailMessageId: string,
        domains: { venmoDomain: string; chimeDomain: string }
    ): Promise<void> {
        // Idempotency: every Gmail message id is unique and processed once.
        const already =
            await this.databaseService.inboundPaymentEmail.findUnique({
                where: { gmailMessageId },
                select: { id: true },
            });
        if (already) return;

        const message = await this.gmail.getMessage(gmailMessageId);
        const fromDomain = this.verifier.getFromDomain(message);
        const parser = this.parsers.find(p => p.matches(fromDomain));
        if (!parser) return; // not a recognized provider sender

        const allowedDomain =
            parser.provider === P2PProvider.VENMO
                ? domains.venmoDomain
                : domains.chimeDomain;

        // Sender-authenticity gate. Untrusted senders are dropped (logged), not
        // stored — keeps the review queue free of spoof/spam noise.
        if (!this.verifier.isAuthenticSender(message, allowedDomain)) {
            this.logger.warn(
                { gmailMessageId, fromDomain },
                'Dropping payment email failing From/DKIM/SPF checks'
            );
            return;
        }

        const receipt = parser.parse(message);
        await this.reconcileReceipt(gmailMessageId, message, receipt);
    }

    private async reconcileReceipt(
        gmailMessageId: string,
        message: GmailMessage,
        receipt: ParsedReceipt
    ): Promise<void> {
        const noteKey = normalizeNote(receipt.note);
        const receivedAt = message.internalDate
            ? new Date(Number(message.internalDate))
            : new Date();

        // Find the single PENDING payment whose unique note matches.
        const candidate = noteKey
            ? await this.databaseService.fiatPayment.findFirst({
                  where: {
                      gateway: PaymentGateway.MANUAL_P2P,
                      provider: receipt.provider,
                      status: FiatPaymentStatus.PENDING,
                      noteKey,
                  },
              })
            : null;

        // Match requires: candidate found + exact amount + destination handle.
        const amountOk =
            !!candidate &&
            receipt.amount != null &&
            Math.abs(Number(candidate.amount) - receipt.amount) <
                AMOUNT_EPSILON;
        const handleOk =
            !!candidate &&
            (!receipt.sentToHandle ||
                normalizeHandle(receipt.sentToHandle) ===
                    normalizeHandle(candidate.destinationTag));
        const notExpired = !!candidate && new Date() < candidate.expiresAt;

        const matched = !!candidate && amountOk && handleOk && notExpired;

        const data: Prisma.InboundPaymentEmailCreateInput = {
            provider: receipt.provider,
            amount: new Prisma.Decimal((receipt.amount ?? 0).toFixed(2)),
            note: receipt.note,
            noteKey: noteKey || null,
            payerName: receipt.payerName,
            externalTxId: receipt.externalTxId,
            sentToHandle: receipt.sentToHandle,
            gmailMessageId,
            receivedAt,
            status: matched
                ? InboundPaymentStatus.MATCHED
                : InboundPaymentStatus.UNMATCHED,
            ...(matched && candidate
                ? { fiatPayment: { connect: { id: candidate.id } } }
                : {}),
            raw: receipt as unknown as Prisma.InputJsonValue,
        };

        try {
            await this.databaseService.inboundPaymentEmail.create({ data });
        } catch (error) {
            // Duplicate transaction id / message id => already handled.
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                this.logger.debug(
                    { gmailMessageId, externalTxId: receipt.externalTxId },
                    'Duplicate inbound payment email skipped'
                );
                return;
            }
            throw error;
        }

        if (matched && candidate) {
            this.logger.info(
                {
                    paymentId: candidate.id,
                    orderId: candidate.orderId,
                    provider: receipt.provider,
                },
                'Inbound email matched a pending payment; completing order'
            );
            await this.fiatPaymentService.markPaidAndComplete(candidate.id);
        } else {
            this.logger.warn(
                {
                    gmailMessageId,
                    provider: receipt.provider,
                    hasCandidate: !!candidate,
                    amountOk,
                    handleOk,
                    notExpired,
                },
                'Inbound payment email could not be auto-matched; queued for review'
            );
        }
    }
}
