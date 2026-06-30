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
            'Storefront method variant. cashapp/applepay/googlepay ride the ' +
            'CHIME (Polapine) hosted checkout and map to distinct admin toggles ' +
            '(cashapp -> CASHAPP, applepay -> APPLEPAY, googlepay -> GOOGLEPAY). ' +
            'chime/venmo are used with gateway MANUAL_P2P (self-hosted, ' +
            'email-reconciled) and map to CHIME_P2P / VENMO.',
        enum: ['cashapp', 'applepay', 'googlepay', 'chime', 'venmo'],
        example: 'cashapp',
    })
    @IsOptional()
    @IsIn(['cashapp', 'applepay', 'googlepay', 'chime', 'venmo'])
    method?: 'cashapp' | 'applepay' | 'googlepay' | 'chime' | 'venmo';
}
