import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './modules/auth/auth.module'
import { TenantModule } from './modules/tenant/tenant.module'
import { SandboxModule } from './modules/sandbox/sandbox.module'
import { AgentModule } from './modules/agent/agent.module'
import { AuditModule } from './modules/audit/audit.module'
import { HealthModule } from './modules/health/health.module'
import { PrismaModule } from './common/prisma.module'
import { RedisModule } from './common/redis.module'
import { MinioModule } from './common/minio.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    MinioModule,
    HealthModule,
    AuthModule,
    TenantModule,
    SandboxModule,
    AgentModule,
    AuditModule,
  ],
})
export class AppModule {}
