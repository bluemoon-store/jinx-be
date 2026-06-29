import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CommonModule } from 'src/common/common.module';
import { RequestModule } from 'src/common/request/request.module';
import { CustomLoggerModule } from 'src/common/logger/logger.module';
import { workerOnlyProviders } from 'src/common/utils/role.util';
import { FiatPaymentModule } from 'src/modules/fiat-payment/fiat-payment.module';

import { GmailClient } from './gmail/gmail.client';
import { EmailVerifier } from './services/email-verifier';
import { VenmoParser } from './parsers/venmo.parser';
import { ChimeParser } from './parsers/chime.parser';
import { EmailReconciliationService } from './services/email-reconciliation.service';
import { EmailReconciliationScheduler } from './schedulers/email-reconciliation.scheduler';
import { InboundPaymentAdminService } from './services/inbound-payment.admin.service';
import { InboundPaymentAdminController } from './controllers/inbound-payment.admin.controller';

/**
 * Email reconciliation for MANUAL_P2P (Chime/Venmo). Polls the notification
 * mailbox (Gmail), parses "you got paid" emails, and auto-completes matching
 * pending payments. Exposes the admin review queue for unmatched emails.
 */
@Module({
    imports: [
        ConfigModule,
        CommonModule, // DatabaseService
        RequestModule, // role guard for admin controller
        CustomLoggerModule, // PinoLogger
        FiatPaymentModule, // FiatPaymentService.markPaidAndComplete
    ],
    controllers: [InboundPaymentAdminController],
    providers: [
        GmailClient,
        EmailVerifier,
        VenmoParser,
        ChimeParser,
        EmailReconciliationService,
        InboundPaymentAdminService,
        // Poll cron — worker container only.
        ...workerOnlyProviders([EmailReconciliationScheduler]),
    ],
    exports: [EmailReconciliationService],
})
export class EmailReconciliationModule {}
