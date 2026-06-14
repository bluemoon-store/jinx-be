import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { OrderItem, OrderStatus, Prisma } from '@prisma/client';
import { Expose, Type } from 'class-transformer';
import {
    IsString,
    IsDate,
    IsUUID,
    IsEnum,
    IsInt,
    IsOptional,
    IsArray,
    ValidateNested,
} from 'class-validator';
import { ProductResponseDto } from 'src/modules/product/dtos/response/product.response';
import { CryptoPaymentResponseDto } from 'src/modules/crypto-payment/dtos/response/crypto-payment.response';

export class OrderItemVouchDto {
    @ApiProperty()
    @Expose()
    id: string;

    @ApiProperty()
    @Expose()
    imageUrl: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    caption: string | null;

    @ApiProperty()
    @Expose()
    createdAt: Date;
}

export class OrderItemResponseDto implements OrderItem {
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
    orderId: string;

    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    productId: string;

    @ApiProperty({
        example: 2,
    })
    @Expose()
    @IsInt()
    quantity: number;

    @ApiProperty({
        example: '99.99',
    })
    @Expose()
    @Type(() => String)
    priceAtPurchase: Prisma.Decimal; // Prisma Decimal type

    @ApiPropertyOptional({
        example: null,
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsUUID()
    variantId: string | null;

    @ApiPropertyOptional({
        example: '$50 Points | Fully Unlocked',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    variantLabel: string | null;

    @ApiPropertyOptional({
        example: 'Your product key: ABC123XYZ',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    deliveredContent: string | null;

    @ApiPropertyOptional({
        example: faker.date.recent().toISOString(),
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsDate()
    deliveredAt: Date | null;

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
        type: ProductResponseDto,
    })
    @Expose()
    @IsOptional()
    @Type(() => ProductResponseDto)
    @ValidateNested()
    product?: ProductResponseDto;

    @ApiPropertyOptional({
        type: [OrderItemVouchDto],
    })
    @Expose()
    @IsOptional()
    @Type(() => OrderItemVouchDto)
    @ValidateNested({ each: true })
    vouches?: OrderItemVouchDto[];
}

export class OrderReviewEmbedDto {
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
    orderId: string;

    @ApiProperty({ example: 5 })
    @Expose()
    @IsInt()
    rating: number;

    @ApiPropertyOptional({
        example: 'Excellent seller, instant delivery.',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    comment: string | null;

    @ApiProperty({ example: faker.date.recent().toISOString() })
    @Expose()
    @IsDate()
    createdAt: Date;
}

export class OrderResponseDto {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({
        example: 'ORD-20260130-ABC12',
    })
    @Expose()
    @IsString()
    orderNumber: string;

    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    userId: string;

    @ApiPropertyOptional({
        example: false,
    })
    @Expose()
    @IsOptional()
    buyerProtection?: boolean;

    @ApiProperty({
        example: '5.00000000',
        description: 'USD fee charged for buyer protection; 0 when disabled.',
    })
    @Expose()
    @Type(() => String)
    buyerProtectionAmount: Prisma.Decimal;

    @ApiPropertyOptional({
        example: '100.00000000',
        description: 'Cart subtotal before discount (snapshot at order time).',
    })
    @Expose()
    @IsOptional()
    @Type(() => String)
    subtotalAmount?: Prisma.Decimal;

    @ApiPropertyOptional({
        example: '10.00000000',
        description: 'Discount applied from coupon (snapshot).',
    })
    @Expose()
    @IsOptional()
    @Type(() => String)
    discountAmount?: Prisma.Decimal;

    @ApiPropertyOptional({
        example: faker.string.uuid(),
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsUUID()
    couponId?: string | null;

    @ApiPropertyOptional({
        example: 'WELCOME10',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    couponCode?: string | null;

    @ApiProperty({
        enum: OrderStatus,
        example: OrderStatus.PENDING,
    })
    @Expose()
    @IsEnum(OrderStatus)
    status: OrderStatus;

    @ApiProperty({
        example: '199.98',
    })
    @Expose()
    @Type(() => String)
    totalAmount: Prisma.Decimal; // Prisma Decimal type

    @ApiProperty({
        example: 'USD',
    })
    @Expose()
    @IsString()
    currency: string;

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
        example: faker.date.recent().toISOString(),
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsDate()
    completedAt: Date | null;

    @ApiPropertyOptional({
        example: null,
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsDate()
    cancelledAt: Date | null;

    @ApiPropertyOptional({
        example: faker.date.past().toISOString(),
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsDate()
    deletedAt: Date | null;

    @ApiPropertyOptional({
        type: [OrderItemResponseDto],
    })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OrderItemResponseDto)
    items?: OrderItemResponseDto[];

    @ApiPropertyOptional({
        type: CryptoPaymentResponseDto,
        description: 'Crypto payment details (if payment method is CRYPTO)',
    })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => CryptoPaymentResponseDto)
    cryptoPayment?: CryptoPaymentResponseDto;

    @ApiPropertyOptional({
        type: OrderReviewEmbedDto,
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => OrderReviewEmbedDto)
    review?: OrderReviewEmbedDto | null;
}

export class OrderUserSnapshotDto {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    id: string;

    @ApiPropertyOptional({
        example: 'JINX-USR-738291045',
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    userNumber: string | null;

    @ApiProperty({
        example: faker.internet.email(),
    })
    @Expose()
    @IsString()
    email: string;

    @ApiProperty({
        example: faker.internet.username(),
    })
    @Expose()
    @IsString()
    userName: string;

    @ApiPropertyOptional({
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    firstName: string | null;

    @ApiPropertyOptional({
        nullable: true,
    })
    @Expose()
    @IsOptional()
    @IsString()
    lastName: string | null;
}

export class OrderDetailResponseDto extends OrderResponseDto {
    @ApiProperty({
        type: [OrderItemResponseDto],
    })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OrderItemResponseDto)
    items: OrderItemResponseDto[];

    @ApiPropertyOptional({
        type: OrderUserSnapshotDto,
    })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => OrderUserSnapshotDto)
    user?: OrderUserSnapshotDto;
}
