import { P2PProvider } from '@prisma/client';

import { VenmoParser } from 'src/modules/email-reconciliation/parsers/venmo.parser';
import { GmailMessage } from 'src/modules/email-reconciliation/gmail/gmail.client';
import {
    generatePaymentNote,
    normalizeNote,
} from 'src/modules/fiat-payment/utils/note-generator';

function htmlMessage(html: string): GmailMessage {
    return {
        id: 'msg1',
        threadId: 'thread1',
        internalDate: '1742515200000',
        payload: {
            mimeType: 'text/html',
            headers: [{ name: 'From', value: 'Venmo <venmo@venmo.com>' }],
            body: { data: Buffer.from(html).toString('base64url') },
        },
    };
}

describe('VenmoParser', () => {
    const parser = new VenmoParser();

    it('matches venmo.com sender domains', () => {
        expect(parser.matches('venmo.com')).toBe(true);
        expect(parser.matches('mail.venmo.com')).toBe(true);
        expect(parser.matches('chime.com')).toBe(false);
    });

    it('extracts amount, note, txid and handle from a real notification', () => {
        // Mirrors the forwarded Venmo "paid you" email layout.
        const html = `
            <div>Venmo</div>
            <div>Jun Li paid you</div>
            <div>$4.40</div>
            <div>HarleySamuelMetal</div>
            <a>See transaction</a>
            <p>Money credited to your Venmo account.</p>
            <p>Transaction details</p>
            <p>Date Mar 21, 2026</p>
            <p>Transaction ID 4558063035059940001</p>
            <p>Sent to @noid1837</p>
        `;

        const r = parser.parse(htmlMessage(html));

        expect(r.provider).toBe(P2PProvider.VENMO);
        expect(r.amount).toBe(4.4);
        expect(normalizeNote(r.note)).toBe('harleysamuelmetal');
        expect(r.externalTxId).toBe('4558063035059940001');
        expect(r.sentToHandle).toBe('@noid1837');
        expect(r.payerName).toContain('Jun Li');
    });

    it('returns nulls it cannot find without throwing', () => {
        const r = parser.parse(htmlMessage('<div>unrelated content</div>'));
        expect(r.amount).toBeNull();
        expect(r.externalTxId).toBeNull();
        expect(r.sentToHandle).toBeNull();
    });
});

describe('note-generator', () => {
    it('normalizes notes to a space/case-insensitive key', () => {
        expect(normalizeNote('Column Notice Robust Master')).toBe(
            'columnnoticerobustmaster'
        );
        // Venmo concatenates words — must still match the spaced original.
        expect(normalizeNote('ColumnNoticeRobustMaster')).toBe(
            normalizeNote('column notice robust master')
        );
    });

    it('generates a note whose key is the normalized note', () => {
        const { note, noteKey } = generatePaymentNote();
        expect(noteKey).toBe(normalizeNote(note));
        expect(note.split(' ').length).toBeGreaterThanOrEqual(3);
    });
});
