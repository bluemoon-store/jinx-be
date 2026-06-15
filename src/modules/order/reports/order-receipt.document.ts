import { createElement as e } from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

export interface OrderReceiptItem {
    name: string;
    variant?: string | null;
    quantity: number;
    unitPrice: string;
}

export interface OrderReceiptData {
    orderNumber: string;
    date: string;
    paymentMethod: string;
    amount: string;
    currency?: string;
    items?: OrderReceiptItem[];
}

const COLORS = {
    bg: '#0b1220',
    card: '#111a2e',
    border: '#1f2a44',
    text: '#e6ebf5',
    muted: '#8aa0c6',
    accent: '#eb2dff',
};

/** Format a raw price string to two decimals, falling back to the input. */
function money(raw: string): string {
    const n = Number(raw);
    return Number.isFinite(n) ? n.toFixed(2) : raw;
}

const styles = StyleSheet.create({
    // A5 portrait; the dark page sits behind a slightly inset card.
    page: {
        backgroundColor: COLORS.bg,
        padding: 28,
        fontFamily: 'Helvetica',
        color: COLORS.text,
    },
    card: {
        backgroundColor: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: 26,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    brand: {
        color: COLORS.accent,
        fontSize: 22,
        fontFamily: 'Helvetica-Bold',
    },
    headerLabel: {
        color: COLORS.muted,
        fontSize: 14,
        fontFamily: 'Helvetica-Bold',
    },
    divider: {
        height: 1,
        backgroundColor: COLORS.border,
        marginTop: 18,
        marginBottom: 18,
    },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        fontSize: 13,
        marginBottom: 8,
    },
    metaLabel: { color: COLORS.muted },
    metaValue: { color: COLORS.text, fontFamily: 'Helvetica-Bold' },
    itemsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    itemsHeaderCell: { color: COLORS.muted, fontSize: 11 },
    itemRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 8,
    },
    itemRowDivided: {
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
    },
    itemName: {
        color: COLORS.text,
        fontSize: 13,
        fontFamily: 'Helvetica-Bold',
    },
    itemVariant: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
    itemPrice: { color: COLORS.text, fontSize: 12 },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    totalLabel: { color: COLORS.muted, fontSize: 15 },
    totalValue: {
        color: COLORS.accent,
        fontSize: 22,
        fontFamily: 'Helvetica-Bold',
    },
});

function metaRow(label: string, value: string, key: string) {
    return e(
        View,
        { key, style: styles.metaRow },
        e(Text, { style: styles.metaLabel }, label),
        e(Text, { style: styles.metaValue }, value)
    );
}

function itemRow(item: OrderReceiptItem, index: number) {
    return e(
        View,
        {
            key: index,
            style:
                index === 0
                    ? styles.itemRow
                    : [styles.itemRow, styles.itemRowDivided],
        },
        e(
            View,
            {},
            e(Text, { style: styles.itemName }, item.name),
            item.variant
                ? e(Text, { style: styles.itemVariant }, item.variant)
                : null
        ),
        e(
            Text,
            { style: styles.itemPrice },
            `${item.quantity} × ${money(item.unitPrice)}`
        )
    );
}

/**
 * Builds the order-receipt PDF element tree. Uses React.createElement directly
 * so the backend needs no JSX/TSX compiler configuration (same pattern as the
 * dashboard report document).
 */
export function OrderReceiptDocument(data: OrderReceiptData) {
    const items = data.items ?? [];

    return e(
        Document,
        { title: `Order receipt — ${data.orderNumber}` },
        e(
            Page,
            { size: 'A5', style: styles.page },
            e(
                View,
                { style: styles.card },
                e(
                    View,
                    { style: styles.headerRow },
                    e(Text, { style: styles.brand }, 'Jinx.to'),
                    e(Text, { style: styles.headerLabel }, 'Order Receipt')
                ),
                e(View, { style: styles.divider }),
                metaRow('Order', data.orderNumber, 'order'),
                metaRow('Date', data.date, 'date'),
                metaRow('Payment', data.paymentMethod, 'payment'),
                e(View, { style: styles.divider }),
                e(
                    View,
                    { style: styles.itemsHeader },
                    e(Text, { style: styles.itemsHeaderCell }, 'Item'),
                    e(Text, { style: styles.itemsHeaderCell }, 'Qty · Price')
                ),
                e(
                    View,
                    { style: { marginTop: 6 } },
                    ...items.map((it, i) => itemRow(it, i))
                ),
                e(View, { style: styles.divider }),
                e(
                    View,
                    { style: styles.totalRow },
                    e(Text, { style: styles.totalLabel }, 'Total'),
                    e(Text, { style: styles.totalValue }, data.amount)
                )
            )
        )
    );
}

export default OrderReceiptDocument;
