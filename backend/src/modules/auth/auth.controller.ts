import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { AuthService } from './auth.service'
import { JwtClaims } from './auth.types'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  password!: string

  @IsString()
  @MinLength(2)
  tenantId!: string
}

class IssueTokenDto {
  @IsString()
  @MinLength(2)
  userId!: string

  @IsString()
  @MinLength(2)
  tenantId!: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member'
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: { user: JwtClaims }) {
    return this.authService.getSessionFromClaims(req.user)
  }

  @Post('token')
  issueToken(@Body() body: IssueTokenDto) {
    return this.authService.issueLegacyToken(body)
  }
}
