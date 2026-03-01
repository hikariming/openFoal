import { Controller, Get } from '@nestjs/common'
import { MinioService } from '../../common/minio.service'
import { PrismaService } from '../../common/prisma.service'
import { RedisService } from '../../common/redis.service'

@Controller('health')
export class HealthController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly minioService: MinioService,
  ) {}

  private async checkDatabase() {
    try {
      await this.prismaService.$queryRaw`SELECT 1`
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
    }
  }

  private async checkRedis() {
    try {
      await this.redisService.ping()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
    }
  }

  private async checkMinio() {
    try {
      await this.minioService.ping()
      return { ok: true, bucket: this.minioService.getBucketName() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
    }
  }

  @Get()
  async getHealth() {
    const [database, redis, minio] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMinio(),
    ])

    return {
      ok: database.ok && redis.ok && minio.ok,
      service: 'openfoal-backend',
      now: new Date().toISOString(),
      dependencies: {
        database,
        redis,
        minio,
      },
    }
  }
}
