import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Admin panel login (step 1). On success an email OTP is sent; complete via /auth/admin/verify-otp. */
export class AdminLoginDto {
    @ApiProperty({
        example: 'owner@echodzns.com',
        required: true,
    })
    // Normalize to match how accounts are stored, mirroring UserLoginDto.
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
