import { faker } from '@faker-js/faker';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
    IsEmail,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    IsDateString,
} from 'class-validator';

export class UserUpdateDto {
    @ApiProperty({
        example: faker.internet.email(),
        required: false,
    })
    @IsEmail()
    @IsOptional()
    @Transform(({ value }) => value?.toLowerCase().trim())
    email?: string;

    @ApiProperty({
        example: faker.person.fullName(),
        required: false,
    })
    @IsString()
    @IsOptional()
    @MinLength(1)
    @MaxLength(100)
    @Transform(({ value }) => value?.trim())
    name?: string;

    @ApiProperty({
        example: 'user-avatars/1234567890abcdef.jpg',
        required: false,
    })
    @IsString()
    @IsOptional()
    avatar?: string;

    @ApiProperty({
        example: faker.date.birthdate().toISOString(),
        required: false,
    })
    @IsDateString()
    @IsOptional()
    dateOfBirth?: string;
}
