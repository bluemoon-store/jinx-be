import { IAuthUser } from 'src/common/request/interfaces/request.interface';

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

export interface IAuthService {
    login(
        data: UserLoginDto
    ): Promise<AuthResponseDto | TwoFactorChallengeResponseDto>;
    verifyTwoFactorLogin(
        data: TwoFactorVerifyLoginDto
    ): Promise<AuthResponseDto>;
    adminLogin(
        data: AdminLoginDto
    ): Promise<AdminLoginChallengeResponseDto | AuthResponseDto>;
    verifyAdminLoginOtp(data: AdminVerifyOtpDto): Promise<AuthResponseDto>;
    resendAdminLoginOtp(
        data: AdminResendOtpDto
    ): Promise<AuthSuccessResponseDto>;
    signup(data: UserCreateDto): Promise<AuthResponseDto>;
    logout(): Promise<{ success: boolean; message: string }>;
    refreshTokens(payload: IAuthUser): Promise<AuthRefreshResponseDto>;
    setupTwoFactor(
        userId: string,
        data: TwoFactorSetupDto
    ): Promise<TwoFactorSetupResponseDto>;
    verifyTwoFactor(
        userId: string,
        data: TwoFactorVerifyDto
    ): Promise<TwoFactorVerifyResponseDto>;
    disableTwoFactor(
        userId: string,
        data: TwoFactorDisableDto
    ): Promise<{ success: boolean; message: string }>;
    forgotPassword(data: ForgotPasswordDto): Promise<AuthSuccessResponseDto>;
    forgotPasswordLink(
        data: ForgotPasswordDto
    ): Promise<AuthSuccessResponseDto>;
    verifyOtp(data: VerifyOtpDto): Promise<AuthSuccessResponseDto>;
    resetPassword(data: ResetPasswordDto): Promise<AuthSuccessResponseDto>;
    resetPasswordLink(
        data: ResetPasswordLinkDto
    ): Promise<AuthSuccessResponseDto>;
    changePassword(
        userId: string,
        data: ChangePasswordDto
    ): Promise<AuthSuccessResponseDto>;
    changeEmail(
        userId: string,
        data: ChangeEmailDto
    ): Promise<AuthSuccessResponseDto>;
    sendVerificationEmail(userId: string): Promise<AuthSuccessResponseDto>;
    verifyEmail(token: string): Promise<AuthSuccessResponseDto>;
}
