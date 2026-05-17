import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsEnum,
    IsInt,
    IsISO8601,
    IsOptional,
    Max,
    Min,
} from 'class-validator';

import { PeriodKey } from '../../utils/period.util';

export enum SalesGranularity {
    DAY = 'day',
    WEEK = 'week',
    MONTH = 'month',
}

export class DashboardPeriodQueryDto {
    @ApiPropertyOptional({
        enum: PeriodKey,
        default: PeriodKey.THIRTY_DAYS,
    })
    @IsOptional()
    @IsEnum(PeriodKey)
    period?: PeriodKey = PeriodKey.THIRTY_DAYS;
}

export class DashboardSalesQueryDto {
    @ApiPropertyOptional({ description: 'Range start (ISO 8601)' })
    @IsOptional()
    @IsISO8601()
    from?: string;

    @ApiPropertyOptional({ description: 'Range end (ISO 8601)' })
    @IsOptional()
    @IsISO8601()
    to?: string;

    @ApiPropertyOptional({
        enum: SalesGranularity,
        default: SalesGranularity.WEEK,
    })
    @IsOptional()
    @IsEnum(SalesGranularity)
    granularity?: SalesGranularity = SalesGranularity.WEEK;
}

export class DashboardTopCategoriesQueryDto extends DashboardPeriodQueryDto {
    @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(20)
    limit?: number = 5;
}
