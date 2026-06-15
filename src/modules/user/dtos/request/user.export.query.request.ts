import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export enum UserExportFormat {
    CSV = 'csv',
    TXT = 'txt',
}

/**
 * Canonical, ordered set of fields that can be exported. The admin toggles a
 * subset of these in the UI; the export emits exactly the selected fields, in
 * this order. Kept here so the service can validate the incoming `fields` list
 * against a single source of truth.
 */
export const USER_EXPORT_FIELDS = [
    'userNumber',
    'name',
    'email',
    'phone',
    'isVerified',
    'role',
    'isBanned',
    'isFlagged',
    'walletBalance',
    'createdAt',
] as const;

export type UserExportField = (typeof USER_EXPORT_FIELDS)[number];

/**
 * Query parameters for exporting users (admin). Mirrors the list filters so the
 * export honours the same search/tab the admin is viewing, plus the chosen file
 * format (csv vs txt) and the selected columns. No pagination — the export
 * streams the full filtered result set (capped server-side).
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
        description:
            'Comma-separated list of columns to include. Allowed keys: ' +
            USER_EXPORT_FIELDS.join(', ') +
            '. Unknown keys are ignored; if empty, all fields are exported.',
    })
    @IsOptional()
    @IsString()
    fields?: string;

    @ApiPropertyOptional({
        description: 'File format',
        enum: UserExportFormat,
        default: UserExportFormat.CSV,
    })
    @IsOptional()
    @IsEnum(UserExportFormat)
    format?: UserExportFormat;
}
