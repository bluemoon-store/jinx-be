import { getQueueToken } from '@nestjs/bull';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as speakeasy from 'speakeasy';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { AuthService } from 'src/common/auth/services/auth.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { HelperEncryptionService } from 'src/common/helper/services/helper.encryption.service';
import { UserService } from 'src/modules/user/services/user.service';
import { WalletService } from 'src/modules/wallet/services/wallet.service';

describe('AuthService', () => {
    let service: AuthService;

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
        createJwtTokens: jest.fn(),
        createTwoFactorToken: jest.fn(),
        verifyTwoFactorToken: jest.fn(),
    };

    const mockEmailQueue = {
        add: jest.fn(),
    };

    const mockNotificationQueue = {
        add: jest.fn(),
    };

    const mockUserService = {};

    const mockWalletService = {
        createWallet: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
        get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: DatabaseService, useValue: mockPrismaService },
                {
                    provide: HelperEncryptionService,
                    useValue: mockHelperEncryptionService,
                },
                { provide: UserService, useValue: mockUserService },
                { provide: WalletService, useValue: mockWalletService },
                { provide: ConfigService, useValue: mockConfigService },
                {
                    provide: getQueueToken(APP_BULL_QUEUES.EMAIL),
                    useValue: mockEmailQueue,
                },
                {
                    provide: getQueueToken(APP_BULL_QUEUES.NOTIFICATION),
                    useValue: mockNotificationQueue,
                },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);

        mockPrismaService.user.findUnique.mockReset();
        mockPrismaService.user.findFirst.mockReset();
        mockPrismaService.user.create.mockReset();
        mockPrismaService.user.update.mockReset();
        mockHelperEncryptionService.match.mockReset();
        mockHelperEncryptionService.createHash.mockReset();
        mockHelperEncryptionService.createJwtTokens.mockReset();
        mockHelperEncryptionService.createTwoFactorToken.mockReset();
        mockHelperEncryptionService.verifyTwoFactorToken.mockReset();
        mockEmailQueue.add.mockReset();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('login', () => {
        it('should throw an error if user is not found', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            await expect(
                service.login({
                    email: 'test@example.com',
                    password: 'password123',
                })
            ).rejects.toThrow(HttpException);
        });

        it('should throw an error if password does not match', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue({
                id: '123',
                password: 'hashed_password',
            });
            mockHelperEncryptionService.match.mockResolvedValue(false);

            await expect(
                service.login({
                    email: 'test@example.com',
                    password: 'wrong_password',
                })
            ).rejects.toThrow(HttpException);
        });

        it('should throw an error if user is soft-deleted', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue({
                id: '123',
                password: 'hashed_password',
                role: Role.USER,
                isBanned: false,
                deletedAt: new Date(),
            });

            await expect(
                service.login({
                    email: 'test@example.com',
                    password: 'password123',
                })
            ).rejects.toThrow(HttpException);
        });

        it('should return tokens and user if login is successful', async () => {
            const mockUser = {
                id: '123',
                password: 'hashed_password',
                role: Role.USER,
                deletedAt: null,
            };
            const mockTokens = {
                accessToken: 'access_token',
                refreshToken: 'refresh_token',
            };

            mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
            mockHelperEncryptionService.match.mockResolvedValue(true);
            mockHelperEncryptionService.createJwtTokens.mockResolvedValue(
                mockTokens
            );

            const result = await service.login({
                email: 'test@example.com',
                password: 'password123',
            });

            expect(result).toEqual({ ...mockTokens, user: mockUser });
        });

        it('should return 2FA challenge when two-factor is enabled', async () => {
            const mockUser = {
                id: '123',
                password: 'hashed_password',
                role: Role.USER,
                deletedAt: null,
                twoFactorEnabled: true,
                twoFactorSecret: 'SECRETBASE32',
            };
            mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
            mockHelperEncryptionService.match.mockResolvedValue(true);
            mockHelperEncryptionService.createTwoFactorToken.mockResolvedValue(
                '2fa-challenge-jwt'
            );

            const result = await service.login({
                email: 'test@example.com',
                password: 'password123',
            });

            expect(result).toEqual({
                requiresTwoFactor: true,
                twoFactorToken: '2fa-challenge-jwt',
            });
            expect(
                mockHelperEncryptionService.createTwoFactorToken
            ).toHaveBeenCalledWith('123');
            expect(
                mockHelperEncryptionService.createJwtTokens
            ).not.toHaveBeenCalled();
        });
    });

    describe('verifyTwoFactorLogin', () => {
        it('should return tokens when TOTP is valid', async () => {
            mockHelperEncryptionService.verifyTwoFactorToken.mockResolvedValue({
                userId: 'u1',
            });
            const mockUser = {
                id: 'u1',
                role: Role.USER,
                deletedAt: null,
                isBanned: false,
                twoFactorEnabled: true,
                twoFactorSecret: 'SECRET',
            };
            mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
            jest.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
            mockHelperEncryptionService.createJwtTokens.mockResolvedValue({
                accessToken: 'a',
                refreshToken: 'r',
            });

            const result = await service.verifyTwoFactorLogin({
                twoFactorToken: 'jwt',
                code: '123456',
            });

            expect(result).toEqual({
                accessToken: 'a',
                refreshToken: 'r',
                user: mockUser,
            });
            jest.restoreAllMocks();
        });
    });

    describe('signup', () => {
        it('should throw an error if user already exists', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue({ id: '123' });

            await expect(
                service.signup({
                    email: 'existing@example.com',
                    password: 'password123',
                    name: 'Existing User',
                })
            ).rejects.toThrow(HttpException);
        });

        it('should create a user and return tokens if signup is successful', async () => {
            const newUser = {
                id: '123',
                email: 'new@example.com',
                name: 'John Doe',
                role: Role.USER,
            };
            const tokens = {
                accessToken: 'access_token',
                refreshToken: 'refresh_token',
            };

            mockPrismaService.user.findUnique.mockResolvedValue(null);
            mockHelperEncryptionService.createHash.mockResolvedValue(
                'hashed_password'
            );
            mockPrismaService.user.create.mockResolvedValue(newUser);
            mockHelperEncryptionService.createJwtTokens.mockResolvedValue(
                tokens
            );

            const result = await service.signup({
                email: 'new@example.com',
                password: 'password123',
                name: 'John Doe',
            });

            expect(result).toEqual({ ...tokens, user: newUser });
            expect(mockEmailQueue.add).toHaveBeenCalled();
        });
    });

    describe('refreshTokens', () => {
        it('should return new tokens when refreshTokens is called', async () => {
            const tokens = {
                accessToken: 'new_access_token',
                refreshToken: 'new_refresh_token',
            };

            mockHelperEncryptionService.createJwtTokens.mockResolvedValue(
                tokens
            );

            const result = await service.refreshTokens({
                userId: '123',
                role: Role.USER,
            });

            expect(result).toEqual(tokens);
        });
    });

    describe('forgotPassword', () => {
        it('returns success when user does not exist', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            const result = await service.forgotPassword({
                email: 'missing@example.com',
            });

            expect(result.success).toBe(true);
            expect(mockPrismaService.user.update).not.toHaveBeenCalled();
        });

        it('stores OTP and enqueues OTP email when user exists', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue({
                id: 'u1',
                email: 'a@example.com',
                name: 'alice',
                deletedAt: null,
            });
            mockPrismaService.user.update.mockResolvedValue({});

            const result = await service.forgotPassword({
                email: 'a@example.com',
            });

            expect(result.success).toBe(true);
            expect(mockPrismaService.user.update).toHaveBeenCalled();
            expect(mockEmailQueue.add).toHaveBeenCalledWith(
                EMAIL_TEMPLATES.FORGOT_PASSWORD_OTP,
                expect.objectContaining({
                    toEmails: ['a@example.com'],
                    data: expect.objectContaining({
                        userName: 'alice',
                        otp: expect.stringMatching(/^\d{6}$/),
                    }),
                })
            );
        });
    });

    describe('forgotPasswordLink', () => {
        it('returns success when user does not exist', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue(null);

            const result = await service.forgotPasswordLink({
                email: 'missing@example.com',
            });

            expect(result.success).toBe(true);
            expect(mockPrismaService.user.update).not.toHaveBeenCalled();
        });

        it('stores token and enqueues reset-link email when user exists', async () => {
            mockPrismaService.user.findUnique.mockResolvedValue({
                id: 'u1',
                email: 'a@example.com',
                name: 'alice',
                deletedAt: null,
            });
            mockPrismaService.user.update.mockResolvedValue({});

            const result = await service.forgotPasswordLink({
                email: 'a@example.com',
            });

            expect(result.success).toBe(true);
            expect(mockPrismaService.user.update).toHaveBeenCalled();
            expect(mockEmailQueue.add).toHaveBeenCalledWith(
                EMAIL_TEMPLATES.RESET_PASSWORD_LINK,
                expect.objectContaining({
                    toEmails: ['a@example.com'],
                    data: expect.objectContaining({
                        userName: 'alice',
                        resetUrl: expect.stringContaining(
                            '/auth/reset-password?token='
                        ),
                    }),
                })
            );
        });
    });
});
