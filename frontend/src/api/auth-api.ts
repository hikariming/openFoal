import { apiClient } from '@/lib/api-client'
import type { UserRole } from '@/stores/auth-store'

export interface LoginCredentials {
  email: string
  password: string
  tenantId: string
}

export interface LoginResponse {
  accessToken: string
  tokenType: string
  expiresIn: string
  session: {
    accountId: string
    name: string
    email: string
    tenantId: string
    role: UserRole
  }
}

export interface MeResponse {
  accountId: string
  name: string
  email: string
  tenantId: string
  role: UserRole
}

export function loginWithPassword(credentials: LoginCredentials) {
  return apiClient.post<LoginResponse>('/api/auth/login', credentials, { skipAuth: true })
}

export function fetchMe() {
  return apiClient.get<MeResponse>('/api/auth/me')
}
