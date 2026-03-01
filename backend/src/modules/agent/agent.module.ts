import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AgentController } from './agent.controller'
import { AgentService } from './agent.service'

@Module({
  imports: [AuthModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
