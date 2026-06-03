import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { FiatPaymentStatus, PaymentGateway } from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';

import { FIAT_PAYMENT_QUEUE } from '../fiat-payment.constants';
import { FiatPaymentService } from '../services/fiat-payment.service';

interface ReconcileJobData {
    paymentId: string;
}
interface ExpireJobData {
    paymentId: string;
}
interface WebhookJobData {
    gateway: PaymentGateway;
    payload: unknown;
}

/**
 * Fiat Payment Processor
 * Handles reconcile / expire / webhook jobs and the scheduled cron delegates.
 * Mirrors PaymentVerificationProcessor (crypto). Request-scoped via
 * FiatPaymentService → OrderDeliveryService → ActivityLogEmitterService.
 */
@Processor(FIAT_PAYMENT_QUEUE)
@Injectable()
export class FiatPaymentProcessor {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly fiatPaymentService: FiatPaymentService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(FiatPaymentProcessor.name);
    }

    @Process('reconcile')
    async handleReconcile(job: Job<ReconcileJobData>): Promise<void> {
        await this.fiatPaymentService.reconcile(job.data.paymentId);
    }

    @Process('expire')
    async handleExpire(job: Job<ExpireJobData>): Promise<void> {
        await this.fiatPaymentService.expirePayment(job.data.paymentId);
    }

    @Process('process-webhook')
    async handleWebhook(job: Job<WebhookJobData>): Promise<void> {
        await this.fiatPaymentService.processWebhookEvent(
            job.data.gateway,
            job.data.payload
        );
    }

    /**
     * Scheduled: reconcile all active (pending/processing) fiat payments.
     * @Cron lives on FiatPaymentScheduler which delegates here.
     */
    async handlePendingReconcileCron(): Promise<void> {
        try {
            const active = await this.databaseService.fiatPayment.findMany({
                where: {
                    status: {
                        in: [
                            FiatPaymentStatus.PENDING,
                            FiatPaymentStatus.PROCESSING,
                        ],
                    },
                    expiresAt: { gt: new Date() },
                },
                select: { id: true },
                take: 100,
            });

            for (const p of active) {
                try {
                    await this.fiatPaymentService.reconcile(p.id);
                } catch (error) {
                    this.logger.error(
                        { error, paymentId: p.id },
                        'Failed to reconcile fiat payment in cron'
                    );
                }
            }
        } catch (error) {
            this.logger.error(
                { error },
                'Failed to run fiat payment reconcile cron'
            );
        }
    }

    /**
     * Scheduled: expire stale pending fiat payments past their window.
     * @Cron lives on FiatPaymentScheduler which delegates here.
     */
    async handleExpiredCron(): Promise<void> {
        try {
            const expired = await this.databaseService.fiatPayment.findMany({
                where: {
                    status: {
                        in: [
                            FiatPaymentStatus.PENDING,
                            FiatPaymentStatus.PROCESSING,
                        ],
                    },
                    expiresAt: { lt: new Date() },
                },
                select: { id: true },
                take: 100,
            });

            for (const p of expired) {
                try {
                    await this.fiatPaymentService.expirePayment(p.id);
                } catch (error) {
                    this.logger.error(
                        { error, paymentId: p.id },
                        'Failed to expire fiat payment in cron'
                    );
                }
            }
        } catch (error) {
            this.logger.error(
                { error },
                'Failed to run fiat payment expire cron'
            );
        }
    }
}
