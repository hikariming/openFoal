import { apiClient } from '@/lib/api-client'
import type { UserRole } from '@/stores/auth-store'

export type MemberStatus = 'active' | 'invited' | 'disabled'

export interface MemberRecord {
  accountId: string
  name: string
  email: string
  role: UserRole
  status: MemberStatus
}

export function fetchMembers() {
  return apiClient.get<MemberRecord[]>('/api/members')
}

export function updateMemberRole(accountId: string, role: UserRole) {
  return apiClient.patch<{ accountId: string; role: UserRole }>(
    `/api/members/${encodeURIComponent(accountId)}/role`,
    { role },
  )
}

export function updateMemberStatus(accountId: string, status: Extract<MemberStatus, 'active' | 'disabled'>) {
  return apiClient.patch<{ accountId: string; status: Extract<MemberStatus, 'active' | 'disabled'> }>(
    `/api/members/${encodeURIComponent(accountId)}/status`,
    { status },
  )
}
