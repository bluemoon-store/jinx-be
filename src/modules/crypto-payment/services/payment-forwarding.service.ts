import {
    Injectable,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CryptoCurrency, PaymentStatus } from '@prisma/client';
import { ethers } from 'ethers';

import { DatabaseService } from 'src/common/database/services/database.service';
import { SystemWalletService } from './system-wallet.service';
import { HotWalletService } from './hot-wallet.service';
import { BlockchainProviderFactory } from '../blockchain-providers/blockchain-provider.factory';
import { IPaymentForwardingService } from '../interfaces/payment-forwarding.service.interface';

/**
 * Payment Forwarding Service
 * Handles forwarding of confirmed payments to platform wallets
 * Supports BTC, ETH, LTC, BCH, ERC-20 (USDT, USDC), and USDT TRC-20 (Tron)
 */
@Injectable()
export class PaymentForwardingService implements IPaymentForwardingService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly systemWalletService: SystemWalletService,
        private readonly providerFactory: BlockchainProviderFactory,
        private readonly hotWalletService: HotWalletService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(PaymentForwardingService.name);
    }

    /**
     * Forward a confirmed payment to platform wallet
     * @param paymentId - Payment ID
     * @returns Forward transaction hash
     */
    async forwardPayment(paymentId: string): Promise<string> {
        this.logger.info({ paymentId }, 'Starting payment forwarding');

        try {
            // Get payment details
            const payment = await this.databaseService.cryptoPayment.findUnique(
                {
                    where: { id: paymentId },
                    include: {
                        order: {
                            select: {
                                id: true,
                                orderNumber: true,
                            },
                        },
                    },
                }
            );

            if (!payment) {
                throw new NotFoundException(`Payment not found: ${paymentId}`);
            }

            // Validate payment status
            if (
                payment.status !== PaymentStatus.CONFIRMED &&
                payment.status !== PaymentStatus.FORWARDING &&
                payment.status !== PaymentStatus.FORWARDED
            ) {
                throw new BadRequestException(
                    `Payment must be CONFIRMED or FORWARDING before forwarding. Current status: ${payment.status}`
                );
            }

            // Check if already forwarded
            if (payment.status === PaymentStatus.FORWARDED) {
                this.logger.warn(
                    { paymentId, forwardTxHash: payment.forwardTxHash },
                    'Payment already forwarded'
                );
                return payment.forwardTxHash || '';
            }

            // Update status to FORWARDING
            await this.databaseService.cryptoPayment.update({
                where: { id: paymentId },
                data: {
                    status: PaymentStatus.FORWARDING,
                },
            });

            this.logger.info(
                { paymentId, cryptocurrency: payment.cryptocurrency },
                'Payment status updated to FORWARDING'
            );

            const platformWalletAddress =
                await this.systemWalletService.getPlatformWalletAddress(
                    payment.cryptocurrency
                );

            await this.ensureGasAvailable(payment, platformWalletAddress);

            const privateKey = await this.systemWalletService.decryptPrivateKey(
                payment.encryptedPrivateKey
            );

            // Get blockchain provider
            const provider = this.providerFactory.getProvider(
                payment.cryptocurrency
            );

            // Calculate amount to forward
            const amountToForward = await this.calculateAmountToForward(
                paymentId,
                payment.cryptocurrency,
                payment.paymentAddress,
                parseFloat(payment.amount.toString())
            );

            let forwardTxHash: string;

            // Forward payment
            if (
                payment.cryptocurrency === CryptoCurrency.USDT_ERC20 ||
                payment.cryptocurrency === CryptoCurrency.USDC_ERC20
            ) {
                forwardTxHash = await this.forwardERC20Token(
                    payment,
                    privateKey,
                    platformWalletAddress,
                    amountToForward
                );
            } else {
                forwardTxHash = await provider.sendTransaction(
                    payment.paymentAddress,
                    platformWalletAddress,
                    amountToForward.toString(),
                    privateKey
                );
            }

            const priorMetadata =
                (payment.metadata as Record<string, unknown>) || {};
            await this.databaseService.cryptoPayment.update({
                where: { id: paymentId },
                data: {
                    status: PaymentStatus.FORWARDED,
                    forwardTxHash: forwardTxHash,
                    forwardedAt: new Date(),
                    metadata: {
                        ...priorMetadata,
                        forwardedAmount: amountToForward,
                    },
                },
            });

            this.logger.info(
                {
                    paymentId,
                    orderId: payment.orderId,
                    cryptocurrency: payment.cryptocurrency,
                    forwardTxHash,
                    amountForwarded: amountToForward,
                    platformWallet: platformWalletAddress,
                },
                'Payment forwarded successfully'
            );

            return forwardTxHash;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';

            if (errorMessage === 'AWAITING_GAS_TOPUP') {
                throw error;
            }

            try {
                const payment =
                    await this.databaseService.cryptoPayment.findUnique({
                        where: { id: paymentId },
                        select: {
                            metadata: true,
                            orderId: true,
                        },
                    });

                const metadata = (payment?.metadata as any) || {};
                await this.databaseService.cryptoPayment.update({
                    where: { id: paymentId },
                    data: {
                        status: PaymentStatus.FORWARDING_FAILED,
                        metadata: {
                            ...metadata,
                            forwardingError: errorMessage,
                            forwardingFailedAt: new Date().toISOString(),
                        },
                    },
                });

                this.logger.error(
                    {
                        paymentId,
                        orderId: payment?.orderId,
                        error: errorMessage,
                        stack: error instanceof Error ? error.stack : undefined,
                    },
                    'Payment forwarding failed'
                );
            } catch (updateError) {
                this.logger.error(
                    { error: updateError, paymentId },
                    'Failed to update payment status after forwarding error'
                );
            }

            throw error;
        }
    }

    private async ensureGasAvailable(
        payment: {
            id: string;
            cryptocurrency: CryptoCurrency;
            paymentAddress: string;
            amount: unknown;
            metadata: unknown;
        },
        platformWalletAddress: string
    ): Promise<void> {
        const { cryptocurrency, paymentAddress, id: paymentId } = payment;
        const metadata =
            (payment.metadata as Record<string, unknown> | null) || {};

        if (
            cryptocurrency === CryptoCurrency.USDT_ERC20 ||
            cryptocurrency === CryptoCurrency.USDC_ERC20
        ) {
            const ethProvider = this.providerFactory.getEthereumProvider();
            const tokenSymbol =
                cryptocurrency === CryptoCurrency.USDT_ERC20 ? 'USDT' : 'USDC';
            const tokenContract =
                ethProvider.getTokenContractAddress(tokenSymbol)!;
            const tokenAmount = payment.amount.toString();

            const needed = await this.hotWalletService.needsEthTopUp(
                paymentAddress,
                platformWalletAddress,
                tokenAmount,
                tokenContract
            );
            if (needed) {
                if (!metadata.gasTopUpTxHash) {
                    const txHash = await this.hotWalletService.topUpEthGas(
                        paymentAddress,
                        platformWalletAddress,
                        tokenAmount,
                        tokenContract
                    );
                    await this.databaseService.cryptoPayment.update({
                        where: { id: paymentId },
                        data: {
                            metadata: { ...metadata, gasTopUpTxHash: txHash },
                        },
                    });
                    this.logger.info(
                        { paymentId, txHash },
                        'ETH gas top-up sent'
                    );
                } else {
                    this.logger.info(
                        { paymentId },
                        'ETH top-up already sent, waiting for confirmation'
                    );
                }
                throw new Error('AWAITING_GAS_TOPUP');
            }
        }

        if (cryptocurrency === CryptoCurrency.USDT_TRC20) {
            const needed =
                await this.hotWalletService.needsTrxTopUp(paymentAddress);
            if (needed) {
                if (!metadata.gasTopUpTxHash) {
                    const txHash =
                        await this.hotWalletService.topUpTrxEnergy(
                            paymentAddress
                        );
                    await this.databaseService.cryptoPayment.update({
                        where: { id: paymentId },
                        data: {
                            metadata: { ...metadata, gasTopUpTxHash: txHash },
                        },
                    });
                    this.logger.info({ paymentId, txHash }, 'TRX top-up sent');
                } else {
                    this.logger.info(
                        { paymentId },
                        'TRX top-up already sent, waiting for confirmation'
                    );
                }
                throw new Error('AWAITING_GAS_TOPUP');
            }
        }
    }

    /**
     * Forward ERC-20 token payment
     */
    private async forwardERC20Token(
        payment: any,
        privateKey: string,
        platformWalletAddress: string,
        amount: number
    ): Promise<string> {
        const ethereumProvider = this.providerFactory.getEthereumProvider();

        // Get token contract address
        let tokenContract: string;
        if (payment.cryptocurrency === CryptoCurrency.USDT_ERC20) {
            tokenContract =
                ethereumProvider.getTokenContractAddress('USDT') || '';
        } else if (payment.cryptocurrency === CryptoCurrency.USDC_ERC20) {
            tokenContract =
                ethereumProvider.getTokenContractAddress('USDC') || '';
        } else {
            throw new BadRequestException(
                `Unsupported ERC-20 token: ${payment.cryptocurrency}`
            );
        }

        if (!tokenContract) {
            throw new BadRequestException(
                `Token contract address not found for ${payment.cryptocurrency}`
            );
        }

        this.logger.info(
            {
                paymentId: payment.id,
                tokenContract,
                amount,
                from: payment.paymentAddress,
                to: platformWalletAddress,
            },
            'Forwarding ERC-20 token'
        );

        // Send ERC-20 token transaction
        return await ethereumProvider.sendERC20TransactionPublic(
            payment.paymentAddress,
            platformWalletAddress,
            amount.toString(),
            privateKey,
            tokenContract
        );
    }

    /**
     * Calculate amount to forward.
     * For USDT TRC-20, forward full token balance (fees are paid in TRX).
     * For ETH, reserve max native transfer fee (see EthereumProvider.estimateNativeEthTransferFeeWei).
     * For all other currencies, forward the full payment amount.
     */
    private async calculateAmountToForward(
        paymentId: string,
        cryptocurrency: CryptoCurrency,
        fromAddress: string,
        totalAmount: number
    ): Promise<number> {
        try {
            // USDT TRC-20: balance is USDT while fees are TRX, so forward full USDT.
            if (cryptocurrency === CryptoCurrency.USDT_TRC20) {
                const provider =
                    this.providerFactory.getProvider(cryptocurrency);
                const balanceStr = await provider.getBalance(fromAddress);
                return parseFloat(balanceStr);
            }
            if (cryptocurrency === CryptoCurrency.ETH) {
                const ethereumProvider =
                    this.providerFactory.getEthereumProvider();
                const feeWei =
                    await ethereumProvider.estimateNativeEthTransferFeeWei();

                const totalWei = ethers.parseEther(totalAmount.toString());
                if (totalWei <= feeWei) {
                    throw new Error(
                        'Payment amount too small to cover network fee'
                    );
                }

                return parseFloat(ethers.formatEther(totalWei - feeWei));
            }
            return totalAmount;
        } catch (error) {
            this.logger.error(
                { error, paymentId, cryptocurrency, totalAmount },
                'Failed to calculate amount to forward'
            );
            throw error;
        }
    }

    /**
     * Check if payment should be forwarded
     * @param paymentId - Payment ID
     * @returns True if payment should be forwarded
     */
    async shouldForwardPayment(paymentId: string): Promise<boolean> {
        try {
            // Get payment
            const payment = await this.databaseService.cryptoPayment.findUnique(
                {
                    where: { id: paymentId },
                    select: {
                        status: true,
                        forwardTxHash: true,
                    },
                }
            );

            if (!payment) {
                return false;
            }

            return (
                (payment.status === PaymentStatus.CONFIRMED ||
                    payment.status === PaymentStatus.FORWARDING) &&
                !payment.forwardTxHash
            );
        } catch (error) {
            this.logger.error(
                { error, paymentId },
                'Failed to check if payment should be forwarded'
            );
            return false;
        }
    }
}
