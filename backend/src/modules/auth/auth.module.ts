import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../../common/prisma.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AdminOnlyGuard } from './guards/admin-only.guard'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRATION', '1d') as any },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, AdminOnlyGuard],
  exports: [AuthService, JwtModule, JwtAuthGuard, AdminOnlyGuard],
})
export class AuthModule {}
