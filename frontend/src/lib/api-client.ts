const AUTH_STORAGE_KEY = 'enterprise-auth-store'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

type ApiRequestOptions = RequestInit & {
  skipAuth?: boolean
}

function readAccessTokenFromStorage() {
  const raw = globalThis.localStorage?.getItem(AUTH_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as {
      state?: {
        session?: {
          accessToken?: string
        } | null
      }
    }

    return parsed.state?.session?.accessToken ?? null
  } catch {
    return null
  }
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  const token = options.skipAuth ? null : readAccessTokenFromStorage()

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 401 && !options.skipAuth) {
    globalThis.localStorage?.removeItem(AUTH_STORAGE_KEY)
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login')
    }
  }

  if (!response.ok) {
    const body = await parseResponseBody(response)
    const message =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message?: string }).message)
        : 'Request failed'
    throw new Error(message)
  }

  return (await parseResponseBody(response)) as T
}
