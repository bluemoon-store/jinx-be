import QRCode from 'qrcode';
import { P2PProvider } from '@prisma/client';

/**
 * Build the payload encoded into a MANUAL_P2P (Chime/Venmo) QR code.
 *
 * Venmo exposes a real pay-intent web URL, so the QR opens the Venmo app with
 * the recipient, amount and note pre-filled. Chime has NO public pay-URL
 * scheme, so the best we can do is encode the raw $tag text — informational
 * (the buyer reads it), not scan-to-pay.
 *
 * @param provider - Which P2P rail (CHIME / VENMO)
 * @param tag - Destination handle/tag shown to the buyer (e.g. "$oreorun", "@noid1837")
 * @param amount - Amount in major units (dollars), as a string
 * @param note - Required note the buyer must include (prefilled for Venmo)
 * @returns The string to encode in the QR code
 */
export function generateP2PPaymentURI(
    provider: P2PProvider,
    tag: string,
    amount: string,
    note?: string
): string {
    switch (provider) {
        case P2PProvider.VENMO: {
            // Venmo web pay intent: https://venmo.com/<handle>?txn=pay&amount=&note=
            const handle = tag.replace(/^@/, '');
            const params = new URLSearchParams({ txn: 'pay', amount });
            if (note) {
                params.set('note', note);
            }
            return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
        }

        case P2PProvider.CHIME:
        default:
            // No reliable Chime pay-URL; encode the raw tag text.
            return tag;
    }
}

/**
 * Generate a MANUAL_P2P payment QR code as a base64 PNG data URL.
 *
 * @param provider - Which P2P rail (CHIME / VENMO)
 * @param tag - Destination handle/tag
 * @param amount - Amount in major units (dollars), as a string
 * @param note - Required note the buyer must include
 * @returns Base64 data URL of the QR code image
 */
export async function generateP2PPaymentQRCode(
    provider: P2PProvider,
    tag: string,
    amount: string,
    note?: string
): Promise<string> {
    const paymentURI = generateP2PPaymentURI(provider, tag, amount, note);

    try {
        return await QRCode.toDataURL(paymentURI, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff',
            },
            errorCorrectionLevel: 'M',
        });
    } catch (error) {
        throw new Error(
            `Failed to generate P2P QR code: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}
