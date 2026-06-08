import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Resend the admin login OTP for an in-flight login challenge. */
export class AdminResendOtpDto {
    @ApiProperty({
        description: 'Short-lived JWT returned from POST /auth/admin/login',
    })
    @IsString()
    @IsNotEmpty()
    public challengeToken: string;
}
