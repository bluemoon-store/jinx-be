import { ApiProperty } from '@nestjs/swagger';
import { FiatPaymentStatus, PaymentGateway } from '@prisma/client';
import { Expose } from 'class-transformer';

export class FiatPaymentResponseDto {
    @ApiProperty({ description: 'Fiat payment ID' })
    @Expose()
    paymentId: string;

    @ApiProperty({ description: 'Order ID' })
    @Expose()
    orderId: string;

    @ApiProperty({ description: 'Payment gateway', enum: PaymentGateway })
    @Expose()
    gateway: PaymentGateway;

    @ApiProperty({ description: 'Amount charged' })
    @Expose()
    amount: string;

    @ApiProperty({ description: 'Currency (ISO code)' })
    @Expose()
    currency: string;

    @ApiProperty({
        description: 'Hosted checkout URL to redirect the buyer to',
    })
    @Expose()
    checkoutUrl: string;

    @ApiProperty({ description: 'Payment status', enum: FiatPaymentStatus })
    @Expose()
    status: FiatPaymentStatus;

    @ApiProperty({ description: 'Payment expiration time' })
    @Expose()
    expiresAt: Date;

    @ApiProperty({ description: 'Time remaining in seconds' })
    @Expose()
    timeRemaining: number;

    @ApiProperty({ description: 'Payment creation time' })
    @Expose()
    createdAt: Date;
}
