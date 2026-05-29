import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { faker } from '@faker-js/faker';
import { Type } from 'class-transformer';
import {
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    IsUUID,
    MaxLength,
    Min,
} from 'class-validator';

export class OrderIssueCreditDto {
    @ApiProperty({
        example: 5.0,
        description:
            'USD amount to credit to the customer wallet. Must be > 0.',
    })
    @Type(() => Number)
    @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
    @IsPositive()
    @Min(0.01)
    amount: number;

    @ApiProperty({
        example: 'Goodwill credit for delayed delivery',
        description:
            'Reason shown on the wallet transaction and the ticket system message.',
    })
    @IsString()
    @MaxLength(255)
    reason: string;

    @ApiPropertyOptional({
        example: faker.string.uuid(),
        description:
            'Support ticket the credit originates from. When provided, a staff system message is appended and the ticket is moved to RESOLVED.',
    })
    @IsOptional()
    @IsUUID()
    ticketId?: string;
}
