import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common'
import { IsIn, IsString, MinLength } from 'class-validator'
import { JwtClaims, UserRole } from '../auth/auth.types'
import { AdminOnlyGuard } from '../auth/guards/admin-only.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { MemberStatus, MembersService } from './members.service'

class AccountIdParamDto {
  @IsString()
  @MinLength(2)
  accountId!: string
}

class UpdateRoleDto {
  @IsIn(['admin', 'member'])
  role!: UserRole
}

class UpdateStatusDto {
  @IsIn(['active', 'disabled'])
  status!: Extract<MemberStatus, 'active' | 'disabled'>
}

@Controller('members')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  list(@Req() req: { user: JwtClaims }) {
    return this.membersService.listMembers(req.user.tenantId)
  }

  @Patch(':accountId/role')
  updateRole(
    @Req() req: { user: JwtClaims },
    @Param() params: AccountIdParamDto,
    @Body() body: UpdateRoleDto,
  ) {
    return this.membersService.updateMemberRole({
      tenantId: req.user.tenantId,
      accountId: params.accountId,
      role: body.role,
    })
  }

  @Patch(':accountId/status')
  updateStatus(
    @Req() req: { user: JwtClaims },
    @Param() params: AccountIdParamDto,
    @Body() body: UpdateStatusDto,
  ) {
    return this.membersService.updateMemberStatus({
      tenantId: req.user.tenantId,
      accountId: params.accountId,
      status: body.status,
    })
  }
}
