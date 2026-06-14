import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';

export class UserAdminCreateDto {
    @ApiProperty({ example: 'Jane Doe', maxLength: 100 })
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    )
    name: string;

    @ApiProperty({ example: 'jane@example.com' })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value
    )
    @IsEmail()
    email: string;

    @ApiPropertyOptional({ example: '+15551234567', maxLength: 32 })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() || undefined : value
    )
    phone?: string;

    @ApiPropertyOptional({
        description:
            'When true, sets isVerified so the user can sign in without verifying email',
    })
    @IsOptional()
    @IsBoolean()
    markVerified?: boolean;
}
