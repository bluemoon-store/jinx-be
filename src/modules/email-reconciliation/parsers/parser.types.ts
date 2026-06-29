import { P2PProvider } from '@prisma/client';

import { GmailMessage } from '../gmail/gmail.client';

/**
 * Normalized data extracted from a single Chime/Venmo "you got paid"
 * notification email. `note` is the buyer's payment note (the reconciliation
 * key); the matcher normalizes it before comparing to FiatPayment.noteKey.
 */
export interface ParsedReceipt {
    provider: P2PProvider;
    amount: number | null; // major units (USD)
    note: string | null; // raw note as shown in the email
    payerName: string | null;
    externalTxId: string | null; // provider transaction id (idempotency)
    sentToHandle: string | null; // the $tag/@handle the money was sent to
}

/** A provider-specific email parser. */
export interface IReceiptParser {
    provider: P2PProvider;
    /** True if this parser recognizes the message (by From domain). */
    matches(fromDomain: string): boolean;
    /** Extract fields from the message body/headers. */
    parse(message: GmailMessage): ParsedReceipt;
}

/** First USD amount like $4.40 / $1,234.56 in the text, as a number. */
export function extractAmount(text: string): number | null {
    const m = text.match(/\$\s*([0-9][0-9,]*\.[0-9]{2})/);
    if (!m) return null;
    const value = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
}
