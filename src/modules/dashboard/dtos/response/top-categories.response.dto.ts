import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';

export class DashboardTopCategoryItemResponseDto {
    @ApiProperty()
    @Expose()
    @IsString()
    name: string;

    @ApiProperty({ example: '999.99' })
    @Expose()
    @IsString()
    revenue: string;
}

export class DashboardTopCategoriesResponseDto {
    @ApiProperty({ type: [DashboardTopCategoryItemResponseDto] })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DashboardTopCategoryItemResponseDto)
    items: DashboardTopCategoryItemResponseDto[];
}
