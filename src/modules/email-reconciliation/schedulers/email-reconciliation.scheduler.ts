import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';

import { EmailReconciliationService } from '../services/email-reconciliation.service';

/**
 * Singleton holder for the email-reconciliation poll cron.
 *
 * EmailReconciliationService transitively depends on a REQUEST-scoped provider
 * (FiatPaymentService -> OrderDeliveryService -> ActivityLogEmitterService), so
 * @nestjs/schedule cannot register a @Cron directly on it. This default-scoped
 * singleton resolves a fresh instance via ModuleRef each tick — same pattern as
 * FiatPaymentScheduler.
 */
@Injectable()
export class EmailReconciliationScheduler {
    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(EmailReconciliationScheduler.name);
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async handlePollCron(): Promise<void> {
        try {
            const service = await this.moduleRef.resolve(
                EmailReconciliationService
            );
            await service.poll();
        } catch (error) {
            this.logger.error(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                },
                'Failed to execute email reconciliation poll'
            );
        }
    }
}
