const AUTH_STORAGE_KEY = 'enterprise-auth-store'
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim()

export class HttpError extends Error {
  status: number
  details: unknown

  constructor(status: number, message: string, details: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }
}

type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | object | null
  skipAuth?: boolean
}

function buildUrl(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  return `${API_BASE_URL}${path}`
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

function clearAuthAndRedirectToLogin() {
  globalThis.localStorage?.removeItem(AUTH_STORAGE_KEY)

  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}

function normalizeErrorMessage(payload: unknown) {
  if (typeof payload === 'string' && payload.length > 0) {
    return payload
  }

  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message?: unknown }).message
    if (Array.isArray(message)) {
      return message.join('; ')
    }
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  }

  return 'Request failed'
}

function normalizeBody(body: ApiRequestOptions['body']) {
  if (body == null) {
    return undefined
  }

  if (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  ) {
    return body as BodyInit
  }

  return JSON.stringify(body)
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  const token = options.skipAuth ? null : readAccessTokenFromStorage()
  const body = normalizeBody(options.body)

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  if (!headers.has('Content-Type') && body && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(buildUrl(path), {
    ...options,
    body,
    headers,
  })

  if (response.status === 401 && !options.skipAuth) {
    clearAuthAndRedirectToLogin()
  }

  const payload = await parseResponseBody(response)
  if (!response.ok) {
    throw new HttpError(response.status, normalizeErrorMessage(payload), payload)
  }

  return payload as T
}

export const apiClient = {
  get: <T>(path: string, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: ApiRequestOptions['body'], options: Omit<ApiRequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: ApiRequestOptions['body'], options: Omit<ApiRequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: ApiRequestOptions['body'], options: Omit<ApiRequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
}
