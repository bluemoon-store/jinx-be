import { ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { DeliveryType } from '@prisma/client';
import {
    IsString,
    IsUUID,
    IsOptional,
    IsBoolean,
    IsInt,
    Min,
    MaxLength,
    IsEnum,
    IsArray,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductVariantInputDto } from './product.create.request';

export class ProductVariantUpdateInputDto extends ProductVariantInputDto {
    @ApiPropertyOptional({
        description: 'Existing variant ID (omit to create)',
    })
    @IsOptional()
    @IsUUID()
    id?: string;
}

export class ProductUpdateDto {
    @ApiPropertyOptional({
        example: faker.commerce.productName(),
        description:
            'Product name (can be duplicated and changed; not required to be unique)',
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string;

    @ApiPropertyOptional({
        example: faker.helpers.slugify(faker.commerce.productName()),
        description: 'URL-friendly slug',
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    slug?: string;

    @ApiPropertyOptional({
        example: faker.commerce.productDescription(),
        description: 'Product description',
    })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({
        example: '99.99',
        description: 'Product price in base currency',
    })
    @IsOptional()
    @IsString()
    price?: string;

    @ApiPropertyOptional({
        example: 100,
        description: 'Stock quantity',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    stockQuantity?: number;

    @ApiPropertyOptional({
        example: true,
        description: 'Whether the product is active',
    })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({
        example: 0,
        description: 'Display sort order',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @ApiPropertyOptional({
        example: faker.string.uuid(),
        description: 'Category ID',
    })
    @IsOptional()
    @IsUUID()
    categoryId?: string;

    @ApiPropertyOptional({
        enum: DeliveryType,
        description: 'Delivery type',
    })
    @IsOptional()
    @IsEnum(DeliveryType)
    deliveryType?: DeliveryType;

    @ApiPropertyOptional({
        example: 'Your product key: ABC123XYZ',
        description: 'Content for instant delivery',
    })
    @IsOptional()
    @IsString()
    deliveryContent?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    shortNotice?: string;

    @ApiPropertyOptional({
        description: 'Short merchandising badge label (e.g. "Summer Deal")',
    })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    flair?: string;

    @ApiPropertyOptional({
        description: 'Product icon URL (used in cart and compact displays)',
    })
    @IsOptional()
    @IsString()
    iconUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isHot?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isNew?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isNFA?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isRestocked?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    launchedAt?: Date;

    @ApiPropertyOptional()
    @IsOptional()
    restockedAt?: Date;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    countryOfOrigin?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    redeemProcess?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    warrantyText?: string;

    @ApiPropertyOptional({
        example: 15,
        description:
            'Warranty period (in minutes) shown to the buyer after delivery',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    warrantyMinutes?: number;

    @ApiPropertyOptional({
        type: [ProductVariantUpdateInputDto],
        description: 'Replace/sync variants when provided',
    })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductVariantUpdateInputDto)
    variants?: ProductVariantUpdateInputDto[];

    @ApiPropertyOptional({
        type: [String],
        description: 'Related product IDs (replaces existing)',
    })
    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    relatedProductIds?: string[];
}
