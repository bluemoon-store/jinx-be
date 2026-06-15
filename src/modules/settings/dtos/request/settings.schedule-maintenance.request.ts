import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsISO8601,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';

export class SettingsScheduleMaintenanceRequestDto {
    @ApiProperty({
        description: 'ISO date of the maintenance window (YYYY-MM-DD)',
        example: '2026-06-12',
    })
    @IsISO8601({ strict: true })
    date: string;

    @ApiProperty({
        description: 'Maintenance start time in 24-hour HH:mm (UTC)',
        example: '02:00',
    })
    @IsString()
    @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
        message: 'settings.error.invalidMaintenanceTime',
    })
    startTime: string;

    @ApiProperty({
        description: 'Maintenance end time in 24-hour HH:mm (UTC)',
        example: '04:30',
    })
    @IsString()
    @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
        message: 'settings.error.invalidMaintenanceTime',
    })
    endTime: string;

    @ApiPropertyOptional({
        description:
            'Custom email subject. Falls back to the default maintenance subject when omitted.',
        example: 'Scheduled maintenance notice',
    })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    subject?: string;

    @ApiPropertyOptional({
        description:
            'Custom email title (heading). Falls back to the default when omitted.',
        example: 'Scheduled Maintenance',
    })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    title?: string;

    @ApiPropertyOptional({
        description:
            'Intro paragraph shown under the title. Newlines are rendered as line breaks. Falls back to the default when omitted.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    intro?: string;

    @ApiPropertyOptional({
        description:
            'Impact note describing what is affected during the window. Falls back to the default when omitted.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(600)
    impactNote?: string;

    @ApiPropertyOptional({
        description:
            'Closing apology / appreciation note. Falls back to the default when omitted.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(600)
    apologyNote?: string;
}
