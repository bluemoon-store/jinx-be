import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class AcceptInvitationRequestDto {
    @ApiProperty({
        example: '550e8400-e29b-41d4-a716-446655440000',
        required: true,
    })
    @IsString()
    @IsNotEmpty()
    @MinLength(36)
    public token: string;

    @ApiProperty({ example: 'NewStr0ng!Pass', required: true })
    @IsString()
    @IsNotEmpty()
    @Matches(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
        {
            message:
                'Password must contain at least 8 characters, including uppercase, lowercase, number, and special character',
        }
    )
    public password: string;
}
