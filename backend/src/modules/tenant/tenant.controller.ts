import { Controller, Get, UseGuards } from '@nestjs/common'
import { AdminOnlyGuard } from '../auth/guards/admin-only.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { TenantService } from './tenant.service'

@Controller('tenants')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  list() {
    return this.tenantService.listTenants()
  }
}
