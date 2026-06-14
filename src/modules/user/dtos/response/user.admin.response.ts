import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { $Enums } from '@prisma/client';
import { Expose } from 'class-transformer';
import {
    IsBoolean,
    IsDate,
    IsEmail,
    IsEnum,
    IsOptional,
    IsString,
    IsUUID,
} from 'class-validator';

export class UserAdminListItemResponseDto {
    @ApiProperty()
    @Expose()
    @IsUUID()
    id: string;

    @ApiPropertyOptional({
        nullable: true,
        description: 'Compact display id, e.g. JINX-USR-738291045',
    })
    @Expose()
    @IsString()
    @IsOptional()
    userNumber: string | null;

    @ApiProperty()
    @Expose()
    @IsEmail()
    email: string;

    @ApiProperty()
    @Expose()
    @IsString()
    name: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsString()
    @IsOptional()
    avatar: string | null;

    @ApiProperty({ enum: $Enums.Role })
    @Expose()
    @IsEnum($Enums.Role)
    role: $Enums.Role;

    @ApiProperty()
    @Expose()
    @IsBoolean()
    isVerified: boolean;

    @ApiProperty()
    @Expose()
    @IsBoolean()
    isBanned: boolean;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsDate()
    @IsOptional()
    bannedAt: Date | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsString()
    @IsOptional()
    bannedReason: string | null;

    @ApiProperty()
    @Expose()
    @IsBoolean()
    isFlagged: boolean;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsDate()
    @IsOptional()
    flaggedAt: Date | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsString()
    @IsOptional()
    flaggedReason: string | null;

    @ApiProperty()
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty()
    @Expose()
    @IsDate()
    updatedAt: Date;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsDate()
    @IsOptional()
    deletedAt: Date | null;

    @ApiPropertyOptional({
        description: 'Wallet balance as a decimal string, or null if no wallet',
        nullable: true,
    })
    @Expose()
    @IsString()
    @IsOptional()
    walletBalance: string | null;
}

export class UserAdminStatsResponseDto {
    @ApiProperty()
    @Expose()
    total: number;

    @ApiProperty({ description: 'Users with isVerified = false' })
    @Expose()
    guests: number;

    @ApiProperty()
    @Expose()
    banned: number;

    @ApiProperty()
    @Expose()
    flagged: number;
}
