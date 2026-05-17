import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

import { KpiCardResponseDto } from './kpi-card.response.dto';

export class DashboardTodayStatsResponseDto {
    @ApiProperty({ type: KpiCardResponseDto })
    @Expose()
    @ValidateNested()
    @Type(() => KpiCardResponseDto)
    revenue: KpiCardResponseDto;

    @ApiProperty({ type: KpiCardResponseDto })
    @Expose()
    @ValidateNested()
    @Type(() => KpiCardResponseDto)
    newOrders: KpiCardResponseDto;

    @ApiProperty({ type: KpiCardResponseDto })
    @Expose()
    @ValidateNested()
    @Type(() => KpiCardResponseDto)
    avgOrderValue: KpiCardResponseDto;
}
