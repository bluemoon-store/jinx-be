import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PinoLogger } from 'nestjs-pino';
import axios, { AxiosInstance } from 'axios';
import { CryptoCurrency, Prisma } from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';
import { IExchangeRateService } from '../interfaces/exchange-rate.service.interface';

/**
 * Mapping of CryptoCurrency enum to Tatum API symbols
 */
const TATUM_SYMBOL_MAP: Record<CryptoCurrency, string> = {
    BTC: 'BTC',
    ETH: 'ETH',
    LTC: 'LTC',
    BCH: 'BCH',
    USDT_ERC20: 'USDT',
    USDT_TRC20: 'USDT',
    USDC_ERC20: 'USDC',
    SOL: 'SOL',
};

/**
 * Mapping of CryptoCurrency enum to Kraken API symbols
 * Kraken uses different symbol formats: XBT for Bitcoin, etc.
 */
const KRAKEN_SYMBOL_MAP: Record<CryptoCurrency, string> = {
    BTC: 'XBTUSD', // Kraken uses XBT for Bitcoin
    ETH: 'ETHUSD',
    LTC: 'LTCUSD',
    BCH: 'BCHUSD',
    USDT_ERC20: 'USDTUSD',
    USDT_TRC20: 'USDTUSD',
    USDC_ERC20: 'USDCUSD',
    SOL: 'SOLUSD',
};

/**
 * Exchange Rate Service
 * Fetches cryptocurrency exchange rates from Tatum (primary) and Kraken (fallback)
 * Implements multi-layer caching: Redis -> Database -> API
 */
@Injectable()
export class ExchangeRateService implements IExchangeRateService {
    private readonly logger: PinoLogger;
    private readonly cacheTTL: number; // Cache TTL in seconds (default: 5 minutes)
    private readonly tatumClient: AxiosInstance;
    private readonly krakenClient: AxiosInstance;

    constructor(
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        logger: PinoLogger
    ) {
        this.logger = logger;
        this.logger.setContext(ExchangeRateService.name);

        // Get cache TTL from config (default: 300 seconds = 5 minutes)
        this.cacheTTL =
            this.configService.get<number>('crypto.exchangeRateCacheTTL') ||
            300;

        // Initialize Tatum HTTP client
        const tatumApiKey = this.configService.get<string>(
            'crypto.tatum.apiKey'
        );
        const tatumBaseUrl =
            this.configService.get<string>('crypto.tatum.baseUrl') ||
            'https://api.tatum.io/v3';

        this.tatumClient = axios.create({
            baseURL: tatumBaseUrl,
            headers: {
                'x-api-key': tatumApiKey || '',
            },
            timeout: 10000, // 10 seconds timeout
        });

        // Initialize Kraken HTTP client (public API, no auth needed)
        const krakenBaseUrl =
            this.configService.get<string>('crypto.kraken.baseUrl') ||
            'https://api.kraken.com/0/public';

        this.krakenClient = axios.create({
            baseURL: krakenBaseUrl,
            timeout: 10000, // 10 seconds timeout
        });
    }

    /**
     * Get current exchange rate for a cryptocurrency
     * Uses multi-layer caching: Redis -> Database -> API (Tatum -> Kraken)
     */
    async getRate(
        cryptocurrency: CryptoCurrency,
        fiatCurrency: string = 'USD'
    ): Promise<number> {
        const cacheKey = `rate:${cryptocurrency}:${fiatCurrency}`;

        // 1. Check Redis cache first
        try {
            const cachedRate = await this.cacheManager.get<string>(cacheKey);
            if (cachedRate) {
                this.logger.debug(
                    { cryptocurrency, fiatCurrency, rate: cachedRate },
                    'Rate retrieved from Redis cache'
                );
                return parseFloat(cachedRate);
            }
        } catch (error) {
            this.logger.warn(
                { error, cacheKey },
                'Failed to retrieve rate from Redis cache'
            );
        }

        // 2. Check database cache
        try {
            const dbRate = await this.getRateFromDatabase(
                cryptocurrency,
                fiatCurrency
            );
            if (dbRate) {
                this.logger.debug(
                    { cryptocurrency, fiatCurrency, rate: dbRate },
                    'Rate retrieved from database cache'
                );

                // Update Redis cache with database value
                await this.cacheManager.set(
                    cacheKey,
                    dbRate.toString(),
                    this.cacheTTL * 1000 // Convert to milliseconds
                );

                return dbRate;
            }
        } catch (error) {
            this.logger.warn(
                { error, cryptocurrency, fiatCurrency },
                'Failed to retrieve rate from database cache'
            );
        }

        // 3. Fetch from Tatum API (primary provider)
        try {
            const rate = await this.fetchFromTatum(
                cryptocurrency,
                fiatCurrency
            );
            const provider = 'tatum';

            // Save to both caches
            await this.saveRate(cryptocurrency, fiatCurrency, rate, provider);

            this.logger.info(
                { cryptocurrency, fiatCurrency, rate, provider },
                'Rate fetched from Tatum API'
            );

            return rate;
        } catch (error) {
            this.logger.warn(
                { error, cryptocurrency, fiatCurrency },
                'Failed to fetch rate from Tatum API, trying Kraken'
            );

            // 4. Fallback to Kraken API
            try {
                const rate = await this.fetchFromKraken(
                    cryptocurrency,
                    fiatCurrency
                );
                const provider = 'kraken';

                // Save to both caches
                await this.saveRate(
                    cryptocurrency,
                    fiatCurrency,
                    rate,
                    provider
                );

                this.logger.info(
                    { cryptocurrency, fiatCurrency, rate, provider },
                    'Rate fetched from Kraken API (fallback)'
                );

                return rate;
            } catch (fallbackError) {
                this.logger.error(
                    {
                        error: fallbackError,
                        cryptocurrency,
                        fiatCurrency,
                    },
                    'Failed to fetch rate from both Tatum and Kraken APIs'
                );

                // 5. Last resort: try database again (might have stale data)
                const staleRate = await this.getRateFromDatabase(
                    cryptocurrency,
                    fiatCurrency,
                    true // allow stale data
                );

                if (staleRate) {
                    this.logger.warn(
                        {
                            cryptocurrency,
                            fiatCurrency,
                            rate: staleRate,
                        },
                        'Using stale rate from database cache (APIs unavailable)'
                    );
                    return staleRate;
                }

                throw new Error(
                    `Unable to fetch exchange rate for ${cryptocurrency}/${fiatCurrency}. All providers failed.`
                );
            }
        }
    }

    /**
     * Convert fiat amount to cryptocurrency
     */
    async convertToCrypto(
        fiatAmount: number,
        cryptocurrency: CryptoCurrency,
        fiatCurrency: string = 'USD'
    ): Promise<number> {
        if (fiatAmount <= 0) {
            throw new Error('Fiat amount must be greater than 0');
        }

        const rate = await this.getRate(cryptocurrency, fiatCurrency);
        const cryptoAmount = fiatAmount / rate;

        // Round to 8 decimal places (standard for crypto)
        return Math.round(cryptoAmount * 100000000) / 100000000;
    }

    /**
     * Convert crypto amount to fiat
     */
    async convertToFiat(
        cryptoAmount: number,
        cryptocurrency: CryptoCurrency,
        fiatCurrency: string = 'USD'
    ): Promise<number> {
        if (cryptoAmount <= 0) {
            throw new Error('Crypto amount must be greater than 0');
        }

        const rate = await this.getRate(cryptocurrency, fiatCurrency);
        const fiatAmount = cryptoAmount * rate;

        // Round to 2 decimal places (standard for fiat)
        return Math.round(fiatAmount * 100) / 100;
    }

    /**
     * Get exchange rates for all supported cryptocurrencies
     */
    async getAllRates(
        fiatCurrency: string = 'USD'
    ): Promise<Map<CryptoCurrency, number>> {
        const rates = new Map<CryptoCurrency, number>();
        const currencies: CryptoCurrency[] = [
            CryptoCurrency.BTC,
            CryptoCurrency.ETH,
            CryptoCurrency.LTC,
            CryptoCurrency.BCH,
            CryptoCurrency.USDT_ERC20,
            CryptoCurrency.USDT_TRC20,
            CryptoCurrency.USDC_ERC20,
            CryptoCurrency.SOL,
        ];

        // Fetch all rates in parallel
        const ratePromises = currencies.map(async crypto => {
            try {
                const rate = await this.getRate(crypto, fiatCurrency);
                rates.set(crypto, rate);
            } catch (error) {
                this.logger.error(
                    { error, cryptocurrency: crypto, fiatCurrency },
                    `Failed to fetch rate for ${crypto}`
                );
                // Continue with other currencies even if one fails
            }
        });

        await Promise.allSettled(ratePromises);

        return rates;
    }

    /**
     * Fetch exchange rate from Tatum API
     */
    private async fetchFromTatum(
        cryptocurrency: CryptoCurrency,
        fiatCurrency: string
    ): Promise<number> {
        const symbol = TATUM_SYMBOL_MAP[cryptocurrency];

        if (!symbol) {
            throw new Error(
                `Unsupported cryptocurrency for Tatum: ${cryptocurrency}`
            );
        }

        // Tatum API endpoint format depends on version:
        // v3: GET /v3/exchange-rate/{symbol}?basePair={fiatCurrency}
        // v4: GET /v4/data/rate/symbol?symbol={symbol}&basePair={fiatCurrency}
        // Try v3 format first, fallback to v4 if needed
        let response;
        try {
            // Try v3 endpoint format
            response = await this.tatumClient.get(`/exchange-rate/${symbol}`, {
                params: {
                    basePair: fiatCurrency.toUpperCase(),
                },
            });
        } catch (error) {
            // Fallback to v4 endpoint format if v3 fails
            this.logger.debug(
                { error, symbol, fiatCurrency },
                'Trying v4 endpoint format for Tatum API'
            );
            response = await this.tatumClient.get('/data/rate/symbol', {
                params: {
                    symbol,
                    basePair: fiatCurrency.toUpperCase(),
                },
            });
        }

        if (!response.data || !response.data.value) {
            throw new Error(
                `Invalid response from Tatum API: ${JSON.stringify(response.data)}`
            );
        }

        const rate = parseFloat(response.data.value);

        if (isNaN(rate) || rate <= 0) {
            throw new Error(`Invalid rate from Tatum API: ${rate}`);
        }

        return rate;
    }

    /**
     * Fetch exchange rate from Kraken API
     */
    private async fetchFromKraken(
        cryptocurrency: CryptoCurrency,
        _fiatCurrency: string
    ): Promise<number> {
        const symbol = KRAKEN_SYMBOL_MAP[cryptocurrency];

        if (!symbol) {
            throw new Error(
                `Unsupported cryptocurrency for Kraken: ${cryptocurrency}`
            );
        }

        // Kraken API endpoint: GET /0/public/Ticker?pair={symbol}
        const response = await this.krakenClient.get('/Ticker', {
            params: {
                pair: symbol,
            },
        });

        if (
            !response.data ||
            !response.data.result ||
            !response.data.result[symbol]
        ) {
            throw new Error(
                `Invalid response from Kraken API: ${JSON.stringify(response.data)}`
            );
        }

        const ticker = response.data.result[symbol];

        // Kraken returns bid/ask prices, use the last trade price (c[0]) or ask price (a[0])
        // Using ask price (a[0]) as it represents the current market price
        const rateStr = ticker.a?.[0] || ticker.c?.[0];

        if (!rateStr) {
            throw new Error(
                `No price data in Kraken ticker: ${JSON.stringify(ticker)}`
            );
        }

        const rate = parseFloat(rateStr);

        if (isNaN(rate) || rate <= 0) {
            throw new Error(`Invalid rate from Kraken API: ${rate}`);
        }

        return rate;
    }

    /**
     * Get rate from database cache
     * @param allowStale - If true, return rate even if expired
     */
    private async getRateFromDatabase(
        cryptocurrency: CryptoCurrency,
        fiatCurrency: string,
        allowStale: boolean = false
    ): Promise<number | null> {
        try {
            const rateRecord =
                await this.databaseService.cryptoExchangeRate.findUnique({
                    where: {
                        cryptocurrency_fiatCurrency: {
                            cryptocurrency,
                            fiatCurrency: fiatCurrency.toUpperCase(),
                        },
                    },
                });

            if (!rateRecord) {
                return null;
            }

            // Check if rate is expired
            if (!allowStale && new Date() > rateRecord.expiresAt) {
                this.logger.debug(
                    {
                        cryptocurrency,
                        fiatCurrency,
                        expiresAt: rateRecord.expiresAt,
                    },
                    'Database rate expired, skipping'
                );
                return null;
            }

            return parseFloat(rateRecord.rate.toString());
        } catch (error) {
            this.logger.error(
                { error, cryptocurrency, fiatCurrency },
                'Error retrieving rate from database'
            );
            return null;
        }
    }

    /**
     * Save rate to both Redis and database caches
     */
    private async saveRate(
        cryptocurrency: CryptoCurrency,
        fiatCurrency: string,
        rate: number,
        provider: string
    ): Promise<void> {
        const cacheKey = `rate:${cryptocurrency}:${fiatCurrency}`;
        const expiresAt = new Date(Date.now() + this.cacheTTL * 1000);

        // Save to Redis cache
        try {
            await this.cacheManager.set(
                cacheKey,
                rate.toString(),
                this.cacheTTL * 1000 // Convert to milliseconds
            );
        } catch (error) {
            this.logger.warn(
                { error, cacheKey },
                'Failed to save rate to Redis cache'
            );
        }

        // Save to database cache
        try {
            await this.databaseService.cryptoExchangeRate.upsert({
                where: {
                    cryptocurrency_fiatCurrency: {
                        cryptocurrency,
                        fiatCurrency: fiatCurrency.toUpperCase(),
                    },
                },
                update: {
                    rate: new Prisma.Decimal(rate),
                    provider,
                    expiresAt,
                },
                create: {
                    cryptocurrency,
                    fiatCurrency: fiatCurrency.toUpperCase(),
                    rate: new Prisma.Decimal(rate),
                    provider,
                    expiresAt,
                },
            });
        } catch (error) {
            this.logger.error(
                { error, cryptocurrency, fiatCurrency, rate, provider },
                'Failed to save rate to database cache'
            );
            // Don't throw - Redis cache is more important
        }
    }
}
