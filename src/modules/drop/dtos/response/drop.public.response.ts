import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsDate,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    ValidateNested,
} from 'class-validator';

export class DropPublicProductImageDto {
    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    url: string | null;

    @ApiProperty()
    @Expose()
    @IsBoolean()
    isPrimary: boolean;
}

export class DropPublicProductDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty()
    @Expose()
    @IsString()
    name: string;

    @ApiProperty()
    @Expose()
    @IsString()
    slug: string;

    @ApiProperty({ type: [DropPublicProductImageDto] })
    @Expose()
    @Type(() => DropPublicProductImageDto)
    @IsArray()
    @ValidateNested({ each: true })
    images: DropPublicProductImageDto[];
}

export class DropPublicVariantDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty()
    @Expose()
    @IsString()
    label: string;
}

export class DropPublicResponseDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ type: () => DropPublicProductDto })
    @Expose()
    @Type(() => DropPublicProductDto)
    @ValidateNested()
    product: DropPublicProductDto;

    @ApiProperty({ type: () => DropPublicVariantDto })
    @Expose()
    @Type(() => DropPublicVariantDto)
    @ValidateNested()
    variant: DropPublicVariantDto;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    description?: string | null;

    @ApiProperty()
    @Expose()
    @IsInt()
    quantity: number;

    @ApiProperty()
    @Expose()
    @IsInt()
    claimedCount: number;

    @ApiProperty()
    @Expose()
    @IsBoolean()
    hasClaimed: boolean;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    expiresAt: Date | null;
}
