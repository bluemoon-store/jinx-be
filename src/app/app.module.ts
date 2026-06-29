import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ScheduleModule } from '@nestjs/schedule';

import { CommonModule } from 'src/common/common.module';
import { UserModule } from 'src/modules/user/user.module';
import { ProductModule } from 'src/modules/product/product.module';
import { CartModule } from 'src/modules/cart/cart.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';
import { OrderModule } from 'src/modules/order/order.module';
import { TicketModule } from 'src/modules/ticket/ticket.module';
import { WorkerModule } from 'src/workers/worker.module';
import { ReviewModule } from 'src/modules/review/review.module';
import { CouponModule } from 'src/modules/coupon/coupon.module';
import { ActivityLogModule } from 'src/modules/activity-log/activity-log.module';
import { VouchModule } from 'src/modules/vouch/vouch.module';
import { DropModule } from 'src/modules/drop/drop.module';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { LegalModule } from 'src/modules/legal/legal.module';
import { FaqModule } from 'src/modules/faq/faq.module';
import { FileModule } from 'src/modules/file/file.module';
import { DashboardModule } from 'src/modules/dashboard/dashboard.module';

import { HealthController } from './controllers/health.controller';
import { CryptoPaymentModule } from 'src/modules/crypto-payment/crypto-payment.module';
import { FiatPaymentModule } from 'src/modules/fiat-payment/fiat-payment.module';
import { EmailReconciliationModule } from 'src/modules/email-reconciliation/email-reconciliation.module';
@Module({
    imports: [
        // Shared Common Services
        CommonModule,
        ActivityLogModule,
        ScheduleModule.forRoot(),

        // Background Processing
        WorkerModule,

        // Health Check
        TerminusModule,

        // Feature Modules
        UserModule,
        ProductModule,
        CartModule,
        WalletModule,
        OrderModule,
        TicketModule,
        CryptoPaymentModule,
        FiatPaymentModule,
        EmailReconciliationModule,
        ReviewModule,
        VouchModule,
        CouponModule,
        DropModule,
        SettingsModule,
        LegalModule,
        FaqModule,
        FileModule,
        DashboardModule,
    ],
    controllers: [HealthController],
})
export class AppModule {}
