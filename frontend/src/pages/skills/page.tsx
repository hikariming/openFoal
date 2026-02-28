import { useMemo, useState } from 'react'
import {
  Banner,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui'
import { PageShell } from '@/components/shared/page-shell'

type SkillStatus = 'published' | 'draft' | 'deprecated'

interface SkillRow {
  id: string
  name: string
  mcpBinding: string
  version: string
  status: SkillStatus
  description: string
}

const initialRows: SkillRow[] = [
  {
    id: 'skill_security_scan',
    name: 'Security Risk Scan',
    mcpBinding: 'GitHub MCP',
    version: 'v1.4.2',
    status: 'published',
    description: '扫描仓库风险并生成修复建议。',
  },
  {
    id: 'skill_contract_check',
    name: 'Contract Validator',
    mcpBinding: 'Confluence MCP',
    version: 'v0.8.1',
    status: 'draft',
    description: '校验企业合同条款完整性与风险项。',
  },
  {
    id: 'skill_incident_summary',
    name: 'Incident Summary',
    mcpBinding: 'Jira MCP',
    version: 'v0.9.0',
    status: 'deprecated',
    description: '自动总结故障票据并输出复盘摘要。',
  },
]

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'published', label: 'published' },
  { value: 'draft', label: 'draft' },
  { value: 'deprecated', label: 'deprecated' },
]

function renderStatusTag(status: SkillStatus) {
  if (status === 'published') {
    return <Tag color="green">published</Tag>
  }
  if (status === 'draft') {
    return <Tag color="blue">draft</Tag>
  }
  return <Tag color="orange">deprecated</Tag>
}

export default function SkillsPage() {
  const [rows, setRows] = useState<SkillRow[]>(initialRows)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<SkillStatus | 'all'>('all')
  const [previewSkill, setPreviewSkill] = useState<SkillRow | null>(null)

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      const statusMatched = status === 'all' || row.status === status
      const keywordMatched =
        q.length === 0 ||
        row.name.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q) ||
        row.mcpBinding.toLowerCase().includes(q)
      return statusMatched && keywordMatched
    })
  }, [keyword, rows, status])

  return (
    <PageShell
      title="企业 Skill 管理"
      description="管理企业级 Skill 模板、版本与发布状态。"
      actions={<Button type="primary">创建 Skill</Button>}
    >
      <Banner
        type="info"
        fullMode={false}
        description="Skill 可理解为可复用的任务能力包，通常包含提示词、约束规则、资源引用和执行流程。"
      />

      <Card>
        <Space spacing={12} wrap>
          <Input
            showClear
            style={{ width: 280 }}
            value={keyword}
            placeholder="搜索技能名称/描述/MCP 绑定"
            onChange={(value) => setKeyword(value)}
          />
          <Select
            style={{ width: 200 }}
            value={status}
            optionList={statusOptions}
            onChange={(value) => setStatus(value as SkillStatus | 'all')}
          />
        </Space>
      </Card>

      {filteredRows.length === 0 ? (
        <Card>
          <Empty title="没有匹配的 Skill" description="调整筛选条件后重试。" />
        </Card>
      ) : (
        <div className="page-grid">
          {filteredRows.map((record) => (
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
                <Typography.Text>{record.description}</Typography.Text>
                <Typography.Text type="tertiary">MCP 绑定: {record.mcpBinding}</Typography.Text>
                <Typography.Text type="tertiary">版本: {record.version}</Typography.Text>
                <Space>
                  <Button size="small" theme="borderless" onClick={() => setPreviewSkill(record)}>
                    查看
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setRows((prev) =>
                        prev.map((row) =>
                          row.id === record.id ? { ...row, status: 'published' } : row,
                        ),
                      )
                      Toast.success(`已发布 ${record.name}`)
                    }}
                  >
                    发布
                  </Button>
                </Space>
              </Space>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="Skill 详情"
        visible={Boolean(previewSkill)}
        onCancel={() => setPreviewSkill(null)}
        footer={
          <Button type="primary" onClick={() => setPreviewSkill(null)}>
            确认
          </Button>
        }
      >
        {previewSkill ? (
          <Space vertical spacing={8} align="start">
            <Typography.Text>
              <strong>名称：</strong>
              {previewSkill.name}
            </Typography.Text>
            <Typography.Text>
              <strong>描述：</strong>
              {previewSkill.description}
            </Typography.Text>
            <Typography.Text>
              <strong>MCP 绑定：</strong>
              {previewSkill.mcpBinding}
            </Typography.Text>
            <Typography.Text>
              <strong>版本：</strong>
              {previewSkill.version}
            </Typography.Text>
            <Typography.Text>
              <strong>状态：</strong>
              {previewSkill.status}
            </Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </PageShell>
  )
}
