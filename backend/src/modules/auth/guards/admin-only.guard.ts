import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtClaims } from '../auth.types'

@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: JwtClaims }>()

    if (!request.user) {
      throw new UnauthorizedException('Unauthorized')
    }

    if (request.user.role !== 'admin') {
      throw new ForbiddenException('Admin access required')
    }

    return true
  }
}
