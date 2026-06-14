import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { Expose, Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsDate,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    ValidateNested,
} from 'class-validator';

export class TicketMessageUserSnapshotDto {
    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ example: faker.person.fullName() })
    @Expose()
    @IsString()
    name: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    avatar: string | null;

    @ApiProperty({ example: 'USER' })
    @Expose()
    @IsString()
    role: string;
}

export class TicketAttachmentResponseDto {
    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ example: 'https://...' })
    @Expose()
    @IsString()
    url: string;

    @ApiProperty({ example: 'screenshot.png' })
    @Expose()
    @IsString()
    fileName: string;

    @ApiProperty({ example: 'image/png' })
    @Expose()
    @IsString()
    mimeType: string;

    @ApiProperty({ example: 24530 })
    @Expose()
    @IsInt()
    size: number;

    @ApiProperty({ example: faker.date.recent().toISOString() })
    @Expose()
    @IsDate()
    createdAt: Date;
}

export class TicketMessageResponseDto {
    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    ticketId: string;

    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    userId: string;

    @ApiProperty({ example: 'Hello, welcome to Jinx Support how may I help?' })
    @Expose()
    @IsString()
    message: string;

    @ApiProperty({ example: false })
    @Expose()
    @IsBoolean()
    isStaff: boolean;

    @ApiProperty({ example: faker.date.recent().toISOString() })
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty({ example: faker.date.recent().toISOString() })
    @Expose()
    @IsDate()
    updatedAt: Date;

    @ApiPropertyOptional({ type: TicketMessageUserSnapshotDto })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => TicketMessageUserSnapshotDto)
    user?: TicketMessageUserSnapshotDto;

    @ApiPropertyOptional({ type: [TicketAttachmentResponseDto] })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TicketAttachmentResponseDto)
    attachments?: TicketAttachmentResponseDto[];
}
