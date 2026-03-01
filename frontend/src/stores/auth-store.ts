import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiRequest } from '@/lib/api-client'

export type UserRole = 'admin' | 'member'

export interface UserSession {
  accountId: string
  name: string
  email: string
  tenantId: string
  role: UserRole
  accessToken: string
}

interface LoginCredentials {
  email: string
  password: string
  tenantId: string
}

interface LoginResponse {
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

interface AuthState {
  isAuthenticated: boolean
  session: UserSession | null
  login: (credentials: LoginCredentials) => Promise<UserSession>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      session: null,
      login: async (credentials) => {
        const response = await apiRequest<LoginResponse>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(credentials),
          skipAuth: true,
        })

        const session: UserSession = {
          ...response.session,
          accessToken: response.accessToken,
        }

        set({
          isAuthenticated: true,
          session,
        })

        return session
      },
      logout: () => {
        set({
          isAuthenticated: false,
          session: null,
        })
      },
    }),
    {
      name: 'enterprise-auth-store',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        session: state.session,
      }),
    },
  ),
)
