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

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'connected', label: 'connected' },
  { value: 'error', label: 'error' },
  { value: 'disabled', label: 'disabled' },
]

function renderStatusTag(status: McpStatus) {
  if (status === 'connected') {
    return <Tag color="green">connected</Tag>
  }
  if (status === 'error') {
    return <Tag color="red">error</Tag>
  }
  return <Tag>disabled</Tag>
}

export default function McpPage() {
  const [rows, setRows] = useState<McpServerRow[]>(initialRows)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<McpStatus | 'all'>('all')

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
      title="企业 MCP 管理"
      description="统一管理企业 MCP 连接器，后续可接入真实握手和健康检查接口。"
      actions={<Button type="primary">新增 MCP 连接</Button>}
    >
      <Banner
        type="info"
        fullMode={false}
        description="MCP（Model Context Protocol）是连接 AI 与外部工具/数据源的标准协议。"
      />

      <Card>
        <Space spacing={12} wrap>
          <Input
            showClear
            style={{ width: 280 }}
            value={keyword}
            placeholder="搜索连接名称或 endpoint"
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
          <Empty title="没有匹配的 MCP 连接" description="调整筛选条件后重试。" />
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
                  <Typography.Text type="tertiary">Transport: {record.transport}</Typography.Text>
                  <Typography.Text ellipsis={{ showTooltip: true }}>Endpoint: {record.endpoint}</Typography.Text>
                  <Typography.Text type="tertiary">最近更新: {record.updatedAt}</Typography.Text>
                  <Space>
                    <Button size="small" theme="borderless">
                      查看详情
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
                        Toast.success(`已切换 ${record.name} 为 ${nextStatus}`)
                      }}
                    >
                      {record.status === 'disabled' ? '启用' : '禁用'}
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
