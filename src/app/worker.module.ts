import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { CommonModule } from 'src/common/common.module';
import { ActivityLogModule } from 'src/modules/activity-log/activity-log.module';
import { CryptoPaymentModule } from 'src/modules/crypto-payment/crypto-payment.module';
import { FiatPaymentModule } from 'src/modules/fiat-payment/fiat-payment.module';
import { EmailReconciliationModule } from 'src/modules/email-reconciliation/email-reconciliation.module';
import { OrderModule } from 'src/modules/order/order.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';
import { WorkerModule } from 'src/workers/worker.module';

/**
 * Bootstrap module for the worker container (APP_ROLE=worker).
 *
 * Imports only what background jobs need: Bull processors, schedulers,
 * and the feature modules they depend on (orders, wallets, crypto payments,
 * activity logs). HTTP controllers, swagger, and websocket adapters are
 * intentionally excluded — workers do not serve traffic.
 */
@Module({
    imports: [
        CommonModule,
        ScheduleModule.forRoot(),
        ActivityLogModule,
        WorkerModule,
        OrderModule,
        WalletModule,
        CryptoPaymentModule,
        FiatPaymentModule,
        EmailReconciliationModule,
    ],
})
export class WorkerAppModule {}
