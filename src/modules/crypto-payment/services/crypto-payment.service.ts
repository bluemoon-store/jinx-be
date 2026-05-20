import {
    Injectable,
    BadRequestException,
    NotFoundException,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PinoLogger } from 'nestjs-pino';
import {
    CryptoCurrency,
    PaymentStatus,
    OrderStatus,
    Prisma,
} from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IPaymentFailedPayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { StockLineService } from 'src/modules/stock-line/services/stock-line.service';
import { SystemWalletService } from './system-wallet.service';
import { ExchangeRateService } from './exchange-rate.service';
import { ICryptoPaymentService } from '../interfaces/crypto-payment.service.interface';
import { CryptoPaymentResponseDto } from '../dtos/response/crypto-payment.response';
import { PaymentStatusResponseDto } from '../dtos/response/payment-status.response';
import {
    generatePaymentQRCode,
    generatePaymentURI,
} from '../utils/qr-code.util';

/**
 * Crypto Payment Service
 * Handles creation, status checking, and management of cryptocurrency payments
 */
@Injectable()
export class CryptoPaymentService implements ICryptoPaymentService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly systemWalletService: SystemWalletService,
        private readonly exchangeRateService: ExchangeRateService,
        private readonly configService: ConfigService,
        @InjectQueue('crypto-payment-verification')
        private readonly paymentVerificationQueue: Queue,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue,
        private readonly stockLineService: StockLineService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(CryptoPaymentService.name);
    }

    private assertCryptoOrderAccess(
        order: { userId: string },
        userId: string
    ): void {
        if (!userId || order.userId !== userId) {
            throw new BadRequestException(
                'You do not have permission to access this order'
            );
        }
    }

    /**
     * Create a crypto payment for an order
     * @param orderId - Order ID
     * @param cryptocurrency - Selected cryptocurrency
     * @param userId - User ID (for authorization)
     * @returns Payment details with address and QR code
     */
    async createPayment(
        orderId: string,
        cryptocurrency: CryptoCurrency,
        userId: string
    ): Promise<CryptoPaymentResponseDto> {
        this.logger.info(
            { orderId, cryptocurrency, userId },
            'Creating crypto payment'
        );

        try {
            // 1. Get order details and verify ownership
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: {
                    cryptoPayment: true,
                },
            });

            if (!order) {
                throw new NotFoundException(`Order not found: ${orderId}`);
            }

            this.assertCryptoOrderAccess(order, userId);

            // Check if order is in valid status
            if (order.status !== OrderStatus.PENDING) {
                throw new BadRequestException(
                    `Cannot create payment for order with status: ${order.status}. Order must be PENDING.`
                );
            }

            // Rate limiting: Check if payment already exists (1 payment per order)
            if (order.cryptoPayment) {
                this.logger.warn(
                    { orderId, paymentId: order.cryptoPayment.id },
                    'Payment already exists for this order - rate limit enforced'
                );

                // Check if existing payment is expired
                const now = new Date();
                if (now > order.cryptoPayment.expiresAt) {
                    // Grace period check
                    const gracePeriodMinutes = this.configService.get<number>(
                        'crypto.payment.expirationGracePeriodMinutes',
                        30
                    );
                    const gracePeriodDate = new Date(
                        order.cryptoPayment.expiresAt
                    );
                    gracePeriodDate.setMinutes(
                        gracePeriodDate.getMinutes() + gracePeriodMinutes
                    );

                    if (now > gracePeriodDate) {
                        // Payment is expired and past grace period
                        // User can create a new payment
                        this.logger.info(
                            { orderId, oldPaymentId: order.cryptoPayment.id },
                            'Previous payment expired past grace period, allowing new payment'
                        );
                    } else {
                        // Still within grace period - check for funds
                        this.logger.warn(
                            {
                                orderId,
                                paymentId: order.cryptoPayment.id,
                                expiresAt: order.cryptoPayment.expiresAt,
                            },
                            'Payment within grace period - checking for late payment before creating new one'
                        );
                        // Return existing payment - grace period still active
                        return this.mapToResponseDto(
                            order.cryptoPayment,
                            orderId
                        );
                    }
                } else {
                    // Payment not expired - return existing
                    return this.mapToResponseDto(order.cryptoPayment, orderId);
                }
            }

            // 2. Get exchange rate and calculate crypto amount
            const amountUsd = parseFloat(order.totalAmount.toString());
            if (amountUsd <= 0) {
                throw new BadRequestException(
                    'Order total amount must be greater than 0'
                );
            }

            const exchangeRate = await this.exchangeRateService.getRate(
                cryptocurrency,
                'USD'
            );
            const cryptoAmount = await this.exchangeRateService.convertToCrypto(
                amountUsd,
                cryptocurrency,
                'USD'
            );

            this.logger.debug(
                {
                    orderId,
                    cryptocurrency,
                    amountUsd,
                    exchangeRate,
                    cryptoAmount,
                },
                'Calculated crypto amount'
            );

            const totalAmount = cryptoAmount;

            // 4. Generate unique payment address
            const addressDetails =
                await this.systemWalletService.generatePaymentAddress(
                    orderId,
                    cryptocurrency,
                    totalAmount,
                    amountUsd
                );

            // 5. Get platform wallet address
            const platformWalletAddress =
                this.systemWalletService.getPlatformWalletAddress(
                    cryptocurrency
                );

            if (!platformWalletAddress) {
                throw new BadRequestException(
                    `Platform wallet address not configured for ${cryptocurrency}`
                );
            }

            // 6. Determine required confirmations based on cryptocurrency
            const requiredConfirmations =
                this.getRequiredConfirmations(cryptocurrency);

            // 7. Determine network based on cryptocurrency
            const network = this.getNetwork(cryptocurrency);

            // 8. Create payment record in database
            const payment = await this.databaseService.cryptoPayment.create({
                data: {
                    orderId,
                    cryptocurrency,
                    network,
                    paymentAddress: addressDetails.address,
                    derivationIndex: addressDetails.derivationIndex,
                    derivationPath: addressDetails.derivationPath,
                    encryptedPrivateKey: addressDetails.encryptedPrivateKey,
                    amount: new Prisma.Decimal(totalAmount),
                    amountUsd: new Prisma.Decimal(amountUsd),
                    exchangeRate: new Prisma.Decimal(exchangeRate),
                    platformWalletAddress,
                    status: PaymentStatus.PENDING,
                    requiredConfirmations,
                    expiresAt: addressDetails.expiresAt,
                },
            });

            await this.stockLineService.syncReservationExpiryForOrder(
                this.databaseService,
                orderId,
                payment.expiresAt
            );

            this.logger.info(
                {
                    paymentId: payment.id,
                    orderId,
                    cryptocurrency,
                    address: addressDetails.address,
                    amount: cryptoAmount,
                    expiresAt: addressDetails.expiresAt,
                },
                'Payment record created'
            );

            // 9. Generate QR code using order amount
            const qrCode = await generatePaymentQRCode(
                addressDetails.address,
                totalAmount,
                cryptocurrency
            );

            // 10. Generate payment URI using order amount
            const paymentUri = generatePaymentURI(
                addressDetails.address,
                totalAmount,
                cryptocurrency
            );

            // 11. Queue verification job (check payment status periodically)
            await this.paymentVerificationQueue.add(
                'verify-payment',
                {
                    paymentId: payment.id,
                    orderId,
                },
                {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 60000, // Start with 1 minute delay
                    },
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            );

            this.logger.info(
                { paymentId: payment.id, orderId },
                'Payment verification job queued'
            );

            // 12. Return payment details
            const timeRemaining = Math.max(
                0,
                Math.floor(
                    (addressDetails.expiresAt.getTime() - Date.now()) / 1000
                )
            );

            return {
                paymentId: payment.id,
                orderId,
                cryptocurrency,
                network,
                paymentAddress: addressDetails.address,
                amount: totalAmount.toString(),
                amountUsd: amountUsd.toString(),
                exchangeRate: exchangeRate.toString(),
                qrCode,
                status: payment.status,
                expiresAt: addressDetails.expiresAt,
                timeRemaining,
                txHash: payment.txHash || undefined,
                confirmations: payment.confirmations,
                requiredConfirmations: payment.requiredConfirmations,
                paymentUri,
                createdAt: payment.createdAt,
            };
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }

            this.logger.error(
                { error, orderId, cryptocurrency, userId },
                'Failed to create crypto payment'
            );

            throw new HttpException(
                `Failed to create crypto payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get payment status
     * @param paymentId - Payment ID
     * @param userId - User ID (for authorization)
     * @returns Current payment status
     */
    async getPaymentStatus(
        paymentId: string,
        userId: string
    ): Promise<PaymentStatusResponseDto> {
        this.logger.debug({ paymentId, userId }, 'Getting payment status');

        try {
            const payment = await this.databaseService.cryptoPayment.findUnique(
                {
                    where: { id: paymentId },
                    include: {
                        order: true,
                    },
                }
            );

            if (!payment) {
                throw new NotFoundException(`Payment not found: ${paymentId}`);
            }

            this.assertCryptoOrderAccess(payment.order, userId);

            // Check if payment has expired
            const now = new Date();
            const isExpired = now > payment.expiresAt;
            const timeRemaining = isExpired
                ? 0
                : Math.max(
                      0,
                      Math.floor(
                          (payment.expiresAt.getTime() - now.getTime()) / 1000
                      )
                  );

            // Auto-expire if needed
            if (isExpired && payment.status === PaymentStatus.PENDING) {
                this.logger.warn(
                    { paymentId, expiresAt: payment.expiresAt },
                    'Payment expired, updating status'
                );
                await this.expirePayment(paymentId);
                // Refresh payment data
                const updatedPayment =
                    await this.databaseService.cryptoPayment.findUnique({
                        where: { id: paymentId },
                    });
                if (updatedPayment) {
                    return this.mapToStatusResponseDto(updatedPayment, 0, true);
                }
            }

            return this.mapToStatusResponseDto(
                payment,
                timeRemaining,
                isExpired
            );
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }

            this.logger.error(
                { error, paymentId, userId },
                'Failed to get payment status'
            );

            throw new HttpException(
                `Failed to get payment status: ${error instanceof Error ? error.message : 'Unknown error'}`,
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get payment by order ID
     * @param orderId - Order ID
     * @param userId - User ID (for authorization)
     * @returns Payment details
     */
    async getPaymentByOrderId(
        orderId: string,
        userId: string
    ): Promise<CryptoPaymentResponseDto> {
        this.logger.debug({ orderId, userId }, 'Getting payment by order ID');

        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: {
                    cryptoPayment: true,
                },
            });

            if (!order) {
                throw new NotFoundException(`Order not found: ${orderId}`);
            }

            this.assertCryptoOrderAccess(order, userId);

            if (!order.cryptoPayment) {
                throw new NotFoundException(
                    `No crypto payment found for order: ${orderId}`
                );
            }

            return this.mapToResponseDto(order.cryptoPayment, orderId);
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }

            this.logger.error(
                { error, orderId, userId },
                'Failed to get payment by order ID'
            );

            throw new HttpException(
                `Failed to get payment by order ID: ${error instanceof Error ? error.message : 'Unknown error'}`,
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Handle payment expiration
     * @param paymentId - Payment ID
     */
    async expirePayment(paymentId: string): Promise<void> {
        this.logger.info({ paymentId }, 'Expiring payment');

        try {
            const payment = await this.databaseService.cryptoPayment.findUnique(
                {
                    where: { id: paymentId },
                }
            );

            if (!payment) {
                this.logger.warn(
                    { paymentId },
                    'Payment not found for expiration'
                );
                return;
            }

            // Only expire if still pending
            if (payment.status !== PaymentStatus.PENDING) {
                this.logger.debug(
                    { paymentId, status: payment.status },
                    'Payment already processed, skipping expiration'
                );
                return;
            }

            const orderId = payment.orderId;

            await this.databaseService.$transaction(async tx => {
                await tx.cryptoPayment.update({
                    where: { id: paymentId },
                    data: {
                        status: PaymentStatus.EXPIRED,
                    },
                });
                await this.stockLineService.releaseReservedForOrder(
                    tx,
                    orderId
                );
            });

            this.logger.info(
                { paymentId, orderId },
                'Payment expired successfully'
            );

            await this.enqueuePaymentFailedEmail(
                orderId,
                `${payment.cryptocurrency}`,
                payment.amountUsd.toString()
            );
        } catch (error) {
            this.logger.error({ error, paymentId }, 'Failed to expire payment');
            // Don't throw - expiration is not critical
        }
    }

    /**
     * Get required confirmations for a cryptocurrency
     * @param cryptocurrency - Cryptocurrency type
     * @returns Required number of confirmations
     */
    private getRequiredConfirmations(cryptocurrency: CryptoCurrency): number {
        const confirmationsConfig = this.configService.get<
            Record<string, number>
        >('crypto.confirmations');

        const configMap: Record<CryptoCurrency, string> = {
            BTC: 'btc',
            ETH: 'eth',
            LTC: 'ltc',
            BCH: 'bch',
            USDT_ERC20: 'usdtErc20',
            USDT_TRC20: 'usdtTrc20',
            USDC_ERC20: 'usdcErc20',
            SOL: 'sol',
        };

        const configKey = configMap[cryptocurrency];
        const confirmations = confirmationsConfig?.[configKey];

        if (confirmations && confirmations > 0) {
            return confirmations;
        }

        // Default confirmations
        const defaults: Record<CryptoCurrency, number> = {
            BTC: 3,
            ETH: 12,
            LTC: 6,
            BCH: 6,
            USDT_ERC20: 12,
            USDT_TRC20: 19,
            USDC_ERC20: 12,
            SOL: 32,
        };

        return defaults[cryptocurrency] || 3;
    }

    /**
     * Get network string for a cryptocurrency
     * @param cryptocurrency - Cryptocurrency type
     * @returns Network string
     */
    private getNetwork(cryptocurrency: CryptoCurrency): string {
        const networkMap: Record<CryptoCurrency, string> = {
            BTC: 'mainnet',
            ETH: 'mainnet',
            LTC: 'mainnet',
            BCH: 'mainnet',
            USDT_ERC20: 'ERC20',
            USDT_TRC20: 'TRC20',
            USDC_ERC20: 'ERC20',
            SOL: 'mainnet-beta',
        };

        const isTestnet = this.configService.get<boolean>(
            'crypto.tatum.testnet',
            false
        );

        if (isTestnet) {
            const testnetMap: Record<CryptoCurrency, string> = {
                BTC: 'testnet',
                ETH: 'sepolia',
                LTC: 'testnet',
                BCH: 'testnet',
                USDT_ERC20: 'ERC20',
                USDT_TRC20: 'TRC20',
                USDC_ERC20: 'ERC20',
                SOL: 'devnet',
            };
            return testnetMap[cryptocurrency] || networkMap[cryptocurrency];
        }

        return networkMap[cryptocurrency];
    }

    /**
     * Map database payment to response DTO
     * @param payment - Payment record
     * @param orderId - Order ID
     * @returns Response DTO
     */
    private async mapToResponseDto(
        payment: any,
        orderId: string
    ): Promise<CryptoPaymentResponseDto> {
        const now = new Date();
        const timeRemaining = Math.max(
            0,
            Math.floor((payment.expiresAt.getTime() - now.getTime()) / 1000)
        );

        // Generate QR code
        let qrCode: string;
        try {
            qrCode = await generatePaymentQRCode(
                payment.paymentAddress,
                parseFloat(payment.amount.toString()),
                payment.cryptocurrency
            );
        } catch (error) {
            this.logger.warn(
                { error, paymentId: payment.id },
                'Failed to generate QR code for existing payment'
            );
            qrCode = ''; // Fallback to empty string
        }

        const paymentUri = generatePaymentURI(
            payment.paymentAddress,
            parseFloat(payment.amount.toString()),
            payment.cryptocurrency
        );

        return {
            paymentId: payment.id,
            orderId,
            cryptocurrency: payment.cryptocurrency,
            network: payment.network || undefined,
            paymentAddress: payment.paymentAddress,
            amount: payment.amount.toString(),
            amountUsd: payment.amountUsd.toString(),
            exchangeRate: payment.exchangeRate?.toString() || undefined,
            qrCode,
            status: payment.status,
            expiresAt: payment.expiresAt,
            timeRemaining,
            txHash: payment.txHash || undefined,
            confirmations: payment.confirmations,
            requiredConfirmations: payment.requiredConfirmations,
            paymentUri,
            createdAt: payment.createdAt,
        };
    }

    /**
     * Map database payment to status response DTO
     * @param payment - Payment record
     * @param timeRemaining - Time remaining in seconds
     * @param isExpired - Whether payment is expired
     * @returns Status response DTO
     */
    private mapToStatusResponseDto(
        payment: any,
        timeRemaining: number,
        isExpired: boolean
    ): PaymentStatusResponseDto {
        return {
            paymentId: payment.id,
            status: payment.status,
            paymentAddress: payment.paymentAddress,
            amount: payment.amount.toString(),
            txHash: payment.txHash || undefined,
            confirmations: payment.confirmations,
            requiredConfirmations: payment.requiredConfirmations,
            timeRemaining,
            isExpired,
            paidAt: payment.paidAt || undefined,
            confirmedAt: payment.confirmedAt || undefined,
            expiresAt: payment.expiresAt,
        };
    }

    private async enqueuePaymentFailedEmail(
        orderId: string,
        paymentMethod: string,
        amountUsd: string
    ): Promise<void> {
        try {
            const order = await this.databaseService.order.findUnique({
                where: { id: orderId },
                include: { user: true },
            });
            if (!order || !order.user) return;

            const numeric = Number(amountUsd);
            const formatted = `$${(Number.isFinite(numeric)
                ? numeric
                : 0
            ).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;

            this.emailQueue.add(EMAIL_TEMPLATES.PAYMENT_FAILED, {
                data: {
                    order_id: order.orderNumber,
                    payment_method: paymentMethod,
                    amount: formatted,
                    date: new Date().toISOString().slice(0, 10),
                },
                toEmails: [order.user.email],
            } as ISendEmailBasePayload<IPaymentFailedPayload>);
        } catch (error) {
            this.logger.error(
                { error, orderId },
                'Failed to enqueue payment-failed email'
            );
        }
    }
}
