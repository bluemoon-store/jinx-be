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
import { PAYMENT_CRYPTO_CODES } from 'src/modules/settings/constants/payment-settings.constant';
import { SettingsService } from 'src/modules/settings/services/settings.service';
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
        private readonly settingsService: SettingsService,
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

            // Reject a method that an admin has disabled. Only enforce for codes
            // that are admin-configurable; others (e.g. USDC_ERC20) stay allowed.
            const { cryptocurrencies: enabledCryptos } =
                await this.settingsService.getEnabledPaymentMethods();
            if (
                (PAYMENT_CRYPTO_CODES as readonly string[]).includes(
                    cryptocurrency
                ) &&
                !enabledCryptos.includes(cryptocurrency)
            ) {
                throw new BadRequestException(
                    `Payment method ${cryptocurrency} is currently unavailable`
                );
            }

            // Check if order is in valid status
            if (order.status !== OrderStatus.PENDING) {
                throw new BadRequestException(
                    `Cannot create payment for order with status: ${order.status}. Order must be PENDING.`
                );
            }

            // A payment already exists for this order (unique one-to-one).
            // Decide whether to return it as-is, switch its currency, or refresh
            // an expired one in place. We never create a second record.
            if (order.cryptoPayment) {
                const existing = order.cryptoPayment;
                const sameCurrency = existing.cryptocurrency === cryptocurrency;
                const hasFunds =
                    existing.txHash != null ||
                    existing.confirmations > 0 ||
                    existing.status !== PaymentStatus.PENDING;

                if (hasFunds) {
                    if (sameCurrency) {
                        // Same method, payment already in flight — just show it.
                        return this.mapToResponseDto(existing, orderId);
                    }
                    // Funds were already detected on the current address.
                    // Switching currency would orphan them, so block the change
                    // and keep the buyer on the existing address.
                    throw new BadRequestException(
                        'Cannot change currency: a payment has already been detected for this order.'
                    );
                }

                const now = new Date();
                const expired = now > existing.expiresAt;

                if (sameCurrency && !expired) {
                    // Same method, still within the payment window — reuse the
                    // existing address and timer (idempotent re-entry).
                    return this.mapToResponseDto(existing, orderId);
                }

                if (sameCurrency && expired) {
                    const gracePeriodMinutes = this.configService.get<number>(
                        'crypto.payment.expirationGracePeriodMinutes',
                        30
                    );
                    const gracePeriodDate = new Date(existing.expiresAt);
                    gracePeriodDate.setMinutes(
                        gracePeriodDate.getMinutes() + gracePeriodMinutes
                    );
                    if (now <= gracePeriodDate) {
                        // Within grace window — keep the same address so a late
                        // payment to it can still be reconciled.
                        return this.mapToResponseDto(existing, orderId);
                    }
                    // Past grace window — fall through and refresh in place.
                }

                // Either a different currency was requested (a real "change
                // payment method") or the same-currency payment is past its
                // grace window. Replace the pending record in place.
                this.logger.info(
                    {
                        orderId,
                        paymentId: existing.id,
                        from: existing.cryptocurrency,
                        to: cryptocurrency,
                    },
                    'Replacing pending crypto payment in place'
                );
                return this.replacePaymentInPlace(
                    order,
                    existing.id,
                    cryptocurrency
                );
            }

            // No existing payment — create a fresh one.
            const amountUsd = parseFloat(order.totalAmount.toString());
            if (amountUsd <= 0) {
                throw new BadRequestException(
                    'Order total amount must be greater than 0'
                );
            }

            const artifacts = await this.buildPaymentArtifacts(
                orderId,
                cryptocurrency,
                amountUsd
            );

            const payment = await this.databaseService.cryptoPayment.create({
                data: {
                    orderId,
                    cryptocurrency,
                    network: artifacts.network,
                    paymentAddress: artifacts.addressDetails.address,
                    derivationIndex: artifacts.addressDetails.derivationIndex,
                    derivationPath: artifacts.addressDetails.derivationPath,
                    encryptedPrivateKey:
                        artifacts.addressDetails.encryptedPrivateKey,
                    amount: new Prisma.Decimal(artifacts.totalAmount),
                    amountUsd: new Prisma.Decimal(amountUsd),
                    exchangeRate: new Prisma.Decimal(artifacts.exchangeRate),
                    platformWalletAddress: artifacts.platformWalletAddress,
                    status: PaymentStatus.PENDING,
                    requiredConfirmations: artifacts.requiredConfirmations,
                    expiresAt: artifacts.addressDetails.expiresAt,
                },
            });

            this.logger.info(
                {
                    paymentId: payment.id,
                    orderId,
                    cryptocurrency,
                    address: payment.paymentAddress,
                    amount: artifacts.cryptoAmount,
                    expiresAt: payment.expiresAt,
                },
                'Payment record created'
            );

            return this.finalizePayment(payment, orderId);
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
     * Compute everything needed to (re)create a payment for a given currency:
     * exchange rate, crypto amount, a freshly derived address, the platform
     * wallet, required confirmations, and network. Shared by the create and the
     * in-place replace paths.
     */
    private async buildPaymentArtifacts(
        orderId: string,
        cryptocurrency: CryptoCurrency,
        amountUsd: number
    ) {
        const exchangeRate = await this.exchangeRateService.getRate(
            cryptocurrency,
            'USD'
        );
        const cryptoAmount = await this.exchangeRateService.convertToCrypto(
            amountUsd,
            cryptocurrency,
            'USD'
        );
        const totalAmount = cryptoAmount;

        const addressDetails =
            await this.systemWalletService.generatePaymentAddress(
                orderId,
                cryptocurrency,
                totalAmount,
                amountUsd
            );

        const platformWalletAddress =
            await this.systemWalletService.getPlatformWalletAddress(
                cryptocurrency
            );
        if (!platformWalletAddress) {
            throw new BadRequestException(
                `Platform wallet address not configured for ${cryptocurrency}`
            );
        }

        const requiredConfirmations =
            this.getRequiredConfirmations(cryptocurrency);
        const network = this.getNetwork(cryptocurrency);

        this.logger.debug(
            { orderId, cryptocurrency, amountUsd, exchangeRate, cryptoAmount },
            'Calculated crypto amount'
        );

        return {
            exchangeRate,
            cryptoAmount,
            totalAmount,
            addressDetails,
            platformWalletAddress,
            requiredConfirmations,
            network,
        };
    }

    /**
     * Sync the stock reservation expiry, queue the verification job, and map
     * the persisted payment to its response DTO. Shared by create/replace.
     */
    private async finalizePayment(
        payment: { id: string; expiresAt: Date },
        orderId: string
    ): Promise<CryptoPaymentResponseDto> {
        await this.stockLineService.syncReservationExpiryForOrder(
            this.databaseService,
            orderId,
            payment.expiresAt
        );

        await this.paymentVerificationQueue.add(
            'verify-payment',
            { paymentId: payment.id, orderId },
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

        return this.mapToResponseDto(payment, orderId);
    }

    /**
     * Replace a pending, unfunded crypto payment in place with a new currency
     * (or a refreshed window). Updates the single existing record so the unique
     * one-to-one order relation is preserved. The conditional `where` also
     * guards against funds landing between the read and the write — Prisma
     * throws P2025 (no row matched), which we surface as a clean 400.
     */
    private async replacePaymentInPlace(
        order: { id: string; totalAmount: Prisma.Decimal },
        existingPaymentId: string,
        cryptocurrency: CryptoCurrency
    ): Promise<CryptoPaymentResponseDto> {
        const orderId = order.id;
        const amountUsd = parseFloat(order.totalAmount.toString());
        if (amountUsd <= 0) {
            throw new BadRequestException(
                'Order total amount must be greater than 0'
            );
        }

        const artifacts = await this.buildPaymentArtifacts(
            orderId,
            cryptocurrency,
            amountUsd
        );

        let payment;
        try {
            payment = await this.databaseService.cryptoPayment.update({
                where: {
                    id: existingPaymentId,
                    status: PaymentStatus.PENDING,
                    txHash: null,
                    confirmations: 0,
                },
                data: {
                    cryptocurrency,
                    network: artifacts.network,
                    paymentAddress: artifacts.addressDetails.address,
                    derivationIndex: artifacts.addressDetails.derivationIndex,
                    derivationPath: artifacts.addressDetails.derivationPath,
                    encryptedPrivateKey:
                        artifacts.addressDetails.encryptedPrivateKey,
                    amount: new Prisma.Decimal(artifacts.totalAmount),
                    amountUsd: new Prisma.Decimal(amountUsd),
                    exchangeRate: new Prisma.Decimal(artifacts.exchangeRate),
                    platformWalletAddress: artifacts.platformWalletAddress,
                    status: PaymentStatus.PENDING,
                    requiredConfirmations: artifacts.requiredConfirmations,
                    expiresAt: artifacts.addressDetails.expiresAt,
                    // Reset any prior monitoring state so a stale verification
                    // run can never carry over to the new address/currency.
                    txHash: null,
                    confirmations: 0,
                    paidAt: null,
                    confirmedAt: null,
                },
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2025'
            ) {
                throw new BadRequestException(
                    'Cannot change currency: a payment has already been detected for this order.'
                );
            }
            throw error;
        }

        this.logger.info(
            {
                paymentId: payment.id,
                orderId,
                cryptocurrency,
                address: payment.paymentAddress,
                expiresAt: payment.expiresAt,
            },
            'Pending payment replaced in place'
        );

        return this.finalizePayment(payment, orderId);
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
                        include: { order: true },
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
            orderStatus: payment.order?.status,
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
