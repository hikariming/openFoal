import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { describe, expect, it } from '@jest/globals'
import { AuthService } from './auth.service'

describe('AuthService', () => {
  it('hashes and verifies password with argon2id', async () => {
    const authService = new AuthService(
      new JwtService({ secret: 'unit-secret', signOptions: { expiresIn: '1d' as any } }),
      {
        account: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        tenantAccountJoin: {
          findUnique: jest.fn(),
        },
      } as any,
      { get: jest.fn().mockReturnValue('1d') } as unknown as ConfigService,
    )

    const hash = await authService.hashPassword('P@ssw0rd123')

    await expect(authService.verifyPassword(hash, 'P@ssw0rd123')).resolves.toBe(true)
    await expect(authService.verifyPassword(hash, 'wrong-password')).resolves.toBe(false)
  })

  it('signs token with fixed jwt claims', () => {
    const jwtService = new JwtService({
      secret: 'unit-test-secret',
      signOptions: { expiresIn: '1d' as any },
    })

    const authService = new AuthService(
      jwtService,
      {
        account: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        tenantAccountJoin: {
          findUnique: jest.fn(),
        },
      } as any,
      { get: jest.fn().mockReturnValue('1d') } as unknown as ConfigService,
    )

    const token = authService.signToken({
      sub: 'acc_1',
      tenantId: 'tenant_1',
      role: 'admin',
      email: 'owner@example.com',
    })

    const decoded = jwtService.verify(token)

    expect(decoded.sub).toBe('acc_1')
    expect(decoded.tenantId).toBe('tenant_1')
    expect(decoded.role).toBe('admin')
    expect(decoded.email).toBe('owner@example.com')
  })

  it('login returns session with role and tenant claims', async () => {
    const jwtService = new JwtService({
      secret: 'unit-test-secret',
      signOptions: { expiresIn: '1d' as any },
    })

    const authServiceForHash = new AuthService(
      jwtService,
      {
        account: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        tenantAccountJoin: {
          findUnique: jest.fn(),
        },
      } as any,
      { get: jest.fn().mockReturnValue('1d') } as unknown as ConfigService,
    )

    const passwordHash = await authServiceForHash.hashPassword('pass_12345')

    const authService = new AuthService(
      jwtService,
      {
        account: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'acc_1',
            name: 'Test Admin',
            email: 'admin@test.dev',
            passwordHash,
          }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        tenantAccountJoin: {
          findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
        },
      } as any,
      { get: jest.fn().mockReturnValue('1d') } as unknown as ConfigService,
    )

    const result = await authService.login({
      email: 'admin@test.dev',
      password: 'pass_12345',
      tenantId: 'tenant_1',
    })

    const decoded = jwtService.verify(result.accessToken)

    expect(result.session.tenantId).toBe('tenant_1')
    expect(result.session.role).toBe('admin')
    expect(decoded.tenantId).toBe('tenant_1')
    expect(decoded.role).toBe('admin')
  })
})
