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

import { DropStatus } from '../../utils/drop.util';

export class DropProductSummaryDto {
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

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    primaryImageUrl: string | null;
}

export class DropVariantSummaryDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty()
    @Expose()
    @IsString()
    label: string;

    @ApiProperty()
    @Expose()
    @IsString()
    price: string;

    @ApiProperty()
    @Expose()
    @IsInt()
    stockQuantity: number;

    @ApiProperty()
    @Expose()
    @IsBoolean()
    isActive: boolean;
}

export class DropResponseDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    id: string;

    @ApiPropertyOptional({ nullable: true, example: 'JINX-DRP-738291045' })
    @Expose()
    @IsOptional()
    @IsString()
    referenceCode: string | null;

    @ApiProperty()
    @Expose()
    @IsUUID()
    productId: string;

    @ApiProperty()
    @Expose()
    @IsUUID()
    variantId: string;

    @ApiProperty({ type: () => DropProductSummaryDto })
    @Expose()
    @Type(() => DropProductSummaryDto)
    @ValidateNested()
    product: DropProductSummaryDto;

    @ApiProperty({ type: () => DropVariantSummaryDto })
    @Expose()
    @Type(() => DropVariantSummaryDto)
    @ValidateNested()
    variant: DropVariantSummaryDto;

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

    @ApiProperty({ type: [String] })
    @Expose()
    @IsArray()
    allowedEmails: string[];

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    expiresAt: Date | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    daysRemaining: number | null;

    @ApiProperty({ enum: ['live', 'expired', 'exhausted', 'inactive'] })
    @Expose()
    status: DropStatus;

    @ApiProperty()
    @Expose()
    @IsBoolean()
    isActive: boolean;

    @ApiProperty()
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty()
    @Expose()
    @IsDate()
    updatedAt: Date;
}
