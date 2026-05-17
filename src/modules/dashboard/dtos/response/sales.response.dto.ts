import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
    IsArray,
    IsDate,
    IsInt,
    IsString,
    ValidateNested,
} from 'class-validator';

export class DashboardSalesItemResponseDto {
    @ApiProperty()
    @Expose()
    @IsDate()
    date: Date;

    @ApiProperty({ example: '1234.56' })
    @Expose()
    @IsString()
    revenue: string;

    @ApiProperty()
    @Expose()
    @IsInt()
    orderCount: number;
}

export class DashboardSalesResponseDto {
    @ApiProperty({ type: [DashboardSalesItemResponseDto] })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DashboardSalesItemResponseDto)
    items: DashboardSalesItemResponseDto[];
}
