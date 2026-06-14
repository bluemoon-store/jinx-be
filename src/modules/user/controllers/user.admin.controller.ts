import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    Res,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiProduces,
    ApiTags,
} from '@nestjs/swagger';
import { ActivityLogCategory } from '@prisma/client';
import { Response } from 'express';

import {
    READ_ADMIN_ROLES,
    STAFF_OPERATIONS_ROLES,
} from 'src/common/request/constants/roles.constant';

import { DocGenericResponse } from 'src/common/doc/decorators/doc.generic.decorator';
import { DocPaginatedResponse } from 'src/common/doc/decorators/doc.paginated.decorator';
import { DocResponse } from 'src/common/doc/decorators/doc.response.decorator';
import { AllowedRoles } from 'src/common/request/decorators/request.role.decorator';
import { AuthUser } from 'src/common/request/decorators/request.user.decorator';
import { QueryTransformPipe } from 'src/common/request/pipes/query-transform.pipe';
import { IAuthUser } from 'src/common/request/interfaces/request.interface';
import { ApiGenericResponseDto } from 'src/common/response/dtos/response.generic.dto';
import { ApiPaginatedDataDto } from 'src/common/response/dtos/response.paginated.dto';

import { UserBanDto } from '../dtos/request/user.ban.request';
import { UserFlagDto } from '../dtos/request/user.flag.request';
import { UserListQueryDto } from '../dtos/request/user.list.query.request';
import { UserExportQueryDto } from '../dtos/request/user.export.query.request';
import { UserAdminCreateDto } from '../dtos/request/user.admin.create.request';
import {
    UserAdminListItemResponseDto,
    UserAdminStatsResponseDto,
} from '../dtos/response/user.admin.response';
import { UserAdminCreateResponseDto } from '../dtos/response/user.admin.create.response';
import { UserService } from '../services/user.service';
import { AuditLog } from 'src/modules/activity-log/decorators/audit-log.decorator';

@ApiTags('admin.user')
@Controller({
    path: '/admin/user',
    version: '1',
})
export class UserAdminController {
    constructor(private readonly userService: UserService) {}

    @Get()
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'List users (admin)' })
    @DocPaginatedResponse({
        serialization: UserAdminListItemResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.userListRetrieved',
    })
    public async listUsers(
        @Query(
            new QueryTransformPipe({
                booleanFields: ['isBanned', 'isVerified', 'isFlagged'],
            })
        )
        query: UserListQueryDto
    ): Promise<ApiPaginatedDataDto<UserAdminListItemResponseDto>> {
        return this.userService.listUsers(query);
    }

    @Get('stats')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'User statistics (admin)' })
    @DocResponse({
        serialization: UserAdminStatsResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.userStatsRetrieved',
    })
    public async getUserStats(): Promise<UserAdminStatsResponseDto> {
        return this.userService.getUserStats();
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @AuditLog({
        action: 'user.create',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdResponsePath: 'user.id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Create a regular user (admin)' })
    @DocResponse({
        serialization: UserAdminCreateResponseDto,
        httpStatus: HttpStatus.CREATED,
        messageKey: 'user.success.created',
    })
    public async createUser(
        @Body() payload: UserAdminCreateDto
    ): Promise<UserAdminCreateResponseDto> {
        return this.userService.createByAdmin(payload);
    }

    @Get('export')
    @AuditLog({
        action: 'user.export',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
    })
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Export users as CSV or TXT (admin)' })
    @ApiProduces('text/csv', 'text/plain')
    public async exportUsers(
        @Query(
            new QueryTransformPipe({
                booleanFields: ['isBanned', 'isVerified', 'isFlagged'],
            })
        )
        query: UserExportQueryDto,
        @Res() res: Response
    ): Promise<void> {
        await this.userService.streamExportUsers(query, res);
    }

    @Get(':id')
    @AllowedRoles(READ_ADMIN_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Get user by id (admin)' })
    @DocResponse({
        serialization: UserAdminListItemResponseDto,
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.userRetrieved',
    })
    public async getUser(
        @Param('id') userId: string
    ): Promise<UserAdminListItemResponseDto> {
        return this.userService.getUserById(userId);
    }

    @Post(':id/flag')
    @AuditLog({
        action: 'user.flag',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Flag user' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.userFlagged',
    })
    public async flagUser(
        @Param('id') userId: string,
        @Body() payload: UserFlagDto
    ): Promise<ApiGenericResponseDto> {
        return this.userService.flagUser(userId, payload);
    }

    @Post(':id/unflag')
    @AuditLog({
        action: 'user.unflag',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Unflag user' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.userUnflagged',
    })
    public async unflagUser(
        @Param('id') userId: string
    ): Promise<ApiGenericResponseDto> {
        return this.userService.unflagUser(userId);
    }

    @Post(':id/ban')
    @AuditLog({
        action: 'user.ban',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Ban user' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.userBanned',
    })
    public async banUser(
        @Param('id') userId: string,
        @Body() payload: UserBanDto
    ): Promise<ApiGenericResponseDto> {
        return this.userService.banUser(userId, payload);
    }

    @Post(':id/unban')
    @AuditLog({
        action: 'user.unban',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Unban user' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.userUnbanned',
    })
    public async unbanUser(
        @Param('id') userId: string
    ): Promise<ApiGenericResponseDto> {
        return this.userService.unbanUser(userId);
    }

    @Delete(':id')
    @AuditLog({
        action: 'user.delete',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
    })
    @AllowedRoles(STAFF_OPERATIONS_ROLES)
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Delete user' })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.deleted',
    })
    public async deleteUser(
        @Param('id') userId: string,
        @AuthUser() user: IAuthUser
    ): Promise<ApiGenericResponseDto> {
        return this.userService.deleteUser(userId, user.userId, user.role);
    }
}
