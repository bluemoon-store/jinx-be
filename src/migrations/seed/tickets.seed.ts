import { Injectable } from '@nestjs/common';
import { Role, TicketPriority, TicketStatus } from '@prisma/client';
import { Command } from 'nestjs-command';
import { PinoLogger } from 'nestjs-pino';
import { DatabaseService } from 'src/common/database/services/database.service';

import { generateTicketNumberString } from 'src/modules/ticket/utils/ticket.util';

const SEED_EMAIL = 'user@jinx.to';

@Injectable()
export class TicketsSeedService {
    constructor(
        private readonly logger: PinoLogger,
        private readonly databaseService: DatabaseService
    ) {
        this.logger.setContext(TicketsSeedService.name);
    }

    @Command({
        command: 'seed:tickets',
        describe:
            'Seed ~6 support tickets with alternating messages for admin UI',
    })
    async seed(): Promise<void> {
        const existingCount = await this.databaseService.supportTicket.count();
        if (existingCount > 0) {
            this.logger.info(
                { existingCount },
                'Tickets already present; skipping seed'
            );
            return;
        }

        const user = await this.databaseService.user.findFirst({
            where: { email: SEED_EMAIL },
        });

        if (!user) {
            this.logger.warn(
                { email: SEED_EMAIL },
                'Seed user missing; run seed:users first'
            );
            return;
        }

        const staffUser =
            (await this.databaseService.user.findFirst({
                where: { role: Role.SUPER_ADMIN },
            })) ??
            (await this.databaseService.user.findFirst({
                where: { role: Role.SUPPORT },
            }));

        if (!staffUser) {
            this.logger.warn('No staff user found; skipping ticket seed');
            return;
        }

        const order = await this.databaseService.order.findFirst({
            where: { userId: user.id, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });

        const ticketDefs: Array<{
            subject: string;
            status: TicketStatus;
            priority: TicketPriority;
            assign: boolean;
            messagePairs: string[];
        }> = [
            {
                subject: 'Payment not reflecting on order',
                status: TicketStatus.OPEN,
                priority: TicketPriority.HIGH,
                assign: false,
                messagePairs: [
                    'Hi, I paid 30 minutes ago but the order still shows pending.',
                    'Thanks for reaching out — can you share your order number?',
                    'Sure, it is ORD-20260502-ABC12.',
                    'We see the payment incoming; will confirm within 10 minutes.',
                ],
            },
            {
                subject: 'Wrong denomination on gift card',
                status: TicketStatus.IN_PROGRESS,
                priority: TicketPriority.MEDIUM,
                assign: true,
                messagePairs: [
                    'I received a $50 card but ordered $100.',
                    'Sorry about that — we are reviewing your order now.',
                    'Here is a screenshot of my confirmation email.',
                    'We will issue a credit or replacement once verified.',
                    'Thank you, standing by.',
                ],
            },
            {
                subject: 'Delivery link expired',
                status: TicketStatus.WAITING_USER,
                priority: TicketPriority.MEDIUM,
                assign: true,
                messagePairs: [
                    'The download link says expired.',
                    'I generated a fresh delivery link — please try again.',
                    'Still seeing an error on my side.',
                    'Please clear cache and try in an incognito window.',
                ],
            },
            {
                subject: 'Refund request — duplicate charge',
                status: TicketStatus.RESOLVED,
                priority: TicketPriority.URGENT,
                assign: true,
                messagePairs: [
                    'I was charged twice for the same order.',
                    'We have located the duplicate settlement.',
                    'Please refund to my wallet balance.',
                    'Refund processed; both payments reconciled.',
                    'Confirmed. Thanks for the quick help.',
                ],
            },
            {
                subject: 'Account verification question',
                status: TicketStatus.CLOSED,
                priority: TicketPriority.LOW,
                assign: false,
                messagePairs: [
                    'How long does verification usually take?',
                    'Typically under 24 hours if documents are clear.',
                    'Uploaded passport yesterday.',
                    'Verified on our side — you are all set.',
                ],
            },
            {
                subject: 'General product availability',
                status: TicketStatus.OPEN,
                priority: TicketPriority.LOW,
                assign: false,
                messagePairs: [
                    'Will Southwest cards restock this week?',
                    'We expect restock mid-week; I will notify you here.',
                    'Great, please ping when live.',
                ],
            },
        ];

        for (const def of ticketDefs) {
            const ticketNumber = await this.uniqueTicketNumber();
            const closedAt =
                def.status === TicketStatus.CLOSED ||
                def.status === TicketStatus.RESOLVED ||
                def.status === TicketStatus.CANCELLED
                    ? new Date()
                    : null;

            await this.databaseService.$transaction(async tx => {
                const ticket = await tx.supportTicket.create({
                    data: {
                        ticketNumber,
                        userId: user.id,
                        orderId: order?.id,
                        subject: def.subject,
                        status: def.status,
                        priority: def.priority,
                        assignedToId:
                            def.assign && staffUser ? staffUser.id : null,
                        lastStaffReadAt:
                            def.status === TicketStatus.WAITING_USER
                                ? new Date(Date.now() - 60 * 60 * 1000)
                                : null,
                        closedAt,
                    },
                });

                for (let i = 0; i < def.messagePairs.length; i += 1) {
                    const isStaff = i % 2 === 1;
                    await tx.ticketMessage.create({
                        data: {
                            ticketId: ticket.id,
                            userId: isStaff ? staffUser.id : user.id,
                            message: def.messagePairs[i],
                            isStaff,
                        },
                    });
                }
            });
        }

        this.logger.info(
            { count: ticketDefs.length },
            'Seeded support tickets'
        );
    }

    private async uniqueTicketNumber(): Promise<string> {
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
        throw new Error('Could not generate unique ticket number');
    }
}
