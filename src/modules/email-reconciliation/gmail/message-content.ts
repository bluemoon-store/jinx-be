import { GmailMessage, GmailMessagePart } from './gmail.client';

/** Case-insensitive header lookup across the top-level payload headers. */
export function getHeader(
    message: GmailMessage,
    name: string
): string | undefined {
    const headers = message.payload?.headers ?? [];
    const lower = name.toLowerCase();
    return headers.find(h => h.name.toLowerCase() === lower)?.value;
}

function decodeBase64Url(data?: string): string {
    if (!data) return '';
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
}

/** Recursively collect decoded text/plain and text/html bodies from all parts. */
export function getDecodedBody(message: GmailMessage): {
    text: string;
    html: string;
} {
    let text = '';
    let html = '';

    const walk = (part?: GmailMessagePart): void => {
        if (!part) return;
        const mime = (part.mimeType ?? '').toLowerCase();
        if (mime === 'text/plain') {
            text += decodeBase64Url(part.body?.data);
        } else if (mime === 'text/html') {
            html += decodeBase64Url(part.body?.data);
        } else if (part.body?.data && !part.parts) {
            // Single-part message with no explicit text/* mime — treat as text.
            text += decodeBase64Url(part.body.data);
        }
        for (const child of part.parts ?? []) walk(child);
    };
    walk(message.payload);

    return { text, html };
}

/** Strip HTML tags/entities to plain text for regex parsing. */
export function htmlToText(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&#36;/g, '$')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Best available plain-text representation of the email body. */
export function getBodyText(message: GmailMessage): string {
    const { text, html } = getDecodedBody(message);
    const fromHtml = html ? htmlToText(html) : '';
    // Prefer whichever is richer; many provider emails are HTML-only.
    return (
        (text.length >= fromHtml.length ? text : fromHtml) || fromHtml || text
    );
}
