import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GuestCheckoutDto {
    @ApiProperty({
        example: 'guest@echodzns.com',
        required: true,
    })
    // Normalize the same way login/signup do, so the find-or-create lookup
    // matches how accounts are stored (case-insensitive, whitespace-tolerant).
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value
    )
    @IsEmail()
    @IsNotEmpty()
    public email: string;

    @ApiPropertyOptional({
        description: 'Cloudflare Turnstile token (verified server-side)',
    })
    @IsString()
    @IsOptional()
    public turnstileToken?: string;
}
