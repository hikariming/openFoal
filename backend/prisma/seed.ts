import { PrismaClient, TenantAccountRole } from '@prisma/client'
import * as argon2 from 'argon2'

const prisma = new PrismaClient()

const DEFAULT_PASSWORD = 'ChangeMe123!'

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed is disabled in production.')
  }

  const tenant = await prisma.tenant.upsert({
    where: { id: 'tenant_seed_main' },
    update: { name: 'OpenFoal Seed Tenant' },
    create: {
      id: 'tenant_seed_main',
      name: 'OpenFoal Seed Tenant',
      plan: 'basic',
      status: 'NORMAL',
    },
  })

  const adminPasswordHash = await argon2.hash(DEFAULT_PASSWORD, { type: argon2.argon2id })
  const memberPasswordHash = await argon2.hash(DEFAULT_PASSWORD, { type: argon2.argon2id })

  const admin = await prisma.account.upsert({
    where: { email: 'admin@openfoal.dev' },
    update: {
      name: 'Seed Admin',
      passwordHash: adminPasswordHash,
      status: 'ACTIVE',
    },
    create: {
      id: 'account_seed_admin',
      name: 'Seed Admin',
      email: 'admin@openfoal.dev',
      passwordHash: adminPasswordHash,
      status: 'ACTIVE',
    },
  })

  const member = await prisma.account.upsert({
    where: { email: 'member@openfoal.dev' },
    update: {
      name: 'Seed Member',
      passwordHash: memberPasswordHash,
      status: 'ACTIVE',
    },
    create: {
      id: 'account_seed_member',
      name: 'Seed Member',
      email: 'member@openfoal.dev',
      passwordHash: memberPasswordHash,
      status: 'ACTIVE',
    },
  })

  await prisma.tenantAccountJoin.upsert({
    where: {
      tenantId_accountId: {
        tenantId: tenant.id,
        accountId: admin.id,
      },
    },
    update: {
      role: TenantAccountRole.ADMIN,
      current: true,
    },
    create: {
      tenantId: tenant.id,
      accountId: admin.id,
      role: TenantAccountRole.ADMIN,
      current: true,
    },
  })

  await prisma.tenantAccountJoin.upsert({
    where: {
      tenantId_accountId: {
        tenantId: tenant.id,
        accountId: member.id,
      },
    },
    update: {
      role: TenantAccountRole.MEMBER,
      current: true,
    },
    create: {
      tenantId: tenant.id,
      accountId: member.id,
      role: TenantAccountRole.MEMBER,
      current: true,
    },
  })

  console.log('Seed completed')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
