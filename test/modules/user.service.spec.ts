jest.mock('src/modules/wallet/services/wallet.service', () => ({
    WalletService: class WalletService {},
}));

import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';

import { DatabaseService } from 'src/common/database/services/database.service';
import { HelperEncryptionService } from 'src/common/helper/services/helper.encryption.service';
import { HelperPaginationService } from 'src/common/helper/services/helper.pagination.service';
import { UserUpdateDto } from 'src/modules/user/dtos/request/user.update.request';
import { UserService } from 'src/modules/user/services/user.service';
import { ActivityLogEmitterService } from 'src/modules/activity-log/services/activity-log.emitter.service';
import { WalletService } from 'src/modules/wallet/services/wallet.service';

describe('UserService', () => {
    let service: UserService;

    const mockPrismaService = {
        user: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
    };

    const mockHelperEncryptionService = {
        match: jest.fn(),
        createHash: jest.fn(),
    };

    const mockHelperPaginationService = {
        paginate: jest.fn(),
        buildSearchCondition: jest.fn(),
    };

    const mockActivityLogEmitter = {
        captureBefore: jest.fn(),
        captureAfter: jest.fn(),
        setAuditResourceId: jest.fn(),
    };

    const mockWalletService = {
        createWallet: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserService,
                { provide: DatabaseService, useValue: mockPrismaService },
                {
                    provide: HelperEncryptionService,
                    useValue: mockHelperEncryptionService,
                },
                {
                    provide: HelperPaginationService,
                    useValue: mockHelperPaginationService,
                },
                {
                    provide: ActivityLogEmitterService,
                    useValue: mockActivityLogEmitter,
                },
                { provide: WalletService, useValue: mockWalletService },
            ],
        }).compile();

        service = module.get<UserService>(UserService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('updateUser', () => {
        it('should throw an error if user is not found', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(
                service.updateUser('non-existent-id', { name: 'John' })
            ).rejects.toThrow(HttpException);
        });

        it('should update and return the user if user exists', async () => {
            const mockUser = { id: '123', name: 'John Doe' };
            const updateDto: UserUpdateDto = { name: 'Jane' };

            mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
            mockPrismaService.user.update.mockResolvedValue({
                ...mockUser,
                ...updateDto,
            });

            const result = await service.updateUser('123', updateDto);

            expect(result).toEqual({ ...mockUser, ...updateDto });
        });
    });

    describe('deleteUser', () => {
        it('should throw an error if user is not found', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(
                service.deleteUser('non-existent-id', 'actor', Role.USER, 'pw')
            ).rejects.toThrow(HttpException);
        });

        it('should soft delete the user and return success message', async () => {
            const mockUser = {
                id: '123',
                name: 'John Doe',
                password: 'hashed',
            };

            mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
            mockHelperEncryptionService.match.mockResolvedValue(true);
            mockPrismaService.user.update.mockResolvedValue({
                ...mockUser,
                deletedAt: new Date(),
            });

            const result = await service.deleteUser(
                '123',
                '123',
                Role.USER,
                'correct-password'
            );

            expect(result).toEqual({
                success: true,
                message: 'user.success.userDeleted',
            });
        });

        it('should reject self-delete when password does not match', async () => {
            const mockUser = { id: '123', password: 'hashed' };
            mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
            mockHelperEncryptionService.match.mockResolvedValue(false);

            await expect(
                service.deleteUser('123', '123', Role.USER, 'wrong')
            ).rejects.toThrow(HttpException);
        });
    });

    describe('getProfile', () => {
        it('should throw an error if user is not found', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(service.getProfile('non-existent-id')).rejects.toThrow(
                HttpException
            );
        });

        it('should return the user profile if user exists', async () => {
            const mockUser = { id: '123', name: 'John Doe' };

            mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

            const result = await service.getProfile('123');

            expect(result).toEqual(mockUser);
        });
    });

    describe('createByAdmin', () => {
        beforeEach(() => {
            mockHelperEncryptionService.createHash.mockResolvedValue(
                'argon-hashed'
            );
            mockWalletService.createWallet.mockResolvedValue({});
            mockPrismaService.user.findFirst.mockReset();
            mockPrismaService.user.create.mockReset();
        });

        it('should reject when email is taken', async () => {
            mockPrismaService.user.findFirst.mockResolvedValue({
                id: 'u1',
                email: 'taken@example.com',
                name: 'Other User',
            });

            await expect(
                service.createByAdmin({
                    email: 'taken@example.com',
                    name: 'New User',
                    markVerified: false,
                })
            ).rejects.toMatchObject({
                response: 'user.error.emailAlreadyTaken',
            });
        });

        it('should create user, wallet, hash password, and return plaintext once', async () => {
            mockPrismaService.user.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    id: 'new-id',
                    email: 'new@example.com',
                    name: 'New User',
                    avatar: null,
                    role: Role.USER,
                    isVerified: true,
                    isBanned: false,
                    bannedAt: null,
                    bannedReason: null,
                    isFlagged: false,
                    flaggedAt: null,
                    flaggedReason: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                    wallet: { balance: null },
                });

            mockPrismaService.user.create.mockResolvedValue({
                id: 'new-id',
                email: 'new@example.com',
                name: 'New User',
            });

            const result = await service.createByAdmin({
                email: 'new@example.com',
                name: 'New User',
                markVerified: true,
            });

            expect(mockHelperEncryptionService.createHash).toHaveBeenCalledWith(
                expect.any(String)
            );
            expect(
                mockHelperEncryptionService.createHash.mock.calls[0][0]
            ).toHaveLength(16);
            expect(mockWalletService.createWallet).toHaveBeenCalledWith(
                'new-id'
            );
            expect(
                mockActivityLogEmitter.setAuditResourceId
            ).toHaveBeenCalledWith('new-id');
            expect(result.generatedPassword).toHaveLength(16);
            expect(result.user.id).toBe('new-id');
            expect(result.user.isVerified).toBe(true);
        });
    });
});
