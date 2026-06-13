import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
    IsArray,
    IsDate,
    IsOptional,
    IsString,
    IsUUID,
    ValidateNested,
} from 'class-validator';

export class DropClaimResponseDto {
    @ApiPropertyOptional({ nullable: true, example: 'JINX-CLM-104857392' })
    @Expose()
    @IsOptional()
    @IsString()
    referenceCode: string | null;

    @ApiProperty()
    @Expose()
    @IsString()
    claimedContent: string;

    @ApiProperty()
    @Expose()
    @IsString()
    productSlug: string;

    @ApiProperty()
    @Expose()
    @IsString()
    productId: string;

    @ApiProperty()
    @Expose()
    @IsString()
    variantLabel: string;

    @ApiProperty()
    @Expose()
    @IsString()
    dashboardPath: string;
}

export class DropClaimVouchEmbedDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    id: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    imageUrl: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    caption: string | null;

    @ApiProperty()
    @Expose()
    @IsDate()
    createdAt: Date;
}

export class MyDropClaimResponseDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    claimId: string;

    @ApiPropertyOptional({ nullable: true, example: 'JINX-CLM-104857392' })
    @Expose()
    @IsOptional()
    @IsString()
    referenceCode: string | null;

    @ApiPropertyOptional({ nullable: true, example: 'JINX-DRP-512903847' })
    @Expose()
    @IsOptional()
    @IsString()
    dropReferenceCode: string | null;

    @ApiProperty()
    @Expose()
    @IsUUID()
    dropId: string;

    @ApiProperty()
    @Expose()
    @IsUUID()
    productId: string;

    @ApiProperty()
    @Expose()
    @IsUUID()
    variantId: string;

    @ApiProperty()
    @Expose()
    @IsString()
    productName: string;

    @ApiProperty()
    @Expose()
    @IsString()
    productSlug: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    productImageUrl: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    productRedeemProcess: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    productWarrantyText: string | null;

    @ApiProperty()
    @Expose()
    @IsString()
    variantLabel: string;

    @ApiProperty()
    @Expose()
    @IsString()
    variantPrice: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    description: string | null;

    @ApiProperty()
    @Expose()
    @IsString()
    claimedContent: string;

    @ApiProperty()
    @Expose()
    @IsDate()
    claimedAt: Date;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    expiresAt: Date | null;

    @ApiProperty({ type: [DropClaimVouchEmbedDto] })
    @Expose()
    @Type(() => DropClaimVouchEmbedDto)
    @IsArray()
    @ValidateNested({ each: true })
    vouches: DropClaimVouchEmbedDto[];
}
