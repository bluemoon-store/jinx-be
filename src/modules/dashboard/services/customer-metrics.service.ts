import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';

import { DashboardOrdersBreakdownResponseDto } from '../dtos/response/orders-breakdown.response.dto';
import { KpiCardResponseDto } from '../dtos/response/kpi-card.response.dto';
import { computeDeltaPct, computeTrend } from '../utils/kpi.util';
import {
    addBuckets,
    BucketUnit,
    densifyBuckets,
    enumerateBuckets,
    PeriodKey,
    PeriodRange,
    resolvePeriod,
    resolveSparklineWeeks,
} from '../utils/period.util';

const SPARKLINE_WEEKS = 8;

type OrdersBreakdownRow = {
    bucket: Date;
    new_customers: bigint;
    returning_customers: bigint;
};

@Injectable()
export class CustomerMetricsService {
    constructor(private readonly databaseService: DatabaseService) {}

    async getTotalCustomers(): Promise<number> {
        return this.databaseService.user.count({
            where: { role: Role.USER, deletedAt: null },
        });
    }

    async countNewCustomers(from: Date, to: Date): Promise<number> {
        return this.databaseService.user.count({
            where: {
                role: Role.USER,
                deletedAt: null,
                createdAt: { gte: from, lt: to },
            },
        });
    }

    async getWeeklyNewCustomerSparkline(
        from: Date,
        to: Date
    ): Promise<number[]> {
        const rows = await this.databaseService.$queryRaw<
            Array<{ bucket: Date; count: bigint }>
        >`
            SELECT date_trunc('week', u.created_at) AS bucket,
                   COUNT(*)::bigint AS count
            FROM users u
            WHERE u.role = 'USER'
              AND u.deleted_at IS NULL
              AND u.created_at >= ${from}
              AND u.created_at < ${to}
            GROUP BY 1
            ORDER BY 1 ASC
        `;
        const densified = densifyBuckets(
            rows,
            enumerateBuckets(from, to, 'week'),
            bucket => ({ bucket, count: 0n })
        );
        return densified.map(row => Number(row.count));
    }

    async getWeeklyCustomerTotalSparkline(from: Date): Promise<number[]> {
        const result: number[] = [];
        for (let i = 0; i < SPARKLINE_WEEKS; i++) {
            const weekEnd = addBuckets(from, 'week', i + 1);
            const count = await this.databaseService.user.count({
                where: {
                    role: Role.USER,
                    deletedAt: null,
                    createdAt: { lt: weekEnd },
                },
            });
            result.push(count);
        }
        return result;
    }

    async buildNewCustomersKpi(
        range: PeriodRange
    ): Promise<KpiCardResponseDto> {
        const sparklineRange = resolveSparklineWeeks(SPARKLINE_WEEKS);
        const [current, previous, sparkline] = await Promise.all([
            this.countNewCustomers(range.from, range.to),
            this.countNewCustomers(range.prevFrom, range.prevTo),
            this.getWeeklyNewCustomerSparkline(
                sparklineRange.from,
                sparklineRange.to
            ),
        ]);
        const deltaPct = computeDeltaPct(current, previous);
        return {
            value: String(current),
            deltaPct,
            trend: computeTrend(deltaPct),
            sparkline,
        };
    }

    async buildFulfillmentRateKpi(
        range: PeriodRange,
        getRate: (from: Date, to: Date) => Promise<number>
    ): Promise<KpiCardResponseDto> {
        const sparklineRange = resolveSparklineWeeks(SPARKLINE_WEEKS);
        const [current, previous] = await Promise.all([
            getRate(range.from, range.to),
            getRate(range.prevFrom, range.prevTo),
        ]);

        const sparkline = await this.getWeeklyFulfillmentSparkline(
            sparklineRange.from,
            sparklineRange.to
        );
        const deltaPct = computeDeltaPct(current, previous);
        return {
            value: String(current),
            deltaPct,
            trend: computeTrend(deltaPct),
            sparkline,
        };
    }

    async getOrdersBreakdown(
        period: PeriodKey
    ): Promise<DashboardOrdersBreakdownResponseDto> {
        const { from, to, bucket } = resolvePeriod(period);
        const trunc = this.assertTruncUnit(bucket);

        const rows = await this.databaseService.$queryRaw<OrdersBreakdownRow[]>`
            WITH user_first_order AS (
                SELECT o.user_id,
                       MIN(o.completed_at) AS first_at
                FROM orders o
                WHERE o.status = 'COMPLETED'
                  AND o.deleted_at IS NULL
                  AND o.completed_at IS NOT NULL
                GROUP BY o.user_id
            )
            SELECT date_trunc(${trunc}, o.completed_at) AS bucket,
                   COUNT(*) FILTER (
                       WHERE date_trunc(${trunc}, ufo.first_at) =
                             date_trunc(${trunc}, o.completed_at)
                   )::bigint AS new_customers,
                   COUNT(*) FILTER (
                       WHERE date_trunc(${trunc}, ufo.first_at) <
                             date_trunc(${trunc}, o.completed_at)
                   )::bigint AS returning_customers
            FROM orders o
            INNER JOIN user_first_order ufo ON ufo.user_id = o.user_id
            WHERE o.status = 'COMPLETED'
              AND o.deleted_at IS NULL
              AND o.completed_at >= ${from}
              AND o.completed_at < ${to}
            GROUP BY 1
            ORDER BY 1 ASC
        `;

        const densified = densifyBuckets(
            rows,
            enumerateBuckets(from, to, bucket),
            bucket => ({
                bucket,
                new_customers: 0n,
                returning_customers: 0n,
            })
        );

        return {
            items: densified.map(row => ({
                date: row.bucket,
                newCustomers: Number(row.new_customers),
                returningCustomers: Number(row.returning_customers),
            })),
        };
    }

    private async getWeeklyFulfillmentSparkline(
        from: Date,
        to: Date
    ): Promise<number[]> {
        const rows = await this.databaseService.$queryRaw<
            Array<{ bucket: Date; rate: number | null }>
        >`
            SELECT date_trunc('week', o.completed_at) AS bucket,
                   CASE
                       WHEN COUNT(*) FILTER (
                           WHERE o.status IN ('COMPLETED', 'CANCELLED', 'REFUNDED')
                       ) = 0 THEN 0
                       ELSE ROUND(
                           100.0 * COUNT(*) FILTER (WHERE o.status = 'COMPLETED') /
                           COUNT(*) FILTER (
                               WHERE o.status IN ('COMPLETED', 'CANCELLED', 'REFUNDED')
                           ),
                           2
                       )
                   END AS rate
            FROM orders o
            WHERE o.deleted_at IS NULL
              AND o.completed_at IS NOT NULL
              AND o.completed_at >= ${from}
              AND o.completed_at < ${to}
            GROUP BY 1
            ORDER BY 1 ASC
        `;

        const densified = densifyBuckets(
            rows,
            enumerateBuckets(from, to, 'week'),
            bucket => ({ bucket, rate: 0 })
        );
        return densified.map(row => Number(row.rate ?? 0));
    }

    private assertTruncUnit(bucket: BucketUnit): BucketUnit {
        const allowed: BucketUnit[] = ['hour', 'day', 'week', 'month'];
        if (!(allowed as readonly string[]).includes(bucket)) {
            throw new Error(`Invalid bucket: ${bucket}`);
        }
        return bucket;
    }
}
