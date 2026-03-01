import { Injectable, NotFoundException } from '@nestjs/common'
import { AccountStatus, TenantAccountRole } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service'
import { UserRole } from '../auth/auth.types'

export type MemberStatus = 'active' | 'invited' | 'disabled'

export interface MemberRow {
  accountId: string
  name: string
  email: string
  role: UserRole
  status: MemberStatus
}

interface UpdateMemberRoleInput {
  tenantId: string
  accountId: string
  role: UserRole
}

interface UpdateMemberStatusInput {
  tenantId: string
  accountId: string
  status: MemberStatus
}

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async listMembers(tenantId: string): Promise<MemberRow[]> {
    const rows = await this.prisma.tenantAccountJoin.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        accountId: true,
        role: true,
        account: {
          select: {
            name: true,
            email: true,
            status: true,
          },
        },
      },
    })

    return rows.map((row) => ({
      accountId: row.accountId,
      name: row.account.name,
      email: row.account.email,
      role: this.toUserRole(row.role),
      status: this.toMemberStatus(row.account.status),
    }))
  }

  async updateMemberRole(input: UpdateMemberRoleInput) {
    const existing = await this.prisma.tenantAccountJoin.findUnique({
      where: {
        tenantId_accountId: {
          tenantId: input.tenantId,
          accountId: input.accountId,
        },
      },
      select: { accountId: true },
    })

    if (!existing) {
      throw new NotFoundException('Member not found')
    }

    await this.prisma.tenantAccountJoin.update({
      where: {
        tenantId_accountId: {
          tenantId: input.tenantId,
          accountId: input.accountId,
        },
      },
      data: {
        role: this.toDbRole(input.role),
      },
    })

    return {
      accountId: input.accountId,
      role: input.role,
    }
  }

  async updateMemberStatus(input: UpdateMemberStatusInput) {
    const existing = await this.prisma.tenantAccountJoin.findUnique({
      where: {
        tenantId_accountId: {
          tenantId: input.tenantId,
          accountId: input.accountId,
        },
      },
      select: { accountId: true },
    })

    if (!existing) {
      throw new NotFoundException('Member not found')
    }

    await this.prisma.account.update({
      where: { id: input.accountId },
      data: {
        status: this.toAccountStatus(input.status),
      },
    })

    return {
      accountId: input.accountId,
      status: input.status,
    }
  }

  private toDbRole(role: UserRole): TenantAccountRole {
    return role === 'admin' ? 'ADMIN' : 'MEMBER'
  }

  private toUserRole(role: TenantAccountRole): UserRole {
    return role === 'ADMIN' ? 'admin' : 'member'
  }

  private toMemberStatus(status: AccountStatus): MemberStatus {
    if (status === 'ACTIVE') {
      return 'active'
    }
    if (status === 'PENDING' || status === 'UNINITIALIZED') {
      return 'invited'
    }
    return 'disabled'
  }

  private toAccountStatus(status: MemberStatus): AccountStatus {
    if (status === 'active') {
      return 'ACTIVE'
    }
    if (status === 'invited') {
      return 'PENDING'
    }
    return 'BANNED'
  }
}
