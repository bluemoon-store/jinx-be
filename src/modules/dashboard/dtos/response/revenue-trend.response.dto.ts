import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsArray, IsDate, IsString, ValidateNested } from 'class-validator';

export class DashboardRevenueTrendItemResponseDto {
    @ApiProperty()
    @Expose()
    @IsDate()
    date: Date;

    @ApiProperty({ example: '500.00' })
    @Expose()
    @IsString()
    currentPeriod: string;

    @ApiProperty({ example: '450.00' })
    @Expose()
    @IsString()
    previousPeriod: string;
}

export class DashboardRevenueTrendResponseDto {
    @ApiProperty({ type: [DashboardRevenueTrendItemResponseDto] })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DashboardRevenueTrendItemResponseDto)
    items: DashboardRevenueTrendItemResponseDto[];
}
