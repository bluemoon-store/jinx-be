import { Injectable } from '@nestjs/common';

import { GmailMessage } from '../gmail/gmail.client';
import { getHeader } from '../gmail/message-content';

/**
 * Authenticity checks for inbound payment-notification emails.
 *
 * Passing DKIM/SPF alone is NOT sufficient (scammers send genuine Venmo "paid
 * you" emails), so this is only ONE of the layered checks — the unique required
 * note + exact amount + correct destination handle + transaction-id idempotency
 * (enforced in the reconciler) are the real defense. This class covers the
 * sender-authenticity layer: From domain + DKIM/SPF verdicts.
 */
@Injectable()
export class EmailVerifier {
    /** Extract the domain from the From header (lowercased), or '' if absent. */
    getFromDomain(message: GmailMessage): string {
        const from = getHeader(message, 'From') ?? '';
        const email = from.match(/[<\s]?([^<>\s@]+@[^<>\s]+)>?/)?.[1] ?? from;
        const at = email.lastIndexOf('@');
        return at >= 0
            ? email
                  .slice(at + 1)
                  .replace(/[>\s]/g, '')
                  .toLowerCase()
            : '';
    }

    /** Parse the Authentication-Results header for spf/dkim/dmarc verdicts. */
    getAuthResults(message: GmailMessage): {
        spfPass: boolean;
        dkimPass: boolean;
        dmarcPass: boolean;
    } {
        const ar = (
            getHeader(message, 'Authentication-Results') ?? ''
        ).toLowerCase();
        return {
            spfPass: /spf=pass/.test(ar),
            dkimPass: /dkim=pass/.test(ar),
            dmarcPass: /dmarc=pass/.test(ar),
        };
    }

    /**
     * Sender-authenticity gate: From domain ends with an allowed provider domain
     * AND DKIM passes AND (SPF or DMARC) passes.
     */
    isAuthenticSender(message: GmailMessage, allowedDomain: string): boolean {
        const fromDomain = this.getFromDomain(message);
        const domainOk =
            fromDomain === allowedDomain.toLowerCase() ||
            fromDomain.endsWith(`.${allowedDomain.toLowerCase()}`);
        if (!domainOk) return false;

        const { spfPass, dkimPass, dmarcPass } = this.getAuthResults(message);
        return dkimPass && (spfPass || dmarcPass);
    }
}
