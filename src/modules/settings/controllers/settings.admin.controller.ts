import { Body, Controller, Get, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityLogCategory } from '@prisma/client';

import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { SETTINGS_ACCESS_ROLES } from 'src/common/request/constants/roles.constant';
import { AllowedRoles } from 'src/common/request/decorators/request.role.decorator';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { AuditLog } from 'src/modules/activity-log/decorators/audit-log.decorator';

import { SettingsScheduleMaintenanceRequestDto } from '../dtos/request/settings.schedule-maintenance.request';
import { SettingsTestEmailValidityRequestDto } from '../dtos/request/settings.test-email-validity.request';
import { SettingsUpdateGeneralRequestDto } from '../dtos/request/settings.update-general.request';
import { SettingsUpdateLandingRequestDto } from '../dtos/request/settings.update-landing.request';
import { SettingsUpdatePaymentRequestDto } from '../dtos/request/settings.update-payment.request';
import { SettingsUpdateSocialRequestDto } from '../dtos/request/settings.update-social.request';
import { SettingsEmailValidityTestResponseDto } from '../dtos/response/settings.email-validity-test.response';
import { SettingsGeneralResponseDto } from '../dtos/response/settings.general.response';
import { SettingsLandingResponseDto } from '../dtos/response/settings.landing.response';
import { SettingsPaymentResponseDto } from '../dtos/response/settings.payment.response';
import { SettingsSocialResponseDto } from '../dtos/response/settings.social.response';
import { SettingsService } from '../services/settings.service';

@ApiTags('admin.settings')
@Controller({ path: '/admin/settings', version: '1' })
export class SettingsAdminController {
    constructor(private readonly settingsService: SettingsService) {}

    @Get('general')
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get admin general settings' })
    @DocResponse({
        serialization: SettingsGeneralResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.generalFound',
    })
    async getGeneral(): Promise<SettingsGeneralResponseDto> {
        return this.settingsService.getGeneral();
    }

    @Put('general')
    @AuditLog({
        action: 'settings.general.update',
        category: ActivityLogCategory.SETTINGS,
        resourceType: 'SystemSettings',
    })
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update admin general settings' })
    @DocResponse({
        serialization: SettingsGeneralResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.generalUpdated',
    })
    async updateGeneral(
        @Body() payload: SettingsUpdateGeneralRequestDto
    ): Promise<SettingsGeneralResponseDto> {
        return this.settingsService.updateGeneral(payload);
    }

    @Get('social')
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get admin social settings' })
    @DocResponse({
        serialization: SettingsSocialResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.socialFound',
    })
    async getSocial(): Promise<SettingsSocialResponseDto> {
        return this.settingsService.getSocial();
    }

    @Put('social')
    @AuditLog({
        action: 'settings.social.update',
        category: ActivityLogCategory.SETTINGS,
        resourceType: 'SystemSettings',
    })
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update admin social settings' })
    @DocResponse({
        serialization: SettingsSocialResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.socialUpdated',
    })
    async updateSocial(
        @Body() payload: SettingsUpdateSocialRequestDto
    ): Promise<SettingsSocialResponseDto> {
        return this.settingsService.updateSocial(payload);
    }

    @Get('landing')
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get admin landing-page text settings' })
    @DocResponse({
        serialization: SettingsLandingResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.landingFound',
    })
    async getLanding(): Promise<SettingsLandingResponseDto> {
        return this.settingsService.getLanding();
    }

    @Put('landing')
    @AuditLog({
        action: 'settings.landing.update',
        category: ActivityLogCategory.SETTINGS,
        resourceType: 'SystemSettings',
    })
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update admin landing-page text settings' })
    @DocResponse({
        serialization: SettingsLandingResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.landingUpdated',
    })
    async updateLanding(
        @Body() payload: SettingsUpdateLandingRequestDto
    ): Promise<SettingsLandingResponseDto> {
        return this.settingsService.updateLanding(payload);
    }

    @Get('payment')
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get admin payment settings' })
    @DocResponse({
        serialization: SettingsPaymentResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.paymentFound',
    })
    async getPayment(): Promise<SettingsPaymentResponseDto> {
        return this.settingsService.getPayment();
    }

    @Put('payment')
    @AuditLog({
        action: 'settings.payment.update',
        category: ActivityLogCategory.SETTINGS,
        resourceType: 'SystemSettings',
    })
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update admin payment settings' })
    @DocResponse({
        serialization: SettingsPaymentResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.paymentUpdated',
    })
    async updatePayment(
        @Body() payload: SettingsUpdatePaymentRequestDto
    ): Promise<SettingsPaymentResponseDto> {
        return this.settingsService.updatePayment(payload);
    }

    @Post('test-email-validity')
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Test external email validity URL' })
    @DocResponse({
        serialization: SettingsEmailValidityTestResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.emailValidityTested',
    })
    async testEmailValidity(
        @Body() payload: SettingsTestEmailValidityRequestDto
    ): Promise<SettingsEmailValidityTestResponseDto> {
        return this.settingsService.testEmailValidityUrl(payload.url);
    }

    @Post('schedule-maintenance')
    @AuditLog({
        action: 'settings.maintenance.broadcast',
        category: ActivityLogCategory.SETTINGS,
        resourceType: 'SystemSettings',
    })
    @AllowedRoles(SETTINGS_ACCESS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({
        summary: 'Broadcast a scheduled-maintenance email to all active users',
    })
    @DocResponse({
        serialization: ApiGenericResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.maintenanceScheduled',
    })
    async scheduleMaintenance(
        @Body() payload: SettingsScheduleMaintenanceRequestDto
    ): Promise<ApiGenericResponseDto> {
        return this.settingsService.broadcastMaintenanceNotice(payload);
    }
}
