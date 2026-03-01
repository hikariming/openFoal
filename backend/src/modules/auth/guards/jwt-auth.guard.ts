import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { JwtClaims } from '../auth.types'

interface JwtPayloadLike {
  sub?: string
  tenantId?: string
  role?: string
  email?: string
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>
      user?: JwtClaims
    }>()

    const header = request.headers?.authorization
    const token = this.extractBearerToken(header)

    if (!token) {
      throw new UnauthorizedException('Unauthorized')
    }

    let decoded: JwtPayloadLike
    try {
      decoded = await this.jwtService.verifyAsync<JwtPayloadLike>(token)
    } catch {
      throw new UnauthorizedException('Unauthorized')
    }

    const claims = this.toClaims(decoded)
    if (!claims) {
      throw new UnauthorizedException('Unauthorized')
    }

    request.user = claims
    return true
  }

  private extractBearerToken(header: string | string[] | undefined) {
    if (!header || Array.isArray(header)) {
      return null
    }

    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) {
      return null
    }

    return token
  }

  private toClaims(payload: JwtPayloadLike): JwtClaims | null {
    const role = payload.role === 'admin' || payload.role === 'member' ? payload.role : null

    if (!payload.sub || !payload.tenantId || !role || typeof payload.email !== 'string') {
      return null
    }

    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role,
      email: payload.email,
    }
  }
}
