import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'

const fetchMock = vi.fn()

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    useAuthStore.getState().logout()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('login stores authenticated session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({
        accessToken: 'token_123',
        tokenType: 'Bearer',
        expiresIn: '1d',
        session: {
          accountId: 'acc_admin',
          name: 'Admin',
          email: 'admin@example.com',
          tenantId: 'tenant_1',
          role: 'admin',
        },
      }),
    })

    await useAuthStore.getState().login({
      email: 'admin@example.com',
      password: 'AdminPass123!',
      tenantId: 'tenant_1',
    })

    const state = useAuthStore.getState()

    expect(state.isAuthenticated).toBe(true)
    expect(state.session?.email).toBe('admin@example.com')
    expect(state.session?.role).toBe('admin')
    expect(state.session?.accessToken).toBe('token_123')
  })

  it('logout clears session', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      session: {
        accountId: 'acc_member',
        name: 'Member',
        email: 'member@example.com',
        tenantId: 'tenant_2',
        role: 'member',
        accessToken: 'token_member',
      },
    })

    useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.session).toBeNull()
  })
})
