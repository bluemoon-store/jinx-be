import { Injectable } from '@nestjs/common';
import { P2PProvider } from '@prisma/client';

import { GmailMessage } from '../gmail/gmail.client';
import { getBodyText } from '../gmail/message-content';
import { IReceiptParser, ParsedReceipt, extractAmount } from './parser.types';

/**
 * Parser for Venmo "X paid you" notification emails.
 *
 * Reference layout (from a real notification):
 *   "<Payer> paid you  $4.40  <note>  See transaction
 *    Money credited to your Venmo account. ... Transaction ID 4558063035059940001
 *    Sent to @noid1837 ..."
 *
 * The note is matched after normalization (lowercased, non-alphanumerics
 * stripped), so spacing/case differences in how Venmo renders it don't matter.
 */
@Injectable()
export class VenmoParser implements IReceiptParser {
    readonly provider = P2PProvider.VENMO;

    matches(fromDomain: string): boolean {
        return fromDomain.toLowerCase().endsWith('venmo.com');
    }

    parse(message: GmailMessage): ParsedReceipt {
        const text = getBodyText(message);

        const payerName =
            text.match(/([^>$\n]{1,60}?)\s+paid you\b/i)?.[1]?.trim() || null;

        const amount = extractAmount(
            // Anchor the amount search to the "paid you" clause when present.
            text.slice(Math.max(0, text.search(/paid you/i)))
        );

        // Note sits between the amount and the "See transaction" CTA.
        const note =
            text
                .match(
                    /paid you\s*\$\s*[0-9.,]+\s*(.*?)\s*See transaction/i
                )?.[1]
                ?.trim() || null;

        const externalTxId =
            text.match(/Transaction ID\s*[:#]?\s*([0-9]{6,})/i)?.[1] ?? null;

        const sentToHandle =
            text.match(/Sent to\s*(@[A-Za-z0-9._-]+)/i)?.[1] ?? null;

        return {
            provider: this.provider,
            amount,
            note: note && note.length <= 140 ? note : null,
            payerName,
            externalTxId,
            sentToHandle,
        };
    }
}
