import { InjectQueue } from '@nestjs/bull';
import { Injectable, Scope } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { Queue } from 'bull';
import { PinoLogger } from 'nestjs-pino';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IMonthlyStoreReportPayload,
    ISendEmailBasePayload,
} from 'src/common/helper/interfaces/email.interface';
import { CustomerMetricsService } from 'src/modules/dashboard/services/customer-metrics.service';
import { SalesMetricsService } from 'src/modules/dashboard/services/sales-metrics.service';

const REPORT_RECIPIENT_ROLES: Role[] = [Role.OWNER, Role.SUPER_ADMIN, Role.MOD];

const EMPTY_VALUE = '—';

const formatUsd = (value: number): string =>
    `$${value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

@Injectable({ scope: Scope.DEFAULT })
export class MonthlyReportScheduleWorker {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly salesMetrics: SalesMetricsService,
        private readonly customerMetrics: CustomerMetricsService,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue,
        private readonly logger: PinoLogger
    ) {
        this.logger.setContext(MonthlyReportScheduleWorker.name);
    }

    // Fires at 00:00 UTC on the 1st of each month — reports cover the
    // calendar month that just ended.
    @Cron('0 0 1 * *')
    async sendMonthlyStoreReport(): Promise<void> {
        try {
            const now = new Date();
            const periodEnd = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
            );
            const periodStart = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
            );
            // Previous calendar month — only consumed by getTopCategories /
            // getPaymentMix to satisfy the PeriodRange type (they read .from/.to).
            const prevPeriodStart = new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)
            );
            const range = {
                from: periodStart,
                to: periodEnd,
                prevFrom: prevPeriodStart,
                prevTo: periodStart,
                bucket: 'month' as const,
            };

            const [
                { revenue, orderCount: totalOrders },
                avgOrderValue,
                fulfillmentRate,
                newCustomers,
                topCategories,
                paymentMix,
            ] = await Promise.all([
                this.salesMetrics.aggregateRevenueAndCount(
                    periodStart,
                    periodEnd
                ),
                this.salesMetrics.getAvgOrderValue(periodStart, periodEnd),
                this.salesMetrics.getFulfillmentRate(periodStart, periodEnd),
                this.customerMetrics.countNewCustomers(periodStart, periodEnd),
                this.salesMetrics.getTopCategories(range, 1),
                this.salesMetrics.getPaymentMix(range),
            ]);

            const totalRevenueFormatted = formatUsd(Number(revenue));
            const avgOrderValueFormatted = formatUsd(Number(avgOrderValue));
            const fulfillmentRateFormatted = `${fulfillmentRate.toFixed(2)}%`;

            const topCategory = topCategories.items[0];
            const topCategoryName = topCategory?.name ?? EMPTY_VALUE;
            const topCategoryRevenue = topCategory
                ? formatUsd(Number(topCategory.revenue))
                : EMPTY_VALUE;
            const topPaymentMethod = paymentMix.items[0]?.name ?? EMPTY_VALUE;

            const reportMonth = periodStart.toLocaleString('en-US', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
            });

            const recipients = await this.databaseService.user.findMany({
                where: {
                    role: { in: REPORT_RECIPIENT_ROLES },
                    deletedAt: null,
                    isBanned: false,
                },
                select: { id: true, email: true },
            });

            if (recipients.length === 0) {
                this.logger.warn(
                    { reportMonth },
                    'No admin recipients found for monthly store report'
                );
                return;
            }

            for (const recipient of recipients) {
                if (!recipient.email) continue;
                this.emailQueue.add(EMAIL_TEMPLATES.MONTHLY_STORE_REPORT, {
                    data: {
                        report_month: reportMonth,
                        total_orders: totalOrders,
                        total_revenue: totalRevenueFormatted,
                        avg_order_value: avgOrderValueFormatted,
                        new_customers: newCustomers,
                        fulfillment_rate: fulfillmentRateFormatted,
                        top_category: topCategoryName,
                        top_category_revenue: topCategoryRevenue,
                        top_payment_method: topPaymentMethod,
                    },
                    toEmails: [recipient.email],
                } as ISendEmailBasePayload<IMonthlyStoreReportPayload>);
            }

            this.logger.info(
                {
                    reportMonth,
                    totalOrders,
                    totalRevenue: totalRevenueFormatted,
                    recipients: recipients.length,
                },
                'Monthly store report queued'
            );
        } catch (error) {
            this.logger.error(
                { error: error?.message },
                'Failed to dispatch monthly store report'
            );
        }
    }
}
