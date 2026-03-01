import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminRouteGuard } from '@/components/auth/admin-route-guard'
import { AuthGuard } from '@/components/auth/auth-guard'
import { MemberRouteGuard } from '@/components/auth/member-route-guard'
import { useAuthStore, type UserRole } from '@/stores/auth-store'

function renderWithRoutes(initialPath: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>login-page</div>} />
        <Route
          path="/dashboard"
          element={
            <AuthGuard>
              <AdminRouteGuard>
                <div>dashboard-page</div>
              </AdminRouteGuard>
            </AuthGuard>
          }
        />
        <Route
          path="/user-prototype"
          element={
            <AuthGuard>
              <MemberRouteGuard>
                <div>user-page</div>
              </MemberRouteGuard>
            </AuthGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function setSession(role: UserRole | null) {
  if (!role) {
    useAuthStore.setState({ isAuthenticated: false, session: null })
    return
  }

  useAuthStore.setState({
    isAuthenticated: true,
    session: {
      accountId: `acc_${role}`,
      name: role,
      email: `${role}@example.com`,
      tenantId: 'tenant_1',
      role,
      accessToken: 'token_123',
    },
  })
}

afterEach(() => {
  setSession(null)
})

describe('route guards', () => {
  it('redirects unauthenticated users to login', async () => {
    setSession(null)
    renderWithRoutes('/dashboard')

    expect(await screen.findByText('login-page')).toBeInTheDocument()
  })

  it('redirects member from dashboard to user prototype', async () => {
    setSession('member')
    renderWithRoutes('/dashboard')

    expect(await screen.findByText('user-page')).toBeInTheDocument()
  })

  it('allows admin to access dashboard', async () => {
    setSession('admin')
    renderWithRoutes('/dashboard')

    expect(await screen.findByText('dashboard-page')).toBeInTheDocument()
  })

  it('redirects admin from user prototype to dashboard', async () => {
    setSession('admin')
    renderWithRoutes('/user-prototype')

    expect(await screen.findByText('dashboard-page')).toBeInTheDocument()
  })
})
