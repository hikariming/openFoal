import { useMemo, useState } from 'react'
import { Button, Input, Select, Table, Tag } from '@douyinfe/semi-ui'
import { PageShell } from '@/components/shared/page-shell'
import type { UserRole } from '@/stores/auth-store'

type MemberStatus = 'active' | 'invited' | 'disabled'

interface MemberRow {
  id: string
  name: string
  email: string
  role: UserRole
  status: MemberStatus
}

const roleOptions = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'it_admin', label: 'IT Admin' },
  { value: 'billing', label: 'Billing' },
  { value: 'member', label: 'Member' },
]

const initialMembers: MemberRow[] = [
  { id: 'm1', name: 'Alice Li', email: 'alice@openfoal.com', role: 'owner', status: 'active' },
  { id: 'm2', name: 'Bob Chen', email: 'bob@openfoal.com', role: 'admin', status: 'active' },
  { id: 'm3', name: 'Cindy Wu', email: 'cindy@openfoal.com', role: 'billing', status: 'invited' },
]

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>(initialMembers)
  const [keyword, setKeyword] = useState('')

  const filteredMembers = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    if (!normalized) {
      return members
    }
    return members.filter(
      (member) =>
        member.name.toLowerCase().includes(normalized) ||
        member.email.toLowerCase().includes(normalized),
    )
  }, [members, keyword])

  return (
    <PageShell
      title="成员管理"
      description="邀请成员、变更角色、停用账户。"
      actions={<Button type="primary">邀请成员</Button>}
    >
      <Input
        showClear
        value={keyword}
        style={{ maxWidth: 320 }}
        placeholder="搜索姓名或邮箱"
        onChange={(value) => setKeyword(value)}
      />

      <Table
        pagination={false}
        dataSource={filteredMembers}
        rowKey="id"
        columns={[
          { title: '姓名', dataIndex: 'name' },
          { title: '邮箱', dataIndex: 'email' },
          {
            title: '角色',
            dataIndex: 'role',
            render: (_, record: MemberRow) => (
              <Select
                value={record.role}
                style={{ width: 160 }}
                optionList={roleOptions}
                onChange={(value) => {
                  setMembers((prev) =>
                    prev.map((member) =>
                      member.id === record.id
                        ? { ...member, role: value as UserRole }
                        : member,
                    ),
                  )
                }}
              />
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (value: MemberStatus) => {
              if (value === 'active') {
                return <Tag color="green">active</Tag>
              }
              if (value === 'invited') {
                return <Tag color="blue">invited</Tag>
              }
              return <Tag>disabled</Tag>
            },
          },
          {
            title: '操作',
            dataIndex: 'action',
            render: (_, record: MemberRow) => (
              <Button
                theme="borderless"
                onClick={() => {
                  setMembers((prev) =>
                    prev.map((member) =>
                      member.id === record.id
                        ? {
                            ...member,
                            status: member.status === 'disabled' ? 'active' : 'disabled',
                          }
                        : member,
                    ),
                  )
                }}
              >
                {record.status === 'disabled' ? '启用' : '停用'}
              </Button>
            ),
          },
        ]}
      />
    </PageShell>
  )
}
