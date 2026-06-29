import { Injectable } from '@nestjs/common';
import { P2PProvider } from '@prisma/client';

import { GmailMessage } from '../gmail/gmail.client';
import { getBodyText } from '../gmail/message-content';
import { IReceiptParser, ParsedReceipt, extractAmount } from './parser.types';

/**
 * Parser for Chime "you received money" (Pay Anyone) notification emails.
 *
 * Chime's exact layout is not publicly documented, so this is best-effort:
 * whatever it can't extract confidently is left null and the message falls
 * through to the manual-review (UNMATCHED) queue rather than being credited.
 * Tighten the regexes once a real sample is captured (see the parser unit test).
 */
@Injectable()
export class ChimeParser implements IReceiptParser {
    readonly provider = P2PProvider.CHIME;

    matches(fromDomain: string): boolean {
        return fromDomain.toLowerCase().endsWith('chime.com');
    }

    parse(message: GmailMessage): ParsedReceipt {
        const text = getBodyText(message);

        const payerName =
            text
                .match(/(?:from|by)\s+([A-Z][\w.'-]*(?:\s+[\w.'-]+){0,3})/)?.[1]
                ?.trim() ||
            text
                .match(/([^>$\n]{1,60}?)\s+(?:sent|paid) you\b/i)?.[1]
                ?.trim() ||
            null;

        const amount = extractAmount(text);

        const note =
            text
                .match(
                    /note\s*[:\-]?\s*"?([^"\n]{1,140}?)"?\s*(?:$|\n|\.)/i
                )?.[1]
                ?.trim() ||
            text
                .match(
                    /(?:sent|paid) you\s*\$\s*[0-9.,]+\s*(.*?)\s*(?:View|See)/i
                )?.[1]
                ?.trim() ||
            null;

        const externalTxId =
            text.match(
                /(?:transaction|payment|confirmation)\s*(?:id|number|#)\s*[:#]?\s*([A-Za-z0-9-]{6,})/i
            )?.[1] ?? null;

        // ChimeSign cashtag the money landed on, e.g. $oreorun.
        const sentToHandle = text.match(/(\$[A-Za-z0-9_]{2,})/)?.[1] ?? null;

        return {
            provider: this.provider,
            amount,
            note,
            payerName,
            externalTxId,
            sentToHandle,
        };
    }
}
