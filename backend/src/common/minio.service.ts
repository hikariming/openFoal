import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'

@Injectable()
export class MinioService {
  private readonly client: Client
  private readonly bucketName: string

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME', 'avatars')

    this.client = new Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT', '127.0.0.1'),
      port: Number(this.configService.get<string>('MINIO_PORT', '9000')),
      useSSL: this.configService.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.configService.get<string>('MINIO_ROOT_USER', ''),
      secretKey: this.configService.get<string>('MINIO_ROOT_PASSWORD', ''),
    })
  }

  getClient() {
    return this.client
  }

  getBucketName() {
    return this.bucketName
  }

  async ping() {
    await this.client.bucketExists(this.bucketName)
  }
}
