import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import {
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';

export class OrderIssueReplacementDto {
    @ApiProperty({
        type: [String],
        example: [faker.string.uuid()],
        description:
            'Order item IDs for which fresh stock should be re-allocated and re-delivered.',
    })
    @IsArray()
    @ArrayNotEmpty()
    @ArrayUnique()
    @IsUUID('all', { each: true })
    orderItemIds: string[];

    @ApiPropertyOptional({
        example: faker.string.uuid(),
        description:
            'Support ticket the replacement originates from. When provided, a staff system message is appended and the ticket is moved to RESOLVED.',
    })
    @IsOptional()
    @IsUUID()
    ticketId?: string;

    @ApiPropertyOptional({
        example: 'Customer reported invalid code',
        description: 'Internal note included in the ticket system message.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}
