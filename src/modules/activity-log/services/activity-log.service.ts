import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import {
    ActivityLogCategory,
    ActivityLogSeverity,
    Prisma,
    Role,
} from '@prisma/client';
import { Cache } from 'cache-manager';
import { Response } from 'express';
import { DatabaseService } from 'src/common/database/services/database.service';

import { IActivityLogJobPayload } from '../interfaces/activity-log-job.interface';
import {
    ActivityLogActorsQueryDto,
    ActivityLogQueryDto,
} from '../dtos/request/activity-log-query.dto';

const ACTORS_CACHE_KEY = 'activity-log:actors';
const ACTORS_TTL_MS = 60_000;
const EXPORT_ROW_CAP = 50_000;

function csvLine(values: Array<string | number | null | undefined>): string {
    return (
        values
            .map(v => {
                const s =
                    v === null || v === undefined
                        ? ''
                        : typeof v === 'string'
                          ? v
                          : String(v);
                if (/[",\n\r]/.test(s)) {
                    return `"${s.replace(/"/g, '""')}"`;
                }
                return s;
            })
            .join(',') + '\n'
    );
}

export interface ActivityLogCursorPayload {
    createdAt: string;
    id: string;
}

@Injectable()
export class ActivityLogService {
    constructor(
        private readonly databaseService: DatabaseService,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
    ) {}

    encodeCursor(row: { createdAt: Date; id: string }): string {
        const payload: ActivityLogCursorPayload = {
            createdAt: row.createdAt.toISOString(),
            id: row.id,
        };
        return Buffer.from(JSON.stringify(payload), 'utf8').toString(
            'base64url'
        );
    }

    decodeCursor(cursor: string): ActivityLogCursorPayload | null {
        try {
            const raw = Buffer.from(cursor, 'base64url').toString('utf8');
            const parsed = JSON.parse(raw) as ActivityLogCursorPayload;
            if (
                parsed &&
                typeof parsed.id === 'string' &&
                typeof parsed.createdAt === 'string'
            ) {
                return parsed;
            }
        } catch {
            return null;
        }
        return null;
    }

    async persist(payload: IActivityLogJobPayload): Promise<void> {
        await this.insertRow(payload);
    }

    async persistDirect(payload: IActivityLogJobPayload): Promise<void> {
        await this.insertRow(payload);
    }

    private async insertRow(payload: IActivityLogJobPayload): Promise<void> {
        let actorEmail: string | null = null;
        let actorName: string | null = null;
        let actorRole: Role | null = payload.actorRoleFromToken ?? null;

        if (payload.actorId) {
            const user = await this.databaseService.user.findUnique({
                where: { id: payload.actorId },
                select: {
                    email: true,
                    firstName: true,
                    lastName: true,
                    userName: true,
                    role: true,
                },
            });
            if (user) {
                actorEmail = user.email;
                const full = [user.firstName, user.lastName]
                    .filter(Boolean)
                    .join(' ')
                    .trim();
                actorName = full || user.userName;
                actorRole = user.role;
            }
        }

        await this.databaseService.activityLog.create({
            data: {
                actorId: payload.actorId ?? undefined,
                actorEmail,
                actorName,
                actorRole: actorRole ?? undefined,
                action: payload.action,
                category: payload.category,
                severity: payload.severity,
                resourceType: payload.resourceType ?? undefined,
                resourceId: payload.resourceId ?? undefined,
                resourceLabel: payload.resourceLabel ?? undefined,
                before:
                    (payload.before as unknown as Prisma.InputJsonValue) ??
                    undefined,
                after:
                    (payload.after as unknown as Prisma.InputJsonValue) ??
                    undefined,
                metadata:
                    (payload.metadata as unknown as Prisma.InputJsonValue) ??
                    undefined,
                ipAddress: payload.ipAddress ?? undefined,
                userAgent: payload.userAgent ?? undefined,
                requestId: payload.requestId ?? undefined,
                status: payload.status,
                errorMessage: payload.errorMessage ?? undefined,
            },
        });
    }

    async findMany(query: ActivityLogQueryDto) {
        const limit = Math.min(query.limit ?? 20, 100);
        const where = this.buildWhere(query);

        const cursorPayload = query.cursor
            ? this.decodeCursor(query.cursor)
            : null;

        const cursorFilter: Prisma.ActivityLogWhereInput | undefined =
            cursorPayload
                ? {
                      OR: [
                          {
                              createdAt: {
                                  lt: new Date(cursorPayload.createdAt),
                              },
                          },
                          {
                              AND: [
                                  {
                                      createdAt: new Date(
                                          cursorPayload.createdAt
                                      ),
                                  },
                                  { id: { lt: cursorPayload.id } },
                              ],
                          },
                      ],
                  }
                : undefined;

        const mergedWhere = this.mergeWhere(where, cursorFilter);

        const rows = await this.databaseService.activityLog.findMany({
            where: mergedWhere,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            include: { actor: { select: { userNumber: true } } },
        });

        const hasMore = rows.length > limit;
        const sliced = hasMore ? rows.slice(0, limit) : rows;
        const items = sliced.map(row => this.withActorUserNumber(row));
        const nextCursor =
            hasMore && items.length > 0
                ? this.encodeCursor(items[items.length - 1])
                : null;

        return { items, nextCursor };
    }

    async findById(id: string) {
        const row = await this.databaseService.activityLog.findUnique({
            where: { id },
            include: { actor: { select: { userNumber: true } } },
        });
        return row ? this.withActorUserNumber(row) : null;
    }

    /**
     * Flatten the joined actor's current `userNumber` onto the row so it can be
     * serialized as `actorUserNumber` (display-only; null if the actor was deleted).
     */
    private withActorUserNumber<
        T extends { actor?: { userNumber: string | null } | null },
    >(row: T): Omit<T, 'actor'> & { actorUserNumber: string | null } {
        const { actor, ...rest } = row;
        return { ...rest, actorUserNumber: actor?.userNumber ?? null };
    }

    async listActors(_query: ActivityLogActorsQueryDto) {
        const cached = await this.cacheManager.get<
            Array<{
                actorId: string;
                actorEmail: string | null;
                actorName: string | null;
                actorRole: Role | null;
            }>
        >(ACTORS_CACHE_KEY);
        if (cached) {
            return cached;
        }

        const rows = await this.databaseService.$queryRaw<
            Array<{
                actor_id: string;
                actor_email: string | null;
                actor_name: string | null;
                actor_role: Role | null;
            }>
        >`
      SELECT DISTINCT ON (actor_id)
        actor_id,
        actor_email,
        actor_name,
        actor_role
      FROM activity_logs
      WHERE actor_id IS NOT NULL
      ORDER BY actor_id, created_at DESC
    `;

        const mapped = this.mapActorRows(rows);
        await this.cacheManager.set(ACTORS_CACHE_KEY, mapped, ACTORS_TTL_MS);
        return mapped;
    }

    private mapActorRows(
        rows: Array<{
            actor_id: string;
            actor_email: string | null;
            actor_name: string | null;
            actor_role: Role | null;
        }>
    ) {
        return rows.map(r => ({
            actorId: r.actor_id,
            actorEmail: r.actor_email,
            actorName: r.actor_name,
            actorRole: r.actor_role,
        }));
    }

    async streamExportCsv(
        query: ActivityLogQueryDto,
        res: Response
    ): Promise<void> {
        const where = this.buildWhere(query);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="activity-logs.csv"'
        );

        const columns = [
            'id',
            'createdAt',
            'action',
            'category',
            'severity',
            'status',
            'actorEmail',
            'actorName',
            'actorRole',
            'resourceType',
            'resourceId',
            'resourceLabel',
            'requestId',
            'ipAddress',
        ];

        let cursor: { createdAt: Date; id: string } | undefined;
        let written = 0;

        res.write(csvLine(columns));

        while (written < EXPORT_ROW_CAP) {
            const batchSize = Math.min(1000, EXPORT_ROW_CAP - written);
            const cursorWhere: Prisma.ActivityLogWhereInput | undefined = cursor
                ? {
                      OR: [
                          { createdAt: { lt: cursor.createdAt } },
                          {
                              AND: [
                                  { createdAt: cursor.createdAt },
                                  { id: { lt: cursor.id } },
                              ],
                          },
                      ],
                  }
                : {};

            const mergedBatchWhere = this.mergeWhere(where, cursorWhere);

            const batch = await this.databaseService.activityLog.findMany({
                where: mergedBatchWhere,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: batchSize,
                select: {
                    id: true,
                    createdAt: true,
                    action: true,
                    category: true,
                    severity: true,
                    status: true,
                    actorEmail: true,
                    actorName: true,
                    actorRole: true,
                    resourceType: true,
                    resourceId: true,
                    resourceLabel: true,
                    requestId: true,
                    ipAddress: true,
                },
            });

            if (batch.length === 0) {
                break;
            }

            for (const row of batch) {
                res.write(
                    csvLine([
                        row.id,
                        row.createdAt.toISOString(),
                        row.action,
                        row.category,
                        row.severity,
                        row.status,
                        row.actorEmail ?? '',
                        row.actorName ?? '',
                        row.actorRole ?? '',
                        row.resourceType ?? '',
                        row.resourceId ?? '',
                        row.resourceLabel ?? '',
                        row.requestId ?? '',
                        row.ipAddress ?? '',
                    ])
                );
                written++;
                if (written >= EXPORT_ROW_CAP) {
                    break;
                }
            }

            const last = batch[batch.length - 1];
            cursor = { createdAt: last.createdAt, id: last.id };
            if (batch.length < batchSize) {
                break;
            }
        }

        res.end();
    }

    private buildWhere(
        query: ActivityLogQueryDto
    ): Prisma.ActivityLogWhereInput {
        const and: Prisma.ActivityLogWhereInput[] = [];

        if (query.actorId) {
            and.push({ actorId: query.actorId });
        }
        if (query.category) {
            and.push({ category: query.category as ActivityLogCategory });
        }
        if (query.action) {
            and.push({ action: query.action });
        }
        if (query.severity) {
            and.push({
                severity: query.severity as ActivityLogSeverity,
            });
        }
        if (query.resourceType) {
            and.push({ resourceType: query.resourceType });
        }
        if (query.resourceId) {
            and.push({ resourceId: query.resourceId });
        }

        if (query.from || query.to) {
            const range: Prisma.DateTimeFilter = {};
            if (query.from) {
                range.gte = new Date(query.from);
            }
            if (query.to) {
                range.lte = new Date(query.to);
            }
            and.push({ createdAt: range });
        }

        if (query.q?.trim()) {
            const q = query.q.trim();
            and.push({
                OR: [
                    {
                        actorEmail: {
                            contains: q,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                    {
                        actorName: {
                            contains: q,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                    {
                        resourceLabel: {
                            contains: q,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                    {
                        action: {
                            contains: q,
                            mode: Prisma.QueryMode.insensitive,
                        },
                    },
                ],
            });
        }

        return and.length ? { AND: and } : {};
    }

    private mergeWhere(
        base: Prisma.ActivityLogWhereInput,
        extra?: Prisma.ActivityLogWhereInput
    ): Prisma.ActivityLogWhereInput {
        const parts = [base, extra].filter(
            p => p && Object.keys(p as object).length > 0
        ) as Prisma.ActivityLogWhereInput[];
        if (parts.length === 0) {
            return {};
        }
        if (parts.length === 1) {
            return parts[0];
        }
        return { AND: parts };
    }
}
