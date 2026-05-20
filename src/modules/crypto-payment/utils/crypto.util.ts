import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { fromHex } from 'tron-format-address';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { derivePath } from 'ed25519-hd-key';
import { CryptoCurrency } from '@prisma/client';

/**
 * BIP44 Derivation Paths for each cryptocurrency
 * Format: m / purpose' / coin_type' / account' / change / address_index
 */
const DERIVATION_PATHS: Record<CryptoCurrency, string> = {
    BTC: "m/44'/0'/0'/0", // Bitcoin
    ETH: "m/44'/60'/0'/0", // Ethereum
    LTC: "m/44'/2'/0'/0", // Litecoin
    BCH: "m/44'/145'/0'/0", // Bitcoin Cash
    USDT_ERC20: "m/44'/60'/0'/0", // USDT on Ethereum (same as ETH)
    USDT_TRC20: "m/44'/195'/0'/0", // USDT on Tron
    USDC_ERC20: "m/44'/60'/0'/0", // USDC on Ethereum (same as ETH)
    SOL: "m/44'/501'/0'", // Solana — fully-hardened ed25519 (SLIP-0010); per-index hardened segment is appended in deriveAddress
};

/**
 * Network configurations for Bitcoin-based chains
 */
const NETWORKS = {
    bitcoin: {
        mainnet: bitcoin.networks.bitcoin,
        testnet: bitcoin.networks.testnet,
    },
    litecoin: {
        mainnet: {
            messagePrefix: '\x19Litecoin Signed Message:\n',
            bech32: 'ltc',
            bip32: {
                public: 0x019da462,
                private: 0x019d9cfe,
            },
            pubKeyHash: 0x30,
            scriptHash: 0x32,
            wif: 0xb0,
        },
        testnet: {
            messagePrefix: '\x19Litecoin Signed Message:\n',
            bech32: 'tltc',
            bip32: {
                public: 0x0436ef7d,
                private: 0x0436f6e1,
            },
            pubKeyHash: 0x6f,
            scriptHash: 0x3a,
            wif: 0xef,
        },
    },
    bitcoinCash: {
        mainnet: {
            messagePrefix: '\x19Bitcoin Cash Signed Message:\n',
            bech32: 'bitcoincash',
            bip32: {
                public: 0x0488b21e,
                private: 0x0488ade4,
            },
            pubKeyHash: 0x00,
            scriptHash: 0x05,
            wif: 0x80,
        },
        testnet: {
            messagePrefix: '\x19Bitcoin Cash Signed Message:\n',
            bech32: 'bchtest',
            bip32: {
                public: 0x043587cf,
                private: 0x04358394,
            },
            pubKeyHash: 0x6f,
            scriptHash: 0xc4,
            wif: 0xef,
        },
    },
};

export interface DerivedAddress {
    address: string;
    privateKey: string; // Hex format
    publicKey: string; // Hex format (for Ethereum)
}

/**
 * Validate BIP39 mnemonic phrase.
 * Uses English wordlist by default (BIP39 recommends English for interoperability).
 *
 * @param mnemonic - 12 or 24 word mnemonic phrase
 * @param wordlist - Optional BIP39 wordlist for specific language (default: English)
 * @returns True if valid (12-24 words contained in wordlist with valid checksum)
 */
export function validateMnemonicPhrase(
    mnemonic: string,
    wordlist: string[] = englishWordlist
): boolean {
    return validateMnemonic(mnemonic, wordlist);
}

/**
 * Derive a payment address from mnemonic using BIP44
 * @param mnemonic - BIP39 mnemonic phrase
 * @param cryptocurrency - Cryptocurrency type
 * @param index - Derivation index (address index)
 * @param isTestnet - Whether to use testnet (default: false)
 * @returns Derived address and private key
 */
export function deriveAddress(
    mnemonic: string,
    cryptocurrency: CryptoCurrency,
    index: number,
    isTestnet: boolean = false
): DerivedAddress {
    // Validate mnemonic
    if (!validateMnemonicPhrase(mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
    }

    // Convert mnemonic to seed
    const seed = mnemonicToSeedSync(mnemonic);

    // Solana uses ed25519 (SLIP-0010) — short-circuit before secp256k1 HDKey
    if (cryptocurrency === CryptoCurrency.SOL) {
        return deriveSolanaAddress(seed, index);
    }

    // Create HD key from seed (secp256k1)
    const hdKey = HDKey.fromMasterSeed(seed);

    // Get derivation path
    const basePath = DERIVATION_PATHS[cryptocurrency];
    if (!basePath) {
        throw new Error(`Unsupported cryptocurrency: ${cryptocurrency}`);
    }

    // Derive child key at specific index
    const fullPath = `${basePath}/${index}`;
    const child = hdKey.derive(fullPath);

    if (!child.privateKey || !child.publicKey) {
        throw new Error('Failed to derive private/public key');
    }

    // Derive address based on cryptocurrency
    switch (cryptocurrency) {
        case CryptoCurrency.BTC:
            return deriveBitcoinAddress(child, isTestnet);
        case CryptoCurrency.LTC:
            return deriveLitecoinAddress(child, isTestnet);
        case CryptoCurrency.BCH:
            return deriveBitcoinCashAddress(child, isTestnet);
        case CryptoCurrency.ETH:
        case CryptoCurrency.USDT_ERC20:
        case CryptoCurrency.USDC_ERC20:
            return deriveEthereumAddress(child);
        case CryptoCurrency.USDT_TRC20:
            return deriveTronAddress(child);
        default:
            throw new Error(
                `Address derivation not implemented for: ${cryptocurrency}`
            );
    }
}

/**
 * Derive Bitcoin address (P2PKH)
 */
function deriveBitcoinAddress(
    hdKey: HDKey,
    isTestnet: boolean
): DerivedAddress {
    const network = isTestnet
        ? NETWORKS.bitcoin.testnet
        : NETWORKS.bitcoin.mainnet;

    const { address } = bitcoin.payments.p2pkh({
        pubkey: Buffer.from(hdKey.publicKey!),
        network,
    });

    if (!address) {
        throw new Error('Failed to generate Bitcoin address');
    }

    return {
        address,
        privateKey: Buffer.from(hdKey.privateKey!).toString('hex'),
        publicKey: Buffer.from(hdKey.publicKey!).toString('hex'),
    };
}

/**
 * Derive Litecoin address (P2PKH)
 */
function deriveLitecoinAddress(
    hdKey: HDKey,
    isTestnet: boolean
): DerivedAddress {
    const network = isTestnet
        ? NETWORKS.litecoin.testnet
        : NETWORKS.litecoin.mainnet;

    const { address } = bitcoin.payments.p2pkh({
        pubkey: Buffer.from(hdKey.publicKey!),
        network: network as bitcoin.Network,
    });

    if (!address) {
        throw new Error('Failed to generate Litecoin address');
    }

    return {
        address,
        privateKey: Buffer.from(hdKey.privateKey!).toString('hex'),
        publicKey: Buffer.from(hdKey.publicKey!).toString('hex'),
    };
}

/**
 * Derive Bitcoin Cash address (P2PKH)
 */
function deriveBitcoinCashAddress(
    hdKey: HDKey,
    isTestnet: boolean
): DerivedAddress {
    const network = isTestnet
        ? NETWORKS.bitcoinCash.testnet
        : NETWORKS.bitcoinCash.mainnet;

    const { address } = bitcoin.payments.p2pkh({
        pubkey: Buffer.from(hdKey.publicKey!),
        network: network as bitcoin.Network,
    });

    if (!address) {
        throw new Error('Failed to generate Bitcoin Cash address');
    }

    return {
        address,
        privateKey: Buffer.from(hdKey.privateKey!).toString('hex'),
        publicKey: Buffer.from(hdKey.publicKey!).toString('hex'),
    };
}

/**
 * Derive Ethereum address (EIP-55 checksum)
 * Also used for ERC-20 tokens (USDT, USDC)
 */
function deriveEthereumAddress(hdKey: HDKey): DerivedAddress {
    const privateKeyHex = '0x' + Buffer.from(hdKey.privateKey!).toString('hex');
    const wallet = new ethers.Wallet(privateKeyHex);

    return {
        address: wallet.address, // EIP-55 checksummed address
        privateKey: Buffer.from(hdKey.privateKey!).toString('hex'),
        publicKey: Buffer.from(hdKey.publicKey!).toString('hex'),
    };
}

/**
 * Derive Tron address (TRC-20 tokens like USDT)
 * Tron uses same address format as Ethereum but with 'T' prefix
 */
function deriveTronAddress(hdKey: HDKey): DerivedAddress {
    // Tron uses Ethereum-style addresses but with base58 encoding
    // For now, we'll derive Ethereum address and convert to Tron format
    const ethAddress = deriveEthereumAddress(hdKey);

    // Tron address conversion (simplified - in production use tronweb library)
    // Tron addresses are base58 encoded with 'T' prefix
    // This is a placeholder - full implementation requires tronweb
    const tronAddress = convertEthToTronAddress(ethAddress.address);

    return {
        address: tronAddress,
        privateKey: ethAddress.privateKey,
        publicKey: ethAddress.publicKey,
    };
}

/**
 * Derive Solana address (ed25519, SLIP-0010).
 * Path: m/44'/501'/0'/{index}' — fully hardened per Phantom/Solflare convention.
 * Bypasses secp256k1 HDKey; uses ed25519-hd-key against the BIP39 seed.
 */
function deriveSolanaAddress(seed: Uint8Array, index: number): DerivedAddress {
    const seedHex = Buffer.from(seed).toString('hex');
    const fullPath = `${DERIVATION_PATHS[CryptoCurrency.SOL]}/${index}'`;
    const { key } = derivePath(fullPath, seedHex);
    const keypair = Keypair.fromSeed(key);

    return {
        address: keypair.publicKey.toBase58(),
        privateKey: bs58.encode(keypair.secretKey),
        publicKey: keypair.publicKey.toBase58(),
    };
}

/**
 * Convert Ethereum address to Tron address format.
 * Tron uses the same secp256k1 key derivation as Ethereum but encodes the 20-byte
 * address with 0x41 prefix and Base58Check (result starts with 'T').
 *
 * @param ethAddress - Ethereum address (0x + 40 hex chars)
 * @returns Tron base58 address (T...)
 */
function convertEthToTronAddress(ethAddress: string): string {
    const normalized = ethAddress.startsWith('0x')
        ? ethAddress.toLowerCase()
        : `0x${ethAddress.toLowerCase()}`;

    if (!/^0x[0-9a-f]{40}$/i.test(normalized)) {
        throw new Error(
            `Invalid Ethereum address for Tron conversion: expected 0x + 40 hex chars, got ${ethAddress.length} chars`
        );
    }

    return fromHex(normalized);
}

/**
 * Get derivation path for a cryptocurrency
 * @param cryptocurrency - Cryptocurrency type
 * @param index - Address index
 * @returns Full derivation path
 */
export function getDerivationPath(
    cryptocurrency: CryptoCurrency,
    index: number
): string {
    const basePath = DERIVATION_PATHS[cryptocurrency];
    if (!basePath) {
        throw new Error(`Unsupported cryptocurrency: ${cryptocurrency}`);
    }
    // Solana requires fully-hardened paths (SLIP-0010 ed25519)
    if (cryptocurrency === CryptoCurrency.SOL) {
        return `${basePath}/${index}'`;
    }
    return `${basePath}/${index}`;
}

/**
 * Validate cryptocurrency address format
 * @param address - Address to validate
 * @param cryptocurrency - Cryptocurrency type
 * @returns True if valid
 */
export function isValidAddress(
    address: string,
    cryptocurrency: CryptoCurrency
): boolean {
    try {
        switch (cryptocurrency) {
            case CryptoCurrency.BTC:
            case CryptoCurrency.LTC:
            case CryptoCurrency.BCH:
                // Bitcoin-style addresses (base58 or bech32)
                return bitcoin.address.toOutputScript(address).length > 0;
            case CryptoCurrency.ETH:
            case CryptoCurrency.USDT_ERC20:
            case CryptoCurrency.USDC_ERC20:
                // Ethereum addresses (EIP-55 checksummed)
                return ethers.isAddress(address);
            case CryptoCurrency.USDT_TRC20:
                return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
            case CryptoCurrency.SOL: {
                // Solana addresses are base58-encoded ed25519 public keys (32 bytes).
                // PublicKey constructor throws on invalid base58 or wrong length;
                // additionally check that the key is on the ed25519 curve.
                const pk = new PublicKey(address);
                return PublicKey.isOnCurve(pk.toBytes());
            }
            default:
                return false;
        }
    } catch {
        return false;
    }
}
