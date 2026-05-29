import {
    Body,
    Controller,
    Get,
    HttpStatus,
    Param,
    Post,
    Put,
    Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityLogCategory, ActivityLogSeverity } from '@prisma/client';

import {
    READ_ADMIN_ROLES,
    STAFF_OPERATIONS_ROLES,
    SUPPORT_HANDLING_ROLES,
} from 'src/common/request/constants/roles.constant';

import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';
import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { DocPaginatedResponse } from 'src/common/doc/decorators/doc.paginated.decorator';
import { DocGenericResponse } from 'src/common/doc/decorators/doc.generic.decorator';
import { AllowedRoles } from 'src/common/request/decorators/request.role.decorator';
import { AuthUser } from 'src/common/request/decorators/request.user.decorator';
import { IAuthUser } from 'src/common/request/interfaces/request.interface';
import { QueryTransformPipe } from 'src/common/request/pipes/query-transform.pipe';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';

import { OrderIssueCreditDto } from '../dtos/request/order.issue-credit.request';
import { OrderIssueReplacementDto } from '../dtos/request/order.issue-replacement.request';
import { OrderStatusUpdateDto } from '../dtos/request/order.status-update.request';
import { OrderListQueryDto } from '../dtos/request/order-list.request';
import { OrderDeliverDto } from '../dtos/request/order.deliver.request';
import {
    OrderResponseDto,
    OrderDetailResponseDto,
} from '../dtos/response/order.response';
import { OrderService } from '../services/order.service';
import { OrderDeliveryService } from '../services/order-delivery.service';
import { AuditLog } from 'src/modules/activity-log/decorators/audit-log.decorator';

@ApiTags('admin.order')
@Controller({
    path: '/admin/orders',
    version: '1',
})
export class OrderAdminController {
    constructor(
        private readonly orderService: OrderService,
        private readonly deliveryService: OrderDeliveryService
    ) {}

    @Get()
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'List all orders (admin)' })
    @DocPaginatedResponse({
        serialization: OrderDetailResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'order.success.list',
    })
    public async getAllOrders(
        @Query(new QueryTransformPipe()) query: OrderListQueryDto
    ): Promise<ApiPaginatedDataDto<OrderDetailResponseDto>> {
        return this.orderService.getAllOrders({
            page: query.page,
            limit: query.limit,
            status: query.status,
            userId: query.userId,
        });
    }

    @Get(':id')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get order detail (admin)' })
    @DocResponse({
        serialization: OrderDetailResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'order.success.orderFound',
    })
    public async getOrderDetail(
        @Param('id') orderId: string
    ): Promise<OrderDetailResponseDto> {
        return this.orderService.getOrderDetail(orderId, undefined, true);
    }

    @Put(':id/status')
    @AuditLog({
        action: 'order.status.update',
        category: ActivityLogCategory.ORDER,
        resourceType: 'Order',
        resourceIdParam: 'id',
        severity: ActivityLogSeverity.WARNING,
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update order status' })
    @DocResponse({
        serialization: OrderResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'order.success.statusUpdated',
    })
    public async updateOrderStatus(
        @Param('id') orderId: string,
        @Body() payload: OrderStatusUpdateDto
    ): Promise<OrderResponseDto> {
        return this.orderService.updateOrderStatus(orderId, payload);
    }

    @Post(':id/deliver')
    @AuditLog({
        action: 'order.deliver',
        category: ActivityLogCategory.ORDER,
        resourceType: 'Order',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Manually deliver order' })
    @DocResponse({
        serialization: OrderResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'order.success.delivered',
    })
    public async deliverOrder(
        @Param('id') orderId: string,
        @Body() payload: OrderDeliverDto
    ): Promise<OrderResponseDto> {
        return this.deliveryService.deliverOrder(orderId, payload);
    }

    @Post(':id/refund')
    @AuditLog({
        action: 'order.refund',
        category: ActivityLogCategory.ORDER,
        resourceType: 'Order',
        resourceIdParam: 'id',
    })
    @AllowedRoles(SUPPORT_HANDLING_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Refund order' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'order.success.refunded',
    })
    public async refundOrder(
        @Param('id') orderId: string
    ): Promise<ApiGenericResponseDto> {
        return this.orderService.refundOrder(orderId);
    }

    @Post(':id/issue-replacement')
    @AuditLog({
        action: 'order.issueReplacement',
        category: ActivityLogCategory.ORDER,
        resourceType: 'Order',
        resourceIdParam: 'id',
        severity: ActivityLogSeverity.WARNING,
    })
    @AllowedRoles(SUPPORT_HANDLING_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({
        summary: 'Issue replacement gift-card content for selected order items',
    })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'order.success.replacementIssued',
    })
    public async issueReplacement(
        @AuthUser() user: IAuthUser,
        @Param('id') orderId: string,
        @Body() payload: OrderIssueReplacementDto
    ): Promise<ApiGenericResponseDto> {
        return this.orderService.issueReplacement(
            orderId,
            user.userId,
            payload
        );
    }

    @Post(':id/issue-credit')
    @AuditLog({
        action: 'order.issueCredit',
        category: ActivityLogCategory.ORDER,
        resourceType: 'Order',
        resourceIdParam: 'id',
        severity: ActivityLogSeverity.WARNING,
    })
    @AllowedRoles(SUPPORT_HANDLING_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({
        summary: 'Issue partial store credit to the customer wallet',
    })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'order.success.creditIssued',
    })
    public async issueCredit(
        @AuthUser() user: IAuthUser,
        @Param('id') orderId: string,
        @Body() payload: OrderIssueCreditDto
    ): Promise<ApiGenericResponseDto> {
        return this.orderService.issueCredit(orderId, user.userId, payload);
    }
}
