import { useMemo, useState } from 'react'
import {
  Banner,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/shared/page-shell'

type SandboxStatus = 'running' | 'stopped' | 'error'

interface SandboxRow {
  id: string
  name: string
  region: string
  runtime: string
  image: string
  status: SandboxStatus
  autoStop: boolean
  activeSessions: number
  cpu: string
  memory: string
  lastActive: string
}

const initialRows: SandboxRow[] = [
  {
    id: 'sbx_design_review',
    name: 'design-review-sbx',
    region: 'ap-southeast-1',
    runtime: 'Node.js 22',
    image: 'openfoal/sandbox:2026.02.28',
    status: 'running',
    autoStop: true,
    activeSessions: 4,
    cpu: '2 vCPU',
    memory: '4 GB',
    lastActive: '2026-03-01 00:26',
  },
  {
    id: 'sbx_agent_eval',
    name: 'agent-eval-sbx',
    region: 'us-west-2',
    runtime: 'Python 3.12',
    image: 'openfoal/sandbox:2026.02.20',
    status: 'stopped',
    autoStop: true,
    activeSessions: 0,
    cpu: '4 vCPU',
    memory: '8 GB',
    lastActive: '2026-02-28 21:40',
  },
  {
    id: 'sbx_ops_check',
    name: 'ops-check-sbx',
    region: 'eu-central-1',
    runtime: 'Node.js 20',
    image: 'openfoal/sandbox:2026.02.15',
    status: 'error',
    autoStop: false,
    activeSessions: 1,
    cpu: '2 vCPU',
    memory: '4 GB',
    lastActive: '2026-02-28 18:07',
  },
]

export default function SandboxPage() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<SandboxRow[]>(initialRows)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<SandboxStatus | 'all'>('all')

  const statusOptions = [
    { value: 'all', label: t('sandbox.statusAll') },
    { value: 'running', label: t('common.status.running') },
    { value: 'stopped', label: t('common.status.stopped') },
    { value: 'error', label: t('common.status.error') },
  ]

  const renderStatusTag = (value: SandboxStatus) => {
    if (value === 'running') {
      return <Tag color="green">{t('common.status.running')}</Tag>
    }
    if (value === 'error') {
      return <Tag color="red">{t('common.status.error')}</Tag>
    }
    return <Tag>{t('common.status.stopped')}</Tag>
  }

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      const statusMatched = status === 'all' || row.status === status
      const keywordMatched =
        q.length === 0 ||
        row.name.toLowerCase().includes(q) ||
        row.region.toLowerCase().includes(q) ||
        row.runtime.toLowerCase().includes(q) ||
        row.image.toLowerCase().includes(q)
      return statusMatched && keywordMatched
    })
  }, [keyword, rows, status])

  return (
    <PageShell
      title={t('sandbox.title')}
      description={t('sandbox.description')}
      actions={<Button type="primary">{t('sandbox.createSandbox')}</Button>}
    >
      <Banner type="info" fullMode={false} description={t('sandbox.intro')} />

      <Card>
        <Space spacing={12} wrap>
          <Input
            showClear
            style={{ width: 280 }}
            value={keyword}
            placeholder={t('sandbox.searchPlaceholder')}
            onChange={(value) => setKeyword(value)}
          />
          <Select
            style={{ width: 200 }}
            value={status}
            optionList={statusOptions}
            onChange={(value) => setStatus(value as SandboxStatus | 'all')}
          />
        </Space>
      </Card>

      {filteredRows.length === 0 ? (
        <Card>
          <Empty title={t('sandbox.emptyTitle')} description={t('sandbox.emptyDescription')} />
        </Card>
      ) : (
        <div className="page-grid">
          {filteredRows.map((record) => {
            const nextStatus: SandboxStatus = record.status === 'running' ? 'stopped' : 'running'

            return (
              <Card
                key={record.id}
                className="page-col-6"
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography.Text strong>{record.name}</Typography.Text>
                    {renderStatusTag(record.status)}
                  </div>
                }
              >
                <Space vertical align="start" spacing={8} style={{ width: '100%' }}>
                  <Typography.Text type="tertiary">
                    {t('sandbox.region')}: {record.region}
                  </Typography.Text>
                  <Typography.Text type="tertiary">
                    {t('sandbox.runtime')}: {record.runtime}
                  </Typography.Text>
                  <Typography.Text ellipsis={{ showTooltip: true }}>
                    {t('sandbox.image')}: {record.image}
                  </Typography.Text>
                  <Typography.Text>
                    {t('sandbox.resources')}: {record.cpu} / {record.memory}
                  </Typography.Text>
                  <Typography.Text type="tertiary">
                    {t('sandbox.activeSessions')}: {record.activeSessions}
                  </Typography.Text>
                  <Typography.Text type="tertiary">
                    {t('sandbox.lastActive')}: {record.lastActive}
                  </Typography.Text>

                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography.Text>{t('sandbox.autoStop')}</Typography.Text>
                    <Switch
                      checked={record.autoStop}
                      onChange={(checked) => {
                        setRows((prev) =>
                          prev.map((row) =>
                            row.id === record.id ? { ...row, autoStop: Boolean(checked) } : row,
                          ),
                        )
                        Toast.success(
                          checked ? t('sandbox.autoStopEnabled') : t('sandbox.autoStopDisabled'),
                        )
                      }}
                    />
                  </div>

                  <Space>
                    <Button size="small" theme="borderless">
                      {t('sandbox.openConsole')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setRows((prev) =>
                          prev.map((row) =>
                            row.id === record.id
                              ? {
                                  ...row,
                                  status: nextStatus,
                                  lastActive: '2026-03-01 00:30',
                                }
                              : row,
                          ),
                        )
                        Toast.success(
                          t('sandbox.toggledStatus', {
                            name: record.name,
                            status: t(`common.status.${nextStatus}`),
                          }),
                        )
                      }}
                    >
                      {record.status === 'running' ? t('sandbox.stop') : t('sandbox.start')}
                    </Button>
                  </Space>
                </Space>
              </Card>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
