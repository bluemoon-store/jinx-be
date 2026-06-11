import { Prisma } from '@prisma/client';

import { IOrderConfirmedPayload } from 'src/common/helper/interfaces/email.interface';

/** Relations needed to build the order-confirmed email (buyer + line items + product name). */
export const ORDER_CONFIRMED_EMAIL_INCLUDE = {
    user: true,
    items: {
        include: {
            product: { select: { name: true } },
        },
    },
} satisfies Prisma.OrderInclude;

export type OrderForConfirmedEmail = Prisma.OrderGetPayload<{
    include: typeof ORDER_CONFIRMED_EMAIL_INCLUDE;
}>;

const formatUsd = (value: number): string =>
    `$${value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

export interface BuildOrderConfirmedEmailOptions {
    paymentMethod: string;
    /** USD amount charged (kept for backward compatibility with the existing `amount` field). */
    totalAmountUsd: number;
    frontendUrl: string;
}

/** Build the order-confirmed email payload (incl. line items + totals) from a loaded order. */
export function buildOrderConfirmedEmailData(
    order: OrderForConfirmedEmail,
    {
        paymentMethod,
        totalAmountUsd,
        frontendUrl,
    }: BuildOrderConfirmedEmailOptions
): IOrderConfirmedPayload {
    const dashboardLink = `${frontendUrl.replace(/\/$/, '')}/orders/${order.id}`;
    const completedAt = order.completedAt ?? new Date();

    const lineItems = order.items.map(item => {
        const unitPrice = Number(item.priceAtPurchase);
        return {
            name: item.product?.name ?? 'Item',
            variant: item.variantLabel ?? null,
            quantity: item.quantity,
            unit_price: formatUsd(unitPrice),
            line_total: formatUsd(unitPrice * item.quantity),
        };
    });

    const discountValue = Number(order.discountAmount);

    return {
        order_id: order.orderNumber,
        payment_method: paymentMethod,
        amount: formatUsd(totalAmountUsd),
        date: completedAt.toISOString().slice(0, 10),
        dashboard_link: dashboardLink,
        orderId: order.id,
        line_items: lineItems,
        subtotal: formatUsd(Number(order.subtotalAmount)),
        discount: discountValue > 0 ? formatUsd(discountValue) : undefined,
        total: formatUsd(Number(order.totalAmount)),
    };
}
