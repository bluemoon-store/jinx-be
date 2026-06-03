import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import axios, { AxiosInstance } from 'axios';

/**
 * Base class for hosted fiat payment gateways.
 *
 * Holds a configured axios client and shared error handling, mirroring the
 * pattern used by BaseBlockchainProvider in the crypto-payment module.
 * Concrete gateways supply their config namespace (e.g. 'paymentGateway.chime')
 * and the auth headers.
 */
export abstract class BaseFiatGateway {
    protected readonly httpClient: AxiosInstance;
    protected readonly logger: PinoLogger;

    constructor(
        protected readonly configService: ConfigService,
        logger: PinoLogger,
        protected readonly providerName: string,
        options: {
            baseUrl: string;
            headers: Record<string, string>;
            timeout?: number;
        }
    ) {
        this.logger = logger;
        this.logger.setContext(this.constructor.name);

        this.httpClient = axios.create({
            baseURL: options.baseUrl,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...options.headers,
            },
            timeout: options.timeout ?? 15000,
        });
    }

    /**
     * Normalise gateway HTTP errors into a single thrown Error with context.
     */
    protected handleGatewayError(error: any, operation: string): never {
        if (error?.response) {
            const status = error.response.status;
            const data = error.response.data;

            this.logger.error(
                { status, data, operation, provider: this.providerName },
                `${this.providerName} API error during ${operation}`
            );

            throw new Error(
                `${this.providerName} API error (${status}): ${
                    data?.message || data?.error || 'Unknown error'
                }`
            );
        }

        if (error?.request) {
            this.logger.error(
                { operation, provider: this.providerName },
                `No response from ${this.providerName} API during ${operation}`
            );
            throw new Error(
                `No response from ${this.providerName} API: ${operation}`
            );
        }

        this.logger.error(
            { error: error?.message, operation, provider: this.providerName },
            `Error during ${operation}`
        );
        throw new Error(`${operation} failed: ${error?.message}`);
    }
}
