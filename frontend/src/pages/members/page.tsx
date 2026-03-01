import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Select, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { fetchMembers, type MemberStatus, updateMemberRole, updateMemberStatus } from '@/api/members-api'
import { PageShell } from '@/components/shared/page-shell'
import type { UserRole } from '@/stores/auth-store'

interface MemberRow {
  id: string
  name: string
  email: string
  role: UserRole
  status: MemberStatus
}

export default function MembersPage() {
  const { t } = useTranslation()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadMembers = async () => {
      setLoading(true)
      setLoadFailed(false)

      try {
        const result = await fetchMembers()
        if (!active) {
          return
        }

        setMembers(
          result.map((item) => ({
            id: item.accountId,
            name: item.name,
            email: item.email,
            role: item.role,
            status: item.status,
          })),
        )
      } catch {
        if (active) {
          setMembers([])
          setLoadFailed(true)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadMembers()

    return () => {
      active = false
    }
  }, [])

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
      {loadFailed ? (
        <Typography.Text type="danger">{t('members.loadFailed')}</Typography.Text>
      ) : null}

      <Input
        showClear
        value={keyword}
        style={{ maxWidth: 320 }}
        placeholder={t('members.searchPlaceholder')}
        onChange={(value) => setKeyword(value)}
      />

      <Table
        loading={loading}
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
                disabled={Boolean(updatingRoleId || updatingStatusId)}
                onChange={async (value) => {
                  const nextRole = value as UserRole
                  setUpdatingRoleId(record.id)

                  try {
                    await updateMemberRole(record.id, nextRole)
                    setMembers((prev) =>
                      prev.map((member) =>
                        member.id === record.id ? { ...member, role: nextRole } : member,
                      ),
                    )
                  } catch {
                    Toast.error(t('members.updateRoleFailed'))
                  } finally {
                    setUpdatingRoleId(null)
                  }
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
                disabled={Boolean(updatingRoleId || updatingStatusId)}
                onClick={async () => {
                  const nextStatus = record.status === 'disabled' ? 'active' : 'disabled'
                  setUpdatingStatusId(record.id)

                  try {
                    await updateMemberStatus(record.id, nextStatus)
                    setMembers((prev) =>
                      prev.map((member) =>
                        member.id === record.id ? { ...member, status: nextStatus } : member,
                      ),
                    )
                  } catch {
                    Toast.error(t('members.updateStatusFailed'))
                  } finally {
                    setUpdatingStatusId(null)
                  }
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
