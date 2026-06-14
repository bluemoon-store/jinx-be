import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsUrl } from 'class-validator';
import { PaymentGateway } from '@prisma/client';

export class CreateFiatPaymentDto {
    @ApiProperty({
        description: 'Fiat payment gateway to use',
        enum: PaymentGateway,
        example: PaymentGateway.CHIME,
    })
    @IsEnum(PaymentGateway)
    @IsNotEmpty()
    gateway: PaymentGateway;

    @ApiPropertyOptional({
        description:
            'URL the gateway redirects the buyer back to after payment',
        example: 'https://app.example.com/checkout?step=3&orderId=...&pm=card',
    })
    @IsOptional()
    @IsUrl({ require_tld: false })
    returnUrl?: string;

    @ApiPropertyOptional({
        description:
            'Storefront method variant. Both ride the CHIME hosted checkout, ' +
            'but map to distinct admin toggles (card -> CHIME, cashapp -> CASHAPP).',
        enum: ['card', 'cashapp'],
        example: 'card',
    })
    @IsOptional()
    @IsIn(['card', 'cashapp'])
    method?: 'card' | 'cashapp';
}
