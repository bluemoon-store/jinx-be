import { getQueueToken } from '@nestjs/bull';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { HelperEncryptionService } from 'src/common/helper/services/helper.encryption.service';
import { IAuthUser } from 'src/common/request/interfaces/request.interface';
import { ActivityLogEmitterService } from 'src/modules/activity-log/services/activity-log.emitter.service';
import { UserTeamService } from 'src/modules/user/services/user.team.service';

describe('UserTeamService.removeTeamMember', () => {
    let service: UserTeamService;

    const mockPrismaService = {
        user: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };

    const mockHelperEncryptionService = {
        createHash: jest.fn(),
    };

    const mockConfigService = {
        get: jest.fn(),
    };

    const mockActivityLogEmitter = {
        captureBefore: jest.fn(),
        captureAfter: jest.fn(),
        setAuditResourceId: jest.fn(),
    };

    const mockEmailQueue = {
        add: jest.fn(),
    };

    const owner: IAuthUser = { userId: 'owner-1', role: Role.OWNER };
    const superAdmin: IAuthUser = { userId: 'sa-1', role: Role.SUPER_ADMIN };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserTeamService,
                { provide: DatabaseService, useValue: mockPrismaService },
                {
                    provide: HelperEncryptionService,
                    useValue: mockHelperEncryptionService,
                },
                { provide: ConfigService, useValue: mockConfigService },
                {
                    provide: ActivityLogEmitterService,
                    useValue: mockActivityLogEmitter,
                },
                {
                    provide: getQueueToken(APP_BULL_QUEUES.EMAIL),
                    useValue: mockEmailQueue,
                },
            ],
        }).compile();

        service = module.get<UserTeamService>(UserTeamService);
    });

    it('throws NOT_FOUND when the target user does not exist', async () => {
        mockPrismaService.user.findUnique.mockResolvedValue(null);

        await expect(
            service.removeTeamMember('missing-id', owner)
        ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
        expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('lets an OWNER soft-delete a regular team member', async () => {
        mockPrismaService.user.findUnique.mockResolvedValue({
            id: 'member-1',
            email: 'member@jinx.io',
            role: Role.MOD,
        });

        const result = await service.removeTeamMember('member-1', owner);

        expect(result).toEqual({
            success: true,
            message: 'user.success.deleted',
        });
        expect(mockPrismaService.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'member-1' },
                data: expect.objectContaining({ deletedAt: expect.any(Date) }),
            })
        );
    });

    it('blocks an OWNER from deleting their own account', async () => {
        mockPrismaService.user.findUnique.mockResolvedValue({
            id: owner.userId,
            email: 'owner@jinx.io',
            role: Role.OWNER,
        });

        await expect(
            service.removeTeamMember(owner.userId, owner)
        ).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN,
            message: 'user.error.cannotDeleteSelf',
        });
        expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('blocks an OWNER from deleting a SUPER_ADMIN', async () => {
        mockPrismaService.user.findUnique.mockResolvedValue({
            id: 'sa-2',
            email: 'sa@jinx.io',
            role: Role.SUPER_ADMIN,
        });

        await expect(
            service.removeTeamMember('sa-2', owner)
        ).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN,
            message: 'user.error.cannotDeleteSuperAdmin',
        });
        expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('lets a SUPER_ADMIN delete anyone, including another SUPER_ADMIN', async () => {
        mockPrismaService.user.findUnique.mockResolvedValue({
            id: 'sa-2',
            email: 'sa@jinx.io',
            role: Role.SUPER_ADMIN,
        });

        const result = await service.removeTeamMember('sa-2', superAdmin);

        expect(result).toEqual({
            success: true,
            message: 'user.success.deleted',
        });
        expect(mockPrismaService.user.update).toHaveBeenCalled();
    });
});
