/**
 * Compact, branded reference codes shown to users (e.g. JINX-ORD-738291045).
 *
 * These are display-only identifiers — UUID primary keys remain the source of
 * truth in URLs, API params and foreign keys. The code is a separate @unique
 * field surfaced in the UI, emails and support search.
 */

export const REFERENCE_PREFIX = {
    ORDER: 'ORD',
    CLAIM: 'CLM',
    DROP: 'DRP',
    PRODUCT: 'PRD',
    TICKET: 'TKT',
} as const;

export type ReferencePrefix =
    (typeof REFERENCE_PREFIX)[keyof typeof REFERENCE_PREFIX];

/** Format: JINX-<PREFIX>-<9 random digits>, e.g. JINX-ORD-738291045 */
export function generateReferenceCode(prefix: string): string {
    // 100000000–999999999 → always exactly 9 digits, no leading zero
    const n = Math.floor(100000000 + Math.random() * 900000000);
    return `JINX-${prefix}-${n}`;
}

/**
 * Generate a reference code that does not already exist, retrying on the
 * (very unlikely) collision. `exists` should resolve true when the code is taken.
 */
export async function generateUniqueReferenceCode(
    prefix: string,
    exists: (code: string) => Promise<boolean>,
    maxRetries = 8
): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
        const code = generateReferenceCode(prefix);
        if (!(await exists(code))) {
            return code;
        }
    }
    throw new Error(
        `Failed to generate a unique ${prefix} reference code after ${maxRetries} attempts`
    );
}
