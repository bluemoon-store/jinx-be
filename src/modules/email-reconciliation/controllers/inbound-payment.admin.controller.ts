import {
    Body,
    Controller,
    Get,
    HttpStatus,
    Param,
    Post,
    Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
    READ_ADMIN_ROLES,
    STAFF_OPERATIONS_ROLES,
} from 'src/common/request/constants/roles.constant';
import { AllowedRoles } from 'src/common/request/decorators/request.role.decorator';
import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';

import {
    InboundPaymentListQueryDto,
    InboundPaymentMatchRequestDto,
    InboundPaymentResponseDto,
} from '../dtos/inbound-payment.dto';
import { InboundPaymentAdminService } from '../services/inbound-payment.admin.service';

@ApiTags('admin.inbound-payment')
@Controller({
    path: '/admin/inbound-payments',
    version: '1',
})
export class InboundPaymentAdminController {
    constructor(
        private readonly inboundPaymentService: InboundPaymentAdminService
    ) {}

    @Get()
    @ApiBearerAuth('accessToken')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiOperation({ summary: 'List parsed inbound payment emails' })
    public async list(
        @Query() query: InboundPaymentListQueryDto
    ): Promise<ApiPaginatedDataDto<InboundPaymentResponseDto>> {
        return this.inboundPaymentService.list(query);
    }

    @Post(':id/match')
    @ApiBearerAuth('accessToken')
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiOperation({
        summary: 'Manually credit an inbound payment to an order',
    })
    @DocResponse({
        serialization: InboundPaymentResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'inbound-payment.success.matched',
    })
    public async match(
        @Param('id') id: string,
        @Body() dto: InboundPaymentMatchRequestDto
    ): Promise<InboundPaymentResponseDto> {
        return this.inboundPaymentService.matchToOrder(id, dto.orderNumber);
    }

    @Post(':id/ignore')
    @ApiBearerAuth('accessToken')
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiOperation({ summary: 'Dismiss an inbound payment email' })
    @DocResponse({
        serialization: InboundPaymentResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'inbound-payment.success.ignored',
    })
    public async ignore(
        @Param('id') id: string
    ): Promise<InboundPaymentResponseDto> {
        return this.inboundPaymentService.ignore(id);
    }
}
