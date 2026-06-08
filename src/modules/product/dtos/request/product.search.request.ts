import { ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { Type } from 'class-transformer';
import {
    IsOptional,
    IsString,
    IsUUID,
    IsBoolean,
    Min,
    IsNumber,
    IsEnum,
} from 'class-validator';
import { ProductType } from '@prisma/client';
import { BasePrismaQueryDto } from 'src/common/helper/dtos/query.dto';

export class ProductSearchDto extends BasePrismaQueryDto {
    @ApiPropertyOptional({
        example: faker.commerce.productName(),
        description: 'Search query for product name or description',
    })
    @IsOptional()
    @IsString()
    searchQuery?: string;

    @ApiPropertyOptional({
        example: faker.string.uuid(),
        description: 'Filter by category ID',
    })
    @IsOptional()
    @IsUUID()
    categoryId?: string;

    @ApiPropertyOptional({
        example: true,
        description: 'Filter by active status',
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({
        description: 'Filter by category slug',
    })
    @IsOptional()
    @IsString()
    categorySlug?: string;

    @ApiPropertyOptional({
        description: 'Filter by product type',
        enum: ProductType,
    })
    @IsOptional()
    @IsEnum(ProductType)
    type?: ProductType;

    @ApiPropertyOptional({
        description: 'Hot selling products',
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isHot?: boolean;

    @ApiPropertyOptional({
        description: 'Newly launched products',
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isNew?: boolean;

    @ApiPropertyOptional({
        description: 'Freshly restocked products',
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isRestocked?: boolean;

    @ApiPropertyOptional({
        example: 0,
        description: 'Minimum price filter',
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    minPrice?: number;

    @ApiPropertyOptional({
        example: 1000,
        description: 'Maximum price filter',
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    maxPrice?: number;

    @ApiPropertyOptional({
        example: 'name',
        description: 'Field to sort by (name, price, createdAt, etc.)',
    })
    @IsOptional()
    @IsString()
    sortBy?: string;
}
