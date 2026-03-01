import { afterEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'

afterEach(() => {
  useAuthStore.getState().logout()
})

describe('useAuthStore', () => {
  it('loginAsDemo sets authenticated session', () => {
    useAuthStore.getState().loginAsDemo('dev@example.com')

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.session?.email).toBe('dev@example.com')
    expect(state.session?.roles).toContain('owner')
  })

  it('logout clears session', () => {
    useAuthStore.getState().loginAsDemo('dev@example.com')
    useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.session).toBeNull()
  })
})
