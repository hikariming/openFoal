import { JwtService } from '@nestjs/jwt'
import { describe, expect, it } from '@jest/globals'
import { AuthService } from './auth.service'

describe('AuthService', () => {
  it('signs token with user and tenant claims', () => {
    const jwtService = new JwtService({
      secret: 'unit-test-secret',
      signOptions: { expiresIn: '1d' as any },
    })
    const authService = new AuthService(jwtService)

    const token = authService.signToken({
      userId: 'acc_1',
      tenantId: 'tenant_1',
      email: 'owner@example.com',
    })

    const decoded = jwtService.verify(token)

    expect(typeof token).toBe('string')
    expect(decoded.sub).toBe('acc_1')
    expect(decoded.tenantId).toBe('tenant_1')
    expect(decoded.email).toBe('owner@example.com')
  })
})
