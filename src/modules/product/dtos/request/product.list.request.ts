import { ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsOptional,
    IsNumber,
    IsString,
    IsBoolean,
    IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType } from '@prisma/client';

import { SortOrder } from 'src/common/helper/dtos/query.dto';

/**
 * Query parameters for listing products
 */
export class ProductListQueryDto {
    @ApiPropertyOptional({
        description: 'Page number',
        example: 1,
        type: Number,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    page?: number;

    @ApiPropertyOptional({
        description: 'Items per page',
        example: 10,
        type: Number,
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    limit?: number;

    @ApiPropertyOptional({
        description: 'Filter by category ID',
        example: 'uuid',
    })
    @IsOptional()
    @IsString()
    categoryId?: string;

    @ApiPropertyOptional({
        description: 'Filter by category slug',
        example: 'gaming-items',
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
        description: 'Filter by active status',
        example: true,
        type: Boolean,
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({
        description: 'Hot selling products',
        type: Boolean,
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isHot?: boolean;

    @ApiPropertyOptional({
        description: 'Newly launched products',
        type: Boolean,
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isNew?: boolean;

    @ApiPropertyOptional({
        description: 'Freshly restocked products',
        type: Boolean,
    })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isRestocked?: boolean;

    @ApiPropertyOptional({
        description:
            'Field to sort by (e.g. updatedAt, createdAt, name, sortOrder). When omitted, falls back to the default ordering based on the active flag filter.',
        example: 'updatedAt',
    })
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({
        description: 'Sort direction',
        enum: SortOrder,
        example: SortOrder.DESC,
    })
    @IsOptional()
    @IsEnum(SortOrder)
    sortOrder?: SortOrder;
}
