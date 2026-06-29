import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsNumber,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

const TEXT_MAX = 256;
const BENEFIT_MAX = 512;
const MAX_BENEFITS = 12;
const MAX_PRICE_USD = 1000;
const ICON_MAX = 64;
// CentralIcon names are PascalCase, e.g. "IconShieldCheck". Restrict to that
// shape so a stored value always renders (or cleanly falls back) on the FE.
const ICON_PATTERN = /^Icon[A-Za-z0-9]+$/;

export class SettingsUpdateBuyerProtectionEnhancedRequestDto {
    @ApiPropertyOptional({ maxLength: TEXT_MAX })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX)
    title?: string;

    @ApiPropertyOptional({ maxLength: TEXT_MAX })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX)
    badge?: string;

    @ApiPropertyOptional({ maxLength: ICON_MAX, example: 'IconShieldCheck' })
    @IsOptional()
    @IsString()
    @MaxLength(ICON_MAX)
    @Matches(ICON_PATTERN)
    icon?: string;

    @ApiPropertyOptional({ enum: ['fixed', 'percent'] })
    @IsOptional()
    @IsIn(['fixed', 'percent'])
    priceMode?: 'fixed' | 'percent';

    @ApiPropertyOptional({ minimum: 0, maximum: MAX_PRICE_USD })
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(MAX_PRICE_USD)
    priceUsd?: number;

    @ApiPropertyOptional({ minimum: 0, maximum: 100 })
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(100)
    pricePercent?: number;

    @ApiPropertyOptional({ type: [String], maxItems: MAX_BENEFITS })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_BENEFITS)
    @IsString({ each: true })
    @MaxLength(BENEFIT_MAX, { each: true })
    benefits?: string[];
}

export class SettingsUpdateBuyerProtectionBasicRequestDto {
    @ApiPropertyOptional({ maxLength: TEXT_MAX })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX)
    title?: string;

    @ApiPropertyOptional({ maxLength: ICON_MAX, example: 'IconSupport' })
    @IsOptional()
    @IsString()
    @MaxLength(ICON_MAX)
    @Matches(ICON_PATTERN)
    icon?: string;

    @ApiPropertyOptional({ type: [String], maxItems: MAX_BENEFITS })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_BENEFITS)
    @IsString({ each: true })
    @MaxLength(BENEFIT_MAX, { each: true })
    benefits?: string[];
}

export class SettingsUpdateBuyerProtectionRequestDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({ maxLength: TEXT_MAX })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX)
    heading?: string;

    @ApiPropertyOptional({ maxLength: TEXT_MAX })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX)
    subheading?: string;

    @ApiPropertyOptional({ maxLength: TEXT_MAX })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX)
    footerText?: string;

    @ApiPropertyOptional({
        type: SettingsUpdateBuyerProtectionEnhancedRequestDto,
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => SettingsUpdateBuyerProtectionEnhancedRequestDto)
    enhanced?: SettingsUpdateBuyerProtectionEnhancedRequestDto;

    @ApiPropertyOptional({ type: SettingsUpdateBuyerProtectionBasicRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => SettingsUpdateBuyerProtectionBasicRequestDto)
    basic?: SettingsUpdateBuyerProtectionBasicRequestDto;
}
