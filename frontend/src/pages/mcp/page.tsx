import { useMemo, useState } from 'react'
import {
  Banner,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/shared/page-shell'

type McpStatus = 'connected' | 'error' | 'disabled'

interface McpServerRow {
  id: string
  name: string
  transport: 'stdio' | 'http' | 'sse'
  endpoint: string
  status: McpStatus
  updatedAt: string
}

const initialRows: McpServerRow[] = [
  {
    id: 'mcp_jira',
    name: 'Jira MCP',
    transport: 'http',
    endpoint: 'https://mcp.enterprise.local/jira',
    status: 'connected',
    updatedAt: '2026-02-28 19:08',
  },
  {
    id: 'mcp_github',
    name: 'GitHub MCP',
    transport: 'sse',
    endpoint: 'https://mcp.enterprise.local/github',
    status: 'connected',
    updatedAt: '2026-02-28 17:41',
  },
  {
    id: 'mcp_confluence',
    name: 'Confluence MCP',
    transport: 'http',
    endpoint: 'https://mcp.enterprise.local/confluence',
    status: 'error',
    updatedAt: '2026-02-28 14:20',
  },
]

export default function McpPage() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<McpServerRow[]>(initialRows)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<McpStatus | 'all'>('all')

  const statusOptions = [
    { value: 'all', label: t('mcp.statusAll') },
    { value: 'connected', label: t('common.status.connected') },
    { value: 'error', label: t('common.status.error') },
    { value: 'disabled', label: t('common.status.disabled') },
  ]

  const renderStatusTag = (value: McpStatus) => {
    if (value === 'connected') {
      return <Tag color="green">{t('common.status.connected')}</Tag>
    }
    if (value === 'error') {
      return <Tag color="red">{t('common.status.error')}</Tag>
    }
    return <Tag>{t('common.status.disabled')}</Tag>
  }

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      const statusMatched = status === 'all' || row.status === status
      const keywordMatched =
        q.length === 0 ||
        row.name.toLowerCase().includes(q) ||
        row.endpoint.toLowerCase().includes(q) ||
        row.transport.includes(q)
      return statusMatched && keywordMatched
    })
  }, [keyword, rows, status])

  return (
    <PageShell
      title={t('mcp.title')}
      description={t('mcp.description')}
      actions={<Button type="primary">{t('mcp.createConnection')}</Button>}
    >
      <Banner type="info" fullMode={false} description={t('mcp.intro')} />

      <Card>
        <Space spacing={12} wrap>
          <Input
            showClear
            style={{ width: 280 }}
            value={keyword}
            placeholder={t('mcp.searchPlaceholder')}
            onChange={(value) => setKeyword(value)}
          />
          <Select
            style={{ width: 200 }}
            value={status}
            optionList={statusOptions}
            onChange={(value) => setStatus(value as McpStatus | 'all')}
          />
        </Space>
      </Card>

      {filteredRows.length === 0 ? (
        <Card>
          <Empty title={t('mcp.emptyTitle')} description={t('mcp.emptyDescription')} />
        </Card>
      ) : (
        <div className="page-grid">
          {filteredRows.map((record) => {
            const nextStatus: McpStatus =
              record.status === 'disabled' ? 'connected' : 'disabled'

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
                    {t('mcp.transport')}: {record.transport}
                  </Typography.Text>
                  <Typography.Text ellipsis={{ showTooltip: true }}>
                    {t('mcp.endpoint')}: {record.endpoint}
                  </Typography.Text>
                  <Typography.Text type="tertiary">
                    {t('mcp.updatedAt')}: {record.updatedAt}
                  </Typography.Text>
                  <Space>
                    <Button size="small" theme="borderless">
                      {t('mcp.viewDetails')}
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
                                  updatedAt: '2026-02-28 23:16',
                                }
                              : row,
                          ),
                        )
                        Toast.success(
                          t('mcp.toggledStatus', {
                            name: record.name,
                            status: t(`common.status.${nextStatus}`),
                          }),
                        )
                      }}
                    >
                      {record.status === 'disabled'
                        ? t('common.actions.enable')
                        : t('common.actions.disable')}
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
