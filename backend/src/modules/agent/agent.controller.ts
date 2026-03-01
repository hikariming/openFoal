import { Controller, Get } from '@nestjs/common'
import { AgentService } from './agent.service'

@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get()
  list() {
    return this.agentService.listAgents()
  }
}
