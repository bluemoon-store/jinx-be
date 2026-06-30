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

export const PAYMENT_GATEWAY_CODES = [
    'CASHAPP',
    'APPLEPAY',
    'GOOGLEPAY',
    'TELEGRAM_STARS',
    'CHIME_P2P',
    'VENMO',
] as const;

// Subset of gateway codes that are self-hosted, email-reconciled P2P rails
// (MANUAL_P2P gateway). These store a destination $tag/@handle instead of
// API key/secret. Maps the admin code -> the Prisma P2PProvider value.
export const PAYMENT_P2P_GATEWAY_PROVIDER: Record<string, 'CHIME' | 'VENMO'> = {
    CHIME_P2P: 'CHIME',
    VENMO: 'VENMO',
};

export const PAYMENT_P2P_GATEWAY_CODES = Object.keys(
    PAYMENT_P2P_GATEWAY_PROVIDER
) as ReadonlyArray<keyof typeof PAYMENT_P2P_GATEWAY_PROVIDER>;

export type PaymentCryptoCode = (typeof PAYMENT_CRYPTO_CODES)[number];
export type PaymentGatewayCode = (typeof PAYMENT_GATEWAY_CODES)[number];

export const PAYMENT_SETTINGS_CATEGORY = 'payment';

// Admin-configurable USD price of a single Telegram Star. The live Telegram
// Stars flow converts an order's USD total into an integer XTR amount via
// `stars = ceil(orderUsd / rate)`. Stored as a single key-value row in
// `SystemSettings` (category `payment`); when unset the flow falls back to the
// TELEGRAM_STAR_USD_RATE env (see paymentGateway.config.ts).
export const PAYMENT_TELEGRAM_STAR_USD_RATE_KEY =
    'payment_telegram_star_usd_rate';
