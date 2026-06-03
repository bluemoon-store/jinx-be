import { registerAs } from '@nestjs/config';

/**
 * Fiat payment gateway configuration.
 *
 * Hosts the credentials/settings for hosted fiat providers. CHIME (Polapine)
 * is the first provider; future providers (Stripe, PayPal, …) add their own
 * sub-objects here and a matching gateway implementation in the
 * `fiat-payment` module.
 */
export default registerAs(
    'paymentGateway',
    (): Record<string, any> => ({
        chime: {
            // API credentials. Use pk_sandbox_* / sk_sandbox_* keys in sandbox.
            apiKey: process.env.CHIME_API_KEY || '',
            apiSecret: process.env.CHIME_API_SECRET || '',

            // Endpoints. `environment` selects which one createCheckout uses.
            baseUrl:
                process.env.CHIME_API_BASE_URL ||
                'https://pay.polapine.com/api/v1',
            sandboxUrl:
                process.env.CHIME_API_SANDBOX_URL ||
                'https://pay.polapine.com/api/sandbox',
            environment: process.env.CHIME_ENV || 'sandbox', // 'sandbox' | 'production'

            // Brand slug used by POST /create-invoice (multiple invoices per brand).
            brandSlug: process.env.CHIME_BRAND_SLUG || '',

            // Secret used to verify inbound webhook signatures.
            // Falls back to the API secret when not separately configured.
            webhookSecret:
                process.env.CHIME_WEBHOOK_SECRET ||
                process.env.CHIME_API_SECRET ||
                '',

            // Minutes a hosted checkout stays valid before we expire it locally.
            paymentExpiryMinutes: parseInt(
                process.env.CHIME_PAYMENT_EXPIRY_MIN || '30',
                10
            ),
        },
    })
);
