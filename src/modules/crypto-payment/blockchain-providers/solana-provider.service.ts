import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction as SolanaTx,
    Connection,
} from '@solana/web3.js';
import bs58 from 'bs58';

import { BaseBlockchainProvider } from './base-blockchain-provider';
import { Transaction } from './blockchain-provider.interface';

/**
 * Solana finalized status is reached at ~32 slots (~13s). The scheduler
 * compares the value returned here against `requiredConfirmations` (default 32),
 * so we report a saturated 32 when Tatum says the tx is `finalized`.
 */
const FINALIZED_CONFIRMATIONS = 32;

/**
 * Rent-exempt minimum (lamports) reserved on a derived account when sweeping funds.
 * 0.00089088 SOL covers a system-program account (~890,880 lamports). The sweep
 * subtracts this + per-signature fee from the swept amount to avoid InsufficientFunds.
 */
const RENT_EXEMPT_LAMPORTS = 890_880;

/** Standard Solana per-signature fee: 5,000 lamports = 0.000005 SOL. */
const SIGNATURE_FEE_LAMPORTS = 5_000;

/**
 * Solana provider (native SOL).
 * RPC via Tatum (consistent with the rest of the stack). `@solana/web3.js` is
 * used only for Keypair/PublicKey construction, transaction building, and
 * lamport ↔ SOL math — not for direct RPC.
 */
@Injectable()
export class SolanaProvider extends BaseBlockchainProvider {
    private readonly solanaNetwork: string;

    constructor(configService: ConfigService, logger: PinoLogger) {
        super(configService, logger, 'solana');
        this.solanaNetwork = this.isTestnet ? 'devnet' : 'mainnet-beta';
    }

    getNetworkName(): string {
        return this.solanaNetwork;
    }

    /**
     * Native SOL balance (human-readable units).
     * Tatum: GET /v3/solana/account/balance/{address} → { balance: "0.123" } in SOL.
     */
    async getBalance(address: string): Promise<string> {
        this.logger.debug({ address }, 'Getting Solana balance');

        try {
            const response = await this.tatumClient.get(
                `/solana/account/balance/${address}`
            );

            const raw = response.data?.balance;
            if (raw === undefined || raw === null) {
                return '0';
            }

            // Tatum may return either SOL (string with decimals) or lamports.
            // Normalize: if value contains '.', treat as SOL; else treat as lamports.
            const asStr = String(raw);
            if (asStr.includes('.')) {
                return asStr;
            }
            const lamports = BigInt(asStr);
            return this.lamportsToSol(lamports);
        } catch (error: any) {
            if (error.response?.status === 404) {
                return '0';
            }
            this.handleTatumError(error, 'getBalance');
        }
    }

    /**
     * Most recent incoming SOL transfer to `address`.
     * Tatum: GET /v3/solana/account/transactions/{address} returns a list of signatures
     * with parsed meta (preBalances / postBalances per account in `accountKeys`).
     */
    async getTransactionByAddress(
        address: string
    ): Promise<Transaction | null> {
        this.logger.debug({ address }, 'Getting Solana incoming transaction');

        try {
            const response = await this.tatumClient.get(
                `/solana/account/transactions/${address}`,
                { params: { limit: 25 } }
            );

            const txs: any[] = Array.isArray(response.data)
                ? response.data
                : Array.isArray(response.data?.transactions)
                  ? response.data.transactions
                  : [];

            for (const tx of txs) {
                const parsed = this.parseIncomingSolTransfer(tx, address);
                if (parsed) {
                    return parsed;
                }
            }

            return null;
        } catch (error: any) {
            if (error.response?.status === 404) {
                return null;
            }
            this.handleTatumError(error, 'getTransactionByAddress');
        }
    }

    async getTransaction(txHash: string): Promise<Transaction | null> {
        this.logger.debug({ txHash }, 'Getting Solana transaction');

        try {
            const response = await this.tatumClient.get(
                `/solana/transaction/${txHash}`
            );

            const tx = response.data;
            if (!tx) {
                return null;
            }

            return this.parseSolTransferByHash(tx, txHash);
        } catch (error: any) {
            if (error.response?.status === 404) {
                return null;
            }
            this.handleTatumError(error, 'getTransaction');
        }
    }

    /**
     * Solana confirmations: returns saturated FINALIZED_CONFIRMATIONS once the
     * transaction's commitment is `finalized`; otherwise returns slot delta
     * (current slot − tx slot), or 0 if unknown.
     */
    async getTransactionConfirmations(txHash: string): Promise<number> {
        this.logger.debug({ txHash }, 'Getting Solana confirmations');

        try {
            const response = await this.tatumClient.get(
                `/solana/transaction/${txHash}`
            );
            const tx = response.data;
            if (!tx) {
                return 0;
            }

            const status =
                tx.confirmationStatus ?? tx.meta?.confirmationStatus ?? null;
            if (status === 'finalized') {
                return FINALIZED_CONFIRMATIONS;
            }

            const txSlot = tx.slot ?? tx.meta?.slot;
            if (txSlot === undefined || txSlot === null) {
                return 0;
            }

            const currentSlot = await this.getCurrentSlot();
            if (currentSlot === null) {
                return 0;
            }

            return Math.max(0, currentSlot - Number(txSlot));
        } catch (error: any) {
            if (error.response?.status === 404) {
                return 0;
            }
            this.logger.warn(
                { error: error.message, txHash },
                'Failed to get Solana confirmations'
            );
            return 0;
        }
    }

    /**
     * Solana fees are deterministic per signature, not gas-priced.
     * One transfer = 1 signature = 5000 lamports = 0.000005 SOL.
     */
    async estimateFee(
        _from: string,
        _to: string,
        _amount: string
    ): Promise<string> {
        return this.lamportsToSol(BigInt(SIGNATURE_FEE_LAMPORTS));
    }

    /**
     * Send native SOL. Builds + signs locally with @solana/web3.js, then broadcasts
     * the base64-encoded signed transaction via Tatum (POST /v3/solana/transaction).
     *
     * Sweeping a derived account requires leaving rent-exempt minimum + fee on it,
     * else the transaction is rejected with InsufficientFundsForRent. Callers passing
     * an `amount` that equals the balance should pre-subtract those overheads.
     */
    async sendTransaction(
        from: string,
        to: string,
        amount: string,
        privateKey: string
    ): Promise<string> {
        this.logger.info({ from, to, amount }, 'Sending SOL');

        try {
            if (!this.isValidAddress(from) || !this.isValidAddress(to)) {
                throw new Error('Invalid Solana address');
            }

            const lamports = this.solToLamports(amount);
            if (lamports <= 0n) {
                throw new Error('Amount must be > 0 lamports');
            }

            const keypair = this.keypairFromBs58(privateKey);
            if (keypair.publicKey.toBase58() !== from) {
                throw new Error('Private key does not match `from` address');
            }

            const recentBlockhash = await this.getLatestBlockhash();
            const tx = new SolanaTx({
                feePayer: keypair.publicKey,
                recentBlockhash,
            }).add(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: new PublicKey(to),
                    lamports: Number(lamports),
                })
            );
            tx.sign(keypair);

            const signedB64 = tx
                .serialize({ requireAllSignatures: true })
                .toString('base64');

            const response = await this.tatumClient.post('/solana/broadcast', {
                txData: signedB64,
            });

            const txId =
                response.data?.txId ||
                response.data?.txID ||
                response.data?.signature;
            if (!txId) {
                throw new Error('Invalid response from Tatum Solana broadcast');
            }

            this.logger.info({ txHash: txId, from, to, amount }, 'SOL sent');
            return txId;
        } catch (error) {
            this.handleTatumError(error, 'sendTransaction');
        }
    }

    isValidAddress(address: string): boolean {
        if (!address || typeof address !== 'string') {
            return false;
        }
        try {
            const pk = new PublicKey(address);
            return PublicKey.isOnCurve(pk.toBytes());
        } catch {
            return false;
        }
    }

    /** Per-signature fee in lamports — exposed for forwarding-amount math. */
    getSignatureFeeLamports(): number {
        return SIGNATURE_FEE_LAMPORTS;
    }

    /** Rent-exempt minimum in lamports — exposed for forwarding-amount math. */
    getRentExemptLamports(): number {
        return RENT_EXEMPT_LAMPORTS;
    }

    private parseIncomingSolTransfer(
        tx: any,
        address: string
    ): Transaction | null {
        const accountKeys: string[] =
            tx?.transaction?.message?.accountKeys ??
            tx?.message?.accountKeys ??
            tx?.accountKeys ??
            [];
        const pre: number[] = tx?.meta?.preBalances ?? [];
        const post: number[] = tx?.meta?.postBalances ?? [];

        if (
            !accountKeys.length ||
            !pre.length ||
            !post.length ||
            pre.length !== post.length
        ) {
            return null;
        }

        const idx = accountKeys.findIndex(
            k => this.normalizeKey(k) === address
        );
        if (idx < 0) {
            return null;
        }

        const delta = BigInt(post[idx]) - BigInt(pre[idx]);
        if (delta <= 0n) {
            return null;
        }

        // Identify the sender: the account whose balance decreased the most.
        let fromIdx = -1;
        let biggestDrop = 0n;
        for (let i = 0; i < accountKeys.length; i++) {
            if (i === idx) {
                continue;
            }
            const drop = BigInt(pre[i]) - BigInt(post[i]);
            if (drop > biggestDrop) {
                biggestDrop = drop;
                fromIdx = i;
            }
        }

        const sig =
            tx?.signature ??
            tx?.txId ??
            tx?.transaction?.signatures?.[0] ??
            null;
        if (!sig) {
            return null;
        }

        const status = tx?.confirmationStatus ?? tx?.meta?.confirmationStatus;
        const slot = tx?.slot ?? tx?.meta?.slot;
        const confirmations =
            status === 'finalized' ? FINALIZED_CONFIRMATIONS : 0;

        return {
            hash: String(sig),
            from: fromIdx >= 0 ? this.normalizeKey(accountKeys[fromIdx]) : '',
            to: address,
            amount: this.lamportsToSol(delta),
            confirmations,
            blockNumber: slot !== undefined ? Number(slot) : undefined,
            timestamp: tx?.blockTime != null ? Number(tx.blockTime) : undefined,
        };
    }

    private parseSolTransferByHash(tx: any, txHash: string): Transaction {
        const accountKeys: string[] =
            tx?.transaction?.message?.accountKeys ??
            tx?.message?.accountKeys ??
            tx?.accountKeys ??
            [];
        const pre: number[] = tx?.meta?.preBalances ?? [];
        const post: number[] = tx?.meta?.postBalances ?? [];

        let fromIdx = -1;
        let toIdx = -1;
        let biggestDrop = 0n;
        let biggestGain = 0n;

        if (
            accountKeys.length &&
            pre.length === post.length &&
            pre.length === accountKeys.length
        ) {
            for (let i = 0; i < accountKeys.length; i++) {
                const delta = BigInt(post[i]) - BigInt(pre[i]);
                if (delta < 0n && -delta > biggestDrop) {
                    biggestDrop = -delta;
                    fromIdx = i;
                }
                if (delta > 0n && delta > biggestGain) {
                    biggestGain = delta;
                    toIdx = i;
                }
            }
        }

        const status = tx?.confirmationStatus ?? tx?.meta?.confirmationStatus;
        const slot = tx?.slot ?? tx?.meta?.slot;
        const confirmations =
            status === 'finalized' ? FINALIZED_CONFIRMATIONS : 0;

        return {
            hash: txHash,
            from: fromIdx >= 0 ? this.normalizeKey(accountKeys[fromIdx]) : '',
            to: toIdx >= 0 ? this.normalizeKey(accountKeys[toIdx]) : '',
            amount: biggestGain > 0n ? this.lamportsToSol(biggestGain) : '0',
            confirmations,
            blockNumber: slot !== undefined ? Number(slot) : undefined,
            timestamp: tx?.blockTime != null ? Number(tx.blockTime) : undefined,
        };
    }

    private normalizeKey(k: any): string {
        if (typeof k === 'string') {
            return k;
        }
        if (k && typeof k === 'object') {
            return String(k.pubkey ?? k.publicKey ?? k.address ?? '');
        }
        return '';
    }

    private async getCurrentSlot(): Promise<number | null> {
        try {
            const response = await this.tatumClient.get(
                '/solana/block/current'
            );
            const slot = response.data?.slot ?? response.data;
            const n = typeof slot === 'number' ? slot : Number(slot);
            return Number.isFinite(n) ? n : null;
        } catch (error: any) {
            this.logger.warn(
                { error: error?.message },
                'Failed to get Solana current slot'
            );
            return null;
        }
    }

    private async getLatestBlockhash(): Promise<string> {
        // Tatum doesn't expose a stable blockhash endpoint; use public RPC fallback.
        // Configurable via SOLANA_RPC_URL, else default to the cluster matching network.
        const rpcUrl =
            this.configService.get<string>('crypto.rpc.solana') ||
            (this.isTestnet
                ? 'https://api.devnet.solana.com'
                : 'https://api.mainnet-beta.solana.com');
        const connection = new Connection(rpcUrl, 'finalized');
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        return blockhash;
    }

    private keypairFromBs58(privateKey: string): Keypair {
        try {
            const secret = bs58.decode(privateKey);
            return Keypair.fromSecretKey(secret);
        } catch {
            throw new Error(
                'Invalid Solana private key (expected base58-encoded 64-byte secret)'
            );
        }
    }

    private lamportsToSol(lamports: bigint): string {
        const whole = lamports / BigInt(LAMPORTS_PER_SOL);
        const frac = lamports % BigInt(LAMPORTS_PER_SOL);
        if (frac === 0n) {
            return whole.toString();
        }
        const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
        return `${whole.toString()}.${fracStr}`;
    }

    private solToLamports(amount: string): bigint {
        const [whole, frac = ''] = amount.split('.');
        if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) {
            throw new Error(`Invalid SOL amount: ${amount}`);
        }
        const fracPadded = (frac + '000000000').slice(0, 9);
        return BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt(fracPadded);
    }
}
