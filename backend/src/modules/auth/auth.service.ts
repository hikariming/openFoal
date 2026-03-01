import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'
import { PrismaService } from '../../common/prisma.service'
import { AuthSession, JwtClaims, LoginResult, LoginTenantOption, UserRole } from './auth.types'

interface LoginInput {
  email: string
  password: string
  tenantId: string
}

interface LegacyTokenInput {
  userId: string
  tenantId: string
  email?: string
  role?: UserRole
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async hashPassword(password: string) {
    return argon2.hash(password, { type: argon2.argon2id })
  }

  async verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password)
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const account = await this.prisma.account.findUnique({
      where: {
        email: input.email,
      },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
      },
    })

    if (!account?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password')
    }

    const passwordValid = await this.verifyPassword(account.passwordHash, input.password)
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password')
    }

    const tenantJoin = await this.prisma.tenantAccountJoin.findUnique({
      where: {
        tenantId_accountId: {
          tenantId: input.tenantId,
          accountId: account.id,
        },
      },
      select: {
        role: true,
      },
    })

    if (!tenantJoin) {
      throw new ForbiddenException('Tenant access denied')
    }

    const role: UserRole = tenantJoin.role === 'ADMIN' ? 'admin' : 'member'
    const claims: JwtClaims = {
      sub: account.id,
      tenantId: input.tenantId,
      role,
      email: account.email,
    }

    const accessToken = this.signToken(claims)

    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        lastLoginAt: new Date(),
      },
    })

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.getTokenExpiration(),
      session: {
        accountId: account.id,
        name: account.name,
        email: account.email,
        tenantId: input.tenantId,
        role,
      },
    }
  }

  async listLoginTenants(): Promise<LoginTenantOption[]> {
    return this.prisma.tenant.findMany({
      where: {
        status: 'NORMAL',
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        name: true,
      },
    })
  }

  // Deprecated compatibility endpoint for existing clients.
  issueLegacyToken(input: LegacyTokenInput) {
    const claims: JwtClaims = {
      sub: input.userId,
      tenantId: input.tenantId,
      role: input.role ?? 'member',
      email: input.email ?? '',
    }

    return {
      accessToken: this.signToken(claims),
      tokenType: 'Bearer' as const,
      expiresIn: this.getTokenExpiration(),
    }
  }

  signToken(payload: JwtClaims) {
    return this.jwtService.sign(payload)
  }

  async getSessionFromClaims(claims: JwtClaims): Promise<AuthSession> {
    const account = await this.prisma.account.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        name: true,
        email: true,
      },
    })

    if (!account) {
      throw new UnauthorizedException('Unauthorized')
    }

    return {
      accountId: account.id,
      name: account.name,
      email: account.email,
      tenantId: claims.tenantId,
      role: claims.role,
    }
  }

  private getTokenExpiration() {
    return this.configService.get<string>('JWT_EXPIRATION', '1d')
  }
}
