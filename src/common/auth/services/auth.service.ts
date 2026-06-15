import { randomBytes, randomInt, randomUUID } from 'crypto';

import { InjectQueue } from '@nestjs/bull';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { Queue } from 'bull';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

import { APP_BULL_QUEUES } from 'src/app/enums/app.enum';
import { DatabaseService } from 'src/common/database/services/database.service';
import { EMAIL_TEMPLATES } from 'src/common/email/enums/email-template.enum';
import {
    IAccountCreatedWithPasswordPayload,
    IAdminLoginOtpPayload,
    IAdminPasswordChangedPayload,
    IForgotPasswordOtpPayload,
    IPasswordChangedPayload,
    IResetPasswordLinkPayload,
    ISendEmailBasePayload,
    IVerifyEmailPayload,
} from 'src/common/helper/interfaces/email.interface';
import { isPrivilegedAdminRole } from 'src/common/request/constants/roles.constant';

import { HelperEncryptionService } from '../../helper/services/helper.encryption.service';
import { IAuthUser } from '../../request/interfaces/request.interface';
import { UserService } from 'src/modules/user/services/user.service';
import { generateUniqueUserNumber } from 'src/modules/user/utils/user.util';
import { WalletService } from 'src/modules/wallet/services/wallet.service';
import { TwoFactorDisableDto } from '../dtos/request/auth.2fa.disable.dto';
import { TwoFactorSetupDto } from '../dtos/request/auth.2fa.setup.dto';
import { TwoFactorVerifyLoginDto } from '../dtos/request/auth.2fa.verify-login.dto';
import { TwoFactorVerifyDto } from '../dtos/request/auth.2fa.verify.dto';
import { AdminLoginDto } from '../dtos/request/auth.admin-login.dto';
import { AdminResendOtpDto } from '../dtos/request/auth.admin-resend-otp.dto';
import { AdminVerifyOtpDto } from '../dtos/request/auth.admin-verify-otp.dto';
import { ChangeEmailDto } from '../dtos/request/auth.change-email.dto';
import { ChangePasswordDto } from '../dtos/request/auth.change-password.dto';
import { ForgotPasswordDto } from '../dtos/request/auth.forgot-password.dto';
import { GuestCheckoutDto } from '../dtos/request/auth.guest-checkout.dto';
import { UserLoginDto } from '../dtos/request/auth.login.dto';
import { ResetPasswordLinkDto } from '../dtos/request/auth.reset-password-link.dto';
import { ResetPasswordDto } from '../dtos/request/auth.reset-password.dto';
import { UserCreateDto } from '../dtos/request/auth.signup.dto';
import { VerifyOtpDto } from '../dtos/request/auth.verify-otp.dto';
import {
    AdminLoginChallengeResponseDto,
    AuthRefreshResponseDto,
    AuthResponseDto,
    AuthSuccessResponseDto,
    TwoFactorChallengeResponseDto,
} from '../dtos/response/auth.response.dto';
import {
    TwoFactorSetupResponseDto,
    TwoFactorVerifyResponseDto,
} from '../dtos/response/auth.2fa.response';
import { IAuthService } from '../interfaces/auth.service.interface';

@Injectable()
export class AuthService implements IAuthService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly helperEncryptionService: HelperEncryptionService,
        private readonly userService: UserService,
        private readonly walletService: WalletService,
        private readonly configService: ConfigService,
        @InjectQueue(APP_BULL_QUEUES.EMAIL)
        private emailQueue: Queue,
        @InjectQueue(APP_BULL_QUEUES.NOTIFICATION)
        private notificationQueue: Queue
    ) {}

    public async login(
        data: UserLoginDto
    ): Promise<AuthResponseDto | TwoFactorChallengeResponseDto> {
        try {
            const { email, password } = data;

            // Customer portal: authenticate the CUSTOMER (USER) account only.
            // A team-only email has no customer account here -> generic 401.
            const user = await this.databaseService.user.findFirst({
                where: { email, role: Role.USER },
            });

            if (!user) {
                // Generic 401 (not 404) so we don't reveal which emails exist.
                throw new HttpException(
                    'auth.error.invalidCredentials',
                    HttpStatus.UNAUTHORIZED
                );
            }

            // Check if user is banned
            if (user.isBanned) {
                throw new HttpException(
                    'auth.error.userBanned',
                    HttpStatus.FORBIDDEN
                );
            }

            if (user.deletedAt) {
                throw new HttpException(
                    'auth.error.accountDeleted',
                    HttpStatus.FORBIDDEN
                );
            }

            const passwordMatched = await this.helperEncryptionService.match(
                user.password,
                password
            );

            if (!passwordMatched) {
                // Same generic 401 + message as the unknown-email case above.
                throw new HttpException(
                    'auth.error.invalidCredentials',
                    HttpStatus.UNAUTHORIZED
                );
            }

            if (user.twoFactorEnabled) {
                if (!user.twoFactorSecret) {
                    throw new HttpException(
                        'auth.error.twoFactorNotConfigured',
                        HttpStatus.INTERNAL_SERVER_ERROR
                    );
                }

                const twoFactorToken =
                    await this.helperEncryptionService.createTwoFactorToken(
                        user.id
                    );
                return {
                    requiresTwoFactor: true as const,
                    twoFactorToken,
                };
            }

            const tokens = await this.helperEncryptionService.createJwtTokens({
                role: user.role,
                userId: user.id,
            });

            return {
                ...tokens,
                user,
            };
        } catch (error) {
            throw error;
        }
    }

    public async verifyTwoFactorLogin(
        data: TwoFactorVerifyLoginDto
    ): Promise<AuthResponseDto> {
        const { userId } =
            await this.helperEncryptionService.verifyTwoFactorToken(
                data.twoFactorToken
            );

        const user = await this.databaseService.user.findUnique({
            where: { id: userId },
        });

        if (!user || user.deletedAt) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        if (user.isBanned) {
            throw new HttpException(
                'auth.error.userBanned',
                HttpStatus.FORBIDDEN
            );
        }

        if (!user.twoFactorEnabled || !user.twoFactorSecret) {
            throw new HttpException(
                'auth.error.twoFactorNotEnabled',
                HttpStatus.BAD_REQUEST
            );
        }

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: data.code,
            window: 2,
        });

        if (!verified) {
            throw new HttpException(
                'auth.error.invalidTwoFactorCode',
                HttpStatus.BAD_REQUEST
            );
        }

        const tokens = await this.helperEncryptionService.createJwtTokens({
            role: user.role,
            userId: user.id,
        });

        return {
            ...tokens,
            user,
        };
    }

    public async adminLogin(
        data: AdminLoginDto
    ): Promise<AdminLoginChallengeResponseDto | AuthResponseDto> {
        const { email, password, rememberMe } = data;

        // Admin portal: authenticate the TEAM (non-USER) account only.
        const user = await this.databaseService.user.findFirst({
            where: { email, role: { not: Role.USER } },
        });

        if (!user) {
            // Generic 401 (not 404) so we don't reveal which emails exist.
            throw new HttpException(
                'auth.error.invalidCredentials',
                HttpStatus.UNAUTHORIZED
            );
        }

        if (user.isBanned) {
            throw new HttpException(
                'auth.error.userBanned',
                HttpStatus.FORBIDDEN
            );
        }

        if (user.deletedAt) {
            throw new HttpException(
                'auth.error.accountDeleted',
                HttpStatus.FORBIDDEN
            );
        }

        const passwordMatched = await this.helperEncryptionService.match(
            user.password,
            password
        );

        if (!passwordMatched) {
            throw new HttpException(
                'auth.error.invalidCredentials',
                HttpStatus.UNAUTHORIZED
            );
        }

        // Admin panel access is staff/super-admin only — reject end users.
        if (!isPrivilegedAdminRole(user.role)) {
            throw new HttpException(
                'auth.error.forbiddenAdmin',
                HttpStatus.FORBIDDEN
            );
        }

        // Feature flag: when disabled, admins sign in with password only.
        const otpEnabled =
            this.configService.get<boolean>('auth.adminLoginOtpEnabled') ??
            true;

        if (!otpEnabled) {
            const tokens = await this.helperEncryptionService.createJwtTokens({
                role: user.role,
                userId: user.id,
                rememberMe,
            });

            return {
                ...tokens,
                user,
            };
        }

        await this.issueAdminLoginOtp(user.id, user.email);

        // Carry the remember-me choice through the OTP step inside the
        // challenge token, so it can't be tampered with between steps.
        const challengeToken =
            await this.helperEncryptionService.createTwoFactorToken(
                user.id,
                rememberMe
            );

        return { challengeToken };
    }

    public async verifyAdminLoginOtp(
        data: AdminVerifyOtpDto
    ): Promise<AuthResponseDto> {
        const { userId, rememberMe } =
            await this.helperEncryptionService.verifyTwoFactorToken(
                data.challengeToken
            );

        const user = await this.databaseService.user.findUnique({
            where: { id: userId },
        });

        if (!user || user.deletedAt) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        if (user.isBanned) {
            throw new HttpException(
                'auth.error.userBanned',
                HttpStatus.FORBIDDEN
            );
        }

        if (!isPrivilegedAdminRole(user.role)) {
            throw new HttpException(
                'auth.error.forbiddenAdmin',
                HttpStatus.FORBIDDEN
            );
        }

        this.assertValidAdminLoginOtp(user, data.code);

        await this.databaseService.user.update({
            where: { id: user.id },
            data: {
                adminLoginOtp: null,
                adminLoginOtpExpiry: null,
            },
        });

        const tokens = await this.helperEncryptionService.createJwtTokens({
            role: user.role,
            userId: user.id,
            rememberMe,
        });

        return {
            ...tokens,
            user,
        };
    }

    public async resendAdminLoginOtp(
        data: AdminResendOtpDto
    ): Promise<AuthSuccessResponseDto> {
        const { userId } =
            await this.helperEncryptionService.verifyTwoFactorToken(
                data.challengeToken
            );

        const user = await this.databaseService.user.findUnique({
            where: { id: userId },
        });

        if (
            user &&
            !user.deletedAt &&
            !user.isBanned &&
            isPrivilegedAdminRole(user.role)
        ) {
            await this.issueAdminLoginOtp(user.id, user.email);
        }

        return {
            success: true,
            message: 'auth.success.adminLoginOtpSent',
        };
    }

    /** Generate a fresh 6-digit admin login OTP (10-min expiry), persist it, and email it. */
    private async issueAdminLoginOtp(
        userId: string,
        email: string
    ): Promise<void> {
        const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
        const adminLoginOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        await this.databaseService.user.update({
            where: { id: userId },
            data: {
                adminLoginOtp: otp,
                adminLoginOtpExpiry,
            },
        });

        this.emailQueue.add(EMAIL_TEMPLATES.ADMIN_LOGIN_OTP, {
            data: {
                otp_code: otp,
            },
            toEmails: [email],
        } as ISendEmailBasePayload<IAdminLoginOtpPayload>);
    }

    public async signup(data: UserCreateDto): Promise<AuthResponseDto> {
        try {
            const { email, name, password } = data;

            // Signup creates a CUSTOMER (USER) account. Only a live customer
            // account with this email blocks it; a team account may share it.
            const existingUser = await this.databaseService.user.findFirst({
                where: { email, role: Role.USER, deletedAt: null },
            });

            if (existingUser) {
                throw new HttpException(
                    'user.error.userExists',
                    HttpStatus.CONFLICT
                );
            }

            const hashed =
                await this.helperEncryptionService.createHash(password);

            const userNumber = await generateUniqueUserNumber(
                this.databaseService
            );

            let createdUser;
            try {
                createdUser = await this.databaseService.user.create({
                    data: {
                        email,
                        password: hashed,
                        name: name.trim(),
                        role: Role.USER,
                        userNumber,
                    },
                });
            } catch (error) {
                // DB backstop for a concurrent signup race (partial customer index).
                if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2002'
                ) {
                    throw new HttpException(
                        'user.error.userExists',
                        HttpStatus.CONFLICT
                    );
                }
                throw error;
            }

            // Create wallet for new user
            await this.walletService.createWallet(createdUser.id);

            const tokens = await this.helperEncryptionService.createJwtTokens({
                role: createdUser.role,
                userId: createdUser.id,
            });

            // Trigger welcome notification
            // this.notificationQueue.add('welcome', {
            //     userId: createdUser.id,
            // });

            return {
                ...tokens,
                user: createdUser,
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Guest checkout: find-or-create an unverified CUSTOMER (USER) account for
     * the given email and issue tokens, so the rest of the checkout (cart, order,
     * payment, delivery) can run through the normal authenticated flow.
     *
     * If a live customer account already exists for the email we refuse and tell
     * the caller to log in — we never mint a token for an account we didn't just
     * create (no silent account takeover). The guest can later claim the account
     * via forgot-password.
     */
    public async guestCheckout(
        data: GuestCheckoutDto
    ): Promise<AuthResponseDto> {
        const { email } = data;

        const existingUser = await this.databaseService.user.findFirst({
            where: { email, role: Role.USER, deletedAt: null },
        });

        if (existingUser) {
            // An account (real or a previous guest) owns this email. Require
            // login rather than attaching the order to someone else's account.
            throw new HttpException(
                'auth.error.accountExistsLoginRequired',
                HttpStatus.CONFLICT
            );
        }

        // Generate a real temporary password (mirrors the team-invite flow) and
        // email it to the guest below so it becomes their actual login credential
        // for next time — not a throwaway. They can change it in Account Settings.
        const temporaryPassword = randomBytes(9).toString('base64url');
        const hashed =
            await this.helperEncryptionService.createHash(temporaryPassword);

        const userNumber = await generateUniqueUserNumber(this.databaseService);

        // Derive a readable display name from the email local-part so admin/order
        // views show something better than a blank.
        const name = email.split('@')[0] || 'Guest';

        let createdUser;
        try {
            createdUser = await this.databaseService.user.create({
                data: {
                    email,
                    password: hashed,
                    name,
                    role: Role.USER,
                    userNumber,
                },
            });
        } catch (error) {
            // DB backstop for a concurrent create race (partial customer index).
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new HttpException(
                    'auth.error.accountExistsLoginRequired',
                    HttpStatus.CONFLICT
                );
            }
            throw error;
        }

        await this.walletService.createWallet(createdUser.id);

        // Email the guest their new account credentials (fire-and-forget, like the
        // team-invite email). Only ever runs on first creation — a re-checkout with
        // the same email hits the 409 above, so we never re-send to existing accounts.
        const loginLink = `${this.configService.get<string>(
            'app.frontendUrl'
        )}/login`;
        this.emailQueue.add(EMAIL_TEMPLATES.ACCOUNT_CREATED_WITH_PASSWORD, {
            data: {
                user_email: email,
                generated_password: temporaryPassword,
                login_link: loginLink,
            },
            toEmails: [email],
        } as ISendEmailBasePayload<IAccountCreatedWithPasswordPayload>);

        const tokens = await this.helperEncryptionService.createJwtTokens({
            role: createdUser.role,
            userId: createdUser.id,
        });

        return {
            ...tokens,
            user: createdUser,
        };
    }

    public async logout(): Promise<{ success: boolean; message: string }> {
        return {
            success: true,
            message: 'auth.success.logout',
        };
    }

    public async refreshTokens(
        payload: IAuthUser
    ): Promise<AuthRefreshResponseDto> {
        return this.helperEncryptionService.createJwtTokens({
            userId: payload.userId,
            role: payload.role,
            // Preserve the extended lifetime across refreshes (rides in the JWT).
            rememberMe: payload.rememberMe,
        });
    }

    public async setupTwoFactor(
        userId: string,
        data: TwoFactorSetupDto
    ): Promise<TwoFactorSetupResponseDto> {
        try {
            const user = await this.databaseService.user.findUnique({
                where: { id: userId },
            });

            if (!user) {
                throw new HttpException(
                    'user.error.userNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            // Verify password
            const passwordMatched = await this.helperEncryptionService.match(
                user.password,
                data.password
            );

            if (!passwordMatched) {
                throw new HttpException(
                    'auth.error.invalidPassword',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Generate secret
            const secret = speakeasy.generateSecret({
                name: `Jinx.to (${user.email})`,
                issuer: 'Jinx.to',
                length: 32,
            });

            // Generate QR code
            const otpAuthUrl = speakeasy.otpauthURL({
                secret: secret.base32,
                label: user.email,
                issuer: 'Jinx.to',
                encoding: 'base32',
            });

            const qrCode = await QRCode.toDataURL(otpAuthUrl);

            // Store secret temporarily (user needs to verify before enabling)
            await this.databaseService.user.update({
                where: { id: userId },
                data: {
                    twoFactorSecret: secret.base32,
                },
            });

            return {
                secret: secret.base32,
                qrCode,
                otpAuthUrl,
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                'auth.error.failedToSetupTwoFactor',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    public async verifyTwoFactor(
        userId: string,
        data: TwoFactorVerifyDto
    ): Promise<TwoFactorVerifyResponseDto> {
        try {
            const user = await this.databaseService.user.findUnique({
                where: { id: userId },
            });

            if (!user) {
                throw new HttpException(
                    'user.error.userNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            if (!user.twoFactorSecret) {
                throw new HttpException(
                    'auth.error.twoFactorNotSetup',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Verify TOTP code
            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: data.code,
                window: 2,
            });

            if (!verified) {
                throw new HttpException(
                    'auth.error.invalidTwoFactorCode',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Enable 2FA
            await this.databaseService.user.update({
                where: { id: userId },
                data: {
                    twoFactorEnabled: true,
                },
            });

            return {
                success: true,
                message: 'auth.success.twoFactorEnabled',
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                'auth.error.failedToVerifyTwoFactor',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    public async disableTwoFactor(
        userId: string,
        data: TwoFactorDisableDto
    ): Promise<{ success: boolean; message: string }> {
        try {
            const user = await this.databaseService.user.findUnique({
                where: { id: userId },
            });

            if (!user) {
                throw new HttpException(
                    'user.error.userNotFound',
                    HttpStatus.NOT_FOUND
                );
            }

            if (!user.twoFactorEnabled || !user.twoFactorSecret) {
                throw new HttpException(
                    'auth.error.twoFactorNotEnabled',
                    HttpStatus.BAD_REQUEST
                );
            }

            const passwordMatched = await this.helperEncryptionService.match(
                user.password,
                data.password
            );

            if (!passwordMatched) {
                throw new HttpException(
                    'auth.error.invalidPassword',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Verify TOTP code before disabling
            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: data.code,
                window: 2,
            });

            if (!verified) {
                throw new HttpException(
                    'auth.error.invalidTwoFactorCode',
                    HttpStatus.BAD_REQUEST
                );
            }

            // Disable 2FA and clear secret
            await this.databaseService.user.update({
                where: { id: userId },
                data: {
                    twoFactorEnabled: false,
                    twoFactorSecret: null,
                },
            });

            return {
                success: true,
                message: 'auth.success.twoFactorDisabled',
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                'auth.error.failedToDisableTwoFactor',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Resolve the account targeted by an email-based password-reset flow.
     * Scoped by portal bucket: the customer `/auth/*` endpoints reset the
     * CUSTOMER (USER) account; the admin `/auth/admin/*` endpoints reset the
     * TEAM (non-USER) account. Soft-deleted rows are excluded.
     */
    private findResettableUser(email: string, bucket: 'customer' | 'team') {
        return this.databaseService.user.findFirst({
            where: {
                email,
                deletedAt: null,
                role: bucket === 'customer' ? Role.USER : { not: Role.USER },
            },
        });
    }

    public forgotPassword(
        data: ForgotPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.issueForgotPasswordOtp(data, 'customer');
    }

    public adminForgotPassword(
        data: ForgotPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.issueForgotPasswordOtp(data, 'team');
    }

    private async issueForgotPasswordOtp(
        data: ForgotPasswordDto,
        bucket: 'customer' | 'team'
    ): Promise<AuthSuccessResponseDto> {
        const user = await this.findResettableUser(data.email, bucket);

        if (!user) {
            return {
                success: true,
                message: 'auth.success.forgotPassword',
            };
        }

        const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
        const passwordResetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        await this.databaseService.user.update({
            where: { id: user.id },
            data: {
                passwordResetOtp: otp,
                passwordResetOtpExpiry,
            },
        });

        this.emailQueue.add(EMAIL_TEMPLATES.FORGOT_PASSWORD_OTP, {
            data: {
                otp_code: otp,
            },
            toEmails: [user.email],
        } as ISendEmailBasePayload<IForgotPasswordOtpPayload>);

        return {
            success: true,
            message: 'auth.success.forgotPassword',
        };
    }

    public forgotPasswordLink(
        data: ForgotPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.issueForgotPasswordLink(data, 'customer');
    }

    public adminForgotPasswordLink(
        data: ForgotPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.issueForgotPasswordLink(data, 'team');
    }

    private async issueForgotPasswordLink(
        data: ForgotPasswordDto,
        bucket: 'customer' | 'team'
    ): Promise<AuthSuccessResponseDto> {
        const user = await this.findResettableUser(data.email, bucket);

        if (!user) {
            return {
                success: true,
                message: 'auth.success.forgotPassword',
            };
        }

        const token = randomUUID();
        const passwordResetOtpExpiry = new Date(Date.now() + 60 * 60 * 1000);

        await this.databaseService.user.update({
            where: { id: user.id },
            data: {
                passwordResetOtp: token,
                passwordResetOtpExpiry,
            },
        });

        const frontendUrl =
            this.configService.get<string>('app.frontendUrl') ??
            'http://localhost:3000';
        const resetUrl = `${frontendUrl.replace(/\/$/, '')}/auth/reset-password?token=${token}`;

        this.emailQueue.add(EMAIL_TEMPLATES.RESET_PASSWORD_LINK, {
            data: {
                reset_link: resetUrl,
                userName: user.name,
            },
            toEmails: [user.email],
        } as ISendEmailBasePayload<IResetPasswordLinkPayload>);

        return {
            success: true,
            message: 'auth.success.forgotPassword',
        };
    }

    public verifyOtp(data: VerifyOtpDto): Promise<AuthSuccessResponseDto> {
        return this.verifyResetOtp(data, 'customer');
    }

    public adminVerifyResetOtp(
        data: VerifyOtpDto
    ): Promise<AuthSuccessResponseDto> {
        return this.verifyResetOtp(data, 'team');
    }

    private async verifyResetOtp(
        data: VerifyOtpDto,
        bucket: 'customer' | 'team'
    ): Promise<AuthSuccessResponseDto> {
        const user = await this.findResettableUser(data.email, bucket);

        if (!user) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        this.assertValidPasswordResetOtp(user, data.otp);

        return {
            success: true,
            message: 'auth.success.otpVerified',
        };
    }

    public resetPassword(
        data: ResetPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.resetPasswordForBucket(data, 'customer');
    }

    public adminResetPassword(
        data: ResetPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.resetPasswordForBucket(data, 'team');
    }

    private async resetPasswordForBucket(
        data: ResetPasswordDto,
        bucket: 'customer' | 'team'
    ): Promise<AuthSuccessResponseDto> {
        const user = await this.findResettableUser(data.email, bucket);

        if (!user) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        this.assertValidPasswordResetOtp(user, data.otp);

        const hashed = await this.helperEncryptionService.createHash(
            data.newPassword
        );

        await this.databaseService.user.update({
            where: { id: user.id },
            data: {
                password: hashed,
                passwordResetOtp: null,
                passwordResetOtpExpiry: null,
            },
        });

        return {
            success: true,
            message: 'auth.success.passwordReset',
        };
    }

    public async resetPasswordLink(
        data: ResetPasswordLinkDto
    ): Promise<AuthSuccessResponseDto> {
        const user = await this.databaseService.user.findFirst({
            where: {
                passwordResetOtp: data.token,
                deletedAt: null,
            },
        });

        if (!user) {
            throw new HttpException(
                'auth.error.invalidOrExpiredResetOtp',
                HttpStatus.BAD_REQUEST
            );
        }

        if (
            !user.passwordResetOtpExpiry ||
            user.passwordResetOtpExpiry <= new Date()
        ) {
            throw new HttpException(
                'auth.error.invalidOrExpiredResetOtp',
                HttpStatus.BAD_REQUEST
            );
        }

        const hashed = await this.helperEncryptionService.createHash(
            data.newPassword
        );

        await this.databaseService.user.update({
            where: { id: user.id },
            data: {
                password: hashed,
                passwordResetOtp: null,
                passwordResetOtpExpiry: null,
            },
        });

        return {
            success: true,
            message: 'auth.success.passwordReset',
        };
    }

    public async changePassword(
        userId: string,
        data: ChangePasswordDto
    ): Promise<AuthSuccessResponseDto> {
        const user = await this.databaseService.user.findUnique({
            where: { id: userId },
        });

        if (!user || user.deletedAt) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        const passwordMatched = await this.helperEncryptionService.match(
            user.password,
            data.currentPassword
        );

        if (!passwordMatched) {
            throw new HttpException(
                'auth.error.invalidPassword',
                HttpStatus.BAD_REQUEST
            );
        }

        const hashed = await this.helperEncryptionService.createHash(
            data.newPassword
        );

        await this.databaseService.user.update({
            where: { id: userId },
            data: { password: hashed },
        });

        if (user.role === Role.USER) {
            this.emailQueue.add(EMAIL_TEMPLATES.PASSWORD_CHANGED, {
                data: {},
                toEmails: [user.email],
            } as ISendEmailBasePayload<IPasswordChangedPayload>);
        } else {
            const adminPanelLink =
                this.configService.get<string>('app.emailLinks.adminPanel') ??
                this.configService.get<string>('app.adminUrl') ??
                '';
            this.emailQueue.add(EMAIL_TEMPLATES.ADMIN_PASSWORD_CHANGED, {
                data: {
                    admin_email: user.email,
                    updated_date: new Date().toISOString().slice(0, 10),
                    admin_panel_link: adminPanelLink,
                },
                toEmails: [user.email],
            } as ISendEmailBasePayload<IAdminPasswordChangedPayload>);
        }

        return {
            success: true,
            message: 'auth.success.passwordChanged',
        };
    }

    public async changeEmail(
        userId: string,
        data: ChangeEmailDto
    ): Promise<AuthSuccessResponseDto> {
        const nextEmail = data.email.trim().toLowerCase();

        const user = await this.databaseService.user.findUnique({
            where: { id: userId },
        });

        if (!user || user.deletedAt) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        if (user.email === nextEmail) {
            throw new HttpException(
                'auth.error.emailUnchanged',
                HttpStatus.BAD_REQUEST
            );
        }

        // Email only needs to be unique within the account's own bucket
        // (one live CUSTOMER + one live TEAM per email).
        const sameBucket =
            user.role === Role.USER
                ? { role: Role.USER }
                : { role: { not: Role.USER } };

        const existingUser = await this.databaseService.user.findFirst({
            where: { email: nextEmail, deletedAt: null, ...sameBucket },
        });

        if (existingUser && existingUser.id !== userId) {
            throw new HttpException(
                'user.error.userExists',
                HttpStatus.CONFLICT
            );
        }

        try {
            await this.databaseService.user.update({
                where: { id: userId },
                data: {
                    email: nextEmail,
                    isVerified: false,
                    emailVerificationToken: null,
                    emailVerificationTokenExpiry: null,
                },
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new HttpException(
                    'user.error.userExists',
                    HttpStatus.CONFLICT
                );
            }
            throw error;
        }

        return this.sendVerificationEmail(userId);
    }

    public async sendVerificationEmail(
        userId: string
    ): Promise<AuthSuccessResponseDto> {
        const user = await this.databaseService.user.findUnique({
            where: { id: userId },
        });

        if (!user || user.deletedAt) {
            throw new HttpException(
                'user.error.userNotFound',
                HttpStatus.NOT_FOUND
            );
        }

        if (user.isVerified) {
            throw new HttpException(
                'auth.error.emailAlreadyVerified',
                HttpStatus.BAD_REQUEST
            );
        }

        const emailToken = randomUUID();
        const emailVerificationTokenExpiry = new Date(
            Date.now() + 24 * 60 * 60 * 1000
        );

        await this.databaseService.user.update({
            where: { id: userId },
            data: {
                emailVerificationToken: emailToken,
                emailVerificationTokenExpiry,
            },
        });

        const frontendUrl =
            this.configService.get<string>('app.frontendUrl') ??
            'http://localhost:3000';
        const verificationUrl = `${frontendUrl.replace(/\/$/, '')}/auth/verify-email?token=${emailToken}`;

        this.emailQueue.add(EMAIL_TEMPLATES.VERIFY_EMAIL, {
            data: {
                verification_link: verificationUrl,
            },
            toEmails: [user.email],
        } as ISendEmailBasePayload<IVerifyEmailPayload>);

        return {
            success: true,
            message: 'auth.success.verificationEmailSent',
        };
    }

    public async verifyEmail(token: string): Promise<AuthSuccessResponseDto> {
        const user = await this.databaseService.user.findFirst({
            where: { emailVerificationToken: token },
        });

        if (!user) {
            throw new HttpException(
                'auth.error.invalidVerificationToken',
                HttpStatus.NOT_FOUND
            );
        }

        if (
            !user.emailVerificationTokenExpiry ||
            user.emailVerificationTokenExpiry <= new Date()
        ) {
            throw new HttpException(
                'auth.error.verificationTokenExpired',
                HttpStatus.BAD_REQUEST
            );
        }

        await this.databaseService.user.update({
            where: { id: user.id },
            data: {
                isVerified: true,
                emailVerificationToken: null,
                emailVerificationTokenExpiry: null,
            },
        });

        return {
            success: true,
            message: 'auth.success.emailVerified',
        };
    }

    private assertValidPasswordResetOtp(
        user: {
            passwordResetOtp: string | null;
            passwordResetOtpExpiry: Date | null;
        },
        otp: string
    ): void {
        if (
            !user.passwordResetOtp ||
            !user.passwordResetOtpExpiry ||
            user.passwordResetOtp !== otp ||
            user.passwordResetOtpExpiry <= new Date()
        ) {
            throw new HttpException(
                'auth.error.invalidOrExpiredResetOtp',
                HttpStatus.BAD_REQUEST
            );
        }
    }

    private assertValidAdminLoginOtp(
        user: {
            adminLoginOtp: string | null;
            adminLoginOtpExpiry: Date | null;
        },
        otp: string
    ): void {
        if (
            !user.adminLoginOtp ||
            !user.adminLoginOtpExpiry ||
            user.adminLoginOtp !== otp ||
            user.adminLoginOtpExpiry <= new Date()
        ) {
            throw new HttpException(
                'auth.error.invalidOrExpiredAdminLoginOtp',
                HttpStatus.BAD_REQUEST
            );
        }
    }
}
