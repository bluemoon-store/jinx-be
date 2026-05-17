import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';

import { SalesGranularity } from '../dtos/request/dashboard-query.request.dto';
import { DashboardOrdersBreakdownResponseDto } from '../dtos/response/orders-breakdown.response.dto';
import { DashboardPaymentMixResponseDto } from '../dtos/response/payment-mix.response.dto';
import { DashboardRevenueTrendResponseDto } from '../dtos/response/revenue-trend.response.dto';
import { DashboardSalesResponseDto } from '../dtos/response/sales.response.dto';
import { DashboardSecondaryMetricsResponseDto } from '../dtos/response/secondary-metrics.response.dto';
import { DashboardSummaryResponseDto } from '../dtos/response/summary.response.dto';
import { DashboardTodayStatsResponseDto } from '../dtos/response/today-stats.response.dto';
import { DashboardTopCategoriesResponseDto } from '../dtos/response/top-categories.response.dto';
import { KpiCardResponseDto } from '../dtos/response/kpi-card.response.dto';
import { computeDeltaPct, computeTrend } from '../utils/kpi.util';
import {
    PeriodKey,
    resolvePeriod,
    resolveSparklineWeeks,
    resolveSummaryDeltaWindow,
    resolveTodayYesterday,
} from '../utils/period.util';
import { CustomerMetricsService } from './customer-metrics.service';
import { SalesMetricsService } from './sales-metrics.service';

const SPARKLINE_WEEKS = 8;

const CACHE_TTL = {
    SUMMARY: 5 * 60 * 1000,
    SECONDARY: 5 * 60 * 1000,
    SALES: 10 * 60 * 1000,
    REVENUE_TREND: 10 * 60 * 1000,
    ORDERS_BREAKDOWN: 10 * 60 * 1000,
    PAYMENT_MIX: 30 * 60 * 1000,
    TOP_CATEGORIES: 30 * 60 * 1000,
    TODAY: 60 * 1000,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_SALES_WEEKS = 12;

@Injectable()
export class DashboardService {
    constructor(
        private readonly salesMetrics: SalesMetricsService,
        private readonly customerMetrics: CustomerMetricsService,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
    ) {}

    getSummary(): Promise<DashboardSummaryResponseDto> {
        return this.cached('dashboard:summary:v1', CACHE_TTL.SUMMARY, () =>
            this.buildSummary()
        );
    }

    getSecondaryMetrics(
        period: PeriodKey
    ): Promise<DashboardSecondaryMetricsResponseDto> {
        return this.cached(
            `dashboard:secondary:${period}`,
            CACHE_TTL.SECONDARY,
            () => this.buildSecondaryMetrics(period)
        );
    }

    getSales(
        from: Date,
        to: Date,
        granularity: SalesGranularity
    ): Promise<DashboardSalesResponseDto> {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        return this.cached(
            `dashboard:sales:${fromIso}:${toIso}:${granularity}`,
            CACHE_TTL.SALES,
            () => this.salesMetrics.getSales(from, to, granularity)
        );
    }

    getRevenueTrend(
        period: PeriodKey
    ): Promise<DashboardRevenueTrendResponseDto> {
        return this.cached(
            `dashboard:revenue-trend:${period}`,
            CACHE_TTL.REVENUE_TREND,
            () => this.salesMetrics.getRevenueTrend(period)
        );
    }

    getOrdersBreakdown(
        period: PeriodKey
    ): Promise<DashboardOrdersBreakdownResponseDto> {
        return this.cached(
            `dashboard:orders-breakdown:${period}`,
            CACHE_TTL.ORDERS_BREAKDOWN,
            () => this.customerMetrics.getOrdersBreakdown(period)
        );
    }

    getPaymentMix(period: PeriodKey): Promise<DashboardPaymentMixResponseDto> {
        return this.cached(
            `dashboard:payment-mix:${period}`,
            CACHE_TTL.PAYMENT_MIX,
            async () => {
                const range = resolvePeriod(period);
                return this.salesMetrics.getPaymentMix(range);
            }
        );
    }

    getTopCategories(
        period: PeriodKey,
        limit: number
    ): Promise<DashboardTopCategoriesResponseDto> {
        return this.cached(
            `dashboard:top-categories:${period}:${limit}`,
            CACHE_TTL.TOP_CATEGORIES,
            async () => {
                const range = resolvePeriod(period);
                return this.salesMetrics.getTopCategories(range, limit);
            }
        );
    }

    getTodayStats(): Promise<DashboardTodayStatsResponseDto> {
        return this.cached('dashboard:today', CACHE_TTL.TODAY, () =>
            this.buildTodayStats()
        );
    }

    resolveSalesRange(
        from?: string,
        to?: string,
        granularity: SalesGranularity = SalesGranularity.WEEK
    ): { from: Date; to: Date; granularity: SalesGranularity } {
        const end = to ? new Date(to) : new Date();
        const start = from
            ? new Date(from)
            : new Date(end.getTime() - DEFAULT_SALES_WEEKS * 7 * MS_PER_DAY);
        return { from: start, to: end, granularity };
    }

    private async buildSummary(): Promise<DashboardSummaryResponseDto> {
        const deltaWindow = resolveSummaryDeltaWindow();
        const sparklineRange = resolveSparklineWeeks(SPARKLINE_WEEKS);

        const [
            lifetimeRevenue,
            lifetimeOrders,
            lifetimeCustomers,
            revenueDeltaCurrent,
            revenueDeltaPrevious,
            ordersDeltaCurrent,
            ordersDeltaPrevious,
            customersDeltaCurrent,
            customersDeltaPrevious,
            revenueSparkline,
            ordersSparkline,
            customersSparkline,
        ] = await Promise.all([
            this.salesMetrics.getLifetimeRevenue(),
            this.salesMetrics.getLifetimeOrderCount(),
            this.customerMetrics.getTotalCustomers(),
            this.salesMetrics.aggregateRevenueAndCount(
                deltaWindow.currentFrom,
                deltaWindow.currentTo
            ),
            this.salesMetrics.aggregateRevenueAndCount(
                deltaWindow.previousFrom,
                deltaWindow.previousTo
            ),
            this.salesMetrics.aggregateRevenueAndCount(
                deltaWindow.currentFrom,
                deltaWindow.currentTo
            ),
            this.salesMetrics.aggregateRevenueAndCount(
                deltaWindow.previousFrom,
                deltaWindow.previousTo
            ),
            this.customerMetrics.countNewCustomers(
                deltaWindow.currentFrom,
                deltaWindow.currentTo
            ),
            this.customerMetrics.countNewCustomers(
                deltaWindow.previousFrom,
                deltaWindow.previousTo
            ),
            this.salesMetrics.getWeeklyRevenueSparkline(
                sparklineRange.from,
                sparklineRange.to,
                SPARKLINE_WEEKS
            ),
            this.salesMetrics.getWeeklyOrderCountSparkline(
                sparklineRange.from,
                sparklineRange.to,
                SPARKLINE_WEEKS
            ),
            this.customerMetrics.getWeeklyCustomerTotalSparkline(
                sparklineRange.from,
                sparklineRange.to
            ),
        ]);

        return {
            revenue: this.buildKpiFromNumbers(
                Number(lifetimeRevenue),
                Number(revenueDeltaCurrent.revenue),
                Number(revenueDeltaPrevious.revenue),
                revenueSparkline,
                lifetimeRevenue
            ),
            orders: this.buildKpiFromNumbers(
                lifetimeOrders,
                ordersDeltaCurrent.orderCount,
                ordersDeltaPrevious.orderCount,
                ordersSparkline,
                String(lifetimeOrders)
            ),
            customers: this.buildKpiFromNumbers(
                lifetimeCustomers,
                customersDeltaCurrent,
                customersDeltaPrevious,
                customersSparkline,
                String(lifetimeCustomers)
            ),
        };
    }

    private async buildSecondaryMetrics(
        period: PeriodKey
    ): Promise<DashboardSecondaryMetricsResponseDto> {
        const range = resolvePeriod(period);
        const sparklineRange = resolveSparklineWeeks(SPARKLINE_WEEKS);

        const [
            avgCurrent,
            avgPrevious,
            avgSparkline,
            newCustomersKpi,
            fulfillmentKpi,
        ] = await Promise.all([
            this.salesMetrics.getAvgOrderValue(range.from, range.to),
            this.salesMetrics.getAvgOrderValue(range.prevFrom, range.prevTo),
            this.buildAvgOrderValueSparkline(
                sparklineRange.from,
                sparklineRange.to
            ),
            this.customerMetrics.buildNewCustomersKpi(range),
            this.customerMetrics.buildFulfillmentRateKpi(range, (from, to) =>
                this.salesMetrics.getFulfillmentRate(from, to)
            ),
        ]);

        const avgDeltaPct = computeDeltaPct(
            Number(avgCurrent),
            Number(avgPrevious)
        );

        return {
            avgOrderValue: {
                value: avgCurrent,
                deltaPct: avgDeltaPct,
                trend: computeTrend(avgDeltaPct),
                sparkline: avgSparkline,
            },
            newCustomers: newCustomersKpi,
            fulfillmentRate: fulfillmentKpi,
        };
    }

    private async buildTodayStats(): Promise<DashboardTodayStatsResponseDto> {
        const { todayStart, tomorrowStart, yesterdayStart } =
            resolveTodayYesterday();

        const sparklineRange = resolveSparklineWeeks(SPARKLINE_WEEKS);

        const [
            todayRevenue,
            yesterdayRevenue,
            todayOrders,
            yesterdayOrders,
            todayAov,
            yesterdayAov,
            revenueSparkline,
            ordersSparkline,
            aovSparkline,
        ] = await Promise.all([
            this.salesMetrics.aggregateRevenueAndCount(
                todayStart,
                tomorrowStart
            ),
            this.salesMetrics.aggregateRevenueAndCount(
                yesterdayStart,
                todayStart
            ),
            this.salesMetrics.aggregateRevenueAndCount(
                todayStart,
                tomorrowStart
            ),
            this.salesMetrics.aggregateRevenueAndCount(
                yesterdayStart,
                todayStart
            ),
            this.salesMetrics.getAvgOrderValue(todayStart, tomorrowStart),
            this.salesMetrics.getAvgOrderValue(yesterdayStart, todayStart),
            this.salesMetrics.getWeeklyRevenueSparkline(
                sparklineRange.from,
                sparklineRange.to,
                SPARKLINE_WEEKS
            ),
            this.salesMetrics.getWeeklyOrderCountSparkline(
                sparklineRange.from,
                sparklineRange.to,
                SPARKLINE_WEEKS
            ),
            this.buildAvgOrderValueSparkline(
                sparklineRange.from,
                sparklineRange.to
            ),
        ]);

        return {
            revenue: this.buildKpiFromNumbers(
                Number(todayRevenue.revenue),
                Number(todayRevenue.revenue),
                Number(yesterdayRevenue.revenue),
                revenueSparkline,
                todayRevenue.revenue
            ),
            newOrders: this.buildKpiFromNumbers(
                todayOrders.orderCount,
                todayOrders.orderCount,
                yesterdayOrders.orderCount,
                ordersSparkline,
                String(todayOrders.orderCount)
            ),
            avgOrderValue: this.buildKpiFromNumbers(
                Number(todayAov),
                Number(todayAov),
                Number(yesterdayAov),
                aovSparkline,
                todayAov
            ),
        };
    }

    private async buildAvgOrderValueSparkline(
        from: Date,
        _to: Date
    ): Promise<number[]> {
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const points: number[] = [];
        for (let i = 0; i < SPARKLINE_WEEKS; i++) {
            const weekFrom = new Date(from.getTime() + i * msPerWeek);
            const weekTo = new Date(from.getTime() + (i + 1) * msPerWeek);
            const aov = await this.salesMetrics.getAvgOrderValue(
                weekFrom,
                weekTo
            );
            points.push(Number(aov));
        }
        return points;
    }

    private buildKpiFromNumbers(
        _displayNumeric: number,
        current: number,
        previous: number,
        sparkline: number[],
        value: string
    ): KpiCardResponseDto {
        const deltaPct = computeDeltaPct(current, previous);
        return {
            value,
            deltaPct,
            trend: computeTrend(deltaPct),
            sparkline,
        };
    }

    private async cached<T>(
        key: string,
        ttlMs: number,
        fn: () => Promise<T>
    ): Promise<T> {
        const hit = await this.cacheManager.get<T>(key);
        if (hit !== undefined && hit !== null) {
            return hit;
        }
        const result = await fn();
        await this.cacheManager.set(key, result, ttlMs);
        return result;
    }
}
