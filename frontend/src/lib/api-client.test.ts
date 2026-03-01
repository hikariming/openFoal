import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'

const fetchMock = vi.fn()

describe('apiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('injects bearer token from auth store payload', async () => {
    localStorage.setItem(
      'enterprise-auth-store',
      JSON.stringify({
        state: {
          session: {
            accessToken: 'jwt_token_123',
          },
        },
      }),
    )

    fetchMock.mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({ ok: true }),
    })

    await apiClient.get('/api/health')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit
    const headers = requestInit.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer jwt_token_123')
  })

  it('throws HttpError with status and normalized message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({ message: ['Forbidden resource'] }),
    })

    await expect(apiClient.get('/api/forbidden')).rejects.toEqual(
      expect.objectContaining({
        name: 'HttpError',
        status: 403,
        message: 'Forbidden resource',
      }),
    )
  })
})
