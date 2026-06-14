import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { Expose } from 'class-transformer';

export class PaymentStatusResponseDto {
    @ApiProperty({ description: 'Payment ID' })
    @Expose()
    paymentId: string;

    @ApiProperty({
        description: 'Payment status',
        enum: PaymentStatus,
    })
    @Expose()
    status: PaymentStatus;

    @ApiProperty({
        description: 'Parent order status (e.g. COMPLETED when admin approves)',
        enum: OrderStatus,
    })
    @Expose()
    orderStatus: OrderStatus;

    @ApiProperty({ description: 'Payment address' })
    @Expose()
    paymentAddress: string;

    @ApiProperty({ description: 'Expected amount' })
    amount: string;

    @ApiProperty({ description: 'Transaction hash (if detected)' })
    txHash?: string;

    @ApiProperty({ description: 'Number of confirmations' })
    @Expose()
    confirmations: number;

    @ApiProperty({ description: 'Required confirmations' })
    @Expose()
    requiredConfirmations: number;

    @ApiProperty({ description: 'Time remaining in seconds (0 if expired)' })
    @Expose()
    timeRemaining: number;

    @ApiProperty({ description: 'Whether payment has expired' })
    @Expose()
    isExpired: boolean;

    @ApiProperty({ description: 'When payment was detected' })
    @Expose()
    paidAt?: Date;

    @ApiProperty({ description: 'When payment was confirmed' })
    @Expose()
    confirmedAt?: Date;

    @ApiProperty({ description: 'Payment expiration time' })
    @Expose()
    expiresAt: Date;
}
