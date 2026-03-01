import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { loginWithPassword, type LoginCredentials, type LoginResponse } from '@/api/auth-api'

export type UserRole = 'admin' | 'member'

export interface UserSession {
  accountId: string
  name: string
  email: string
  tenantId: string
  role: UserRole
  accessToken: string
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
        const response: LoginResponse = await loginWithPassword(credentials)

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
