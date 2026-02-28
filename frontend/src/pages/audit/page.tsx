import { useMemo, useState } from 'react'
import { Input, Select, Table, Tag } from '@douyinfe/semi-ui'
import { PageShell } from '@/components/shared/page-shell'

type ActionType = 'member.update' | 'sso.update' | 'billing.contract.update'

interface AuditRow {
  id: string
  actor: string
  action: ActionType
  resource: string
  result: 'success' | 'failure'
  ip: string
  createdAt: string
}

const auditRows: AuditRow[] = [
  {
    id: 'a_1',
    actor: 'alice@openfoal.com',
    action: 'member.update',
    resource: 'member/bob',
    result: 'success',
    ip: '34.120.10.11',
    createdAt: '2026-02-28 10:22:11',
  },
  {
    id: 'a_2',
    actor: 'bob@openfoal.com',
    action: 'sso.update',
    resource: 'sso/oidc',
    result: 'success',
    ip: '34.120.10.55',
    createdAt: '2026-02-28 12:03:08',
  },
  {
    id: 'a_3',
    actor: 'billing@openfoal.com',
    action: 'billing.contract.update',
    resource: 'contract/ctr_2026_001',
    result: 'failure',
    ip: '34.120.10.29',
    createdAt: '2026-02-28 13:16:44',
  },
]

export default function AuditPage() {
  const [keyword, setKeyword] = useState('')
  const [action, setAction] = useState<ActionType | 'all'>('all')

  const filteredRows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()

    return auditRows.filter((row) => {
      const actionMatched = action === 'all' || row.action === action
      const keywordMatched =
        normalized.length === 0 ||
        row.actor.toLowerCase().includes(normalized) ||
        row.resource.toLowerCase().includes(normalized) ||
        row.ip.includes(normalized)
      return actionMatched && keywordMatched
    })
  }, [action, keyword])

  return (
    <PageShell
      title="审计日志"
      description="统一审计事件视图：actor/action/resource/result/time/ip。"
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          showClear
          style={{ width: 280 }}
          placeholder="搜索 actor/resource/ip"
          value={keyword}
          onChange={(value) => setKeyword(value)}
        />
        <Select
          style={{ width: 240 }}
          value={action}
          optionList={[
            { value: 'all', label: '全部动作' },
            { value: 'member.update', label: 'member.update' },
            { value: 'sso.update', label: 'sso.update' },
            { value: 'billing.contract.update', label: 'billing.contract.update' },
          ]}
          onChange={(value) => setAction(value as ActionType | 'all')}
        />
      </div>

      <Table
        rowKey="id"
        pagination={false}
        dataSource={filteredRows}
        columns={[
          { title: 'Actor', dataIndex: 'actor' },
          { title: 'Action', dataIndex: 'action' },
          { title: 'Resource', dataIndex: 'resource' },
          {
            title: 'Result',
            dataIndex: 'result',
            render: (value: 'success' | 'failure') => (
              <Tag color={value === 'success' ? 'green' : 'red'}>{value}</Tag>
            ),
          },
          { title: 'IP', dataIndex: 'ip' },
          { title: 'Time', dataIndex: 'createdAt' },
        ]}
      />
    </PageShell>
  )
}
