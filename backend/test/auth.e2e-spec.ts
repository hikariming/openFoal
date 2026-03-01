import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import * as argon2 from 'argon2'
import request = require('supertest')
import { PrismaService } from '../src/common/prisma.service'
import { AuthModule } from '../src/modules/auth/auth.module'
import { TenantModule } from '../src/modules/tenant/tenant.module'

const adminAccount = {
  id: 'acc_admin',
  name: 'Admin User',
  email: 'admin@example.com',
}

const memberAccount = {
  id: 'acc_member',
  name: 'Member User',
  email: 'member@example.com',
}

describe('Auth API (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-secret'
    process.env.JWT_EXPIRATION = '1d'

    const adminHash = await argon2.hash('AdminPass123!', { type: argon2.argon2id })
    const memberHash = await argon2.hash('MemberPass123!', { type: argon2.argon2id })

    const mockPrisma: Partial<PrismaService> = {
      tenant: {
        findMany: jest.fn(async () => [
          { id: 'tenant_admin', name: 'Admin Tenant' },
          { id: 'tenant_member', name: 'Member Tenant' },
        ]),
      } as any,
      account: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where?.email === adminAccount.email) {
            return {
              ...adminAccount,
              passwordHash: adminHash,
            }
          }

          if (where?.email === memberAccount.email) {
            return {
              ...memberAccount,
              passwordHash: memberHash,
            }
          }

          if (where?.id === adminAccount.id) {
            return adminAccount
          }

          if (where?.id === memberAccount.id) {
            return memberAccount
          }

          return null
        }),
        update: jest.fn(async () => undefined),
      } as any,
      tenantAccountJoin: {
        findUnique: jest.fn(async ({ where }: any) => {
          const composite = where?.tenantId_accountId
          if (!composite) {
            return null
          }

          if (composite.tenantId === 'tenant_admin' && composite.accountId === adminAccount.id) {
            return { role: 'ADMIN' }
          }

          if (composite.tenantId === 'tenant_member' && composite.accountId === memberAccount.id) {
            return { role: 'MEMBER' }
          }

          return null
        }),
      } as any,
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        AuthModule,
        TenantModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    )

    await app.init()
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /api/auth/login logs in admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: adminAccount.email,
        password: 'AdminPass123!',
        tenantId: 'tenant_admin',
      })
      .expect(201)

    expect(res.body).toHaveProperty('accessToken')
    expect(res.body.session.role).toBe('admin')
    expect(res.body.session.tenantId).toBe('tenant_admin')
  })

  it('GET /api/auth/tenants returns public tenant options', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/tenants').expect(200)
    expect(res.body).toEqual([
      { id: 'tenant_admin', name: 'Admin Tenant' },
      { id: 'tenant_member', name: 'Member Tenant' },
    ])
  })

  it('POST /api/auth/login logs in member', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: memberAccount.email,
        password: 'MemberPass123!',
        tenantId: 'tenant_member',
      })
      .expect(201)

    expect(res.body.session.role).toBe('member')
  })

  it('POST /api/auth/login rejects invalid password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: adminAccount.email,
        password: 'wrong-password',
        tenantId: 'tenant_admin',
      })
      .expect(401)
  })

  it('POST /api/auth/login rejects unmatched tenant', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: adminAccount.email,
        password: 'AdminPass123!',
        tenantId: 'tenant_member',
      })
      .expect(403)
  })

  it('GET /api/auth/me returns session from bearer token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: memberAccount.email,
        password: 'MemberPass123!',
        tenantId: 'tenant_member',
      })
      .expect(201)

    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200)

    expect(meRes.body.accountId).toBe(memberAccount.id)
    expect(meRes.body.role).toBe('member')
    expect(meRes.body.tenantId).toBe('tenant_member')
  })

  it('GET /api/tenants returns 403 for member role', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: memberAccount.email,
        password: 'MemberPass123!',
        tenantId: 'tenant_member',
      })
      .expect(201)

    await request(app.getHttpServer())
      .get('/api/tenants')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(403)
  })
})
