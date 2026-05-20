import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { Expose, Type } from 'class-transformer';
import {
    IsString,
    IsUUID,
    IsArray,
    ValidateNested,
    IsOptional,
} from 'class-validator';

export class OrderItemDeliveryContentDto {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    itemId: string;

    @ApiPropertyOptional({
        example: faker.string.uuid(),
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsUUID()
    productId?: string | null;

    @ApiPropertyOptional({
        example: faker.string.uuid(),
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsUUID()
    variantId?: string | null;

    @ApiProperty({
        example: faker.commerce.productName(),
    })
    @Expose()
    @IsString()
    productName: string;

    @ApiProperty({
        example: 'Your product key: ABC123XYZ',
    })
    @Expose()
    @IsString()
    content: string;

    @ApiPropertyOptional({
        example: 'https://example.com/download/file.zip',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    downloadLink?: string | null;

    @ApiProperty({
        example: faker.date.recent().toISOString(),
    })
    @Expose()
    @IsString()
    deliveredAt: string;

    @ApiPropertyOptional({
        example: faker.date.recent().toISOString(),
        nullable: true,
        description:
            'When the buyer first fetched this delivery payload; null until then.',
    })
    @Expose()
    @IsOptional()
    @IsString()
    firstViewedAt?: string | null;
}

export class OrderDeliveryResponseDto {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    orderId: string;

    @ApiProperty({
        example: 'ORD-20260130-ABC12',
    })
    @Expose()
    @IsString()
    orderNumber: string;

    @ApiProperty({
        type: [OrderItemDeliveryContentDto],
    })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OrderItemDeliveryContentDto)
    items: OrderItemDeliveryContentDto[];
}
