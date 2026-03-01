import { Controller, Get, UseGuards } from '@nestjs/common'
import { AdminOnlyGuard } from '../auth/guards/admin-only.guard'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { SandboxService } from './sandbox.service'

@Controller('sandboxes')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Get()
  list() {
    return this.sandboxService.list()
  }
}
