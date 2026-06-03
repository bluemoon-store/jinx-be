import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { AuthUser } from 'src/common/request/decorators/request.user.decorator';
import { IAuthUser } from 'src/common/request/interfaces/request.interface';

import { CreateFiatPaymentDto } from '../dtos/request/create-fiat-payment.request';
import { FiatPaymentResponseDto } from '../dtos/response/fiat-payment.response';
import { FiatPaymentStatusResponseDto } from '../dtos/response/fiat-payment-status.response';
import { FiatPaymentService } from '../services/fiat-payment.service';

@ApiTags('public.fiat-payment')
@Controller({
    path: '/orders',
    version: '1',
})
export class FiatPaymentPublicController {
    constructor(private readonly fiatPaymentService: FiatPaymentService) {}

    @Post(':orderId/fiat-payment')
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Create hosted fiat payment for order' })
    @DocResponse({
        serialization: FiatPaymentResponseDto,
        httpStatus: HttpStatus.CREATED,
        messageKey: 'fiat-payment.success.created',
    })
    public async createPayment(
        @Param('orderId') orderId: string,
        @Body() dto: CreateFiatPaymentDto,
        @AuthUser() user: IAuthUser
    ): Promise<FiatPaymentResponseDto> {
        return this.fiatPaymentService.createPayment(
            orderId,
            dto.gateway,
            user.userId,
            dto.returnUrl
        );
    }

    @Get(':orderId/fiat-payment/status')
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Check fiat payment status by order ID' })
    @DocResponse({
        serialization: FiatPaymentStatusResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'fiat-payment.success.statusRetrieved',
    })
    public async getPaymentStatusByOrderId(
        @Param('orderId') orderId: string,
        @AuthUser() user: IAuthUser
    ): Promise<FiatPaymentStatusResponseDto> {
        return this.fiatPaymentService.getPaymentStatusByOrderId(
            orderId,
            user.userId
        );
    }

    @Get(':orderId/fiat-payment')
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get fiat payment by order ID' })
    @DocResponse({
        serialization: FiatPaymentResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'fiat-payment.success.retrieved',
    })
    public async getPaymentByOrderId(
        @Param('orderId') orderId: string,
        @AuthUser() user: IAuthUser
    ): Promise<FiatPaymentResponseDto> {
        return this.fiatPaymentService.getPaymentByOrderId(
            orderId,
            user.userId
        );
    }
}
