import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsString, Length } from 'class-validator';

import { ADMIN_ROLES } from 'src/common/request/constants/roles.constant';

export class TeamInviteRequestDto {
    @ApiProperty({ example: 'member@jinx.to' })
    @IsEmail()
    @Transform(({ value }) => value?.toLowerCase().trim())
    public email: string;

    @ApiProperty({ enum: Role, example: Role.OWNER })
    @IsIn(ADMIN_ROLES)
    public role: Role;

    @ApiProperty({ example: 'John Team' })
    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    )
    public name: string;
}
