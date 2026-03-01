import { Controller, Get, UseGuards } from '@nestjs/common'
import { AdminOnlyGuard } from '../auth/guards/admin-only.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { AuditService } from './audit.service'

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list() {
    return this.auditService.listLogs()
  }
}
