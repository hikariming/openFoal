import { useMemo, useState } from 'react'
import { Button, Input, Select, Table, Tag } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
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

const initialMembers: MemberRow[] = [
  { id: 'm1', name: 'Alice Li', email: 'alice@openfoal.com', role: 'admin', status: 'active' },
  { id: 'm2', name: 'Bob Chen', email: 'bob@openfoal.com', role: 'admin', status: 'active' },
  { id: 'm3', name: 'Cindy Wu', email: 'cindy@openfoal.com', role: 'member', status: 'invited' },
]

export default function MembersPage() {
  const { t } = useTranslation()
  const [members, setMembers] = useState<MemberRow[]>(initialMembers)
  const [keyword, setKeyword] = useState('')

  const roleOptions = [
    { value: 'admin', label: t('common.roles.admin') },
    { value: 'member', label: t('common.roles.member') },
  ]

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
      title={t('members.title')}
      description={t('members.description')}
      actions={<Button type="primary">{t('members.inviteMember')}</Button>}
    >
      <Input
        showClear
        value={keyword}
        style={{ maxWidth: 320 }}
        placeholder={t('members.searchPlaceholder')}
        onChange={(value) => setKeyword(value)}
      />

      <Table
        pagination={false}
        dataSource={filteredMembers}
        rowKey="id"
        columns={[
          { title: t('members.columns.name'), dataIndex: 'name' },
          { title: t('members.columns.email'), dataIndex: 'email' },
          {
            title: t('members.columns.role'),
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
            title: t('members.columns.status'),
            dataIndex: 'status',
            render: (value: MemberStatus) => {
              if (value === 'active') {
                return <Tag color="green">{t('common.status.active')}</Tag>
              }
              if (value === 'invited') {
                return <Tag color="blue">{t('common.status.invited')}</Tag>
              }
              return <Tag>{t('common.status.disabled')}</Tag>
            },
          },
          {
            title: t('members.columns.action'),
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
                {record.status === 'disabled'
                  ? t('common.actions.enable')
                  : t('common.actions.disable')}
              </Button>
            ),
          },
        ]}
      />
    </PageShell>
  )
}
