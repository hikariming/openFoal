import { apiClient } from '@/lib/api-client'
import type { Tenant } from '@/stores/tenant-store'

export function fetchLoginTenants() {
  return apiClient.get<Tenant[]>('/api/auth/tenants', { skipAuth: true })
}
