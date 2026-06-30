import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FiatPaymentStatus, P2PProvider, PaymentGateway } from '@prisma/client';
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
        description:
            'Hosted checkout URL to redirect the buyer to (hosted gateways only; ' +
            'empty for MANUAL_P2P — use the instruction fields instead)',
    })
    @Expose()
    checkoutUrl: string;

    @ApiPropertyOptional({
        description: 'MANUAL_P2P only: which P2P rail (Chime / Venmo)',
        enum: P2PProvider,
    })
    @Expose()
    provider?: P2PProvider;

    @ApiPropertyOptional({
        description: 'MANUAL_P2P only: destination $tag / @handle to pay',
    })
    @Expose()
    destinationTag?: string;

    @ApiPropertyOptional({
        description:
            'MANUAL_P2P only: exact note the buyer must include in the payment',
    })
    @Expose()
    requiredNote?: string;

    @ApiPropertyOptional({
        description: 'MANUAL_P2P only: base64 QR data URL for the payment',
    })
    @Expose()
    qrCode?: string;

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
