import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import {
    DeliveryType,
    Prisma,
    Product,
    ProductImage,
    ProductType,
} from '@prisma/client';
import { Expose, Type } from 'class-transformer';
import {
    IsString,
    IsBoolean,
    IsInt,
    IsDate,
    IsOptional,
    IsUUID,
    IsEnum,
    IsArray,
    ValidateNested,
} from 'class-validator';
import { CategoryResponseDto } from './category.response';

export class ProductImageResponseDto implements ProductImage {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    productId: string;

    @ApiProperty({
        example: 'products/images/product-123.jpg',
    })
    @Expose()
    @IsString()
    key: string;

    @ApiPropertyOptional({
        example:
            'https://s3.amazonaws.com/bucket/products/images/product-123.jpg',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    url: string | null;

    @ApiProperty({
        example: false,
    })
    @Expose()
    @IsBoolean()
    isPrimary: boolean;

    @ApiProperty({
        example: 0,
    })
    @Expose()
    @IsInt()
    sortOrder: number;

    @ApiProperty({
        example: faker.date.past().toISOString(),
    })
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty({
        example: faker.date.recent().toISOString(),
    })
    @Expose()
    @IsDate()
    updatedAt: Date;

    @ApiPropertyOptional({
        example: null,
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsDate()
    deletedAt: Date | null;
}

export class ProductVariantResponseDto {
    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    productId: string;

    @ApiProperty({ example: '$50 Points | Fully Unlocked' })
    @Expose()
    @IsString()
    label: string;

    @ApiProperty({ example: '99.99' })
    @Expose()
    @Type(() => String)
    price: Prisma.Decimal;

    @ApiProperty({ example: 10 })
    @Expose()
    @IsInt()
    stockQuantity: number;

    @ApiProperty({ example: true })
    @Expose()
    @IsBoolean()
    isActive: boolean;

    @ApiProperty({ example: 0 })
    @Expose()
    @IsInt()
    sortOrder: number;

    @ApiProperty({ example: 42 })
    @Expose()
    @IsInt()
    soldCount: number;

    @ApiPropertyOptional({ example: null, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    deletedAt: Date | null;
}

export class ProductResponseDto implements Product {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    id: string;

    @ApiPropertyOptional({
        nullable: true,
        example: 'JINX-PRD-690218374',
    })
    @Expose()
    @IsOptional()
    @IsString()
    referenceCode: string | null;

    @ApiProperty({
        example: faker.commerce.productName(),
    })
    @Expose()
    @IsString()
    name: string;

    @ApiProperty({
        example: faker.helpers.slugify(faker.commerce.productName()),
    })
    @Expose()
    @IsString()
    slug: string;

    @ApiProperty({
        example: faker.commerce.productDescription(),
    })
    @Expose()
    @IsString()
    description: string;

    @ApiProperty({
        example: '99.99',
    })
    @Expose()
    @Type(() => String)
    price: Prisma.Decimal;

    @ApiProperty({
        enum: ProductType,
        example: ProductType.STANDARD,
    })
    @Expose()
    @IsEnum(ProductType)
    type: ProductType;

    @ApiProperty({
        example: 100,
    })
    @Expose()
    @IsInt()
    stockQuantity: number;

    @ApiProperty({
        example: true,
    })
    @Expose()
    @IsBoolean()
    isActive: boolean;

    @ApiProperty({ example: 0 })
    @Expose()
    @IsInt()
    sortOrder: number;

    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    categoryId: string;

    @ApiProperty({
        enum: DeliveryType,
        example: DeliveryType.INSTANT,
    })
    @Expose()
    @IsEnum(DeliveryType)
    deliveryType: DeliveryType;

    @ApiPropertyOptional({
        example: 'Your product key: ABC123XYZ',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    deliveryContent: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    shortNotice: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    flair: string | null;

    @ApiProperty({ example: false })
    @Expose()
    @IsBoolean()
    isHot: boolean;

    @ApiProperty({ example: false })
    @Expose()
    @IsBoolean()
    isNew: boolean;

    @ApiProperty({ example: false })
    @Expose()
    @IsBoolean()
    isNFA: boolean;

    @ApiProperty({ example: false })
    @Expose()
    @IsBoolean()
    isRestocked: boolean;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    launchedAt: Date | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    restockedAt: Date | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    countryOfOrigin: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    redeemProcess: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    warrantyText: string | null;

    @ApiProperty({
        example: 15,
        description:
            'Warranty period in minutes (after delivery) — used by the FE to render a countdown.',
    })
    @Expose()
    @IsInt()
    warrantyMinutes: number;

    @ApiProperty({
        example: faker.date.past().toISOString(),
    })
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty({
        example: faker.date.recent().toISOString(),
    })
    @Expose()
    @IsDate()
    updatedAt: Date;

    @ApiPropertyOptional({
        example: null,
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsDate()
    deletedAt: Date | null;

    @ApiPropertyOptional({
        nullable: true,
        description: 'ID of the user who created the product',
    })
    @Expose()
    @IsOptional()
    @IsString()
    createdById: string | null;

    @ApiPropertyOptional({
        type: CategoryResponseDto,
    })
    @Expose()
    @IsOptional()
    @Type(() => CategoryResponseDto)
    @ValidateNested()
    category?: CategoryResponseDto;

    @ApiPropertyOptional({
        type: [ProductImageResponseDto],
    })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductImageResponseDto)
    images?: ProductImageResponseDto[];

    @ApiPropertyOptional({
        type: [ProductVariantResponseDto],
    })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductVariantResponseDto)
    variants?: ProductVariantResponseDto[];
}

export class ProductListResponseDto extends ProductResponseDto {
    @ApiPropertyOptional({
        type: CategoryResponseDto,
    })
    @Expose()
    @IsOptional()
    @Type(() => CategoryResponseDto)
    @ValidateNested()
    category?: CategoryResponseDto;

    @ApiPropertyOptional({
        type: [ProductImageResponseDto],
    })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductImageResponseDto)
    images?: ProductImageResponseDto[];

    @ApiPropertyOptional({
        description: 'Primary image URL for cards',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    primaryImageUrl: string | null;

    @ApiProperty({
        description: 'Minimum active variant price, or base product price',
        example: '49.99000000',
    })
    @Expose()
    @IsString()
    fromPrice: string;

    @ApiProperty({
        description: 'Display tags derived from flags',
        example: ['Hot', 'New'],
        type: [String],
    })
    @Expose()
    @IsArray()
    @IsString({ each: true })
    tags: string[];

    @ApiPropertyOptional({
        description: 'Display name of the user who created the product',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    createdByName?: string | null;
}

export class ProductDetailResponseDto extends ProductListResponseDto {
    @ApiPropertyOptional({
        description: 'Hero image (same as primary for now)',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    heroImageUrl: string | null;

    @ApiPropertyOptional({
        type: [ProductVariantResponseDto],
    })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductVariantResponseDto)
    variants?: ProductVariantResponseDto[];

    @ApiPropertyOptional({
        type: [ProductListResponseDto],
    })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProductListResponseDto)
    related?: ProductListResponseDto[];
}
