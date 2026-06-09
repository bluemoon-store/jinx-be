import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { CryptoCurrency, PaymentStatus, OrderStatus } from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IOrderConfirmedPayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { CryptoPaymentService } from './crypto-payment.service';
import { BlockchainProviderFactory } from '../blockchain-providers/blockchain-provider.factory';
import { IBlockchainMonitorService } from '../interfaces/blockchain-monitor.service.interface';
import { OrderDeliveryService } from 'src/modules/order/services/order-delivery.service';
import { StockLineService } from 'src/modules/stock-line/services/stock-line.service';
import { WalletService } from 'src/modules/wallet/services/wallet.service';

/**
 * Blockchain Monitor Service
 * Monitors blockchain for incoming payments and tracks confirmations
 */
@Injectable()
export class BlockchainMonitorService implements IBlockchainMonitorService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly cryptoPaymentService: CryptoPaymentService,
        private readonly providerFactory: BlockchainProviderFactory,
        private readonly configService: ConfigService,
        private readonly deliveryService: OrderDeliveryService,
        private readonly stockLineService: StockLineService,
        private readonly walletService: WalletService,
        @InjectQueue('crypto-payment-verification')
        private readonly paymentVerificationQueue: Queue,
        @InjectQueue('crypto-payment-forwarding')
        private readonly paymentForwardingQueue: Queue,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(BlockchainMonitorService.name);
    }

    /**
     * Check a single payment for incoming transaction
     * @param paymentId - Payment ID
     */
    async checkPayment(paymentId: string): Promise<void> {
        this.logger.debug({ paymentId }, 'Checking payment');

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
                this.logger.warn({ paymentId }, 'Payment not found');
                return;
            }

            // Skip if payment is not pending
            if (payment.status !== PaymentStatus.PENDING) {
                this.logger.debug(
                    { paymentId, status: payment.status },
                    'Payment not pending, skipping check'
                );
                return;
            }

            // Check if payment has expired
            const now = new Date();
            if (now > payment.expiresAt) {
                this.logger.info(
                    { paymentId, expiresAt: payment.expiresAt },
                    'Payment expired, expiring payment'
                );
                await this.cryptoPaymentService.expirePayment(paymentId);
                return;
            }

            // Get blockchain provider
            const provider = this.providerFactory.getProvider(
                payment.cryptocurrency
            );

            // Check balance
            let balance: string;
            let transaction = null;

            if (
                payment.cryptocurrency === CryptoCurrency.USDT_ERC20 ||
                payment.cryptocurrency === CryptoCurrency.USDC_ERC20
            ) {
                // ERC-20 token - use Ethereum provider with token contract
                const ethereumProvider =
                    this.providerFactory.getEthereumProvider();
                const tokenContract = this.getTokenContractAddress(
                    payment.cryptocurrency
                );

                if (!tokenContract) {
                    this.logger.error(
                        { paymentId, cryptocurrency: payment.cryptocurrency },
                        'Token contract address not found'
                    );
                    return;
                }

                balance = await ethereumProvider.getERC20BalancePublic(
                    payment.paymentAddress,
                    tokenContract
                );
                transaction =
                    await ethereumProvider.getERC20TransactionByAddressPublic(
                        payment.paymentAddress,
                        tokenContract
                    );
            } else {
                // Native cryptocurrency
                balance = await provider.getBalance(payment.paymentAddress);
                transaction = await provider.getTransactionByAddress(
                    payment.paymentAddress
                );
            }

            const balanceNumber = parseFloat(balance);
            const expectedAmount = parseFloat(payment.amount.toString());

            this.logger.debug(
                {
                    paymentId,
                    address: payment.paymentAddress,
                    balance: balanceNumber,
                    expectedAmount,
                    cryptocurrency: payment.cryptocurrency,
                },
                'Balance checked'
            );

            // Get partial payment tolerance from config (default 1%)
            const tolerancePercent = this.configService.get<number>(
                'crypto.payment.partialPaymentTolerancePercent',
                1.0
            );
            const minAcceptableAmount =
                expectedAmount * (1 - tolerancePercent / 100);

            // Check if payment amount is met or exceeded (with tolerance)
            if (balanceNumber >= minAcceptableAmount) {
                // Payment detected! (with possible partial/overpayment)
                const isPartialPayment =
                    balanceNumber >= minAcceptableAmount &&
                    balanceNumber < expectedAmount;
                const isOverpayment = balanceNumber > expectedAmount;

                this.logger.info(
                    {
                        paymentId,
                        orderId: payment.orderId,
                        address: payment.paymentAddress,
                        amountReceived: balanceNumber,
                        expectedAmount,
                        isPartialPayment,
                        isOverpayment,
                        txHash: transaction?.hash,
                    },
                    'Payment detected on blockchain'
                );

                // Verify transaction details (double-spend protection)
                if (transaction) {
                    const isValidTransaction = await this.verifyTransaction(
                        transaction,
                        payment.paymentAddress,
                        minAcceptableAmount,
                        payment.cryptocurrency
                    );

                    if (!isValidTransaction) {
                        this.logger.error(
                            {
                                paymentId,
                                txHash: transaction.hash,
                                to: transaction.to,
                                amount: transaction.amount,
                            },
                            'Transaction verification failed - possible fraud'
                        );
                        return; // Don't accept invalid transactions
                    }
                }

                // Prepare metadata for partial/overpayment
                const metadata: any = {
                    ...((payment.metadata as any) || {}),
                    amountReceived: balanceNumber,
                    expectedAmount,
                };

                if (isPartialPayment) {
                    metadata.isPartialPayment = true;
                    metadata.partialPaymentPercentage =
                        (balanceNumber / expectedAmount) * 100;
                    metadata.shortfall = expectedAmount - balanceNumber;
                    // Flag for admin review
                    metadata.requiresAdminReview = true;
                }

                if (isOverpayment) {
                    metadata.isOverpayment = true;
                    metadata.overpaymentAmount = balanceNumber - expectedAmount;
                    // Flag for admin review
                    metadata.requiresAdminReview = true;
                }

                // Update payment status to PAID
                await this.databaseService.cryptoPayment.update({
                    where: { id: paymentId },
                    data: {
                        status: PaymentStatus.PAID,
                        paidAt: new Date(),
                        txHash: transaction?.hash || null,
                        confirmations: transaction?.confirmations || 0,
                        metadata,
                    },
                });

                // Queue confirmation checking job
                await this.paymentVerificationQueue.add(
                    'check-confirmations',
                    { paymentId },
                    {
                        attempts: 10, // Check up to 10 times
                        backoff: {
                            type: 'exponential',
                            delay: 60000, // Start with 1 minute delay
                        },
                        removeOnComplete: true,
                        removeOnFail: false,
                    }
                );

                this.logger.info(
                    { paymentId },
                    'Payment marked as PAID, confirmation check queued'
                );
            } else if (balanceNumber > 0) {
                // Insufficient partial payment detected (below tolerance)
                this.logger.warn(
                    {
                        paymentId,
                        balance: balanceNumber,
                        expectedAmount,
                        minAcceptable: minAcceptableAmount,
                        percentage: (balanceNumber / expectedAmount) * 100,
                        tolerancePercent,
                    },
                    'Insufficient partial payment detected (below tolerance)'
                );

                // Update metadata to flag for admin review
                await this.databaseService.cryptoPayment.update({
                    where: { id: paymentId },
                    data: {
                        metadata: {
                            ...((payment.metadata as any) || {}),
                            insufficientPayment: true,
                            amountReceived: balanceNumber,
                            expectedAmount,
                            shortfall: expectedAmount - balanceNumber,
                            requiresAdminReview: true,
                            detectedAt: new Date().toISOString(),
                        },
                    },
                });
            }
        } catch (error) {
            this.logger.error({ error, paymentId }, 'Failed to check payment');
            // Don't throw - allow retry
        }
    }

    async checkTopUp(topUpId: string): Promise<void> {
        this.logger.debug({ topUpId }, 'Checking wallet top-up');

        try {
            const topUp = await this.databaseService.walletTopUp.findUnique({
                where: { id: topUpId },
                include: {
                    wallet: true,
                },
            });

            if (!topUp || topUp.status !== PaymentStatus.PENDING) {
                return;
            }

            const now = new Date();
            if (now > topUp.expiresAt) {
                await this.walletService.expireWalletTopUp(topUpId);
                return;
            }

            const provider = this.providerFactory.getProvider(
                topUp.cryptocurrency
            );

            let balance: string;
            let transaction = null;
            if (
                topUp.cryptocurrency === CryptoCurrency.USDT_ERC20 ||
                topUp.cryptocurrency === CryptoCurrency.USDC_ERC20
            ) {
                const ethereumProvider =
                    this.providerFactory.getEthereumProvider();
                const tokenContract = this.getTokenContractAddress(
                    topUp.cryptocurrency
                );
                if (!tokenContract) {
                    this.logger.error(
                        { topUpId, cryptocurrency: topUp.cryptocurrency },
                        'Token contract address not found for wallet top-up'
                    );
                    return;
                }
                balance = await ethereumProvider.getERC20BalancePublic(
                    topUp.paymentAddress,
                    tokenContract
                );
                transaction =
                    await ethereumProvider.getERC20TransactionByAddressPublic(
                        topUp.paymentAddress,
                        tokenContract
                    );
            } else {
                balance = await provider.getBalance(topUp.paymentAddress);
                transaction = await provider.getTransactionByAddress(
                    topUp.paymentAddress
                );
            }

            const balanceNumber = parseFloat(balance);
            const expectedAmount = parseFloat(topUp.amount.toString());

            this.logger.debug(
                {
                    topUpId,
                    address: topUp.paymentAddress,
                    balance: balanceNumber,
                    expectedAmount,
                    cryptocurrency: topUp.cryptocurrency,
                },
                'Wallet top-up balance checked'
            );

            const tolerancePercent = this.configService.get<number>(
                'crypto.payment.partialPaymentTolerancePercent',
                1.0
            );
            const minAcceptableAmount =
                expectedAmount * (1 - tolerancePercent / 100);

            if (balanceNumber >= minAcceptableAmount) {
                const isPartialPayment =
                    balanceNumber >= minAcceptableAmount &&
                    balanceNumber < expectedAmount;
                const isOverpayment = balanceNumber > expectedAmount;

                if (transaction) {
                    const isValidTransaction = await this.verifyTransaction(
                        transaction,
                        topUp.paymentAddress,
                        minAcceptableAmount,
                        topUp.cryptocurrency
                    );

                    if (!isValidTransaction) {
                        this.logger.error(
                            {
                                topUpId,
                                txHash: transaction.hash,
                                to: transaction.to,
                                amount: transaction.amount,
                            },
                            'Wallet top-up transaction verification failed'
                        );
                        return;
                    }
                }

                const metadata: any = {
                    ...((topUp.metadata as any) || {}),
                    amountReceived: balanceNumber,
                    expectedAmount,
                };

                if (isPartialPayment) {
                    metadata.isPartialPayment = true;
                    metadata.partialPaymentPercentage =
                        (balanceNumber / expectedAmount) * 100;
                    metadata.shortfall = expectedAmount - balanceNumber;
                    metadata.requiresAdminReview = true;
                }

                if (isOverpayment) {
                    metadata.isOverpayment = true;
                    metadata.overpaymentAmount = balanceNumber - expectedAmount;
                    metadata.requiresAdminReview = true;
                }

                await this.databaseService.walletTopUp.update({
                    where: { id: topUpId },
                    data: {
                        status: PaymentStatus.PAID,
                        paidAt: new Date(),
                        txHash: transaction?.hash || null,
                        confirmations: transaction?.confirmations || 0,
                        metadata,
                    },
                });

                await this.paymentVerificationQueue.add(
                    'check-topup-confirmations',
                    { topUpId },
                    {
                        attempts: 10,
                        backoff: { type: 'exponential', delay: 60000 },
                        removeOnComplete: true,
                        removeOnFail: false,
                    }
                );

                this.logger.info(
                    { topUpId },
                    'Wallet top-up marked as PAID, confirmation check queued'
                );
            } else if (balanceNumber > 0) {
                this.logger.warn(
                    {
                        topUpId,
                        balance: balanceNumber,
                        expectedAmount,
                        minAcceptable: minAcceptableAmount,
                        percentage: (balanceNumber / expectedAmount) * 100,
                        tolerancePercent,
                    },
                    'Insufficient wallet top-up (below tolerance)'
                );

                await this.databaseService.walletTopUp.update({
                    where: { id: topUpId },
                    data: {
                        metadata: {
                            ...((topUp.metadata as any) || {}),
                            insufficientPayment: true,
                            amountReceived: balanceNumber,
                            expectedAmount,
                            shortfall: expectedAmount - balanceNumber,
                            requiresAdminReview: true,
                            detectedAt: new Date().toISOString(),
                        },
                    },
                });
            }
        } catch (error) {
            this.logger.error(
                { error, topUpId },
                'Failed to check wallet top-up'
            );
        }
    }

    /**
     * Check all pending payments (including grace period)
     */
    async checkPendingPayments(): Promise<void> {
        this.logger.debug('Checking all pending payments');

        try {
            // Get grace period from config
            const gracePeriodMinutes = this.configService.get<number>(
                'crypto.payment.expirationGracePeriodMinutes',
                30
            );
            const gracePeriodDate = new Date();
            gracePeriodDate.setMinutes(
                gracePeriodDate.getMinutes() - gracePeriodMinutes
            );

            const pendingPayments =
                await this.databaseService.cryptoPayment.findMany({
                    where: {
                        status: PaymentStatus.PENDING,
                        expiresAt: {
                            gt: gracePeriodDate, // Within grace period
                        },
                    },
                    select: {
                        id: true,
                        expiresAt: true,
                    },
                    take: 100, // Limit to 100 payments per batch
                });

            // Separate active vs grace period payments
            const now = new Date();
            const activePayments = pendingPayments.filter(
                p => p.expiresAt > now
            );
            const gracePeriodPayments = pendingPayments.filter(
                p => p.expiresAt <= now
            );

            this.logger.info(
                {
                    activeCount: activePayments.length,
                    gracePeriodCount: gracePeriodPayments.length,
                    total: pendingPayments.length,
                },
                'Found pending payments to check'
            );

            // Check grace period payments with special logging
            if (gracePeriodPayments.length > 0) {
                this.logger.info(
                    {
                        count: gracePeriodPayments.length,
                        gracePeriodMinutes,
                    },
                    'Checking expired payments within grace period'
                );
            }

            // Check payments in parallel (with concurrency limit)
            const concurrency = 5; // Check 5 payments at a time
            for (let i = 0; i < pendingPayments.length; i += concurrency) {
                const batch = pendingPayments.slice(i, i + concurrency);
                await Promise.allSettled(
                    batch.map(payment => this.checkPayment(payment.id))
                );
            }

            this.logger.info(
                { count: pendingPayments.length },
                'Finished checking pending payments'
            );
        } catch (error) {
            this.logger.error({ error }, 'Failed to check pending payments');
            // Don't throw - allow retry
        }
    }

    /**
     * Poll pending wallet top-ups (mirrors checkPendingPayments for crypto orders)
     */
    async checkPendingWalletTopUps(): Promise<void> {
        this.logger.debug('Checking all pending wallet top-ups');

        try {
            const gracePeriodMinutes = this.configService.get<number>(
                'crypto.payment.expirationGracePeriodMinutes',
                30
            );
            const gracePeriodDate = new Date();
            gracePeriodDate.setMinutes(
                gracePeriodDate.getMinutes() - gracePeriodMinutes
            );

            const pendingTopUps =
                await this.databaseService.walletTopUp.findMany({
                    where: {
                        status: PaymentStatus.PENDING,
                        expiresAt: {
                            gt: gracePeriodDate,
                        },
                    },
                    select: {
                        id: true,
                        expiresAt: true,
                    },
                    take: 100,
                });

            const now = new Date();
            const activeTopUps = pendingTopUps.filter(t => t.expiresAt > now);
            const graceTopUps = pendingTopUps.filter(t => t.expiresAt <= now);

            this.logger.info(
                {
                    activeCount: activeTopUps.length,
                    gracePeriodCount: graceTopUps.length,
                    total: pendingTopUps.length,
                },
                'Found pending wallet top-ups to check'
            );

            if (graceTopUps.length > 0) {
                this.logger.info(
                    {
                        count: graceTopUps.length,
                        gracePeriodMinutes,
                    },
                    'Checking wallet top-ups within expiration grace period'
                );
            }

            const concurrency = 5;
            for (let i = 0; i < pendingTopUps.length; i += concurrency) {
                const batch = pendingTopUps.slice(i, i + concurrency);
                await Promise.allSettled(batch.map(t => this.checkTopUp(t.id)));
            }

            this.logger.info(
                { count: pendingTopUps.length },
                'Finished checking pending wallet top-ups'
            );
        } catch (error) {
            this.logger.error(
                { error },
                'Failed to check pending wallet top-ups'
            );
        }
    }

    /**
     * Check transaction confirmations
     * @param paymentId - Payment ID
     */
    async checkConfirmations(paymentId: string): Promise<void> {
        this.logger.debug({ paymentId }, 'Checking transaction confirmations');

        try {
            const payment = await this.databaseService.cryptoPayment.findUnique(
                {
                    where: { id: paymentId },
                }
            );

            if (!payment || !payment.txHash) {
                this.logger.warn(
                    { paymentId },
                    'Payment or transaction hash not found'
                );
                return;
            }

            // Skip if already confirmed
            if (payment.status === PaymentStatus.CONFIRMED) {
                this.logger.debug({ paymentId }, 'Payment already confirmed');
                return;
            }

            // Get blockchain provider
            const provider = this.providerFactory.getProvider(
                payment.cryptocurrency
            );

            // Get current confirmations
            const confirmations = await provider.getTransactionConfirmations(
                payment.txHash
            );

            this.logger.debug(
                {
                    paymentId,
                    txHash: payment.txHash,
                    confirmations,
                    required: payment.requiredConfirmations,
                },
                'Confirmations checked'
            );

            // Update confirmation count
            await this.databaseService.cryptoPayment.update({
                where: { id: paymentId },
                data: {
                    confirmations,
                    status:
                        confirmations > 0
                            ? PaymentStatus.CONFIRMING
                            : PaymentStatus.PAID,
                },
            });

            // Check if required confirmations met
            if (confirmations >= payment.requiredConfirmations) {
                this.logger.info(
                    {
                        paymentId,
                        confirmations,
                        required: payment.requiredConfirmations,
                    },
                    'Required confirmations met, confirming payment'
                );
                await this.confirmPayment(paymentId);
            } else {
                // Re-queue for another check if not confirmed yet
                const delay = this.configService.get<number>(
                    'crypto.payment.confirmationRecheckDelayMs',
                    30_000
                );

                await this.paymentVerificationQueue.add(
                    'check-confirmations',
                    { paymentId },
                    {
                        delay,
                        attempts: 10,
                        removeOnComplete: true,
                        removeOnFail: false,
                    }
                );

                this.logger.debug(
                    {
                        paymentId,
                        confirmations,
                        required: payment.requiredConfirmations,
                        delay,
                    },
                    'Re-queued confirmation check'
                );
            }
        } catch (error) {
            this.logger.error(
                { error, paymentId },
                'Failed to check confirmations'
            );
            // Don't throw - allow retry
        }
    }

    async checkTopUpConfirmations(topUpId: string): Promise<void> {
        try {
            const topUp = await this.databaseService.walletTopUp.findUnique({
                where: { id: topUpId },
            });

            if (!topUp || !topUp.txHash) {
                return;
            }

            if (topUp.status === PaymentStatus.CONFIRMED) {
                return;
            }

            const provider = this.providerFactory.getProvider(
                topUp.cryptocurrency
            );
            const confirmations = await provider.getTransactionConfirmations(
                topUp.txHash
            );

            await this.databaseService.walletTopUp.update({
                where: { id: topUpId },
                data: {
                    confirmations,
                    status:
                        confirmations > 0
                            ? PaymentStatus.CONFIRMING
                            : PaymentStatus.PAID,
                },
            });

            if (confirmations < topUp.requiredConfirmations) {
                const delay = this.configService.get<number>(
                    'crypto.payment.confirmationRecheckDelayMs',
                    30_000
                );
                await this.paymentVerificationQueue.add(
                    'check-topup-confirmations',
                    { topUpId },
                    {
                        delay,
                        attempts: 10,
                        removeOnComplete: true,
                        removeOnFail: false,
                    }
                );
                return;
            }

            await this.databaseService.walletTopUp.update({
                where: { id: topUpId },
                data: {
                    status: PaymentStatus.CONFIRMED,
                    confirmedAt: new Date(),
                },
            });

            await this.walletService.processConfirmedTopUp(topUpId);
        } catch (error) {
            this.logger.error(
                { error, topUpId },
                'Failed to check wallet top-up confirmations'
            );
        }
    }

    /**
     * Confirm payment after required confirmations
     * @param paymentId - Payment ID
     */
    async confirmPayment(paymentId: string): Promise<void> {
        this.logger.info({ paymentId }, 'Confirming payment');

        try {
            const payment = await this.databaseService.$transaction(
                async tx => {
                    const p = await tx.cryptoPayment.update({
                        where: { id: paymentId },
                        data: {
                            status: PaymentStatus.CONFIRMED,
                            confirmedAt: new Date(),
                        },
                        include: {
                            order: true,
                        },
                    });
                    await this.stockLineService.markSoldForOrder(tx, p.orderId);
                    // Clear the buyer's cart atomically with payment confirmation.
                    await tx.cartItem.deleteMany({
                        where: { cart: { userId: p.order.userId } },
                    });
                    await tx.order.update({
                        where: { id: p.orderId },
                        data: {
                            status: OrderStatus.COMPLETED,
                            completedAt: new Date(),
                        },
                    });
                    return p;
                }
            );

            this.logger.info(
                {
                    paymentId,
                    orderId: payment.orderId,
                    cryptocurrency: payment.cryptocurrency,
                    amount: payment.amount.toString(),
                },
                'Payment confirmed'
            );

            this.logger.info(
                { paymentId, orderId: payment.orderId },
                'Order status updated to COMPLETED'
            );

            await this.enqueueOrderConfirmedEmail(
                payment.orderId,
                `${payment.cryptocurrency}`,
                payment.amountUsd.toString()
            );

            // Auto-process order for instant delivery (all products are digital)
            try {
                await this.deliveryService.processInstantDelivery(
                    payment.orderId
                );
            } catch (deliveryError) {
                this.logger.error(
                    {
                        error: deliveryError,
                        paymentId,
                        orderId: payment.orderId,
                    },
                    'Failed to trigger auto-delivery'
                );
            }

            // TODO: Send notification
            // await this.notificationService.sendPaymentConfirmed(payment.orderId);

            // Queue payment forwarding (must be CONFIRMED and not already forwarded)
            const paymentCheck =
                await this.databaseService.cryptoPayment.findUnique({
                    where: { id: paymentId },
                    select: {
                        status: true,
                        forwardTxHash: true,
                    },
                });

            if (
                paymentCheck &&
                paymentCheck.status === PaymentStatus.CONFIRMED &&
                !paymentCheck.forwardTxHash
            ) {
                await this.paymentForwardingQueue.add(
                    'forward-payment',
                    { paymentId },
                    {
                        attempts: 5,
                        backoff: {
                            type: 'exponential',
                            delay: 60000, // Start with 1 minute delay
                        },
                        removeOnComplete: true,
                        removeOnFail: false,
                    }
                );

                this.logger.info(
                    { paymentId },
                    'Payment forwarding job queued'
                );
            }
        } catch (error) {
            this.logger.error(
                { error, paymentId },
                'Failed to confirm payment'
            );
            throw error; // Re-throw for retry
        }
    }

    /**
     * Verify transaction details (double-spend protection)
     * @param transaction - Transaction to verify
     * @param expectedAddress - Expected recipient address
     * @param minAmount - Minimum expected amount
     * @param cryptocurrency - Used for address comparison rules (Tron Base58 is case-sensitive)
     * @returns True if transaction is valid
     */
    private async verifyTransaction(
        transaction: any,
        expectedAddress: string,
        minAmount: number,
        cryptocurrency: CryptoCurrency
    ): Promise<boolean> {
        try {
            // 1. Verify recipient address matches
            const recipientMatches =
                cryptocurrency === CryptoCurrency.USDT_TRC20
                    ? transaction.to === expectedAddress
                    : transaction.to.toLowerCase() ===
                      expectedAddress.toLowerCase();
            if (!recipientMatches) {
                this.logger.error(
                    {
                        txHash: transaction.hash,
                        expectedTo: expectedAddress,
                        actualTo: transaction.to,
                    },
                    'Transaction recipient address mismatch'
                );
                return false;
            }

            // 2. Verify amount is sufficient
            const txAmount = parseFloat(transaction.amount || '0');
            if (txAmount < minAmount) {
                this.logger.error(
                    {
                        txHash: transaction.hash,
                        expectedAmount: minAmount,
                        actualAmount: txAmount,
                    },
                    'Transaction amount insufficient'
                );
                return false;
            }

            // 3. Verify transaction has confirmations (not in mempool only)
            // Allow 0 confirmations for initial detection, but flag suspicious patterns
            if (transaction.confirmations === undefined) {
                this.logger.warn(
                    { txHash: transaction.hash },
                    'Transaction confirmations unavailable'
                );
            }

            // 4. Verify block number exists (transaction is mined)
            if (!transaction.blockNumber && transaction.confirmations === 0) {
                // Transaction is in mempool - this is acceptable for initial detection
                this.logger.debug(
                    { txHash: transaction.hash },
                    'Transaction in mempool, not yet mined'
                );
            }

            this.logger.debug(
                {
                    txHash: transaction.hash,
                    to: transaction.to,
                    amount: txAmount,
                    confirmations: transaction.confirmations,
                },
                'Transaction verification passed'
            );

            return true;
        } catch (error) {
            this.logger.error(
                { error, transaction },
                'Failed to verify transaction'
            );
            return false;
        }
    }

    /**
     * Get ERC-20 token contract address
     * @param cryptocurrency - Cryptocurrency type
     * @returns Contract address
     */
    private getTokenContractAddress(cryptocurrency: CryptoCurrency): string {
        const ethereumProvider = this.providerFactory.getEthereumProvider();

        if (cryptocurrency === CryptoCurrency.USDT_ERC20) {
            return ethereumProvider.getTokenContractAddress('USDT') || '';
        }

        if (cryptocurrency === CryptoCurrency.USDC_ERC20) {
            return ethereumProvider.getTokenContractAddress('USDC') || '';
        }

        return '';
    }

    private async enqueueOrderConfirmedEmail(
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

            const frontendUrl =
                this.configService.get<string>('app.frontendUrl') ??
                'http://localhost:3000';
            const dashboardLink = `${frontendUrl.replace(/\/$/, '')}/orders/${order.id}`;
            const numeric = Number(amountUsd);
            const formatted = `$${(Number.isFinite(numeric)
                ? numeric
                : 0
            ).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;
            const completedAt = order.completedAt ?? new Date();

            this.emailQueue.add(EMAIL_TEMPLATES.ORDER_CONFIRMED, {
                data: {
                    order_id: order.orderNumber,
                    payment_method: paymentMethod,
                    amount: formatted,
                    date: completedAt.toISOString().slice(0, 10),
                    dashboard_link: dashboardLink,
                },
                toEmails: [order.user.email],
            } as ISendEmailBasePayload<IOrderConfirmedPayload>);
        } catch (error) {
            this.logger.error(
                { error, orderId },
                'Failed to enqueue order-confirmed email'
            );
        }
    }
}
