import { HttpStatus, Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PinoLogger } from 'nestjs-pino';
import {
    CryptoCurrency,
    PaymentStatus,
    Prisma,
    WalletTransactionType,
} from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    ISendEmailBasePayload,
    IWalletTopUpSuccessfulPayload,
} from 'src/common/helper/interfaces/email.interface';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { SystemWalletService } from 'src/modules/crypto-payment/services/system-wallet.service';
import { ExchangeRateService } from 'src/modules/crypto-payment/services/exchange-rate.service';
import {
    generatePaymentQRCode,
    generatePaymentURI,
} from 'src/modules/crypto-payment/utils/qr-code.util';

import { WalletAddBalanceDto } from '../dtos/request/wallet.add-balance.request';
import { WalletAdjustBalanceDto } from '../dtos/request/wallet.adjust-balance.request';
import { CreateWalletTopUpDto } from '../dtos/request/wallet.topup.request';
import { WalletResponseDto } from '../dtos/response/wallet.response';
import { WalletTopUpResponseDto } from '../dtos/response/wallet-topup.response';
import { WalletTransactionResponseDto } from '../dtos/response/wallet-transaction.response';
import { IWalletService } from '../interfaces/wallet.service.interface';
import { ActivityLogEmitterService } from 'src/modules/activity-log/services/activity-log.emitter.service';

@Injectable()
export class WalletService implements IWalletService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly paginationService: HelperPaginationService,
        private readonly systemWalletService: SystemWalletService,
        private readonly exchangeRateService: ExchangeRateService,
        private readonly configService: ConfigService,
        @InjectQueue('crypto-payment-verification')
        private readonly paymentVerificationQueue: Queue,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue,
        private readonly activityLogEmitter: ActivityLogEmitterService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(WalletService.name);
    }

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

        return 3;
    }

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

        if (!isTestnet) {
            return networkMap[cryptocurrency];
        }

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

    private async mapTopUpResponse(
        topUp: any
    ): Promise<WalletTopUpResponseDto> {
        const amount = parseFloat(topUp.amount.toString());
        const qrCode = await generatePaymentQRCode(
            topUp.paymentAddress,
            amount,
            topUp.cryptocurrency
        );
        const paymentUri = generatePaymentURI(
            topUp.paymentAddress,
            amount,
            topUp.cryptocurrency
        );

        return {
            id: topUp.id,
            walletId: topUp.walletId,
            cryptocurrency: topUp.cryptocurrency,
            network: topUp.network,
            paymentAddress: topUp.paymentAddress,
            amount: topUp.amount,
            amountUsd: topUp.amountUsd,
            exchangeRate: topUp.exchangeRate,
            status: topUp.status,
            confirmations: topUp.confirmations,
            requiredConfirmations: topUp.requiredConfirmations,
            expiresAt: topUp.expiresAt,
            qrCode,
            paymentUri,
            creditedAt: topUp.creditedAt,
            createdAt: topUp.createdAt,
        };
    }

    /**
     * Create a transaction record
     */
    private async createTransaction(
        walletId: string,
        type: WalletTransactionType,
        amount: number,
        balance: number,
        description: string,
        referenceId?: string
    ): Promise<void> {
        await this.databaseService.walletTransaction.create({
            data: {
                walletId,
                type,
                amount: amount.toString(),
                balance: balance.toString(),
                description,
                referenceId,
            },
        });

        this.logger.info(
            {
                walletId,
                type,
                amount,
                balance,
                referenceId,
            },
            'Wallet transaction created'
        );
    }

    /**
     * Get current balance as number
     */
    private getBalanceAsNumber(balance: any): number {
        if (typeof balance === 'string') {
            return parseFloat(balance);
        }
        return Number(balance);
    }

    /**
     * Create wallet for user
     */
    async createWallet(userId: string): Promise<WalletResponseDto> {
        try {
            // Check if wallet already exists
            const existingWallet =
                await this.databaseService.userWallet.findUnique({
                    where: { userId },
                });

            if (existingWallet) {
                return existingWallet as WalletResponseDto;
            }

            // Verify user exists
            const user = await this.databaseService.user.findUnique({
                where: { id: userId },
            });

            if (!user) {
                throw new HttpException(
                    'wallet.error.userNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            // Create wallet
            const wallet = await this.databaseService.userWallet.create({
                data: {
                    userId,
                    balance: 0,
                },
            });

            this.logger.info({ userId, walletId: wallet.id }, 'Wallet created');
            return wallet as WalletResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to create wallet: ${error.message}`);
            throw new HttpException(
                'wallet.error.createWalletFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get wallet for user (creates if doesn't exist)
     */
    async getWallet(userId: string): Promise<WalletResponseDto> {
        try {
            let wallet = await this.databaseService.userWallet.findUnique({
                where: { userId },
            });

            if (!wallet) {
                // Create wallet if it doesn't exist
                wallet = await this.createWallet(userId);
            }

            return wallet as WalletResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to get wallet: ${error.message}`);
            throw new HttpException(
                'wallet.error.getWalletFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get wallet by user ID (admin use - doesn't create if missing)
     */
    async getWalletByUserId(userId: string): Promise<WalletResponseDto> {
        try {
            const wallet = await this.databaseService.userWallet.findUnique({
                where: { userId },
            });

            if (!wallet) {
                throw new HttpException(
                    'wallet.error.walletNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            return wallet as WalletResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(
                `Failed to get wallet by user ID: ${error.message}`
            );
            throw new HttpException(
                'wallet.error.getWalletFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Add balance to wallet (admin only)
     */
    async addBalance(
        userId: string,
        data: WalletAddBalanceDto
    ): Promise<WalletResponseDto> {
        try {
            // Get or create wallet
            const wallet = await this.getWallet(userId);

            // Calculate new balance
            const currentBalance = this.getBalanceAsNumber(wallet.balance);
            const newBalance = currentBalance + data.amount;

            this.activityLogEmitter.captureBefore({
                before: { balance: currentBalance },
            });

            // Update wallet balance
            const updatedWallet = await this.databaseService.userWallet.update({
                where: { id: wallet.id },
                data: { balance: newBalance.toString() },
            });

            // Create transaction record
            await this.createTransaction(
                wallet.id,
                WalletTransactionType.DEPOSIT,
                data.amount,
                newBalance,
                data.description,
                data.referenceId
            );

            this.logger.info(
                {
                    userId,
                    walletId: wallet.id,
                    amount: data.amount,
                    oldBalance: currentBalance,
                    newBalance,
                },
                'Balance added to wallet'
            );

            this.activityLogEmitter.captureAfter({
                after: { balance: newBalance },
                resourceLabel: `user:${userId}`,
            });

            return updatedWallet as WalletResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to add balance: ${error.message}`);
            throw new HttpException(
                'wallet.error.addBalanceFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Deduct balance from wallet (internal use)
     */
    async deductBalance(
        userId: string,
        amount: number,
        description: string,
        referenceId?: string
    ): Promise<WalletResponseDto> {
        try {
            if (amount <= 0) {
                throw new HttpException(
                    'wallet.error.invalidAmount',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Get wallet
            const wallet = await this.getWallet(userId);

            // Check sufficient balance
            const currentBalance = this.getBalanceAsNumber(wallet.balance);
            if (currentBalance < amount) {
                throw new HttpException(
                    'wallet.error.insufficientBalance',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Calculate new balance
            const newBalance = currentBalance - amount;

            // Update wallet balance
            const updatedWallet = await this.databaseService.userWallet.update({
                where: { id: wallet.id },
                data: { balance: newBalance.toString() },
            });

            // Create transaction record
            await this.createTransaction(
                wallet.id,
                WalletTransactionType.PURCHASE,
                amount,
                newBalance,
                description,
                referenceId
            );

            this.logger.info(
                {
                    userId,
                    walletId: wallet.id,
                    amount,
                    oldBalance: currentBalance,
                    newBalance,
                    referenceId,
                },
                'Balance deducted from wallet'
            );

            return updatedWallet as WalletResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to deduct balance: ${error.message}`);
            throw new HttpException(
                'wallet.error.deductBalanceFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Adjust balance (admin only - can be positive or negative)
     */
    async adjustBalance(
        userId: string,
        data: WalletAdjustBalanceDto
    ): Promise<WalletResponseDto> {
        try {
            // Get wallet
            const wallet = await this.getWalletByUserId(userId);

            // Calculate new balance
            const currentBalance = this.getBalanceAsNumber(wallet.balance);
            const newBalance = currentBalance + data.amount;

            // Prevent negative balance unless explicitly allowed (for refunds, etc.)
            if (newBalance < 0) {
                throw new HttpException(
                    'wallet.error.negativeBalanceNotAllowed',
                    HttpStatus.BAD_REQUEST
                );
            }

            this.activityLogEmitter.captureBefore({
                before: { balance: currentBalance },
            });

            // Determine transaction type
            const transactionType =
                data.amount >= 0
                    ? WalletTransactionType.ADMIN_ADJUST
                    : WalletTransactionType.ADMIN_ADJUST;

            // Update wallet balance
            const updatedWallet = await this.databaseService.userWallet.update({
                where: { id: wallet.id },
                data: { balance: newBalance.toString() },
            });

            // Create transaction record
            await this.createTransaction(
                wallet.id,
                transactionType,
                Math.abs(data.amount),
                newBalance,
                data.description,
                data.referenceId
            );

            this.logger.info(
                {
                    userId,
                    walletId: wallet.id,
                    adjustment: data.amount,
                    oldBalance: currentBalance,
                    newBalance,
                    referenceId: data.referenceId,
                },
                'Balance adjusted'
            );

            this.activityLogEmitter.captureAfter({
                after: { balance: newBalance },
                resourceLabel: `user:${userId}`,
            });

            return updatedWallet as WalletResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to adjust balance: ${error.message}`);
            throw new HttpException(
                'wallet.error.adjustBalanceFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Refund balance to wallet (for order refunds)
     */
    async refundBalance(
        userId: string,
        amount: number,
        description: string,
        referenceId?: string
    ): Promise<WalletResponseDto> {
        try {
            if (amount <= 0) {
                throw new HttpException(
                    'wallet.error.invalidAmount',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Get wallet
            const wallet = await this.getWallet(userId);

            // Calculate new balance
            const currentBalance = this.getBalanceAsNumber(wallet.balance);
            const newBalance = currentBalance + amount;

            // Update wallet balance
            const updatedWallet = await this.databaseService.userWallet.update({
                where: { id: wallet.id },
                data: { balance: newBalance.toString() },
            });

            // Create transaction record
            await this.createTransaction(
                wallet.id,
                WalletTransactionType.REFUND,
                amount,
                newBalance,
                description,
                referenceId
            );

            this.logger.info(
                {
                    userId,
                    walletId: wallet.id,
                    amount,
                    oldBalance: currentBalance,
                    newBalance,
                    referenceId,
                },
                'Balance refunded to wallet'
            );

            return updatedWallet as WalletResponseDto;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to refund balance: ${error.message}`);
            throw new HttpException(
                'wallet.error.refundBalanceFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get transaction history
     */
    async getTransactionHistory(
        userId: string,
        options?: {
            page?: number;
            limit?: number;
            type?: string;
            sortBy?: 'createdAt' | 'amount';
            sortOrder?: 'asc' | 'desc';
        }
    ): Promise<ApiPaginatedDataDto<WalletTransactionResponseDto>> {
        try {
            // Get wallet
            const wallet = await this.getWallet(userId);

            // Build where clause
            const where: any = {
                walletId: wallet.id,
            };

            if (options?.type) {
                where.type = options.type as WalletTransactionType;
            }

            const result =
                await this.paginationService.paginate<WalletTransactionResponseDto>(
                    this.databaseService.walletTransaction,
                    {
                        page: options?.page ?? 1,
                        limit: options?.limit ?? 10,
                    },
                    {
                        where,
                        orderBy: {
                            [options?.sortBy ?? 'createdAt']:
                                options?.sortOrder ?? 'desc',
                        },
                    }
                );

            return result;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(
                `Failed to get transaction history: ${error.message}`
            );
            throw new HttpException(
                'wallet.error.getTransactionHistoryFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async createTopUp(
        userId: string,
        dto: CreateWalletTopUpDto
    ): Promise<WalletTopUpResponseDto> {
        try {
            const wallet = await this.getWallet(userId);
            const exchangeRate = await this.exchangeRateService.getRate(
                dto.cryptocurrency,
                'USD'
            );
            const cryptoAmount = await this.exchangeRateService.convertToCrypto(
                dto.amountUsd,
                dto.cryptocurrency,
                'USD'
            );

            const addressDetails =
                await this.systemWalletService.generatePaymentAddress(
                    wallet.id,
                    dto.cryptocurrency,
                    cryptoAmount,
                    dto.amountUsd
                );

            const topUp = await this.databaseService.walletTopUp.create({
                data: {
                    walletId: wallet.id,
                    cryptocurrency: dto.cryptocurrency,
                    network: this.getNetwork(dto.cryptocurrency),
                    paymentAddress: addressDetails.address,
                    derivationIndex: addressDetails.derivationIndex,
                    derivationPath: addressDetails.derivationPath,
                    encryptedPrivateKey: addressDetails.encryptedPrivateKey,
                    amount: new Prisma.Decimal(cryptoAmount),
                    amountUsd: new Prisma.Decimal(dto.amountUsd),
                    exchangeRate: new Prisma.Decimal(exchangeRate),
                    platformWalletAddress:
                        this.systemWalletService.getPlatformWalletAddress(
                            dto.cryptocurrency
                        ),
                    status: PaymentStatus.PENDING,
                    requiredConfirmations: this.getRequiredConfirmations(
                        dto.cryptocurrency
                    ),
                    expiresAt: addressDetails.expiresAt,
                },
            });

            await this.paymentVerificationQueue.add(
                'verify-topup',
                { topUpId: topUp.id },
                {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 60000,
                    },
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            );

            return this.mapTopUpResponse(topUp);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            this.logger.error(
                { error, userId, dto },
                'Failed to create top-up'
            );
            throw new HttpException(
                'wallet.error.createTopUpFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async getTopUp(
        userId: string,
        topUpId: string
    ): Promise<WalletTopUpResponseDto> {
        try {
            const topUp = await this.databaseService.walletTopUp.findFirst({
                where: {
                    id: topUpId,
                    wallet: {
                        userId,
                    },
                },
            });

            if (!topUp) {
                throw new HttpException(
                    'wallet.error.topUpNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            return this.mapTopUpResponse(topUp);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            this.logger.error(
                { error, userId, topUpId },
                'Failed to get top-up'
            );
            throw new HttpException(
                'wallet.error.getTopUpFailed',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    async getTopUpStatus(
        userId: string,
        topUpId: string
    ): Promise<WalletTopUpResponseDto> {
        return this.getTopUp(userId, topUpId);
    }

    async processConfirmedTopUp(topUpId: string): Promise<void> {
        try {
            const topUp = await this.databaseService.walletTopUp.findUnique({
                where: { id: topUpId },
                include: {
                    wallet: true,
                },
            });

            if (!topUp) {
                return;
            }

            if (
                topUp.status !== PaymentStatus.CONFIRMED ||
                topUp.creditedAt != null
            ) {
                return;
            }

            const amountUsd = parseFloat(topUp.amountUsd.toString());

            await this.addBalance(topUp.wallet.userId, {
                amount: amountUsd,
                description: `Top-up via ${topUp.cryptocurrency}`,
                referenceId: topUp.id,
            });

            const creditedAt = new Date();
            await this.databaseService.walletTopUp.update({
                where: { id: topUpId },
                data: {
                    creditedAt,
                },
            });

            await this.enqueueTopUpSuccessfulEmail(
                topUp.wallet.userId,
                amountUsd,
                creditedAt
            );
        } catch (error) {
            this.logger.error({ error, topUpId }, 'Failed to credit top-up');
            throw error;
        }
    }

    private async enqueueTopUpSuccessfulEmail(
        userId: string,
        amountUsd: number,
        creditedAt: Date
    ): Promise<void> {
        const user = await this.databaseService.user.findUnique({
            where: { id: userId },
            include: { wallet: true },
        });
        if (!user || !user.wallet) return;

        const formatUsd = (n: number) =>
            `$${n.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;
        const balance = parseFloat(user.wallet.balance.toString());
        const frontendUrl =
            this.configService.get<string>('app.frontendUrl') ??
            'http://localhost:3000';
        const dashboardLink = `${frontendUrl.replace(/\/$/, '')}/wallet`;

        this.emailQueue.add(EMAIL_TEMPLATES.WALLET_TOP_UP_SUCCESSFUL, {
            data: {
                amount: formatUsd(amountUsd),
                wallet_balance: formatUsd(balance),
                date: creditedAt.toISOString().slice(0, 10),
                dashboard_link: dashboardLink,
            },
            toEmails: [user.email],
        } as ISendEmailBasePayload<IWalletTopUpSuccessfulPayload>);
    }

    async expireWalletTopUp(topUpId: string): Promise<void> {
        this.logger.info({ topUpId }, 'Expiring wallet top-up');

        try {
            const topUp = await this.databaseService.walletTopUp.findUnique({
                where: { id: topUpId },
            });

            if (!topUp) {
                this.logger.warn(
                    { topUpId },
                    'Wallet top-up not found for expiration'
                );
                return;
            }

            if (topUp.status !== PaymentStatus.PENDING) {
                this.logger.debug(
                    { topUpId, status: topUp.status },
                    'Wallet top-up already processed, skipping expiration'
                );
                return;
            }

            await this.databaseService.walletTopUp.update({
                where: { id: topUpId },
                data: {
                    status: PaymentStatus.EXPIRED,
                },
            });

            this.logger.info({ topUpId }, 'Wallet top-up expired successfully');
        } catch (error) {
            this.logger.error(
                { error, topUpId },
                'Failed to expire wallet top-up'
            );
        }
    }
}
