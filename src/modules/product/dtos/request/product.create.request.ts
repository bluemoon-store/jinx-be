import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { DeliveryType, ProductType } from '@prisma/client';
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

export class ProductImageDto {
    @ApiProperty({
        example: 'products/images/product-123.jpg',
        description: 'S3 key for the image',
    })
    @IsString()
    key: string;

    @ApiPropertyOptional({
        example: false,
        default: false,
        description: 'Whether this is the primary image',
    })
    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;

    @ApiPropertyOptional({
        example: 0,
        default: 0,
        description: 'Sort order for image display',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;
}

export class ProductVariantInputDto {
    @ApiProperty({ example: '$50 Points | Fully Unlocked' })
    @IsString()
    label: string;

    @ApiProperty({ example: '99.99' })
    @IsString()
    price: string;

    @ApiPropertyOptional({ example: 0, default: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    stockQuantity?: number;

    @ApiPropertyOptional({ example: true, default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ example: 0, default: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;
}

export class ProductCreateDto {
    @ApiProperty({
        example: faker.commerce.productName(),
        description:
            'Product name (can be duplicated; not required to be unique)',
    })
    @IsString()
    @MaxLength(255)
    name: string;

    @ApiPropertyOptional({
        example: faker.helpers.slugify(faker.commerce.productName()),
        description: 'URL-friendly slug (auto-generated if not provided)',
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    slug?: string;

    @ApiProperty({
        example: faker.commerce.productDescription(),
        description: 'Product description',
    })
    @IsString()
    description: string;

    @ApiProperty({
        example: '99.99',
        description: 'Product price in base currency',
    })
    @IsString()
    price: string;

    @ApiPropertyOptional({
        enum: ProductType,
        default: ProductType.STANDARD,
        description: 'Product type (STANDARD, ACCOUNT, or GIFT_CARD)',
    })
    @IsOptional()
    @IsEnum(ProductType)
    type?: ProductType;

    @ApiPropertyOptional({
        example: 100,
        default: 0,
        description: 'Stock quantity',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    stockQuantity?: number;

    @ApiPropertyOptional({
        example: true,
        default: true,
        description: 'Whether the product is active',
    })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({
        example: 0,
        default: 0,
        description: 'Display sort order (carousels)',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @ApiProperty({
        example: faker.string.uuid(),
        description: 'Category ID',
    })
    @IsUUID()
    categoryId: string;

    @ApiPropertyOptional({
        enum: DeliveryType,
        default: DeliveryType.INSTANT,
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

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    isHot?: boolean;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    isNew?: boolean;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    isNFA?: boolean;

    @ApiPropertyOptional({ default: false })
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
        default: 15,
        description:
            'Warranty period (in minutes) shown to the buyer after delivery',
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    warrantyMinutes?: number;

    @ApiPropertyOptional({
        type: [ProductImageDto],
        description: 'Product images',
    })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductImageDto)
    images?: ProductImageDto[];

    @ApiPropertyOptional({
        type: [ProductVariantInputDto],
        description: 'Purchasable variants',
    })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductVariantInputDto)
    variants?: ProductVariantInputDto[];
}
