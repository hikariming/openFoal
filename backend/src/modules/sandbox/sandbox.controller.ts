import { Controller, Get } from '@nestjs/common'
import { SandboxService } from './sandbox.service'

@Controller('sandboxes')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Get()
  list() {
    return this.sandboxService.list()
  }
}
