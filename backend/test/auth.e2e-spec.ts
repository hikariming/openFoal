import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import request = require('supertest')
import { AuthModule } from '../src/modules/auth/auth.module'

describe('Auth API (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-secret'
    process.env.JWT_EXPIRATION = '1d'

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
    }).compile()

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

  it('issues jwt token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/token')
      .send({
        userId: 'acc_test',
        tenantId: 'tenant_test',
        email: 'owner@example.com',
      })
      .expect(201)

    expect(res.body).toHaveProperty('accessToken')
    expect(res.body.tokenType).toBe('Bearer')
    expect(res.body.expiresIn).toBe('1d')
  })

  it('rejects invalid payload', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/token')
      .send({ userId: 'x', tenantId: 'y', email: 'bad-email' })
      .expect(400)
  })
})
