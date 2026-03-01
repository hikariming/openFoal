import { Injectable } from '@nestjs/common'

@Injectable()
export class TenantService {
  listTenants() {
    return [
      { id: 't_openfoal', name: 'OpenFoal', slug: 'openfoal' },
      { id: 't_aiteam', name: 'AI Team', slug: 'ai-team' },
    ]
  }
}
