import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsIn,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';

import {
    PAYMENT_CRYPTO_CODES,
    PAYMENT_GATEWAY_CODES,
} from '../../constants/payment-settings.constant';

export class SettingsUpdatePaymentCryptoRequestDto {
    @ApiProperty({ enum: PAYMENT_CRYPTO_CODES, example: 'BTC' })
    @IsString()
    @IsIn(PAYMENT_CRYPTO_CODES as unknown as string[])
    code: string;

    @ApiPropertyOptional({ maxLength: 256, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(256)
    address?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}

export class SettingsUpdatePaymentGatewayRequestDto {
    @ApiProperty({ enum: PAYMENT_GATEWAY_CODES, example: 'CHIME' })
    @IsString()
    @IsIn(PAYMENT_GATEWAY_CODES as unknown as string[])
    code: string;

    @ApiPropertyOptional({ maxLength: 512, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(512)
    apiKey?: string | null;

    @ApiPropertyOptional({ maxLength: 512, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(512)
    apiSecret?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}

export class SettingsUpdatePaymentRequestDto {
    @ApiPropertyOptional({ type: [SettingsUpdatePaymentCryptoRequestDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SettingsUpdatePaymentCryptoRequestDto)
    cryptocurrencies?: SettingsUpdatePaymentCryptoRequestDto[];

    @ApiPropertyOptional({ type: [SettingsUpdatePaymentGatewayRequestDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SettingsUpdatePaymentGatewayRequestDto)
    gateways?: SettingsUpdatePaymentGatewayRequestDto[];

    @ApiPropertyOptional({
        description:
            'USD price of a single Telegram Star. Used to convert an order ' +
            'total into an integer XTR amount (stars = ceil(orderUsd / rate)).',
        example: 0.013,
    })
    @IsOptional()
    @IsNumber()
    @IsPositive()
    telegramStarUsdRate?: number;
}
