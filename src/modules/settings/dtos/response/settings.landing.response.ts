import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class SettingsLandingResponseDto {
    @ApiPropertyOptional({ nullable: true })
    @Expose()
    heroTitle: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    heroSubtitle: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    hotSellingDesc: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    freshlyDesc: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    newlyDesc: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    howToDesc: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    featuresDesc: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    faqDesc: string | null;
}
