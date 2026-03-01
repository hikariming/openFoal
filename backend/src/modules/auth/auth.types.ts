export type UserRole = 'admin' | 'member'

export interface JwtClaims {
  sub: string
  tenantId: string
  role: UserRole
  email: string
}

export interface AuthSession {
  accountId: string
  name: string
  email: string
  tenantId: string
  role: UserRole
}

export interface LoginResult {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: string
  session: AuthSession
}
