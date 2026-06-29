import { FiatPaymentStatus, P2PProvider, PaymentGateway } from '@prisma/client';

/**
 * Parameters required to open a hosted checkout against a gateway.
 */
export interface CreateCheckoutParams {
    orderId: string;
    orderNumber: string;
    amount: number; // major units (e.g. dollars), matches Order.totalAmount
    currency: string; // ISO code, e.g. 'USD'
    returnUrl?: string; // where the gateway redirects the buyer back to
    expiresAt: Date; // local expiry we want the checkout to honour
    // Pre-computed integer Telegram Stars (XTR) amount for this order. Resolved
    // by the orchestration service from the admin/env USD-per-Star rate and
    // ignored by gateways that charge in fiat (CHIME). Telegram has no decimal
    // sub-unit, so this is always a whole number of Stars.
    starAmount?: number;
    // MANUAL_P2P only: which P2P rail and the destination $tag/@handle the
    // buyer should send to (resolved from admin settings by the service). Other
    // gateways ignore these.
    provider?: P2PProvider;
    destinationTag?: string;
}

/**
 * Buyer-facing instructions for a manual P2P (Chime/Venmo) payment. The buyer
 * sends `amount` to `tag` and MUST include `note` so the inbound notification
 * email can be matched back to this payment.
 */
export interface ManualP2PInstructions {
    provider: P2PProvider;
    tag: string; // Chime $tag / Venmo @handle
    note: string; // Display note, e.g. "column notice robust master"
    noteKey: string; // Normalized note used for email matching
}

/**
 * Result of creating a hosted checkout.
 */
export interface CreateCheckoutResult {
    externalId: string; // gateway invoice / payment-link id
    checkoutUrl?: string; // hosted page the buyer is redirected to (hosted gateways only)
    expiresAt?: Date; // gateway-reported expiry, if any
    externalReference?: string; // order_reference we sent to the gateway
    instructions?: ManualP2PInstructions; // MANUAL_P2P only
    raw?: unknown; // raw provider response (persisted in metadata)
}

/**
 * Normalised payment status read back from a gateway.
 */
export interface GatewayStatusResult {
    status: FiatPaymentStatus;
    paidAt?: Date;
    raw?: unknown;
}

/**
 * Normalised webhook event parsed from a gateway payload.
 */
export interface GatewayWebhookEvent {
    externalId: string;
    status: FiatPaymentStatus;
    paidAt?: Date;
    raw?: unknown;
}

/**
 * Contract every fiat payment gateway must implement.
 *
 * Keeping all provider-specific wire format inside implementations of this
 * interface lets the orchestration service (FiatPaymentService) stay
 * provider-agnostic, and lets new gateways (Stripe, PayPal, …) plug in via
 * the PaymentGatewayFactory without touching the rest of the module.
 */
export interface IPaymentGateway {
    /** Which gateway this implementation represents. */
    getGatewayName(): PaymentGateway;

    /** Create a hosted checkout and return the redirect URL + external id. */
    createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult>;

    /** Poll the current status of a previously created checkout. */
    getStatus(externalId: string): Promise<GatewayStatusResult>;

    /** Verify an inbound webhook signature against the raw request body. */
    verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;

    /** Parse an inbound webhook payload into a normalised event. */
    parseWebhookEvent(payload: unknown): GatewayWebhookEvent;
}
