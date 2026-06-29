import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class SettingsBuyerProtectionEnhancedResponseDto {
    @ApiProperty()
    @Expose()
    title: string;

    @ApiProperty()
    @Expose()
    badge: string;

    @ApiProperty({ example: 'IconShieldCheck' })
    @Expose()
    icon: string;

    @ApiProperty({ enum: ['fixed', 'percent'], example: 'fixed' })
    @Expose()
    priceMode: 'fixed' | 'percent';

    @ApiProperty({ example: 5 })
    @Expose()
    priceUsd: number;

    @ApiProperty({ example: 5 })
    @Expose()
    pricePercent: number;

    @ApiProperty({ type: [String] })
    @Expose()
    benefits: string[];
}

export class SettingsBuyerProtectionBasicResponseDto {
    @ApiProperty()
    @Expose()
    title: string;

    @ApiProperty({ example: 'IconSupport' })
    @Expose()
    icon: string;

    @ApiProperty({ type: [String] })
    @Expose()
    benefits: string[];
}

export class SettingsBuyerProtectionResponseDto {
    @ApiProperty()
    @Expose()
    enabled: boolean;

    @ApiProperty()
    @Expose()
    heading: string;

    @ApiProperty()
    @Expose()
    subheading: string;

    @ApiProperty()
    @Expose()
    footerText: string;

    @ApiProperty({ type: SettingsBuyerProtectionEnhancedResponseDto })
    @Expose()
    @Type(() => SettingsBuyerProtectionEnhancedResponseDto)
    enhanced: SettingsBuyerProtectionEnhancedResponseDto;

    @ApiProperty({ type: SettingsBuyerProtectionBasicResponseDto })
    @Expose()
    @Type(() => SettingsBuyerProtectionBasicResponseDto)
    basic: SettingsBuyerProtectionBasicResponseDto;
}
