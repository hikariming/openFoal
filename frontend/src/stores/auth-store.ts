import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserRole = 'owner' | 'admin' | 'it_admin' | 'billing' | 'member'

export interface UserSession {
  userId: string
  name: string
  email: string
  roles: UserRole[]
}

interface AuthState {
  isAuthenticated: boolean
  session: UserSession | null
  loginAsDemo: (email: string) => void
  logout: () => void
}

const demoSession: UserSession = {
  userId: 'u_owner_demo',
  name: 'Enterprise Owner',
  email: 'owner@openfoal.com',
  roles: ['owner', 'admin'],
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      session: null,
      loginAsDemo: (email) => {
        set({
          isAuthenticated: true,
          session: {
            ...demoSession,
            email: email || demoSession.email,
          },
        })
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
