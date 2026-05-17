import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsArray, IsDate, IsInt, ValidateNested } from 'class-validator';

export class DashboardOrdersBreakdownItemResponseDto {
    @ApiProperty()
    @Expose()
    @IsDate()
    date: Date;

    @ApiProperty()
    @Expose()
    @IsInt()
    newCustomers: number;

    @ApiProperty()
    @Expose()
    @IsInt()
    returningCustomers: number;
}

export class DashboardOrdersBreakdownResponseDto {
    @ApiProperty({ type: [DashboardOrdersBreakdownItemResponseDto] })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DashboardOrdersBreakdownItemResponseDto)
    items: DashboardOrdersBreakdownItemResponseDto[];
}
