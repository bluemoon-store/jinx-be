import { faker } from '@faker-js/faker';
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

import { UserLoginDto } from './auth.login.dto';

export class UserCreateDto extends UserLoginDto {
    @ApiProperty({
        example: faker.person.fullName(),
    })
    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    )
    public name: string;
}
