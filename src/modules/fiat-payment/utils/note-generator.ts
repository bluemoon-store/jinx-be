/**
 * Required-note generator for MANUAL_P2P (Chime/Venmo) payments.
 *
 * Each payment shows the buyer a short, human-readable phrase they must paste
 * into their Chime/Venmo payment note. That note is the ONLY way to tie an
 * inbound "you got paid" notification email back to a specific order (neither
 * provider exposes a payments API), so it must be unique per active payment.
 *
 * Matching is done on the NORMALIZED form (`noteKey`) because providers mangle
 * the displayed note: Venmo, for example, strips spaces and concatenates words
 * ("column notice robust master" -> "columnnoticerobustmaster"). Always compare
 * `normalizeNote(incoming) === payment.noteKey`.
 */

// Curated, unambiguous words (no lookalikes, no profanity) — keep lowercase and
// space-free so normalization is a pure concatenation.
const WORDS = [
    'column',
    'notice',
    'robust',
    'master',
    'harbor',
    'velvet',
    'copper',
    'meadow',
    'pilot',
    'cargo',
    'ember',
    'fabric',
    'garden',
    'helmet',
    'island',
    'jacket',
    'kernel',
    'ladder',
    'magnet',
    'nugget',
    'orbit',
    'pebble',
    'quartz',
    'ribbon',
    'saddle',
    'timber',
    'umbra',
    'violet',
    'walnut',
    'yonder',
    'zenith',
    'anchor',
    'bishop',
    'canyon',
    'dapper',
    'falcon',
] as const;

/**
 * Normalize a note for matching: lowercase, strip everything that is not a
 * latin letter or digit. Mirrors how Venmo/Chime render the note in emails.
 */
export function normalizeNote(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Generate a fresh required note. Returns both the spaced display form and the
 * normalized matching key. Uniqueness is enforced by the caller against the DB
 * (`FiatPayment.noteKey` is unique) with a small retry loop on collision.
 */
export function generatePaymentNote(wordCount = 4): {
    note: string;
    noteKey: string;
} {
    const picked: string[] = [];
    while (picked.length < wordCount) {
        const word = WORDS[Math.floor(Math.random() * WORDS.length)];
        // Avoid immediate repeats so the phrase reads naturally.
        if (picked[picked.length - 1] === word) continue;
        picked.push(word);
    }
    const note = picked.join(' ');
    return { note, noteKey: normalizeNote(note) };
}
