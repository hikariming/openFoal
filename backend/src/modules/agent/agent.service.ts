import { Injectable } from '@nestjs/common'

@Injectable()
export class AgentService {
  listAgents() {
    return [
      { id: 'ag_ops', name: 'Ops Copilot', status: 'active' },
      { id: 'ag_research', name: 'Research Copilot', status: 'active' },
    ]
  }
}
