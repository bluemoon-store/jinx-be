import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export enum UserExportScope {
    EMAILS = 'emails',
    FULL = 'full',
}

export enum UserExportFormat {
    CSV = 'csv',
    TXT = 'txt',
}

/**
 * Query parameters for exporting users (admin). Mirrors the list filters so the
 * export honours the same search/tab the admin is viewing, plus the chosen
 * scope (emails-only vs full) and file format (csv vs txt). No pagination — the
 * export streams the full filtered result set (capped server-side).
 */
export class UserExportQueryDto {
    @ApiPropertyOptional({
        description: 'Search email or name (case-insensitive)',
    })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional({ description: 'Filter by banned status' })
    @IsOptional()
    @IsBoolean()
    isBanned?: boolean;

    @ApiPropertyOptional({
        description: 'Filter by verified (non-guest) status',
    })
    @IsOptional()
    @IsBoolean()
    isVerified?: boolean;

    @ApiPropertyOptional({ description: 'Filter by flagged status' })
    @IsOptional()
    @IsBoolean()
    isFlagged?: boolean;

    @ApiPropertyOptional({
        description: 'Export scope: emails only or full user record',
        enum: UserExportScope,
        default: UserExportScope.FULL,
    })
    @IsOptional()
    @IsEnum(UserExportScope)
    scope?: UserExportScope;

    @ApiPropertyOptional({
        description: 'File format',
        enum: UserExportFormat,
        default: UserExportFormat.CSV,
    })
    @IsOptional()
    @IsEnum(UserExportFormat)
    format?: UserExportFormat;
}
