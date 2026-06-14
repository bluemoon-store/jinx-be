import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class SettingsPaymentMethodsResponseDto {
    @ApiProperty({ type: [String], example: ['BTC', 'ETH'] })
    @Expose()
    cryptocurrencies: string[];

    @ApiProperty({ type: [String], example: ['CHIME', 'CASHAPP'] })
    @Expose()
    gateways: string[];
}
