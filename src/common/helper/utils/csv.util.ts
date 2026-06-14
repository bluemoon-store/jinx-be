/**
 * Serialize a row of values into a single RFC-4180 CSV line (trailing newline
 * included). Values containing a comma, double-quote, or newline are wrapped in
 * double-quotes with inner quotes escaped by doubling.
 */
export function csvLine(
    values: Array<string | number | boolean | null | undefined>
): string {
    return (
        values
            .map(v => {
                const s =
                    v === null || v === undefined
                        ? ''
                        : typeof v === 'string'
                          ? v
                          : String(v);
                if (/[",\n\r]/.test(s)) {
                    return `"${s.replace(/"/g, '""')}"`;
                }
                return s;
            })
            .join(',') + '\n'
    );
}
