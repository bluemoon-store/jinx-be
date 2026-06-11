// Canonical codes for admin-configurable payment methods. These are stored as
// key-value rows in `SystemSettings` (category `payment`) and are decoupled
// from the live payment flow (which still reads addresses/keys from env config).
export const PAYMENT_CRYPTO_CODES = [
    'BTC',
    'ETH',
    'SOL',
    'USDT_TRC20',
    'USDT_ERC20',
    'LTC',
    'BCH',
] as const;

export const PAYMENT_GATEWAY_CODES = ['CHIME', 'CASHAPP'] as const;

export type PaymentCryptoCode = (typeof PAYMENT_CRYPTO_CODES)[number];
export type PaymentGatewayCode = (typeof PAYMENT_GATEWAY_CODES)[number];

export const PAYMENT_SETTINGS_CATEGORY = 'payment';
