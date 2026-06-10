import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UserLoginDto {
    @ApiProperty({
        example: 'nguyen@echodzns.com',
        required: true,
    })
    // Normalize to match how accounts are stored (createByAdmin lowercases + trims the email),
    // so login is case-insensitive and tolerant of stray copy/paste whitespace.
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value
    )
    @IsEmail()
    @IsNotEmpty()
    public email: string;

    @ApiProperty({
        example: '6td6lPRZVC@@!827',
        required: true,
    })
    // Trim only. Login must accept whatever password is stored — format rules belong on
    // registration/password-reset, not here. A format regex on login rejects valid stored
    // passwords (e.g. a trailing space copied from the generated-password field).
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    )
    @IsString()
    @IsNotEmpty()
    public password: string;

    @ApiPropertyOptional({
        description: 'Cloudflare Turnstile token (verified server-side)',
    })
    @IsString()
    @IsOptional()
    public turnstileToken?: string;
}
