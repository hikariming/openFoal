import { useMemo, useState } from 'react'
import { Card, Select, Switch, Table, Tag } from '@douyinfe/semi-ui'
import { PageShell } from '@/components/shared/page-shell'
import type { UserRole } from '@/stores/auth-store'

const roleOptions = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'it_admin', label: 'IT Admin' },
  { value: 'billing', label: 'Billing' },
  { value: 'member', label: 'Member' },
]

const permissionSeeds: Record<UserRole, string[]> = {
  owner: ['tenant.manage', 'member.manage', 'audit.read', 'billing.manage', 'sso.manage'],
  admin: ['member.manage', 'audit.read', 'sso.manage'],
  it_admin: ['member.manage', 'audit.read', 'sso.manage'],
  billing: ['billing.manage', 'audit.read'],
  member: ['audit.read'],
}

const permissionCatalog = [
  { code: 'tenant.manage', description: '管理组织/租户配置' },
  { code: 'member.manage', description: '邀请/停用/调整成员角色' },
  { code: 'audit.read', description: '查看审计日志' },
  { code: 'billing.manage', description: '管理订阅、发票、合同' },
  { code: 'sso.manage', description: '配置 OIDC/SAML SSO' },
]

export default function RbacPage() {
  const [activeRole, setActiveRole] = useState<UserRole>('admin')
  const [granted, setGranted] = useState<Record<UserRole, Set<string>>>(() => ({
    owner: new Set(permissionSeeds.owner),
    admin: new Set(permissionSeeds.admin),
    it_admin: new Set(permissionSeeds.it_admin),
    billing: new Set(permissionSeeds.billing),
    member: new Set(permissionSeeds.member),
  }))

  const rows = useMemo(
    () =>
      permissionCatalog.map((item) => ({
        ...item,
        enabled: granted[activeRole].has(item.code),
      })),
    [activeRole, granted],
  )

  return (
    <PageShell
      title="RBAC 权限"
      description="按角色配置资源权限，先前端验证交互，再接后端策略引擎。"
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
        当前角色：<Tag color="blue">{activeRole}</Tag>
      </Card>

      <Table
        pagination={false}
        dataSource={rows}
        rowKey="code"
        columns={[
          { title: '权限编码', dataIndex: 'code' },
          { title: '说明', dataIndex: 'description' },
          {
            title: '启用',
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
