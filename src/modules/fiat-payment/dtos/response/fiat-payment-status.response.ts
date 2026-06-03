import { ApiProperty } from '@nestjs/swagger';
import { FiatPaymentStatus, OrderStatus, PaymentGateway } from '@prisma/client';
import { Expose } from 'class-transformer';

export class FiatPaymentStatusResponseDto {
    @ApiProperty({ description: 'Fiat payment ID' })
    @Expose()
    paymentId: string;

    @ApiProperty({ description: 'Order ID' })
    @Expose()
    orderId: string;

    @ApiProperty({ description: 'Payment gateway', enum: PaymentGateway })
    @Expose()
    gateway: PaymentGateway;

    @ApiProperty({ description: 'Payment status', enum: FiatPaymentStatus })
    @Expose()
    status: FiatPaymentStatus;

    @ApiProperty({ description: 'Related order status', enum: OrderStatus })
    @Expose()
    orderStatus: OrderStatus;

    @ApiProperty({ description: 'Time remaining in seconds' })
    @Expose()
    timeRemaining: number;

    @ApiProperty({ description: 'Whether the checkout window has expired' })
    @Expose()
    isExpired: boolean;

    @ApiProperty({ description: 'When the payment was confirmed (if paid)' })
    @Expose()
    paidAt?: Date;

    @ApiProperty({ description: 'Payment expiration time' })
    @Expose()
    expiresAt: Date;
}
