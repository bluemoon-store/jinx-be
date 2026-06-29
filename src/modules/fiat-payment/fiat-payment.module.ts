import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { CommonModule } from 'src/common/common.module';
import { RequestModule } from 'src/common/request/request.module';
import { CustomLoggerModule } from 'src/common/logger/logger.module';
import { workerOnlyProviders } from 'src/common/utils/role.util';
import { OrderModule } from 'src/modules/order/order.module';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { StockLineModule } from 'src/modules/stock-line/stock-line.module';

import { FIAT_PAYMENT_QUEUE } from './fiat-payment.constants';
import { ChimeGateway } from './gateways/chime-gateway.service';
import { ManualP2PGateway } from './gateways/manual-p2p-gateway.service';
import { TelegramStarsGateway } from './gateways/telegram-stars-gateway.service';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { FiatPaymentService } from './services/fiat-payment.service';
import { FiatPaymentProcessor } from './processors/fiat-payment.processor';
import { FiatPaymentScheduler } from './schedulers/fiat-payment.scheduler';
import { FiatPaymentPublicController } from './controllers/fiat-payment.public.controller';
import { FiatPaymentWebhookController } from './controllers/fiat-payment.webhook.controller';
import { TelegramWebhookController } from './controllers/telegram-webhook.controller';

@Module({
    imports: [
        ConfigModule,
        CommonModule, // DatabaseService, CacheManager
        RequestModule,
        CustomLoggerModule, // PinoLogger
        OrderModule, // OrderDeliveryService
        SettingsModule, // SettingsService (enabled-method enforcement)
        StockLineModule, // StockLineService
        BullModule.registerQueue({ name: FIAT_PAYMENT_QUEUE }),
        BullModule.registerQueue({ name: APP_BULL_QUEUES.EMAIL }),
    ],
    controllers: [
        FiatPaymentPublicController,
        FiatPaymentWebhookController,
        TelegramWebhookController,
    ],
    providers: [
        FiatPaymentService,
        PaymentGatewayFactory,
        ChimeGateway,
        TelegramStarsGateway,
        ManualP2PGateway,
        // Processor + cron scheduler — worker container only
        ...workerOnlyProviders([FiatPaymentProcessor, FiatPaymentScheduler]),
    ],
    exports: [FiatPaymentService],
})
export class FiatPaymentModule {}
