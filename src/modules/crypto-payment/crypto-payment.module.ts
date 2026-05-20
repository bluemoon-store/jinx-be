import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { CommonModule } from 'src/common/common.module';
import { RequestModule } from 'src/common/request/request.module';
import { CustomLoggerModule } from 'src/common/logger/logger.module';
import { workerOnlyProviders } from 'src/common/utils/role.util';
import { OrderModule } from 'src/modules/order/order.module';
import { StockLineModule } from 'src/modules/stock-line/stock-line.module';
import { WalletModule } from 'src/modules/wallet/wallet.module';
import { SystemWalletService } from './services/system-wallet.service';
import { ExchangeRateService } from './services/exchange-rate.service';
import { CryptoPaymentService } from './services/crypto-payment.service';
import { BlockchainMonitorService } from './services/blockchain-monitor.service';
import { PaymentForwardingService } from './services/payment-forwarding.service';
import { HotWalletService } from './services/hot-wallet.service';

// Blockchain Providers
import { BitcoinProvider } from './blockchain-providers/bitcoin-provider.service';
import { EthereumProvider } from './blockchain-providers/ethereum-provider.service';
import { LitecoinProvider } from './blockchain-providers/litecoin-provider.service';
import { BitcoinCashProvider } from './blockchain-providers/bitcoin-cash-provider.service';
import { TronProvider } from './blockchain-providers/tron-provider.service';
import { SolanaProvider } from './blockchain-providers/solana-provider.service';
import { BlockchainProviderFactory } from './blockchain-providers/blockchain-provider.factory';

// Processors
import { PaymentVerificationProcessor } from './processors/payment-verification.processor';
import { PaymentForwardingProcessor } from './processors/payment-forwarding.processor';

// Schedulers
import { PaymentScheduler } from './schedulers/payment.scheduler';

// Controllers
import { CryptoPaymentPublicController } from './controllers/crypto-payment.public.controller';
import { ExchangeRatePublicController } from './controllers/exchange-rate.public.controller';
import { CryptoPaymentAdminController } from './controllers/crypto-payment.admin.controller';

@Module({
    imports: [
        ConfigModule,
        CommonModule, // Provides DatabaseService and CacheManager
        RequestModule,
        CustomLoggerModule, // Provides PinoLogger
        OrderModule, // Provides OrderDeliveryService
        StockLineModule,
        WalletModule,
        BullModule.registerQueue({
            name: 'crypto-payment-verification',
        }),
        BullModule.registerQueue({
            name: 'crypto-payment-forwarding',
        }),
        BullModule.registerQueue({
            name: APP_BULL_QUEUES.EMAIL,
        }),
    ],
    controllers: [
        CryptoPaymentPublicController,
        ExchangeRatePublicController,
        CryptoPaymentAdminController,
    ],
    providers: [
        // Core Services
        SystemWalletService,
        ExchangeRateService,
        CryptoPaymentService,
        BlockchainMonitorService,
        PaymentForwardingService,
        HotWalletService,
        // Blockchain Providers
        BitcoinProvider,
        EthereumProvider,
        LitecoinProvider,
        BitcoinCashProvider,
        TronProvider,
        SolanaProvider,
        // Factory
        BlockchainProviderFactory,
        // Processors + cron schedulers — worker container only
        ...workerOnlyProviders([
            PaymentVerificationProcessor,
            PaymentForwardingProcessor,
            PaymentScheduler,
        ]),
    ],
    exports: [
        SystemWalletService,
        ExchangeRateService,
        CryptoPaymentService,
        BlockchainMonitorService,
        PaymentForwardingService,
        HotWalletService,
        BlockchainProviderFactory,
    ],
})
export class CryptoPaymentModule {}
