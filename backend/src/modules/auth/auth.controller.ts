import { Body, Controller, Post } from '@nestjs/common'
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'
import { AuthService } from './auth.service'

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
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  issueToken(@Body() body: IssueTokenDto) {
    const accessToken = this.authService.signToken(body)
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRATION ?? '1d',
    }
  }
}
