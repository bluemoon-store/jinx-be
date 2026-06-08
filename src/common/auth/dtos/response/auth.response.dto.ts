import { faker } from '@faker-js/faker';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

import { UserResponseDto } from 'src/modules/user/dtos/response/user.response';

export class TokenDto {
    @ApiProperty({
        example: faker.string.alphanumeric({ length: 64 }),
        required: true,
    })
    @Expose()
    accessToken: string;

    @ApiProperty({
        example: faker.string.alphanumeric({ length: 64 }),
        required: true,
    })
    @Expose()
    refreshToken: string;
}

export class AuthResponseDto extends TokenDto {
    @ApiProperty({
        type: () => UserResponseDto,
        required: true,
    })
    @Expose()
    @Type(() => UserResponseDto)
    @ValidateNested()
    user: UserResponseDto;
}

export class AuthRefreshResponseDto extends TokenDto {}

/** Returned from POST /auth/login when the user must complete 2FA in a second step. */
export class TwoFactorChallengeResponseDto {
    @ApiProperty({ example: true })
    @Expose()
    requiresTwoFactor = true as const;

    @ApiProperty({
        example: faker.string.alphanumeric({ length: 120 }),
        description:
            'Short-lived JWT (5m); POST to /auth/2fa/verify-login with the TOTP code.',
    })
    @Expose()
    twoFactorToken: string;
}

/** Returned from POST /auth/admin/login — an email OTP was sent; complete via /auth/admin/verify-otp. */
export class AdminLoginChallengeResponseDto {
    @ApiProperty({
        example: faker.string.alphanumeric({ length: 120 }),
        description:
            'Short-lived JWT (5m); POST to /auth/admin/verify-otp with the emailed 6-digit code.',
    })
    @Expose()
    challengeToken: string;
}

/**
 * Serializer for POST /auth/admin/login union — a full auth response (when the OTP
 * feature flag is off) OR an email-OTP challenge (when on). Used by ResponseInterceptor.
 */
export class AdminLoginResponseSerializerDto {
    @ApiPropertyOptional()
    @Expose()
    accessToken?: string;

    @ApiPropertyOptional()
    @Expose()
    refreshToken?: string;

    @ApiPropertyOptional({ type: () => UserResponseDto })
    @Expose()
    @Type(() => UserResponseDto)
    @ValidateNested()
    user?: UserResponseDto;

    @ApiPropertyOptional()
    @Expose()
    challengeToken?: string;
}

/**
 * Serializer for POST /auth/login union (full auth OR 2FA challenge) — used by ResponseInterceptor.
 */
export class LoginResponseSerializerDto {
    @ApiPropertyOptional()
    @Expose()
    accessToken?: string;

    @ApiPropertyOptional()
    @Expose()
    refreshToken?: string;

    @ApiPropertyOptional({ type: () => UserResponseDto })
    @Expose()
    @Type(() => UserResponseDto)
    @ValidateNested()
    user?: UserResponseDto;

    @ApiPropertyOptional({ example: true })
    @Expose()
    requiresTwoFactor?: boolean;

    @ApiPropertyOptional()
    @Expose()
    twoFactorToken?: string;
}

export class AuthSuccessResponseDto {
    @ApiProperty({ example: true })
    @Expose()
    success: boolean;

    @ApiProperty({ example: 'auth.success.generic' })
    @Expose()
    message: string;
}
