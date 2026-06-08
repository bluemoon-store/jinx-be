import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

/** Admin panel login (step 2) — verify the emailed 6-digit code. */
export class AdminVerifyOtpDto {
    @ApiProperty({
        description: 'Short-lived JWT returned from POST /auth/admin/login',
    })
    @IsString()
    @IsNotEmpty()
    public challengeToken: string;

    @ApiProperty({
        example: '123456',
        description: '6-digit code emailed to the admin',
    })
    @IsString()
    @IsNotEmpty()
    @Length(6, 6)
    @Matches(/^\d{6}$/)
    public code: string;
}
