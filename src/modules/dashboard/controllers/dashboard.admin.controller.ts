import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiProduces,
    ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { REVENUE_VIEW_ROLES } from 'src/common/request/constants/roles.constant';
import { AllowedRoles } from 'src/common/request/decorators/request.role.decorator';
import { QueryTransformPipe } from 'src/common/request/pipes/query-transform.pipe';
import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';

import {
    DashboardPeriodQueryDto,
    DashboardSalesQueryDto,
    DashboardTopCategoriesQueryDto,
} from '../dtos/request/dashboard-query.request.dto';
import { DashboardOrdersBreakdownResponseDto } from '../dtos/response/orders-breakdown.response.dto';
import { DashboardPaymentMixResponseDto } from '../dtos/response/payment-mix.response.dto';
import { DashboardRevenueTrendResponseDto } from '../dtos/response/revenue-trend.response.dto';
import { DashboardSalesResponseDto } from '../dtos/response/sales.response.dto';
import { DashboardSecondaryMetricsResponseDto } from '../dtos/response/secondary-metrics.response.dto';
import { DashboardSummaryResponseDto } from '../dtos/response/summary.response.dto';
import { DashboardTodayStatsResponseDto } from '../dtos/response/today-stats.response.dto';
import { DashboardTopCategoriesResponseDto } from '../dtos/response/top-categories.response.dto';
import { PeriodKey } from '../utils/period.util';
import { DashboardService } from '../services/dashboard.service';
import { DashboardReportService } from '../services/dashboard-report.service';

@ApiTags('admin.dashboard')
@Controller({
    path: '/admin/dashboard',
    version: '1',
})
export class DashboardAdminController {
    constructor(
        private readonly dashboardService: DashboardService,
        private readonly dashboardReportService: DashboardReportService
    ) {}

    @Get('report')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Export current-month dashboard report as PDF' })
    @ApiProduces('application/pdf')
    async getReport(@Res() res: Response): Promise<void> {
        const buffer = await this.dashboardReportService.generateMonthlyReport(
            new Date()
        );
        const month = new Date().toISOString().slice(0, 7); // YYYY-MM
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="dashboard-report-${month}.pdf"`
        );
        res.end(buffer);
    }

    @Get('summary')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Dashboard lifetime KPI summary' })
    @DocResponse({
        serialization: DashboardSummaryResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.summary',
    })
    getSummary(): Promise<DashboardSummaryResponseDto> {
        return this.dashboardService.getSummary();
    }

    @Get('secondary-metrics')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Dashboard secondary KPI metrics for a period' })
    @DocResponse({
        serialization: DashboardSecondaryMetricsResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.secondaryMetrics',
    })
    getSecondaryMetrics(
        @Query(new QueryTransformPipe()) query: DashboardPeriodQueryDto
    ): Promise<DashboardSecondaryMetricsResponseDto> {
        return this.dashboardService.getSecondaryMetrics(
            query.period ?? PeriodKey.THIRTY_DAYS
        );
    }

    @Get('sales')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Revenue and order count time series' })
    @DocResponse({
        serialization: DashboardSalesResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.sales',
    })
    getSales(
        @Query(new QueryTransformPipe()) query: DashboardSalesQueryDto
    ): Promise<DashboardSalesResponseDto> {
        const { from, to, granularity } =
            this.dashboardService.resolveSalesRange(
                query.from,
                query.to,
                query.granularity
            );
        return this.dashboardService.getSales(from, to, granularity);
    }

    @Get('revenue-trend')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Revenue trend vs previous period' })
    @DocResponse({
        serialization: DashboardRevenueTrendResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.revenueTrend',
    })
    getRevenueTrend(
        @Query(new QueryTransformPipe()) query: DashboardPeriodQueryDto
    ): Promise<DashboardRevenueTrendResponseDto> {
        return this.dashboardService.getRevenueTrend(
            query.period ?? PeriodKey.THIRTY_DAYS
        );
    }

    @Get('orders-breakdown')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'New vs returning customer orders by bucket' })
    @DocResponse({
        serialization: DashboardOrdersBreakdownResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.ordersBreakdown',
    })
    getOrdersBreakdown(
        @Query(new QueryTransformPipe()) query: DashboardPeriodQueryDto
    ): Promise<DashboardOrdersBreakdownResponseDto> {
        return this.dashboardService.getOrdersBreakdown(
            query.period ?? PeriodKey.THIRTY_DAYS
        );
    }

    @Get('payment-mix')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Payment mix by cryptocurrency' })
    @DocResponse({
        serialization: DashboardPaymentMixResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.paymentMix',
    })
    getPaymentMix(
        @Query(new QueryTransformPipe()) query: DashboardPeriodQueryDto
    ): Promise<DashboardPaymentMixResponseDto> {
        return this.dashboardService.getPaymentMix(
            query.period ?? PeriodKey.THIRTY_DAYS
        );
    }

    @Get('top-categories')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Top product categories by revenue' })
    @DocResponse({
        serialization: DashboardTopCategoriesResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.topCategories',
    })
    getTopCategories(
        @Query(new QueryTransformPipe()) query: DashboardTopCategoriesQueryDto
    ): Promise<DashboardTopCategoriesResponseDto> {
        return this.dashboardService.getTopCategories(
            query.period ?? PeriodKey.THIRTY_DAYS,
            query.limit ?? 5
        );
    }

    @Get('today-stats')
    @AllowedRoles(REVENUE_VIEW_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Today vs yesterday dashboard stats' })
    @DocResponse({
        serialization: DashboardTodayStatsResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'dashboard.success.todayStats',
    })
    getTodayStats(): Promise<DashboardTodayStatsResponseDto> {
        return this.dashboardService.getTodayStats();
    }
}
