import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { CryptoCurrency, Prisma } from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';
import { ISystemWalletService } from '../interfaces/system-wallet.service.interface';
import {
    deriveAddress,
    getDerivationPath,
    validateMnemonicPhrase,
} from '../utils/crypto.util';
import {
    encryptAndSerialize,
    deserializeAndDecrypt,
} from '../utils/encryption.util';

@Injectable()
export class SystemWalletService implements ISystemWalletService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: ConfigService,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(SystemWalletService.name);
    }

    /**
     * Get mnemonic for a cryptocurrency from configuration
     * @param cryptocurrency - Cryptocurrency type
     * @returns Mnemonic phrase
     */
    private getMnemonic(cryptocurrency: CryptoCurrency): string {
        const mnemonicKey = this.getMnemonicKey(cryptocurrency);
        const mnemonic = this.configService.get<string>(
            `crypto.mnemonics.${mnemonicKey}`
        );

        if (!mnemonic) {
            throw new BadRequestException(
                `Mnemonic not configured for ${cryptocurrency}. Please set SYSTEM_MNEMONIC_${cryptocurrency} environment variable.`
            );
        }

        // Validate mnemonic format
        if (!validateMnemonicPhrase(mnemonic)) {
            throw new BadRequestException(
                `Invalid mnemonic format for ${cryptocurrency}. Must be a valid BIP39 mnemonic.`
            );
        }

        return mnemonic;
    }

    /**
     * Get mnemonic key name for cryptocurrency
     */
    private getMnemonicKey(cryptocurrency: CryptoCurrency): string {
        const keyMap: Record<CryptoCurrency, string> = {
            BTC: 'btc',
            ETH: 'eth',
            LTC: 'ltc',
            BCH: 'bch',
            USDT_ERC20: 'eth', // USDT ERC-20 uses ETH mnemonic
            USDT_TRC20: 'trx',
            USDC_ERC20: 'eth', // USDC ERC-20 uses ETH mnemonic
            SOL: 'sol',
        };

        return keyMap[cryptocurrency] || cryptocurrency.toLowerCase();
    }

    /**
     * Get encryption key from configuration
     */
    private getEncryptionKey(): string {
        const key = this.configService.get<string>('crypto.encryption.key');

        if (!key) {
            throw new BadRequestException(
                'Wallet encryption key not configured. Please set WALLET_ENCRYPTION_KEY environment variable.'
            );
        }

        return key;
    }

    /**
     * Check if testnet is enabled
     */
    private isTestnet(): boolean {
        return this.configService.get<boolean>('crypto.tatum.testnet', false);
    }

    /**
     * Get next derivation index for a cryptocurrency (atomic increment)
     * @param cryptocurrency - Cryptocurrency type
     * @returns Next index
     */
    async getNextIndex(cryptocurrency: CryptoCurrency): Promise<number> {
        this.logger.debug({ cryptocurrency }, 'Getting next derivation index');

        try {
            // Use database transaction to ensure atomic increment
            const result = await this.databaseService.$transaction(
                async tx => {
                    // Find or create wallet index record
                    let walletIndex = await tx.systemWalletIndex.findUnique({
                        where: { cryptocurrency },
                    });

                    if (!walletIndex) {
                        // Create if doesn't exist (should be seeded, but handle gracefully)
                        walletIndex = await tx.systemWalletIndex.create({
                            data: {
                                cryptocurrency,
                                nextIndex: 0,
                            },
                        });
                        this.logger.warn(
                            { cryptocurrency },
                            'Wallet index record not found, created new one'
                        );
                    }

                    // Increment and update atomically
                    const updated = await tx.systemWalletIndex.update({
                        where: { cryptocurrency },
                        data: {
                            nextIndex: {
                                increment: 1,
                            },
                        },
                    });

                    return updated.nextIndex;
                },
                {
                    isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                }
            );

            this.logger.info(
                { cryptocurrency, index: result },
                'Successfully incremented derivation index'
            );

            return result;
        } catch (error) {
            this.logger.error(
                { cryptocurrency, error },
                'Failed to get next derivation index'
            );
            throw new BadRequestException(
                `Failed to get next derivation index for ${cryptocurrency}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Generate a unique payment address for an order
     * @param orderId - Order ID
     * @param cryptocurrency - Cryptocurrency type
     * @param amountCrypto - Amount in cryptocurrency
     * @param amountUsd - Amount in USD
     * @returns Payment address details
     */
    async generatePaymentAddress(
        orderId: string,
        cryptocurrency: CryptoCurrency,
        amountCrypto: number,
        amountUsd: number
    ): Promise<{
        address: string;
        derivationIndex: number;
        derivationPath: string;
        encryptedPrivateKey: string;
        expiresAt: Date;
    }> {
        this.logger.info(
            { orderId, cryptocurrency, amountCrypto, amountUsd },
            'Generating payment address'
        );

        try {
            // Get mnemonic for cryptocurrency
            const mnemonic = this.getMnemonic(cryptocurrency);

            // Get next derivation index (atomic)
            const derivationIndex = await this.getNextIndex(cryptocurrency);

            // Derive address and private key
            const isTestnet = this.isTestnet();
            const derived = deriveAddress(
                mnemonic,
                cryptocurrency,
                derivationIndex,
                isTestnet
            );

            // Get derivation path
            const derivationPath = getDerivationPath(
                cryptocurrency,
                derivationIndex
            );

            // Encrypt private key
            const encryptionKey = this.getEncryptionKey();
            const encryptedPrivateKey = encryptAndSerialize(
                derived.privateKey,
                encryptionKey
            );

            // Calculate expiration time (15 minutes from now)
            const expirationMinutes = this.configService.get<number>(
                'crypto.payment.expirationMinutes',
                15
            );
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + expirationMinutes);

            this.logger.info(
                {
                    orderId,
                    cryptocurrency,
                    address: derived.address,
                    derivationIndex,
                    expiresAt,
                },
                'Successfully generated payment address'
            );

            // NEVER log private key or mnemonic
            return {
                address: derived.address,
                derivationIndex,
                derivationPath,
                encryptedPrivateKey,
                expiresAt,
            };
        } catch (error) {
            this.logger.error(
                { orderId, cryptocurrency, error },
                'Failed to generate payment address'
            );
            throw new BadRequestException(
                `Failed to generate payment address: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Get payment address details by payment ID
     * @param paymentId - Payment ID
     * @returns Payment details
     */
    async getPaymentAddress(paymentId: string): Promise<any> {
        this.logger.debug({ paymentId }, 'Getting payment address');

        try {
            const payment = await this.databaseService.cryptoPayment.findUnique(
                {
                    where: { id: paymentId },
                    include: {
                        order: {
                            select: {
                                id: true,
                                orderNumber: true,
                                userId: true,
                                status: true,
                            },
                        },
                    },
                }
            );

            if (!payment) {
                throw new BadRequestException(
                    `Payment not found: ${paymentId}`
                );
            }

            return payment;
        } catch (error) {
            this.logger.error(
                { paymentId, error },
                'Failed to get payment address'
            );
            throw new BadRequestException(
                `Failed to get payment address: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Decrypt private key for payment forwarding
     * @param encryptedKey - Encrypted private key (JSON string)
     * @returns Decrypted private key in hex format
     */
    async decryptPrivateKey(encryptedKey: string): Promise<string> {
        this.logger.debug('Decrypting private key');

        try {
            const encryptionKey = this.getEncryptionKey();
            const privateKey = deserializeAndDecrypt(
                encryptedKey,
                encryptionKey
            );

            this.logger.debug('Successfully decrypted private key');
            // NEVER log the actual private key

            return privateKey;
        } catch (error) {
            this.logger.error({ error }, 'Failed to decrypt private key');
            throw new BadRequestException(
                `Failed to decrypt private key: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Get platform wallet address for a cryptocurrency
     * @param cryptocurrency - Cryptocurrency type
     * @returns Platform wallet address
     */
    getPlatformWalletAddress(cryptocurrency: CryptoCurrency): string {
        const keyMap: Record<CryptoCurrency, string> = {
            BTC: 'btc',
            ETH: 'eth',
            LTC: 'ltc',
            BCH: 'bch',
            USDT_ERC20: 'eth', // USDT ERC-20 uses ETH platform wallet
            USDT_TRC20: 'trx',
            USDC_ERC20: 'eth', // USDC ERC-20 uses ETH platform wallet
            SOL: 'sol',
        };

        const key = keyMap[cryptocurrency] || cryptocurrency.toLowerCase();
        const address = this.configService.get<string>(
            `crypto.platformWallets.${key}`
        );

        if (!address) {
            throw new BadRequestException(
                `Platform wallet address not configured for ${cryptocurrency}. Please set PLATFORM_WALLET_${cryptocurrency} environment variable.`
            );
        }

        return address;
    }
}
