import {
    Body,
    Controller,
    Delete,
    Get,
    HttpStatus,
    Param,
    Post,
    Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityLogCategory, ActivityLogSeverity, Role } from '@prisma/client';

import { DocGenericResponse } from 'src/common/doc/decorators/doc.generic.decorator';
import { AuditLog } from 'src/modules/activity-log/decorators/audit-log.decorator';
import { AllowedRoles } from 'src/common/request/decorators/request.role.decorator';
import { AuthUser } from 'src/common/request/decorators/request.user.decorator';
import { IAuthUser } from 'src/common/request/interfaces/request.interface';

import { TeamInviteRequestDto } from '../dtos/request/team.invite.request';
import { TeamUpdateRequestDto } from '../dtos/request/team.update.request';
import { UserTeamService } from '../services/user.team.service';

@ApiTags('admin.team')
@Controller({
    path: '/admin/team',
    version: '1',
})
export class UserTeamController {
    constructor(private readonly userTeamService: UserTeamService) {}

    @Get()
    @AllowedRoles([Role.OWNER])
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'List team members' })
    public listTeamMembers() {
        return this.userTeamService.listTeamMembers();
    }

    @Post('invite')
    @AllowedRoles([Role.OWNER])
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Invite team member' })
    @AuditLog({
        action: 'team.invite',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
    })
    public inviteTeamMember(
        @Body() payload: TeamInviteRequestDto,
        @AuthUser() user: IAuthUser
    ) {
        return this.userTeamService.inviteTeamMember(payload, user.userId);
    }

    @Put(':id')
    @AllowedRoles([Role.OWNER])
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Update team member role/status' })
    @AuditLog({
        action: 'team.update',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
    })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.updated',
    })
    public updateTeamMember(
        @Param('id') id: string,
        @Body() payload: TeamUpdateRequestDto
    ) {
        return this.userTeamService.updateTeamMember(id, payload);
    }

    @Delete(':id')
    @AllowedRoles([Role.SUPER_ADMIN])
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Delete team member' })
    @AuditLog({
        action: 'team.remove',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
        severity: ActivityLogSeverity.WARNING,
    })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.deleted',
    })
    public removeTeamMember(@Param('id') id: string) {
        return this.userTeamService.removeTeamMember(id);
    }

    @Post(':id/resend-invite')
    @AllowedRoles([Role.OWNER])
    @ApiBearerAuth('accessToken')
    @ApiOperation({ summary: 'Resend invitation email' })
    @AuditLog({
        action: 'team.resend_invite',
        category: ActivityLogCategory.USER,
        resourceType: 'User',
        resourceIdParam: 'id',
    })
    @DocGenericResponse({
        httpStatus: HttpStatus.OK,
        messageKey: 'user.success.inviteResent',
    })
    public resendInvite(@Param('id') id: string) {
        return this.userTeamService.resendInvite(id);
    }
}
