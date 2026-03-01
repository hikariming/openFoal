import { useMemo, useState } from 'react'
import { Card, Select, Switch, Table, Tag } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/shared/page-shell'
import type { UserRole } from '@/stores/auth-store'

const permissionSeeds: Record<UserRole, string[]> = {
  owner: ['tenant.manage', 'member.manage', 'audit.read', 'billing.manage', 'sso.manage'],
  admin: ['member.manage', 'audit.read', 'sso.manage'],
  it_admin: ['member.manage', 'audit.read', 'sso.manage'],
  billing: ['billing.manage', 'audit.read'],
  member: ['audit.read'],
}

export default function RbacPage() {
  const { t } = useTranslation()
  const [activeRole, setActiveRole] = useState<UserRole>('admin')
  const [granted, setGranted] = useState<Record<UserRole, Set<string>>>(() => ({
    owner: new Set(permissionSeeds.owner),
    admin: new Set(permissionSeeds.admin),
    it_admin: new Set(permissionSeeds.it_admin),
    billing: new Set(permissionSeeds.billing),
    member: new Set(permissionSeeds.member),
  }))

  const roleOptions = [
    { value: 'owner', label: t('common.roles.owner') },
    { value: 'admin', label: t('common.roles.admin') },
    { value: 'it_admin', label: t('common.roles.it_admin') },
    { value: 'billing', label: t('common.roles.billing') },
    { value: 'member', label: t('common.roles.member') },
  ]

  const permissionCatalog = useMemo(
    () => [
      { code: 'tenant.manage', description: t('rbac.permissions.tenantManage') },
      { code: 'member.manage', description: t('rbac.permissions.memberManage') },
      { code: 'audit.read', description: t('rbac.permissions.auditRead') },
      { code: 'billing.manage', description: t('rbac.permissions.billingManage') },
      { code: 'sso.manage', description: t('rbac.permissions.ssoManage') },
    ],
    [t],
  )

  const rows = useMemo(
    () =>
      permissionCatalog.map((item) => ({
        ...item,
        enabled: granted[activeRole].has(item.code),
      })),
    [activeRole, granted, permissionCatalog],
  )

  return (
    <PageShell
      title={t('rbac.title')}
      description={t('rbac.description')}
      actions={
        <Select
          value={activeRole}
          optionList={roleOptions}
          style={{ width: 180 }}
          onChange={(value) => setActiveRole(value as UserRole)}
        />
      }
    >
      <Card>
        {t('rbac.currentRole')}: <Tag color="blue">{activeRole}</Tag>
      </Card>

      <Table
        pagination={false}
        dataSource={rows}
        rowKey="code"
        columns={[
          { title: t('rbac.columns.code'), dataIndex: 'code' },
          { title: t('rbac.columns.description'), dataIndex: 'description' },
          {
            title: t('rbac.columns.enabled'),
            dataIndex: 'enabled',
            render: (enabled: boolean, record: { code: string }) => (
              <Switch
                checked={enabled}
                onChange={(checked) => {
                  setGranted((prev) => {
                    const next = new Set(prev[activeRole])
                    if (checked) {
                      next.add(record.code)
                    } else {
                      next.delete(record.code)
                    }
                    return {
                      ...prev,
                      [activeRole]: next,
                    }
                  })
                }}
              />
            ),
          },
        ]}
      />
    </PageShell>
  )
}
