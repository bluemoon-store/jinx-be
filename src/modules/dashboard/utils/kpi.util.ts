export type TrendDirection = 'up' | 'down' | 'flat';

export function computeDeltaPct(current: number, previous: number): number {
    if (previous === 0) {
        return current === 0 ? 0 : 100;
    }
    return Number((((current - previous) / previous) * 100).toFixed(2));
}

export function computeTrend(deltaPct: number): TrendDirection {
    if (Math.abs(deltaPct) < 0.5) {
        return 'flat';
    }
    return deltaPct > 0 ? 'up' : 'down';
}

export function decimalSumToString(
    value: { toString(): string } | null | undefined
): string {
    return value?.toString() ?? '0';
}

export function avgOrderValueString(
    revenueSum: { toString(): string } | null | undefined,
    orderCount: number
): string {
    if (orderCount === 0) {
        return '0';
    }
    const revenue = Number(revenueSum?.toString() ?? '0');
    return (revenue / orderCount).toString();
}
