import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { CryptoCurrency } from '@prisma/client';

import { IBlockchainProvider } from './blockchain-provider.interface';
import { BitcoinProvider } from './bitcoin-provider.service';
import { EthereumProvider } from './ethereum-provider.service';
import { LitecoinProvider } from './litecoin-provider.service';
import { BitcoinCashProvider } from './bitcoin-cash-provider.service';
import { TronProvider } from './tron-provider.service';
import { SolanaProvider } from './solana-provider.service';

/**
 * Blockchain Provider Factory
 * Creates and manages blockchain providers for different cryptocurrencies
 */
@Injectable()
export class BlockchainProviderFactory {
    private readonly providers: Map<CryptoCurrency, IBlockchainProvider>;

    constructor(
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger,
        private readonly bitcoinProvider: BitcoinProvider,
        private readonly ethereumProvider: EthereumProvider,
        private readonly litecoinProvider: LitecoinProvider,
        private readonly bitcoinCashProvider: BitcoinCashProvider,
        private readonly tronProvider: TronProvider,
        private readonly solanaProvider: SolanaProvider
    ) {
        this.providers = new Map();
        this.initializeProviders();
    }

    /**
     * Initialize all providers
     */
    private initializeProviders(): void {
        this.providers.set(CryptoCurrency.BTC, this.bitcoinProvider);
        this.providers.set(CryptoCurrency.ETH, this.ethereumProvider);
        this.providers.set(CryptoCurrency.LTC, this.litecoinProvider);
        this.providers.set(CryptoCurrency.BCH, this.bitcoinCashProvider);
        // ERC-20 tokens use Ethereum provider
        this.providers.set(CryptoCurrency.USDT_ERC20, this.ethereumProvider);
        this.providers.set(CryptoCurrency.USDC_ERC20, this.ethereumProvider);
        this.providers.set(CryptoCurrency.USDT_TRC20, this.tronProvider);
        this.providers.set(CryptoCurrency.SOL, this.solanaProvider);

        this.logger.info(
            { supportedCurrencies: Array.from(this.providers.keys()) },
            'Blockchain providers initialized'
        );
    }

    /**
     * Get blockchain provider for a cryptocurrency
     * @param cryptocurrency - Cryptocurrency type
     * @returns Blockchain provider instance
     */
    getProvider(cryptocurrency: CryptoCurrency): IBlockchainProvider {
        const provider = this.providers.get(cryptocurrency);

        if (!provider) {
            throw new Error(
                `No blockchain provider found for ${cryptocurrency}`
            );
        }

        return provider;
    }

    /**
     * Get Ethereum provider (for ERC-20 token operations)
     * @returns Ethereum provider instance
     */
    getEthereumProvider(): EthereumProvider {
        return this.ethereumProvider;
    }

    /**
     * Check if cryptocurrency is supported
     * @param cryptocurrency - Cryptocurrency type
     * @returns True if supported
     */
    isSupported(cryptocurrency: CryptoCurrency): boolean {
        return this.providers.has(cryptocurrency);
    }
}
