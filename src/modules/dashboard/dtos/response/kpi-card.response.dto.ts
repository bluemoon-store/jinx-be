import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsString } from 'class-validator';

import { TrendDirection } from '../../utils/kpi.util';

export class KpiCardResponseDto {
    @ApiProperty({ example: '12345.67' })
    @Expose()
    @IsString()
    value: string;

    @ApiProperty({ example: 12.5 })
    @Expose()
    @IsNumber()
    deltaPct: number;

    @ApiProperty({ enum: ['up', 'down', 'flat'] })
    @Expose()
    @IsEnum(['up', 'down', 'flat'])
    trend: TrendDirection;

    @ApiProperty({ type: [Number], example: [10, 20, 15, 30, 25, 40, 35, 50] })
    @Expose()
    @IsArray()
    sparkline: number[];
}
