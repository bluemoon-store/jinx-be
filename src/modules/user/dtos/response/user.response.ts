import { faker } from '@faker-js/faker';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { $Enums, User } from '@prisma/client';
import { Exclude, Expose } from 'class-transformer';
import {
    IsDate,
    IsEmail,
    IsEnum,
    IsOptional,
    IsString,
    IsUUID,
    IsBoolean,
} from 'class-validator';

export class UserResponseDto implements Partial<User> {
    @ApiProperty({
        example: faker.string.uuid(),
    })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({
        example: 'JINX-USR-738291045',
        required: false,
        nullable: true,
        description: 'Compact display id, e.g. JINX-USR-738291045',
    })
    @Expose()
    @IsString()
    @IsOptional()
    userNumber: string | null;

    @ApiProperty({
        example: faker.internet.email(),
    })
    @Expose()
    @IsEmail()
    email: string;

    @ApiProperty({
        example: faker.person.fullName(),
    })
    @Expose()
    @IsString()
    name: string;

    @ApiProperty({
        example: faker.image.avatar(),
        required: false,
        nullable: true,
    })
    @Expose()
    @IsString()
    @IsOptional()
    avatar: string | null;

    @ApiProperty({
        example: faker.phone.number(),
        required: false,
        nullable: true,
    })
    @Expose()
    @IsString()
    @IsOptional()
    phone: string | null;

    @ApiProperty({
        enum: $Enums.Role,
        example: faker.helpers.arrayElement(Object.values($Enums.Role)),
    })
    @Expose()
    @IsEnum($Enums.Role)
    role: $Enums.Role;

    @ApiProperty({
        example: faker.datatype.boolean(),
    })
    @Expose()
    @IsBoolean()
    isVerified: boolean;

    @ApiProperty({
        example: false,
        description: 'Whether TOTP two-factor authentication is enabled',
    })
    @Expose()
    @IsBoolean()
    twoFactorEnabled: boolean;

    @ApiProperty({
        example: faker.date.birthdate().toISOString(),
        required: false,
        nullable: true,
    })
    @Expose()
    @IsDate()
    @IsOptional()
    dateOfBirth: Date | null;

    @ApiProperty({
        example: faker.date.past().toISOString(),
    })
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty({
        example: faker.date.recent().toISOString(),
    })
    @Expose()
    @IsDate()
    updatedAt: Date;

    @ApiProperty({
        example: faker.date.future().toISOString(),
        required: false,
        nullable: true,
    })
    @Expose()
    @IsDate()
    @IsOptional()
    deletedAt: Date | null;

    @ApiHideProperty()
    @Exclude()
    password: string;
}

export class UserGetProfileResponseDto extends UserResponseDto {}

export class UserUpdateProfileResponseDto extends UserResponseDto {}
