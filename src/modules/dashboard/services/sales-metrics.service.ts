import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';

import { SalesGranularity } from '../dtos/request/dashboard-query.request.dto';
import { DashboardPaymentMixResponseDto } from '../dtos/response/payment-mix.response.dto';
import { DashboardRevenueTrendResponseDto } from '../dtos/response/revenue-trend.response.dto';
import { DashboardSalesResponseDto } from '../dtos/response/sales.response.dto';
import { DashboardTopCategoriesResponseDto } from '../dtos/response/top-categories.response.dto';
import { avgOrderValueString, decimalSumToString } from '../utils/kpi.util';
import {
    BucketUnit,
    PeriodKey,
    PeriodRange,
    resolvePeriod,
} from '../utils/period.util';

const COMPLETED_ORDER_WHERE = {
    status: OrderStatus.COMPLETED,
    deletedAt: null,
} as const;

type BucketRow = {
    bucket: Date;
    revenue: Prisma.Decimal | null;
    order_count: bigint;
};

@Injectable()
export class SalesMetricsService {
    constructor(private readonly databaseService: DatabaseService) {}

    async aggregateRevenueAndCount(
        from: Date,
        to: Date
    ): Promise<{ revenue: string; orderCount: number }> {
        const agg = await this.databaseService.order.aggregate({
            where: {
                ...COMPLETED_ORDER_WHERE,
                completedAt: { gte: from, lt: to },
            },
            _sum: { totalAmount: true },
            _count: true,
        });
        return {
            revenue: decimalSumToString(agg._sum.totalAmount),
            orderCount: agg._count,
        };
    }

    async getLifetimeRevenue(): Promise<string> {
        const agg = await this.databaseService.order.aggregate({
            where: COMPLETED_ORDER_WHERE,
            _sum: { totalAmount: true },
        });
        return decimalSumToString(agg._sum.totalAmount);
    }

    async getLifetimeOrderCount(): Promise<number> {
        return this.databaseService.order.count({
            where: COMPLETED_ORDER_WHERE,
        });
    }

    async getWeeklyRevenueSparkline(
        from: Date,
        to: Date,
        weekCount: number
    ): Promise<number[]> {
        const rows = await this.queryOrderBuckets(from, to, 'week');
        return this.toSparklineNumbers(rows, weekCount, from, r =>
            Number(r.revenue?.toString() ?? '0')
        );
    }

    async getWeeklyOrderCountSparkline(
        from: Date,
        to: Date,
        weekCount: number
    ): Promise<number[]> {
        const rows = await this.queryOrderBuckets(from, to, 'week');
        return this.toSparklineNumbers(rows, weekCount, from, r =>
            Number(r.order_count)
        );
    }

    async getSales(
        from: Date,
        to: Date,
        granularity: SalesGranularity
    ): Promise<DashboardSalesResponseDto> {
        const rows = await this.queryOrderBuckets(from, to, granularity);
        return {
            items: rows.map(row => ({
                date: row.bucket,
                revenue: decimalSumToString(row.revenue),
                orderCount: Number(row.order_count),
            })),
        };
    }

    async getRevenueTrend(
        period: PeriodKey
    ): Promise<DashboardRevenueTrendResponseDto> {
        const { from, to, prevFrom, prevTo, bucket } = resolvePeriod(period);
        const [currentRows, previousRows] = await Promise.all([
            this.queryOrderBuckets(from, to, bucket),
            this.queryOrderBuckets(prevFrom, prevTo, bucket),
        ]);

        const previousByIndex = new Map(
            previousRows.map((row, index) => [index, row])
        );

        const items = currentRows.map((row, index) => {
            const prev = previousByIndex.get(index);
            return {
                date: row.bucket,
                currentPeriod: decimalSumToString(row.revenue),
                previousPeriod: decimalSumToString(prev?.revenue ?? null),
            };
        });

        return { items };
    }

    async getPaymentMix(
        range: PeriodRange
    ): Promise<DashboardPaymentMixResponseDto> {
        const rows = await this.databaseService.$queryRaw<
            Array<{ name: string; value: bigint }>
        >`
            SELECT cp.cryptocurrency::text AS name,
                   COUNT(*)::bigint AS value
            FROM crypto_payments cp
            INNER JOIN orders o ON o.id = cp.order_id
            WHERE cp.status IN ('CONFIRMED', 'FORWARDED')
              AND o.status = 'COMPLETED'
              AND o.deleted_at IS NULL
              AND o.completed_at >= ${range.from}
              AND o.completed_at < ${range.to}
            GROUP BY cp.cryptocurrency
            ORDER BY value DESC
        `;

        return {
            items: rows.map(row => ({
                name: row.name,
                value: Number(row.value),
            })),
        };
    }

    async getTopCategories(
        range: PeriodRange,
        limit: number
    ): Promise<DashboardTopCategoriesResponseDto> {
        const rows = await this.databaseService.$queryRaw<
            Array<{ name: string; revenue: Prisma.Decimal }>
        >`
            SELECT pc.name AS name,
                   SUM(oi.price_at_purchase * oi.quantity) AS revenue
            FROM order_items oi
            INNER JOIN orders o ON o.id = oi.order_id
            INNER JOIN products p ON p.id = oi.product_id
            INNER JOIN product_categories pc ON pc.id = p.category_id
            WHERE o.status = 'COMPLETED'
              AND o.deleted_at IS NULL
              AND o.completed_at >= ${range.from}
              AND o.completed_at < ${range.to}
            GROUP BY pc.id, pc.name
            ORDER BY revenue DESC
            LIMIT ${limit}
        `;

        return {
            items: rows.map(row => ({
                name: row.name,
                revenue: decimalSumToString(row.revenue),
            })),
        };
    }

    async getFulfillmentRate(from: Date, to: Date): Promise<number> {
        const counts = await this.databaseService.order.groupBy({
            by: ['status'],
            where: {
                deletedAt: null,
                completedAt: { gte: from, lt: to },
                status: {
                    in: [
                        OrderStatus.COMPLETED,
                        OrderStatus.CANCELLED,
                        OrderStatus.REFUNDED,
                    ],
                },
            },
            _count: true,
        });

        const completed =
            counts.find(c => c.status === OrderStatus.COMPLETED)?._count ?? 0;
        const terminal = counts.reduce((sum, c) => sum + c._count, 0);
        if (terminal === 0) {
            return 0;
        }
        return Number(((completed / terminal) * 100).toFixed(2));
    }

    async getAvgOrderValue(from: Date, to: Date): Promise<string> {
        const agg = await this.databaseService.order.aggregate({
            where: {
                ...COMPLETED_ORDER_WHERE,
                completedAt: { gte: from, lt: to },
            },
            _sum: { totalAmount: true },
            _count: true,
        });
        return avgOrderValueString(agg._sum.totalAmount, agg._count);
    }

    private async queryOrderBuckets(
        from: Date,
        to: Date,
        bucket: BucketUnit | SalesGranularity
    ): Promise<BucketRow[]> {
        const trunc = this.assertTruncUnit(bucket);
        return this.databaseService.$queryRaw<BucketRow[]>`
            SELECT date_trunc(${trunc}, o.completed_at) AS bucket,
                   COALESCE(SUM(o.total_amount), 0) AS revenue,
                   COUNT(*)::bigint AS order_count
            FROM orders o
            WHERE o.status = 'COMPLETED'
              AND o.deleted_at IS NULL
              AND o.completed_at IS NOT NULL
              AND o.completed_at >= ${from}
              AND o.completed_at < ${to}
            GROUP BY 1
            ORDER BY 1 ASC
        `;
    }

    private assertTruncUnit(
        bucket: BucketUnit | SalesGranularity
    ): 'hour' | 'day' | 'week' | 'month' {
        const allowed = ['hour', 'day', 'week', 'month'] as const;
        if (!(allowed as readonly string[]).includes(bucket)) {
            throw new Error(`Invalid bucket: ${bucket}`);
        }
        return bucket;
    }

    private toSparklineNumbers(
        rows: BucketRow[],
        pointCount: number,
        rangeFrom: Date,
        pickValue: (row: BucketRow) => number
    ): number[] {
        const byBucket = new Map(
            rows.map(row => [row.bucket.getTime(), pickValue(row)])
        );
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const result: number[] = [];
        for (let i = 0; i < pointCount; i++) {
            const bucketStart = new Date(rangeFrom.getTime() + i * msPerWeek);
            result.push(byBucket.get(bucketStart.getTime()) ?? 0);
        }
        return result;
    }
}
