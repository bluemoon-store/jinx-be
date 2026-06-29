import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { PublicRoute } from 'src/common/request/decorators/request.public.decorator';

import { SettingsBuyerProtectionResponseDto } from '../dtos/response/settings.buyer-protection.response';
import { SettingsLandingResponseDto } from '../dtos/response/settings.landing.response';
import { SettingsPaymentMethodsResponseDto } from '../dtos/response/settings.payment-methods.response';
import { SettingsPublicResponseDto } from '../dtos/response/settings.public.response';
import { SettingsService } from '../services/settings.service';

@ApiTags('public.settings')
@Controller({ path: '/settings', version: '1' })
export class SettingsPublicController {
    constructor(private readonly settingsService: SettingsService) {}

    @Get('public')
    @PublicRoute()
    @ApiOperation({ summary: 'Get public settings' })
    @DocResponse({
        serialization: SettingsPublicResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.publicFound',
    })
    async getPublic(): Promise<SettingsPublicResponseDto> {
        return this.settingsService.getPublic();
    }

    @Get('landing')
    @PublicRoute()
    @ApiOperation({ summary: 'Get public landing-page text settings' })
    @DocResponse({
        serialization: SettingsLandingResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.landingFound',
    })
    async getLanding(): Promise<SettingsLandingResponseDto> {
        return this.settingsService.getLanding();
    }

    @Get('buyer-protection')
    @PublicRoute()
    @ApiOperation({ summary: 'Get public buyer-protection settings' })
    @DocResponse({
        serialization: SettingsBuyerProtectionResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.buyerProtectionFound',
    })
    async getBuyerProtection(): Promise<SettingsBuyerProtectionResponseDto> {
        return this.settingsService.getBuyerProtection();
    }

    @Get('payment-methods')
    @PublicRoute()
    @ApiOperation({ summary: 'Get enabled payment methods' })
    @DocResponse({
        serialization: SettingsPaymentMethodsResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'settings.success.paymentFound',
    })
    async getPaymentMethods(): Promise<SettingsPaymentMethodsResponseDto> {
        return this.settingsService.getEnabledPaymentMethods();
    }
}
