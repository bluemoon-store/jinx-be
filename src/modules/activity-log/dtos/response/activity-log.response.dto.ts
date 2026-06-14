import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ActivityLogCategory,
    ActivityLogSeverity,
    ActivityLogStatus,
    Role,
} from '@prisma/client';
import { Expose } from 'class-transformer';

export class ActivityLogResponseDto {
    @ApiProperty()
    @Expose()
    id: string;

    @ApiPropertyOptional()
    @Expose()
    actorId?: string | null;

    @ApiPropertyOptional({
        description: "Actor's compact display id, e.g. JINX-USR-738291045",
    })
    @Expose()
    actorUserNumber?: string | null;

    @ApiPropertyOptional()
    @Expose()
    actorEmail?: string | null;

    @ApiPropertyOptional()
    @Expose()
    actorName?: string | null;

    @ApiPropertyOptional({ enum: Role })
    @Expose()
    actorRole?: Role | null;

    @ApiProperty()
    @Expose()
    action: string;

    @ApiProperty({ enum: ActivityLogCategory })
    @Expose()
    category: ActivityLogCategory;

    @ApiProperty({ enum: ActivityLogSeverity })
    @Expose()
    severity: ActivityLogSeverity;

    @ApiPropertyOptional()
    @Expose()
    resourceType?: string | null;

    @ApiPropertyOptional()
    @Expose()
    resourceId?: string | null;

    @ApiPropertyOptional()
    @Expose()
    resourceLabel?: string | null;

    @ApiPropertyOptional()
    @Expose()
    before?: unknown;

    @ApiPropertyOptional()
    @Expose()
    after?: unknown;

    @ApiPropertyOptional()
    @Expose()
    metadata?: unknown;

    @ApiPropertyOptional()
    @Expose()
    ipAddress?: string | null;

    @ApiPropertyOptional()
    @Expose()
    userAgent?: string | null;

    @ApiPropertyOptional()
    @Expose()
    requestId?: string | null;

    @ApiProperty({ enum: ActivityLogStatus })
    @Expose()
    status: ActivityLogStatus;

    @ApiPropertyOptional()
    @Expose()
    errorMessage?: string | null;

    @ApiProperty()
    @Expose()
    createdAt: Date;
}

export class ActivityLogListResponseDto {
    @ApiProperty({ type: [ActivityLogResponseDto] })
    @Expose()
    items: ActivityLogResponseDto[];

    @ApiPropertyOptional({ nullable: true })
    @Expose()
    nextCursor: string | null;
}
