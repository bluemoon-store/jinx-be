import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class SettingsPaymentCryptoResponseDto {
    @ApiProperty({ example: 'BTC' })
    @Expose()
    code: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    address: string | null;

    @ApiProperty()
    @Expose()
    enabled: boolean;
}

export class SettingsPaymentGatewayResponseDto {
    @ApiProperty({ example: 'CHIME' })
    @Expose()
    code: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    apiKey: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    apiSecret: string | null;

    @ApiPropertyOptional({
        nullable: true,
        description: 'Destination $tag / @handle for P2P rails (Chime/Venmo).',
    })
    @Expose()
    tag: string | null;

    @ApiProperty()
    @Expose()
    enabled: boolean;
}

export class SettingsPaymentResponseDto {
    @ApiProperty({ type: [SettingsPaymentCryptoResponseDto] })
    @Expose()
    @Type(() => SettingsPaymentCryptoResponseDto)
    cryptocurrencies: SettingsPaymentCryptoResponseDto[];

    @ApiProperty({ type: [SettingsPaymentGatewayResponseDto] })
    @Expose()
    @Type(() => SettingsPaymentGatewayResponseDto)
    gateways: SettingsPaymentGatewayResponseDto[];

    @ApiPropertyOptional({
        nullable: true,
        description:
            'Admin-configured USD price of one Telegram Star (null = use env default).',
        example: 0.013,
    })
    @Expose()
    telegramStarUsdRate: number | null;
}
