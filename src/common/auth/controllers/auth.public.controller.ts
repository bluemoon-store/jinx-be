import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DocGenericResponse } from 'src/common/doc/decorators/doc.generic.decorator';
import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { PublicRoute } from 'src/common/request/decorators/request.public.decorator';
import { AuthUser } from 'src/common/request/decorators/request.user.decorator';
import { JwtAccessGuard } from 'src/common/request/guards/jwt.access.guard';
import { JwtRefreshGuard } from 'src/common/request/guards/jwt.refresh.guard';
import { TurnstileGuard } from 'src/common/request/guards/turnstile.guard';
import { IAuthUser } from 'src/common/request/interfaces/request.interface';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { UserGetProfileResponseDto } from 'src/modules/user/dtos/response/user.response';
import { UserService } from 'src/modules/user/services/user.service';
import { UserTeamService } from 'src/modules/user/services/user.team.service';

import { TwoFactorDisableDto } from '../dtos/request/auth.2fa.disable.dto';
import { TwoFactorSetupDto } from '../dtos/request/auth.2fa.setup.dto';
import { TwoFactorVerifyLoginDto } from '../dtos/request/auth.2fa.verify-login.dto';
import { TwoFactorVerifyDto } from '../dtos/request/auth.2fa.verify.dto';
import { AdminLoginDto } from '../dtos/request/auth.admin-login.dto';
import { AdminResendOtpDto } from '../dtos/request/auth.admin-resend-otp.dto';
import { AdminVerifyOtpDto } from '../dtos/request/auth.admin-verify-otp.dto';
import { AcceptInvitationRequestDto } from '../dtos/request/accept-invitation.request';
import { ChangeEmailDto } from '../dtos/request/auth.change-email.dto';
import { ChangePasswordDto } from '../dtos/request/auth.change-password.dto';
import { ForgotPasswordDto } from '../dtos/request/auth.forgot-password.dto';
import { UserLoginDto } from '../dtos/request/auth.login.dto';
import { ResetPasswordLinkDto } from '../dtos/request/auth.reset-password-link.dto';
import { ResetPasswordDto } from '../dtos/request/auth.reset-password.dto';
import { UserCreateDto } from '../dtos/request/auth.signup.dto';
import { VerifyEmailQueryDto } from '../dtos/request/auth.verify-email.query.dto';
import { VerifyOtpDto } from '../dtos/request/auth.verify-otp.dto';
import {
    TwoFactorSetupResponseDto,
    TwoFactorVerifyResponseDto,
} from '../dtos/response/auth.2fa.response';
import {
    AdminLoginChallengeResponseDto,
    AdminLoginResponseSerializerDto,
    AuthRefreshResponseDto,
    AuthResponseDto,
    AuthSuccessResponseDto,
    LoginResponseSerializerDto,
    TwoFactorChallengeResponseDto,
} from '../dtos/response/auth.response.dto';
import { AuthService } from '../services/auth.service';

@ApiTags('public.auth')
@Controller({
    version: '1',
    path: '/auth',
})
export class AuthPublicController {
    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly userTeamService: UserTeamService
    ) {}

    @Post('login')
    @PublicRoute()
    @UseGuards(TurnstileGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'User login',
        description:
            'Returns tokens when 2FA is off. When 2FA is on, returns requiresTwoFactor and twoFactorToken; complete login via POST /auth/2fa/verify-login.',
    })
    @DocResponse({
        serialization: LoginResponseSerializerDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.login',
    })
    public login(
        @Body() payload: UserLoginDto
    ): Promise<AuthResponseDto | TwoFactorChallengeResponseDto> {
        return this.authService.login(payload);
    }

    @Post('2fa/verify-login')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Complete login with TOTP after password step' })
    @DocResponse({
        serialization: AuthResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.login',
    })
    public verifyTwoFactorLogin(
        @Body() payload: TwoFactorVerifyLoginDto
    ): Promise<AuthResponseDto> {
        return this.authService.verifyTwoFactorLogin(payload);
    }

    @Post('admin/login')
    @PublicRoute()
    @UseGuards(TurnstileGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Admin login (step 1)',
        description:
            'Verifies admin credentials. When the email-code feature is enabled, emails a 6-digit code and returns a challengeToken (complete via POST /auth/admin/verify-otp). When disabled, returns tokens directly.',
    })
    @DocResponse({
        serialization: AdminLoginResponseSerializerDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.adminLoginOtpSent',
    })
    public adminLogin(
        @Body() payload: AdminLoginDto
    ): Promise<AdminLoginChallengeResponseDto | AuthResponseDto> {
        return this.authService.adminLogin(payload);
    }

    @Post('admin/verify-otp')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Admin login (step 2) — verify emailed code' })
    @DocResponse({
        serialization: AuthResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.login',
    })
    public verifyAdminLoginOtp(
        @Body() payload: AdminVerifyOtpDto
    ): Promise<AuthResponseDto> {
        return this.authService.verifyAdminLoginOtp(payload);
    }

    @Post('admin/resend-otp')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Resend the admin login code' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.adminLoginOtpSent',
    })
    public resendAdminLoginOtp(
        @Body() payload: AdminResendOtpDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.resendAdminLoginOtp(payload);
    }

    @Post('signup')
    @PublicRoute()
    @UseGuards(TurnstileGuard)
    @ApiOperation({ summary: 'User signup' })
    @DocResponse({
        serialization: AuthResponseDto,
        httpStatus: HttpStatus.CREATED,
        messageKey: 'auth.success.signup',
    })
    public signup(@Body() payload: UserCreateDto): Promise<AuthResponseDto> {
        return this.authService.signup(payload);
    }

    @Post('accept-invitation')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Accept team invitation' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.invitationAccepted',
    })
    public acceptInvitation(
        @Body() payload: AcceptInvitationRequestDto
    ): Promise<ApiGenericResponseDto> {
        return this.userTeamService.acceptInvitation(payload);
    }

    @Post('forgot-password')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Request password reset OTP' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.forgotPassword',
    })
    public forgotPassword(
        @Body() payload: ForgotPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.forgotPassword(payload);
    }

    @Post('forgot-password-link')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Request password reset link (email)' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.forgotPassword',
    })
    public forgotPasswordLink(
        @Body() payload: ForgotPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.forgotPasswordLink(payload);
    }

    @Post('verify-otp')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify password reset OTP' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.otpVerified',
    })
    public verifyOtp(
        @Body() payload: VerifyOtpDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.verifyOtp(payload);
    }

    @Post('reset-password')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reset password with OTP' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.passwordReset',
    })
    public resetPassword(
        @Body() payload: ResetPasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.resetPassword(payload);
    }

    @Post('reset-password-link')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reset password with token from email link' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.passwordReset',
    })
    public resetPasswordLink(
        @Body() payload: ResetPasswordLinkDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.resetPasswordLink(payload);
    }

    @Put('change-password')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Change password (authenticated)' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.passwordChanged',
    })
    public changePassword(
        @AuthUser() user: IAuthUser,
        @Body() payload: ChangePasswordDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.changePassword(user.userId, payload);
    }

    @Put('change-email')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Change email (authenticated)' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.verificationEmailSent',
    })
    public changeEmail(
        @AuthUser() user: IAuthUser,
        @Body() payload: ChangeEmailDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.changeEmail(user.userId, payload);
    }

    @Post('send-verification-email')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Send email verification link' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.verificationEmailSent',
    })
    public sendVerificationEmail(
        @AuthUser() user: IAuthUser
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.sendVerificationEmail(user.userId);
    }

    @Get('verify-email')
    @PublicRoute()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify email via token from link' })
    @DocResponse({
        serialization: AuthSuccessResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.emailVerified',
    })
    public verifyEmail(
        @Query() query: VerifyEmailQueryDto
    ): Promise<AuthSuccessResponseDto> {
        return this.authService.verifyEmail(query.token);
    }

    @Post('logout')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'User logout' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.logout',
    })
    public logout(): Promise<{ success: boolean; message: string }> {
        return this.authService.logout();
    }

    @Get('me')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Get authenticated user profile' })
    @DocResponse({
        serialization: UserGetProfileResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.profile',
    })
    public getMe(
        @AuthUser() user: IAuthUser
    ): Promise<UserGetProfileResponseDto> {
        return this.userService.getProfile(user.userId);
    }

    @Get('refresh-token')
    @PublicRoute()
    @UseGuards(JwtRefreshGuard)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth('refreshToken')
    @ApiOperation({ summary: 'Refresh token' })
    @DocResponse({
        serialization: AuthRefreshResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.refreshToken',
    })
    public refreshTokens(
        @AuthUser() user: IAuthUser
    ): Promise<AuthRefreshResponseDto> {
        return this.authService.refreshTokens(user);
    }

    @Post('2fa/setup')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Setup two-factor authentication' })
    @DocResponse({
        serialization: TwoFactorSetupResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.twoFactorSetup',
    })
    public setupTwoFactor(
        @AuthUser() user: IAuthUser,
        @Body() payload: TwoFactorSetupDto
    ): Promise<TwoFactorSetupResponseDto> {
        return this.authService.setupTwoFactor(user.userId, payload);
    }

    @Post('2fa/verify')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Verify and enable two-factor authentication' })
    @DocResponse({
        serialization: TwoFactorVerifyResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.twoFactorEnabled',
    })
    public verifyTwoFactor(
        @AuthUser() user: IAuthUser,
        @Body() payload: TwoFactorVerifyDto
    ): Promise<TwoFactorVerifyResponseDto> {
        return this.authService.verifyTwoFactor(user.userId, payload);
    }

    @Delete('2fa')
    @UseGuards(JwtAccessGuard)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Disable two-factor authentication' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'auth.success.twoFactorDisabled',
    })
    public disableTwoFactor(
        @AuthUser() user: IAuthUser,
        @Body() payload: TwoFactorDisableDto
    ): Promise<{ success: boolean; message: string }> {
        return this.authService.disableTwoFactor(user.userId, payload);
    }
}
