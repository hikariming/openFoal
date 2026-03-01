import { Injectable } from '@nestjs/common'

@Injectable()
export class AuditService {
  listLogs() {
    return [
      {
        id: 'al_01',
        actor: 'admin@openfoal.dev',
        action: 'sandbox.start',
        resource: 'sbx_design_review',
        result: 'success',
        createdAt: '2026-03-01T10:06:00.000Z',
      },
    ]
  }
}
