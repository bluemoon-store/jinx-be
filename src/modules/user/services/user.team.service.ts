import { randomBytes, randomUUID } from 'crypto';

import { InjectQueue } from '@nestjs/bull';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { Queue } from 'bull';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { AcceptInvitationRequestDto } from 'src/common/auth/dtos/request/accept-invitation.request';
import { isSuperAdminRole } from 'src/common/request/constants/roles.constant';
import { IAuthUser } from 'src/common/request/interfaces/request.interface';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    ISendEmailBasePayload,
    IWelcomeToJinxManagementPayload,
} from 'src/common/helper/interfaces/email.interface';
import { HelperEncryptionService } from 'src/common/helper/services/helper.encryption.service';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { ActivityLogEmitterService } from 'src/modules/activity-log/services/activity-log.emitter.service';

import { TeamInviteRequestDto } from '../dtos/request/team.invite.request';
import {
    TeamMemberStatus,
    TeamUpdateRequestDto,
} from '../dtos/request/team.update.request';

@Injectable()
export class UserTeamService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly helperEncryptionService: HelperEncryptionService,
        private readonly configService: ConfigService,
        private readonly activityLogEmitter: ActivityLogEmitterService,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private readonly emailQueue: Queue
    ) {}

    public async listTeamMembers() {
        const teamMembers = await this.databaseService.user.findMany({
            where: {
                role: { notIn: [Role.USER, Role.SUPER_ADMIN] },
                deletedAt: null,
            },
            select: {
                id: true,
                email: true,
                userName: true,
                firstName: true,
                lastName: true,
                role: true,
                isVerified: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
                deactivatedAt: true,
                invitationTokenExpiry: true,
                invitedBy: true,
            },
            orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
        });

        return teamMembers;
    }

    public async inviteTeamMember(
        payload: TeamInviteRequestDto,
        invitedByUserId: string
    ) {
        // Only a TEAM (non-USER) account blocks the invite — a customer (USER)
        // account with the same email is fine and gets its own team account.
        const existingTeam = await this.databaseService.user.findFirst({
            where: {
                email: payload.email,
                role: { not: Role.USER },
                deletedAt: null,
            },
        });
        if (existingTeam) {
            throw new HttpException(
                'user.error.userExists',
                HttpStatus.CONFLICT
            );
        }

        const userNameTaken = await this.databaseService.user.findUnique({
            where: { userName: payload.userName },
        });
        if (userNameTaken && userNameTaken.deletedAt === null) {
            throw new HttpException(
                'user.error.userNameExists',
                HttpStatus.CONFLICT
            );
        }

        const inviter = await this.databaseService.user.findFirst({
            where: { id: invitedByUserId, deletedAt: null },
        });
        if (!inviter) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const invitationToken = randomUUID();
        const invitationTokenExpiry = new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
        );

        const temporaryPassword = randomBytes(9).toString('base64url');
        const hashedTemporaryPassword =
            await this.helperEncryptionService.createHash(temporaryPassword);

        // A soft-deleted TEAM account with this email is revived rather than
        // re-created. (Scoped to the team bucket so a deleted customer account
        // with the same email is never touched by an invite.)
        const deletedTeam = await this.databaseService.user.findFirst({
            where: {
                email: payload.email,
                role: { not: Role.USER },
                deletedAt: { not: null },
            },
        });
        const reviveTargetId = deletedTeam ? deletedTeam.id : null;

        let created;
        try {
            created = reviveTargetId
                ? await this.databaseService.user.update({
                      where: { id: reviveTargetId },
                      data: {
                          email: payload.email,
                          role: payload.role,
                          userName: payload.userName,
                          password: hashedTemporaryPassword,
                          firstName: payload.name?.trim() || null,
                          isVerified: false,
                          invitedBy: invitedByUserId,
                          invitationToken,
                          invitationTokenExpiry,
                          deletedAt: null,
                          deactivatedAt: null,
                      },
                  })
                : await this.databaseService.user.create({
                      data: {
                          email: payload.email,
                          role: payload.role,
                          userName: payload.userName,
                          password: hashedTemporaryPassword,
                          firstName: payload.name?.trim() || null,
                          isVerified: false,
                          invitedBy: invitedByUserId,
                          invitationToken,
                          invitationTokenExpiry,
                      },
                  });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                const target = (error.meta as { target?: string[] } | undefined)
                    ?.target;
                const targetStr = (target ?? []).join(' ').toLowerCase();
                if (targetStr.includes('email')) {
                    throw new HttpException(
                        'user.error.userExists',
                        HttpStatus.CONFLICT
                    );
                }
                throw new HttpException(
                    'user.error.userNameExists',
                    HttpStatus.CONFLICT
                );
            }
            throw error;
        }

        this.activityLogEmitter.setAuditResourceId(created.id);
        this.activityLogEmitter.captureAfter({
            after: {
                email: created.email,
                userName: created.userName,
                role: created.role,
                status: 'INVITED',
            },
            resourceLabel: created.email,
        });

        await this.sendInvitationEmail(
            created.email,
            payload.role,
            temporaryPassword
        );

        return created;
    }

    public async updateTeamMember(
        id: string,
        payload: TeamUpdateRequestDto
    ): Promise<ApiGenericResponseDto> {
        const user = await this.databaseService.user.findUnique({
            where: { id },
        });
        if (!user) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const data: {
            role?: Role;
            deactivatedAt?: Date | null;
        } = {};
        if (payload.role) {
            data.role = payload.role;
        }
        if (payload.status) {
            data.deactivatedAt =
                payload.status === TeamMemberStatus.DEACTIVATED
                    ? new Date()
                    : null;
        }

        this.activityLogEmitter.captureBefore({
            before: {
                role: user.role,
                deactivatedAt: user.deactivatedAt,
            },
        });

        await this.databaseService.user.update({
            where: { id },
            data,
        });

        this.activityLogEmitter.captureAfter({
            after: {
                role: data.role ?? user.role,
                deactivatedAt:
                    data.deactivatedAt !== undefined
                        ? data.deactivatedAt
                        : user.deactivatedAt,
            },
            resourceLabel: user.email,
        });

        return {
            success: true,
            message: 'user.success.updated',
        };
    }

    public async removeTeamMember(
        id: string,
        requester: IAuthUser
    ): Promise<ApiGenericResponseDto> {
        const user = await this.databaseService.user.findUnique({
            where: { id },
        });
        if (!user) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        // SUPER_ADMIN bypasses these guards; OWNER cannot delete themselves
        // or any SUPER_ADMIN account.
        if (!isSuperAdminRole(requester.role)) {
            if (requester.userId === id) {
                throw new HttpException(
                    'user.error.cannotDeleteSelf',
                    HttpStatus.FORBIDDEN
                );
            }
            if (isSuperAdminRole(user.role)) {
                throw new HttpException(
                    'user.error.cannotDeleteSuperAdmin',
                    HttpStatus.FORBIDDEN
                );
            }
        }

        const now = new Date();
        this.activityLogEmitter.captureBefore({
            before: { deletedAt: null },
        });

        await this.databaseService.user.update({
            where: { id },
            data: {
                deletedAt: now,
            },
        });

        this.activityLogEmitter.captureAfter({
            after: { deletedAt: now },
            resourceLabel: user.email,
        });

        return {
            success: true,
            message: 'user.success.deleted',
        };
    }

    public async resendInvite(id: string): Promise<ApiGenericResponseDto> {
        const user = await this.databaseService.user.findUnique({
            where: { id },
        });
        if (!user) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const invitationToken = randomUUID();
        const invitationTokenExpiry = new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
        );

        const temporaryPassword = randomBytes(9).toString('base64url');
        const hashedTemporaryPassword =
            await this.helperEncryptionService.createHash(temporaryPassword);

        await this.databaseService.user.update({
            where: { id: user.id },
            data: {
                invitationToken,
                invitationTokenExpiry,
                password: hashedTemporaryPassword,
            },
        });

        this.activityLogEmitter.captureAfter({
            after: { invitationResent: true },
            resourceLabel: user.email,
        });

        await this.sendInvitationEmail(
            user.email,
            user.role,
            temporaryPassword
        );

        return {
            success: true,
            message: 'user.success.inviteResent',
        };
    }

    public async acceptInvitation(
        payload: AcceptInvitationRequestDto
    ): Promise<ApiGenericResponseDto> {
        const user = await this.databaseService.user.findFirst({
            where: {
                invitationToken: payload.token,
                deletedAt: null,
            },
        });
        if (!user) {
            throw new HttpException(
                'auth.error.invalidInvitationToken',
                HttpStatus.BAD_REQUEST
            );
        }

        if (
            !user.invitationTokenExpiry ||
            user.invitationTokenExpiry <= new Date()
        ) {
            throw new HttpException(
                'auth.error.invitationExpired',
                HttpStatus.BAD_REQUEST
            );
        }

        const hashed = await this.helperEncryptionService.createHash(
            payload.password
        );

        const data: Prisma.UserUpdateInput = {
            password: hashed,
            isVerified: true,
            invitationToken: null,
            invitationTokenExpiry: null,
            deletedAt: null,
        };

        if (payload.userName) {
            const normalized = payload.userName.trim().toLowerCase();
            if (normalized && normalized !== user.userName.toLowerCase()) {
                const taken = await this.databaseService.user.findUnique({
                    where: { userName: normalized },
                });
                if (taken && taken.id !== user.id) {
                    throw new HttpException(
                        'user.error.userNameExists',
                        HttpStatus.CONFLICT
                    );
                }
                data.userName = normalized;
            }
        }

        await this.databaseService.user.update({
            where: { id: user.id },
            data,
        });

        return {
            success: true,
            message: 'auth.success.invitationAccepted',
        };
    }

    private async sendInvitationEmail(
        email: string,
        role: Role,
        temporaryPassword: string
    ): Promise<void> {
        const adminPanelLink =
            this.configService.get<string>('app.emailLinks.adminPanel') ??
            this.configService.get<string>('app.adminUrl') ??
            'http://localhost:3001';

        this.emailQueue.add(EMAIL_TEMPLATES.WELCOME_TO_JINX_MANAGEMENT, {
            data: {
                admin_role: role.toString(),
                temporary_password: temporaryPassword,
                admin_panel_link: adminPanelLink,
            },
            toEmails: [email],
        } as ISendEmailBasePayload<IWelcomeToJinxManagementPayload>);
    }
}
