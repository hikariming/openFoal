import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  signToken(payload: { userId: string; tenantId: string; email?: string }) {
    return this.jwtService.sign({
      sub: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
    })
  }
}
