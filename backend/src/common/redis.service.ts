import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL')

    if (redisUrl) {
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      })
      return
    }

    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', '127.0.0.1'),
      port: Number(this.configService.get<string>('REDIS_PORT', '6379')),
      username: this.configService.get<string>('REDIS_USERNAME') || undefined,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(this.configService.get<string>('REDIS_DB', '0')),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    })
  }

  getClient() {
    return this.client
  }

  async ping() {
    if (this.client.status === 'wait') {
      await this.client.connect()
    }
    await this.client.ping()
  }

  async onModuleDestroy() {
    await this.client.quit()
  }
}
