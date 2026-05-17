import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';

export class DashboardPaymentMixItemResponseDto {
    @ApiProperty({ example: 'BTC' })
    @Expose()
    @IsString()
    name: string;

    @ApiProperty()
    @Expose()
    @IsInt()
    value: number;
}

export class DashboardPaymentMixResponseDto {
    @ApiProperty({ type: [DashboardPaymentMixItemResponseDto] })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DashboardPaymentMixItemResponseDto)
    items: DashboardPaymentMixItemResponseDto[];
}
