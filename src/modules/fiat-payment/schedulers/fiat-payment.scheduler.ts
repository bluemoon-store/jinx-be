import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';

import { FiatPaymentProcessor } from '../processors/fiat-payment.processor';

/**
 * Singleton holder for fiat-payment cron jobs.
 *
 * FiatPaymentProcessor transitively depends on a REQUEST-scoped provider
 * (OrderDeliveryService -> ActivityLogEmitterService), so @nestjs/schedule
 * refuses to register @Cron handlers on it. This default-scoped singleton
 * resolves a fresh processor via ModuleRef each tick — same pattern as
 * PaymentScheduler in the crypto-payment module.
 */
@Injectable()
export class FiatPaymentScheduler {
    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(FiatPaymentScheduler.name);
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async handlePendingReconcileCron(): Promise<void> {
        try {
            const processor =
                await this.moduleRef.resolve(FiatPaymentProcessor);
            await processor.handlePendingReconcileCron();
        } catch (error) {
            this.logger.error(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                },
                'Failed to execute handlePendingReconcileCron'
            );
        }
    }

    @Cron('*/5 * * * *')
    async handleExpiredCron(): Promise<void> {
        try {
            const processor =
                await this.moduleRef.resolve(FiatPaymentProcessor);
            await processor.handleExpiredCron();
        } catch (error) {
            this.logger.error(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                },
                'Failed to execute handleExpiredCron'
            );
        }
    }
}
