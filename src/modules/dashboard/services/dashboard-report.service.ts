import { Injectable } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';

import { SalesGranularity } from '../dtos/request/dashboard-query.request.dto';
import { KpiCardResponseDto } from '../dtos/response/kpi-card.response.dto';
import { PeriodKey } from '../utils/period.util';
import {
    DashboardReportData,
    DashboardReportMetric,
    DashboardReportDocument,
} from '../reports/dashboard-report.document';
import { DashboardService } from './dashboard.service';

const usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dayFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});
const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
});

/** "May 16 – Jun 15, 2026" — a human-readable inclusive date range. */
function rangeLabel(start: Date, end: Date): string {
    return `${monthDayFormatter.format(start)} – ${dayFormatter.format(end)}`;
}

/** Share of `value` within `total`, formatted as a whole percent (e.g. "32%"). */
function share(value: number, total: number): string {
    if (!(total > 0)) return '0%';
    return `${Math.round((value / total) * 100)}%`;
}

function money(value: string | number): string {
    const n = typeof value === 'number' ? value : Number.parseFloat(value);
    return usd.format(Number.isFinite(n) ? n : 0);
}

function count(value: string | number): string {
    const n = typeof value === 'number' ? value : Number.parseFloat(value);
    return integer.format(Number.isFinite(n) ? n : 0);
}

function percent(value: string | number): string {
    const n = typeof value === 'number' ? value : Number.parseFloat(value);
    return `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
}

function metric(
    label: string,
    formatted: string,
    kpi?: KpiCardResponseDto
): DashboardReportMetric {
    return {
        label,
        value: formatted,
        ...(kpi ? { deltaPct: kpi.deltaPct, trend: kpi.trend } : {}),
    };
}

@Injectable()
export class DashboardReportService {
    constructor(private readonly dashboardService: DashboardService) {}

    /**
     * Assemble the current-month dashboard summary and render it to a PDF
     * Buffer. Reuses the cached dashboard service methods only (no new SQL).
     */
    async generateMonthlyReport(now: Date): Promise<Buffer> {
        const monthStart = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
        );

        const [
            summary,
            secondary,
            today,
            paymentMix,
            topCategories,
            monthSales,
        ] = await Promise.all([
            this.dashboardService.getSummary(),
            this.dashboardService.getSecondaryMetrics(PeriodKey.THIRTY_DAYS),
            this.dashboardService.getTodayStats(),
            this.dashboardService.getPaymentMix(PeriodKey.THIRTY_DAYS),
            this.dashboardService.getTopCategories(PeriodKey.THIRTY_DAYS, 5),
            this.dashboardService.getSales(
                monthStart,
                now,
                SalesGranularity.DAY
            ),
        ]);

        // True current-calendar-month totals, summed from the daily series.
        const monthRevenue = monthSales.items.reduce(
            (sum, item) => sum + Number.parseFloat(item.revenue || '0'),
            0
        );
        const monthOrders = monthSales.items.reduce(
            (sum, item) => sum + item.orderCount,
            0
        );
        const monthAov = monthOrders > 0 ? monthRevenue / monthOrders : 0;

        const monthLabel = new Intl.DateTimeFormat('en-US', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
        }).format(now);
        const thirtyDaysAgo = new Date(
            now.getTime() - 30 * 24 * 60 * 60 * 1000
        );

        // Payment mix: order by volume and annotate each method's share.
        const paymentTotal = paymentMix.items.reduce(
            (sum, item) => sum + Number(item.value || 0),
            0
        );
        const paymentMixItems = [...paymentMix.items]
            .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
            .map(item => ({
                name: item.name,
                value: `${count(item.value)} payments · ${share(Number(item.value || 0), paymentTotal)}`,
            }));

        // Top categories: rank them and show each one's share of listed revenue.
        const categoryTotal = topCategories.items.reduce(
            (sum, item) => sum + Number.parseFloat(item.revenue || '0'),
            0
        );
        const topCategoryItems = topCategories.items.map((item, i) => ({
            name: `${i + 1}. ${item.name}`,
            value: `${money(item.revenue)} · ${share(Number.parseFloat(item.revenue || '0'), categoryTotal)}`,
        }));

        const data: DashboardReportData = {
            monthLabel,
            generatedAt: now.toISOString(),
            sections: [
                {
                    title: 'Today',
                    subtitle: dayFormatter.format(now),
                    metrics: [
                        metric(
                            'Revenue',
                            money(today.revenue.value),
                            today.revenue
                        ),
                        metric(
                            'New paid orders',
                            count(today.newOrders.value),
                            today.newOrders
                        ),
                        metric(
                            'Avg order value',
                            money(today.avgOrderValue.value),
                            today.avgOrderValue
                        ),
                    ],
                },
                {
                    title: 'This month',
                    subtitle: `${monthLabel}, to date`,
                    metrics: [
                        metric('Revenue', money(monthRevenue)),
                        metric('Paid orders', count(monthOrders)),
                        metric('Avg order value', money(monthAov)),
                    ],
                },
                {
                    title: 'Last 30 days',
                    subtitle: rangeLabel(thirtyDaysAgo, now),
                    metrics: [
                        metric(
                            'Avg order value',
                            money(secondary.avgOrderValue.value),
                            secondary.avgOrderValue
                        ),
                        metric(
                            'New customers',
                            count(secondary.newCustomers.value),
                            secondary.newCustomers
                        ),
                        metric(
                            'Fulfillment rate',
                            percent(secondary.fulfillmentRate.value),
                            secondary.fulfillmentRate
                        ),
                    ],
                },
                {
                    title: 'Lifetime',
                    subtitle: 'All time',
                    metrics: [
                        metric(
                            'Revenue',
                            money(summary.revenue.value),
                            summary.revenue
                        ),
                        metric(
                            'Orders',
                            count(summary.orders.value),
                            summary.orders
                        ),
                        metric(
                            'Customers',
                            count(summary.customers.value),
                            summary.customers
                        ),
                    ],
                },
            ],
            topCategories: topCategoryItems,
            paymentMix: paymentMixItems,
        };

        return renderToBuffer(DashboardReportDocument(data));
    }
}
