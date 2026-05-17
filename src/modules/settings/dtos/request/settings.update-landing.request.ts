import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const TITLE_MAX = 256;
const DESC_MAX = 1024;

export class SettingsUpdateLandingRequestDto {
    @ApiPropertyOptional({ maxLength: TITLE_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(TITLE_MAX)
    heroTitle?: string | null;

    @ApiPropertyOptional({ maxLength: TITLE_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(TITLE_MAX)
    heroSubtitle?: string | null;

    @ApiPropertyOptional({ maxLength: DESC_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(DESC_MAX)
    hotSellingDesc?: string | null;

    @ApiPropertyOptional({ maxLength: DESC_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(DESC_MAX)
    freshlyDesc?: string | null;

    @ApiPropertyOptional({ maxLength: DESC_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(DESC_MAX)
    newlyDesc?: string | null;

    @ApiPropertyOptional({ maxLength: DESC_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(DESC_MAX)
    howToDesc?: string | null;

    @ApiPropertyOptional({ maxLength: DESC_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(DESC_MAX)
    featuresDesc?: string | null;

    @ApiPropertyOptional({ maxLength: DESC_MAX, nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(DESC_MAX)
    faqDesc?: string | null;
}
