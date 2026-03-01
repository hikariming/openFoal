import { Injectable } from '@nestjs/common'

@Injectable()
export class SandboxService {
  list() {
    return [
      {
        id: 'sbx_design_review',
        name: 'design-review-sbx',
        status: 'running',
        runtime: 'Node.js 22',
        image: 'openfoal/sandbox:2026.02.28',
      },
      {
        id: 'sbx_agent_eval',
        name: 'agent-eval-sbx',
        status: 'stopped',
        runtime: 'Python 3.12',
        image: 'openfoal/sandbox:2026.02.20',
      },
    ]
  }
}
