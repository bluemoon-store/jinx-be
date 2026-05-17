import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

import { KpiCardResponseDto } from './kpi-card.response.dto';

export class DashboardSecondaryMetricsResponseDto {
    @ApiProperty({ type: KpiCardResponseDto })
    @Expose()
    @ValidateNested()
    @Type(() => KpiCardResponseDto)
    avgOrderValue: KpiCardResponseDto;

    @ApiProperty({ type: KpiCardResponseDto })
    @Expose()
    @ValidateNested()
    @Type(() => KpiCardResponseDto)
    newCustomers: KpiCardResponseDto;

    @ApiProperty({ type: KpiCardResponseDto })
    @Expose()
    @ValidateNested()
    @Type(() => KpiCardResponseDto)
    fulfillmentRate: KpiCardResponseDto;
}
