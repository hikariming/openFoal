import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { SandboxController } from './sandbox.controller'
import { SandboxService } from './sandbox.service'

@Module({
  imports: [AuthModule],
  controllers: [SandboxController],
  providers: [SandboxService],
})
export class SandboxModule {}
