import { CryptoCurrency } from '@prisma/client';

export interface ISystemWalletService {
    /**
     * Generate a unique payment address for an order
     * @param orderId - Order ID
     * @param cryptocurrency - Cryptocurrency type
     * @param amountCrypto - Amount in crypto
     * @param amountUsd - Amount in USD
     * @returns Payment address details
     */
    generatePaymentAddress(
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
    }>;

    /**
     * Get payment address details
     * @param paymentId - Payment ID
     * @returns Payment details
     */
    getPaymentAddress(paymentId: string): Promise<any>;

    /**
     * Decrypt private key for forwarding
     * @param encryptedKey - Encrypted private key
     * @returns Decrypted private key
     */
    decryptPrivateKey(encryptedKey: string): Promise<string>;

    /**
     * Get next derivation index for a cryptocurrency
     * @param cryptocurrency - Cryptocurrency type
     * @returns Next index
     */
    getNextIndex(cryptocurrency: CryptoCurrency): Promise<number>;

    /**
     * Get platform wallet address for a cryptocurrency
     * @param cryptocurrency - Cryptocurrency type
     * @returns Platform wallet address
     */
    getPlatformWalletAddress(cryptocurrency: CryptoCurrency): Promise<string>;
}
