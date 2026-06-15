/**
 * Single source of truth describing every environment variable the backend
 * reads. Used by:
 *   - env.validation.ts  → fail-fast boot validation (throws in production when
 *     a `required` var is missing, so a misconfigured deploy never serves traffic)
 *   - env-diagnostics     → public `GET /health/config` reports which vars are
 *     present so operators can verify "did this env actually reach prod?".
 *
 * IMPORTANT: never expose a secret's value. Vars flagged `secret: true` report
 * presence only (boolean) — their value is never included in any output.
 */

export interface EnvVarSpec {
    key: string;
    /** Enforced at boot in production (missing → app refuses to start). */
    required?: boolean;
    /** Value is sensitive — masked in diagnostics output. */
    secret?: boolean;
    /** Short human note shown in diagnostics / docs. */
    note?: string;
}

export interface EnvGroupSpec {
    group: string;
    label: string;
    vars: EnvVarSpec[];
}

export const ENV_SPEC: EnvGroupSpec[] = [
    {
        group: 'app',
        label: 'Application',
        vars: [
            { key: 'APP_ENV' },
            { key: 'APP_NAME' },
            { key: 'APP_DEBUG' },
            { key: 'APP_LOG_LEVEL' },
            {
                key: 'APP_FRONTEND_URL',
                required: true,
                note: 'Storefront origin (CORS + email links)',
            },
            {
                key: 'APP_ADMIN_URL',
                required: true,
                note: 'Admin origin (CORS + email links)',
            },
            {
                key: 'APP_CORS_ORIGINS',
                required: true,
                note: 'Comma-separated allowed origins in production',
            },
        ],
    },
    {
        group: 'http',
        label: 'HTTP server',
        vars: [
            { key: 'HTTP_HOST' },
            { key: 'HTTP_PORT' },
            { key: 'HTTP_VERSIONING_ENABLE' },
            { key: 'HTTP_VERSION' },
        ],
    },
    {
        group: 'auth',
        label: 'Authentication',
        vars: [
            { key: 'AUTH_ACCESS_TOKEN_SECRET', required: true, secret: true },
            { key: 'AUTH_REFRESH_TOKEN_SECRET', required: true, secret: true },
            { key: 'AUTH_ACCESS_TOKEN_EXP' },
            { key: 'AUTH_REFRESH_TOKEN_EXP' },
            { key: 'AUTH_REMEMBER_REFRESH_TOKEN_EXP' },
            { key: 'ADMIN_LOGIN_OTP_ENABLED' },
        ],
    },
    {
        group: 'security',
        label: 'Bot protection (Turnstile)',
        vars: [
            { key: 'TURNSTILE_ENABLED' },
            {
                key: 'TURNSTILE_SECRET_KEY',
                secret: true,
                note: 'Required when TURNSTILE_ENABLED=true',
            },
        ],
    },
    {
        group: 'database',
        label: 'Database',
        vars: [{ key: 'DATABASE_URL', required: true, secret: true }],
    },
    {
        group: 'redis',
        label: 'Redis / queues',
        vars: [
            { key: 'REDIS_HOST', required: true },
            { key: 'REDIS_PORT', required: true },
            { key: 'REDIS_PASSWORD', secret: true },
            { key: 'REDIS_ENABLE_TLS' },
        ],
    },
    {
        group: 'storage',
        label: 'Supabase storage',
        vars: [
            { key: 'SUPABASE_URL', required: true },
            { key: 'SUPABASE_SERVICE_ROLE_KEY', required: true, secret: true },
            { key: 'SUPABASE_STORAGE_BUCKET_USER_UPLOADS', required: true },
            { key: 'SUPABASE_STORAGE_BUCKET_PUBLIC_ASSETS' },
            { key: 'SUPABASE_STORAGE_PRESIGN_EXPIRES' },
        ],
    },
    {
        group: 'email',
        label: 'Email (SMTP + Resend)',
        vars: [
            {
                key: 'SMTP_HOST',
                note: 'At least one of SMTP_* or RESEND_API_KEY must be configured',
            },
            { key: 'SMTP_PORT' },
            { key: 'SMTP_SECURE' },
            { key: 'SMTP_USER' },
            { key: 'SMTP_PASSWORD', secret: true },
            { key: 'SMTP_FROM_EMAIL' },
            { key: 'SMTP_FROM_NAME' },
            { key: 'RESEND_API_KEY', secret: true },
            { key: 'RESEND_FROM_EMAIL' },
            { key: 'RESEND_FROM_NAME' },
        ],
    },
    {
        group: 'payments-fiat',
        label: 'Fiat payments (Chime)',
        vars: [
            { key: 'CHIME_ENV' },
            { key: 'CHIME_API_BASE_URL' },
            { key: 'CHIME_API_SANDBOX_URL' },
            { key: 'CHIME_API_KEY', secret: true },
            { key: 'CHIME_API_SECRET', secret: true },
            { key: 'CHIME_WEBHOOK_SECRET', secret: true },
            { key: 'CHIME_BRAND_SLUG' },
            { key: 'CHIME_PAYMENT_EXPIRY_MIN' },
        ],
    },
    {
        group: 'payments-crypto',
        label: 'Crypto payments (RPC + exchange rates)',
        vars: [
            { key: 'BITCOIN_NETWORK' },
            { key: 'BITCOIN_RPC_URL' },
            { key: 'BITCOIN_CASH_RPC_URL' },
            { key: 'ETHEREUM_NETWORK' },
            { key: 'ETHEREUM_RPC_URL' },
            { key: 'LITECOIN_NETWORK' },
            { key: 'LITECOIN_RPC_URL' },
            { key: 'TRON_NETWORK' },
            { key: 'TRON_RPC_URL' },
            { key: 'TATUM_API_KEY', secret: true },
            { key: 'TATUM_BASE_URL' },
            { key: 'TATUM_TESTNET' },
            { key: 'KRAKEN_API_KEY', secret: true },
            { key: 'KRAKEN_API_SECRET', secret: true },
            { key: 'KRAKEN_BASE_URL' },
            { key: 'EXCHANGE_RATE_CACHE_TTL' },
            { key: 'PAYMENT_EXPIRATION_MINUTES' },
            { key: 'PAYMENT_MONITOR_INTERVAL_SECONDS' },
        ],
    },
    {
        group: 'wallets',
        label: 'Crypto wallets (HIGH-VALUE SECRETS)',
        vars: [
            { key: 'WALLET_ENCRYPTION_KEY', secret: true },
            { key: 'SYSTEM_MNEMONIC_BTC', secret: true },
            { key: 'SYSTEM_MNEMONIC_BCH', secret: true },
            { key: 'SYSTEM_MNEMONIC_ETH', secret: true },
            { key: 'SYSTEM_MNEMONIC_LTC', secret: true },
            { key: 'SYSTEM_MNEMONIC_SOL', secret: true },
            { key: 'SYSTEM_MNEMONIC_TRX', secret: true },
            { key: 'HOT_WALLET_ETH_PRIVATE_KEY', secret: true },
            { key: 'HOT_WALLET_TRX_PRIVATE_KEY', secret: true },
            { key: 'HOT_WALLET_ETH_ADDRESS' },
            { key: 'PLATFORM_WALLET_BTC' },
            { key: 'PLATFORM_WALLET_BCH' },
            { key: 'PLATFORM_WALLET_ETH' },
            { key: 'PLATFORM_WALLET_LTC' },
            { key: 'PLATFORM_WALLET_SOL' },
            { key: 'PLATFORM_WALLET_TRX' },
        ],
    },
    {
        group: 'monitoring',
        label: 'Monitoring',
        vars: [{ key: 'SENTRY_DSN', secret: true }],
    },
    {
        group: 'seed',
        label: 'Initial seed (bootstrap only)',
        vars: [
            { key: 'SEED_ADMIN_EMAIL' },
            { key: 'SEED_ADMIN_PASSWORD', secret: true },
        ],
    },
];

/** Flat list of keys that must be present at boot in production. */
export const REQUIRED_ENV_KEYS: string[] = ENV_SPEC.flatMap(g =>
    g.vars.filter(v => v.required).map(v => v.key)
);
