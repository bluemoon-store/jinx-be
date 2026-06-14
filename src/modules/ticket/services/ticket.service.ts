import { forwardRef, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Prisma, Role, TicketPriority, TicketStatus } from '@prisma/client';

import { ENUM_FILE_STORE } from 'src/common/file/enums/files.enum';
import { FileService } from 'src/common/file/services/files.service';
import { DatabaseService } from 'src/common/database/services/database.service';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import {
    ADMIN_ROLES,
    isPrivilegedAdminRole,
    isSuperAdminRole,
} from 'src/common/request/constants/roles.constant';

import { TicketAttachmentPresignDto } from '../dtos/request/ticket-attachment.presign.request';
import { TicketCreateDto } from '../dtos/request/ticket.create.request';
import {
    TICKET_UNASSIGNED_FILTER,
    TicketAdminListQueryDto,
} from '../dtos/request/ticket-list-admin.request';
import { TicketListQueryDto } from '../dtos/request/ticket-list.request';
import { TicketUpdateDto } from '../dtos/request/ticket.update.request';
import { TicketPresignResponseDto } from '../dtos/response/ticket-presign.response';
import {
    TicketDetailResponseDto,
    TicketListItemDto,
    TicketResponseDto,
} from '../dtos/response/ticket.response';
import { TicketGateway } from '../gateways/ticket.gateway';
import { ITicketService } from '../interfaces/ticket.service.interface';
import {
    mapTicketDetail,
    mapTicketListItem,
    tabToStatuses,
    TicketListRow,
} from '../ticket.mapper';
import { generateTicketNumberString } from '../utils/ticket.util';

const ASSIGNABLE_ROLES: Role[] = [...ADMIN_ROLES, Role.SUPER_ADMIN];

@Injectable()
export class TicketService implements ITicketService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly paginationService: HelperPaginationService,
        @Inject(forwardRef(() => TicketGateway))
        private readonly ticketGateway: TicketGateway,
        private readonly fileService: FileService
    ) {}

    async createTicket(
        userId: string,
        data: TicketCreateDto
    ): Promise<TicketDetailResponseDto> {
        const order = await this.databaseService.order.findFirst({
            where: { orderNumber: data.orderNumber, deletedAt: null },
            include: {
                items: {
                    select: {
                        deliveredAt: true,
                        product: {
                            select: { warrantyMinutes: true },
                        },
                    },
                },
            },
        });
        if (!order || order.userId !== userId) {
            throw new HttpException(
                'ticket.error.orderMismatch',
                HttpStatus.BAD_REQUEST
            );
        }

        const deliveredAts = order.items
            .map(i => i.deliveredAt)
            .filter((d): d is Date => d !== null);
        if (deliveredAts.length === 0) {
            throw new HttpException(
                'ticket.error.orderNotDelivered',
                HttpStatus.BAD_REQUEST
            );
        }
        const latestDeliveredAt = deliveredAts.reduce(
            (max, d) => (d > max ? d : max),
            deliveredAts[0]
        );
        const cutoffMinutes = order.items.reduce<number>(
            (min, i) => Math.min(min, i.product.warrantyMinutes),
            Number.POSITIVE_INFINITY
        );
        const effectiveCutoff = Number.isFinite(cutoffMinutes)
            ? cutoffMinutes
            : 15;
        const elapsedMs = Date.now() - latestDeliveredAt.getTime();
        if (elapsedMs > effectiveCutoff * 60 * 1000) {
            throw new HttpException(
                'Your product is out of warranty.',
                HttpStatus.BAD_REQUEST
            );
        }

        const ticketNumber = await this.generateUniqueTicketNumber();

        const created = await this.databaseService.$transaction(async tx => {
            const ticket = await tx.supportTicket.create({
                data: {
                    ticketNumber,
                    userId,
                    subject: data.subject,
                    orderId: order.id,
                    priority: data.priority ?? TicketPriority.MEDIUM,
                    status: TicketStatus.OPEN,
                    messages: {
                        create: {
                            userId,
                            message: data.message,
                            isStaff: false,
                        },
                    },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            avatar: true,
                            role: true,
                        },
                    },
                    assignedTo: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            avatar: true,
                            role: true,
                        },
                    },
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            status: true,
                            items: {
                                select: {
                                    deliveredAt: true,
                                    firstViewedAt: true,
                                },
                            },
                        },
                    },
                    messages: {
                        orderBy: { createdAt: 'asc' },
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    avatar: true,
                                    role: true,
                                    email: true,
                                },
                            },
                            attachments: true,
                        },
                    },
                },
            });

            return ticket;
        });

        const unreadCount = await this.countStaffUnread(
            created.id,
            created.lastStaffReadAt
        );

        const detail = mapTicketDetail(created, unreadCount);
        const latestMsg = created.messages[created.messages.length - 1];
        const listRow: TicketListRow = {
            ...created,
            messages: [latestMsg],
        };
        this.ticketGateway.emitTicketListUpserted(
            mapTicketListItem(listRow, unreadCount)
        );

        return detail;
    }

    async getUserTickets(
        userId: string,
        query: TicketListQueryDto
    ): Promise<ApiPaginatedDataDto<TicketResponseDto>> {
        const statuses = query.status?.length
            ? query.status
            : tabToStatuses(query.tab);

        const baseWhere: Prisma.SupportTicketWhereInput = {
            userId,
            deletedAt: null,
            ...(statuses?.length
                ? {
                      status: { in: statuses },
                  }
                : {}),
        };

        const result = await this.paginationService.paginate(
            this.databaseService.supportTicket,
            { page: query.page, limit: query.limit },
            {
                where: baseWhere,
                orderBy: { updatedAt: 'desc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            avatar: true,
                            role: true,
                        },
                    },
                    assignedTo: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            avatar: true,
                            role: true,
                        },
                    },
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            status: true,
                            items: {
                                select: {
                                    deliveredAt: true,
                                    firstViewedAt: true,
                                },
                            },
                        },
                    },
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    avatar: true,
                                    role: true,
                                    email: true,
                                },
                            },
                        },
                    },
                },
            }
        );

        const items: TicketResponseDto[] = [];
        for (const row of result.items) {
            const unreadCount = await this.countStaffUnread(
                row.id,
                row.lastStaffReadAt
            );
            items.push(mapTicketListItem(row, unreadCount));
        }

        return {
            metadata: result.metadata,
            items,
        };
    }

    async getAllTickets(
        query: TicketAdminListQueryDto
    ): Promise<ApiPaginatedDataDto<TicketResponseDto>> {
        const statuses = query.status?.length
            ? query.status
            : tabToStatuses(query.tab);

        const searchOr: Prisma.SupportTicketWhereInput[] | undefined =
            query.search?.trim()
                ? [
                      {
                          ticketNumber: {
                              contains: query.search.trim(),
                              mode: 'insensitive',
                          },
                      },
                      {
                          user: {
                              email: {
                                  contains: query.search.trim(),
                                  mode: 'insensitive',
                              },
                          },
                      },
                      {
                          order: {
                              is: {
                                  orderNumber: {
                                      contains: query.search.trim(),
                                      mode: 'insensitive',
                                  },
                              },
                          },
                      },
                  ]
                : undefined;

        const assignedToFilter: Prisma.SupportTicketWhereInput | undefined =
            query.assignedToId === TICKET_UNASSIGNED_FILTER
                ? { assignedToId: null }
                : query.assignedToId
                  ? { assignedToId: query.assignedToId }
                  : undefined;

        const where: Prisma.SupportTicketWhereInput = {
            deletedAt: null,
            ...(statuses?.length ? { status: { in: statuses } } : {}),
            ...assignedToFilter,
            ...(query.userId ? { userId: query.userId } : {}),
            ...(query.orderId ? { orderId: query.orderId } : {}),
            ...(searchOr?.length ? { OR: searchOr } : {}),
        };

        const result = await this.paginationService.paginate(
            this.databaseService.supportTicket,
            { page: query.page, limit: query.limit },
            {
                where,
                orderBy: { updatedAt: 'desc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            avatar: true,
                            role: true,
                        },
                    },
                    assignedTo: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            avatar: true,
                            role: true,
                        },
                    },
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                            status: true,
                            items: {
                                select: {
                                    deliveredAt: true,
                                    firstViewedAt: true,
                                },
                            },
                        },
                    },
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    avatar: true,
                                    role: true,
                                    email: true,
                                },
                            },
                        },
                    },
                },
            }
        );

        const items: TicketResponseDto[] = [];
        for (const row of result.items) {
            const unreadCount = await this.countStaffUnread(
                row.id,
                row.lastStaffReadAt
            );
            items.push(mapTicketListItem(row, unreadCount));
        }

        return {
            metadata: result.metadata,
            items,
        };
    }

    async getTicketDetail(
        ticketId: string,
        actor: { userId: string; role: Role }
    ): Promise<TicketDetailResponseDto> {
        await this.assertTicketAccess(ticketId, actor);

        const ticket = await this.databaseService.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                assignedTo: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        status: true,
                        items: {
                            select: {
                                deliveredAt: true,
                                firstViewedAt: true,
                            },
                        },
                    },
                },
            },
        });

        if (!ticket) {
            throw new HttpException(
                'ticket.error.ticketNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const messages = await this.databaseService.ticketMessage.findMany({
            where: { ticketId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                        role: true,
                        email: true,
                    },
                },
                attachments: true,
            },
        });

        const chronological = [...messages].reverse();

        const unreadCount = await this.countStaffUnread(
            ticket.id,
            ticket.lastStaffReadAt
        );

        return mapTicketDetail(
            { ...ticket, messages: chronological },
            unreadCount
        );
    }

    async updateTicket(
        ticketId: string,
        data: TicketUpdateDto,
        _actor: { userId: string; role: Role }
    ): Promise<TicketResponseDto> {
        await this.assertTicketAccess(ticketId, _actor);

        if (
            !isSuperAdminRole(_actor.role) &&
            !isPrivilegedAdminRole(_actor.role)
        ) {
            throw new HttpException(
                'ticket.error.forbidden',
                HttpStatus.FORBIDDEN
            );
        }

        if (data.assignedToId !== undefined && data.assignedToId !== null) {
            const assignee = await this.databaseService.user.findUnique({
                where: { id: data.assignedToId },
            });
            if (!assignee || !ASSIGNABLE_ROLES.includes(assignee.role)) {
                throw new HttpException(
                    'ticket.error.assigneeInvalid',
                    HttpStatus.BAD_REQUEST
                );
            }
        }

        const updateData: Prisma.SupportTicketUpdateInput = {};

        if (data.priority !== undefined) {
            updateData.priority = data.priority;
        }

        if (data.status !== undefined) {
            updateData.status = data.status;
            if (
                data.status === TicketStatus.CLOSED ||
                data.status === TicketStatus.RESOLVED ||
                data.status === TicketStatus.CANCELLED
            ) {
                updateData.closedAt = new Date();
            } else {
                updateData.closedAt = null;
            }
        }

        if (data.assignedToId !== undefined) {
            updateData.assignedToId = data.assignedToId;
        }

        await this.databaseService.supportTicket.update({
            where: { id: ticketId },
            data: updateData,
        });

        const row = await this.databaseService.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                assignedTo: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        status: true,
                        items: {
                            select: {
                                deliveredAt: true,
                                firstViewedAt: true,
                            },
                        },
                    },
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                avatar: true,
                                role: true,
                                email: true,
                            },
                        },
                    },
                },
            },
        });

        if (!row) {
            throw new HttpException(
                'ticket.error.ticketNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const unreadCount = await this.countStaffUnread(
            row.id,
            row.lastStaffReadAt
        );
        const dto = mapTicketListItem(row, unreadCount);
        this.ticketGateway.emitTicketUpdated(ticketId, dto);
        if (data.assignedToId !== undefined) {
            this.ticketGateway.emitTicketListAssigned(
                ticketId,
                row.assignedToId
            );
        }
        return dto;
    }

    async closeTicket(
        ticketId: string,
        actor: { userId: string; role: Role }
    ): Promise<TicketResponseDto> {
        return this.updateTicket(
            ticketId,
            { status: TicketStatus.CLOSED },
            actor
        );
    }

    async resolveTicketByOwner(
        ticketId: string,
        userId: string
    ): Promise<TicketResponseDto> {
        const ticket = await this.databaseService.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
        });
        if (!ticket) {
            throw new HttpException(
                'ticket.error.ticketNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (ticket.userId !== userId) {
            throw new HttpException(
                'ticket.error.forbidden',
                HttpStatus.FORBIDDEN
            );
        }
        if (
            ticket.status === TicketStatus.RESOLVED ||
            ticket.status === TicketStatus.CLOSED ||
            ticket.status === TicketStatus.CANCELLED
        ) {
            throw new HttpException(
                'ticket.error.cannotResolveClosed',
                HttpStatus.BAD_REQUEST
            );
        }

        await this.databaseService.supportTicket.update({
            where: { id: ticketId },
            data: {
                status: TicketStatus.RESOLVED,
                closedAt: new Date(),
            },
        });

        const row = await this.databaseService.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                assignedTo: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        status: true,
                        items: {
                            select: {
                                deliveredAt: true,
                                firstViewedAt: true,
                            },
                        },
                    },
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                avatar: true,
                                role: true,
                                email: true,
                            },
                        },
                    },
                },
            },
        });

        if (!row) {
            throw new HttpException(
                'ticket.error.ticketNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const unreadCount = await this.countStaffUnread(
            row.id,
            row.lastStaffReadAt
        );
        const dto = mapTicketListItem(row, unreadCount);
        this.ticketGateway.emitTicketUpdated(ticketId, dto);
        return dto;
    }

    /**
     * Idempotently move a ticket to RESOLVED when it is still active.
     * No-ops when already RESOLVED / CLOSED / CANCELLED. Safe to call
     * from service-to-service flows (order replacement / credit) where
     * the caller has already authorized the action.
     */
    async resolveIfActive(
        ticketId: string,
        tx?: Prisma.TransactionClient
    ): Promise<void> {
        const client = tx ?? this.databaseService;
        const ticket = await client.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
            select: { id: true, status: true },
        });
        if (!ticket) {
            throw new HttpException(
                'ticket.error.ticketNotFound',
                HttpStatus.NOT_FOUND
            );
        }
        if (
            ticket.status === TicketStatus.RESOLVED ||
            ticket.status === TicketStatus.CLOSED ||
            ticket.status === TicketStatus.CANCELLED
        ) {
            return;
        }

        await client.supportTicket.update({
            where: { id: ticketId },
            data: {
                status: TicketStatus.RESOLVED,
                closedAt: new Date(),
            },
        });

        // Broadcast updated list item best-effort outside the caller's tx.
        // When called inside a transaction we skip the broadcast — the
        // caller can trigger a refresh on its own success path.
        if (!tx) {
            const listDto = await this.fetchTicketListItemDto(ticketId);
            if (listDto) {
                this.ticketGateway.emitTicketUpdated(ticketId, listDto);
            }
        }
    }

    async presignAttachment(
        actor: { userId: string; role: Role },
        ticketId: string,
        dto: TicketAttachmentPresignDto
    ): Promise<TicketPresignResponseDto> {
        await this.assertTicketAccess(ticketId, actor);
        const result = await this.fileService.getPresignUrlPutObject(
            actor.userId,
            {
                fileName: dto.fileName,
                contentType: dto.contentType,
                storeType: ENUM_FILE_STORE.TICKET_ATTACHMENTS,
            }
        );
        return result;
    }

    async markRead(ticketId: string): Promise<void> {
        const existing = await this.databaseService.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
        });
        if (!existing) {
            throw new HttpException(
                'ticket.error.ticketNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const row = await this.databaseService.supportTicket.update({
            where: { id: ticketId },
            data: { lastStaffReadAt: new Date() },
        });

        this.ticketGateway.emitRead(ticketId, {
            ticketId,
            lastStaffReadAt: row.lastStaffReadAt,
        });

        const listDto = await this.fetchTicketListItemDto(ticketId);
        if (listDto) {
            this.ticketGateway.emitTicketListUpserted(listDto);
        }
    }

    private async fetchTicketListItemDto(
        ticketId: string
    ): Promise<TicketListItemDto | null> {
        const row = await this.databaseService.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                assignedTo: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        avatar: true,
                        role: true,
                    },
                },
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        status: true,
                        items: {
                            select: {
                                deliveredAt: true,
                                firstViewedAt: true,
                            },
                        },
                    },
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                avatar: true,
                                role: true,
                                email: true,
                            },
                        },
                    },
                },
            },
        });

        if (!row) {
            return null;
        }

        const unreadCount = await this.countStaffUnread(
            row.id,
            row.lastStaffReadAt
        );
        return mapTicketListItem(row, unreadCount);
    }

    private async generateUniqueTicketNumber(): Promise<string> {
        for (let i = 0; i < 8; i += 1) {
            const candidate = generateTicketNumberString();
            const exists = await this.databaseService.supportTicket.findUnique({
                where: { ticketNumber: candidate },
                select: { id: true },
            });
            if (!exists) {
                return candidate;
            }
        }
        throw new HttpException(
            'ticket.error.messageFailed',
            HttpStatus.INTERNAL_SERVER_ERROR
        );
    }

    private async countStaffUnread(
        ticketId: string,
        lastStaffReadAt: Date | null
    ): Promise<number> {
        return this.databaseService.ticketMessage.count({
            where: {
                ticketId,
                isStaff: false,
                ...(lastStaffReadAt
                    ? { createdAt: { gt: lastStaffReadAt } }
                    : {}),
            },
        });
    }

    private async assertTicketAccess(
        ticketId: string,
        actor: { userId: string; role: Role }
    ): Promise<void> {
        const ticket = await this.databaseService.supportTicket.findFirst({
            where: { id: ticketId, deletedAt: null },
            select: {
                userId: true,
                assignedToId: true,
            },
        });

        if (!ticket) {
            throw new HttpException(
                'ticket.error.ticketNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        if (isSuperAdminRole(actor.role) || isPrivilegedAdminRole(actor.role)) {
            return;
        }

        if (
            ticket.userId === actor.userId ||
            ticket.assignedToId === actor.userId
        ) {
            return;
        }

        throw new HttpException('ticket.error.forbidden', HttpStatus.FORBIDDEN);
    }
}
