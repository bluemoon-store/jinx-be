import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { Expose, Type } from 'class-transformer';
import {
    IsArray,
    IsDate,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    ValidateNested,
} from 'class-validator';

import { TicketMessageResponseDto } from './ticket-message.response';

export class TicketUserSnapshotDto {
    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ example: faker.internet.email() })
    @Expose()
    @IsString()
    email: string;

    @ApiProperty({ example: faker.internet.username() })
    @Expose()
    @IsString()
    userName: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    firstName: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    lastName: string | null;

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

export class TicketOrderSnapshotDto {
    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ example: 'ORD-20260130-ABC12' })
    @Expose()
    @IsString()
    orderNumber: string;

    @ApiProperty({ example: 'COMPLETED' })
    @Expose()
    @IsString()
    status: string;

    @ApiPropertyOptional({
        nullable: true,
        description:
            'Latest deliveredAt across the order items (warranty clock).',
    })
    @Expose()
    @IsOptional()
    @IsDate()
    deliveredAt?: Date | null;

    @ApiPropertyOptional({
        nullable: true,
        description:
            'Earliest non-null firstViewedAt across order items — when the buyer first revealed the delivered content.',
    })
    @Expose()
    @IsOptional()
    @IsDate()
    firstViewedAt?: Date | null;
}

export class TicketResponseDto {
    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    id: string;

    @ApiProperty({ example: 'TKT-20260502-AB12C' })
    @Expose()
    @IsString()
    ticketNumber: string;

    @ApiProperty({ example: 'My order has not been delivered' })
    @Expose()
    @IsString()
    subject: string;

    @ApiProperty({ enum: TicketStatus, example: TicketStatus.OPEN })
    @Expose()
    @IsEnum(TicketStatus)
    status: TicketStatus;

    @ApiProperty({ enum: TicketPriority, example: TicketPriority.MEDIUM })
    @Expose()
    @IsEnum(TicketPriority)
    priority: TicketPriority;

    @ApiProperty({ example: faker.string.uuid() })
    @Expose()
    @IsUUID()
    userId: string;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsUUID()
    orderId: string | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsUUID()
    assignedToId: string | null;

    @ApiProperty({ example: faker.date.past().toISOString() })
    @Expose()
    @IsDate()
    createdAt: Date;

    @ApiProperty({
        example: faker.date.past().toISOString(),
        description: 'Alias of createdAt — when the ticket was opened.',
    })
    @Expose()
    @IsDate()
    openedAt: Date;

    @ApiProperty({ example: faker.date.recent().toISOString() })
    @Expose()
    @IsDate()
    updatedAt: Date;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    closedAt: Date | null;

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    lastStaffReadAt: Date | null;

    @ApiPropertyOptional({ type: TicketUserSnapshotDto })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => TicketUserSnapshotDto)
    user?: TicketUserSnapshotDto;

    @ApiPropertyOptional({ type: TicketUserSnapshotDto, nullable: true })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => TicketUserSnapshotDto)
    assignedTo?: TicketUserSnapshotDto | null;

    @ApiPropertyOptional({ type: TicketOrderSnapshotDto, nullable: true })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => TicketOrderSnapshotDto)
    order?: TicketOrderSnapshotDto | null;

    @ApiPropertyOptional({ type: TicketMessageResponseDto, nullable: true })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => TicketMessageResponseDto)
    lastMessage?: TicketMessageResponseDto | null;

    @ApiPropertyOptional({ example: 0 })
    @Expose()
    @IsOptional()
    @IsInt()
    unreadCount?: number;
}

/** Admin list row + WebSocket `ticket:list:upserted` payload (same shape as list API items). */
export class TicketListItemDto extends TicketResponseDto {}

export class TicketDetailResponseDto extends TicketResponseDto {
    @ApiProperty({ type: [TicketMessageResponseDto] })
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TicketMessageResponseDto)
    messages: TicketMessageResponseDto[];
}
