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
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/shared/page-shell'

type SkillStatus = 'published' | 'draft' | 'deprecated'

interface SkillRow {
  id: string
  name: string
  mcpBinding: string
  version: string
  status: SkillStatus
  descriptionKey: string
}

const initialRows: SkillRow[] = [
  {
    id: 'skill_security_scan',
    name: 'Security Risk Scan',
    mcpBinding: 'GitHub MCP',
    version: 'v1.4.2',
    status: 'published',
    descriptionKey: 'skills.seedDescriptions.securityRiskScan',
  },
  {
    id: 'skill_contract_check',
    name: 'Contract Validator',
    mcpBinding: 'Confluence MCP',
    version: 'v0.8.1',
    status: 'draft',
    descriptionKey: 'skills.seedDescriptions.contractValidator',
  },
  {
    id: 'skill_incident_summary',
    name: 'Incident Summary',
    mcpBinding: 'Jira MCP',
    version: 'v0.9.0',
    status: 'deprecated',
    descriptionKey: 'skills.seedDescriptions.incidentSummary',
  },
]

export default function SkillsPage() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<SkillRow[]>(initialRows)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<SkillStatus | 'all'>('all')
  const [previewSkill, setPreviewSkill] = useState<SkillRow | null>(null)

  const statusOptions = [
    { value: 'all', label: t('skills.statusAll') },
    { value: 'published', label: t('common.status.published') },
    { value: 'draft', label: t('common.status.draft') },
    { value: 'deprecated', label: t('common.status.deprecated') },
  ]

  const renderStatusTag = (value: SkillStatus) => {
    if (value === 'published') {
      return <Tag color="green">{t('common.status.published')}</Tag>
    }
    if (value === 'draft') {
      return <Tag color="blue">{t('common.status.draft')}</Tag>
    }
    return <Tag color="orange">{t('common.status.deprecated')}</Tag>
  }

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      const statusMatched = status === 'all' || row.status === status
      const keywordMatched =
        q.length === 0 ||
        row.name.toLowerCase().includes(q) ||
        t(row.descriptionKey).toLowerCase().includes(q) ||
        row.mcpBinding.toLowerCase().includes(q)
      return statusMatched && keywordMatched
    })
  }, [keyword, rows, status, t])

  return (
    <PageShell
      title={t('skills.title')}
      description={t('skills.description')}
      actions={<Button type="primary">{t('skills.createSkill')}</Button>}
    >
      <Banner type="info" fullMode={false} description={t('skills.intro')} />

      <Card>
        <Space spacing={12} wrap>
          <Input
            showClear
            style={{ width: 280 }}
            value={keyword}
            placeholder={t('skills.searchPlaceholder')}
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
          <Empty title={t('skills.emptyTitle')} description={t('skills.emptyDescription')} />
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
                <Typography.Text>{t(record.descriptionKey)}</Typography.Text>
                <Typography.Text type="tertiary">
                  {t('skills.mcpBinding')}: {record.mcpBinding}
                </Typography.Text>
                <Typography.Text type="tertiary">
                  {t('skills.version')}: {record.version}
                </Typography.Text>
                <Space>
                  <Button size="small" theme="borderless" onClick={() => setPreviewSkill(record)}>
                    {t('common.actions.view')}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setRows((prev) =>
                        prev.map((row) =>
                          row.id === record.id ? { ...row, status: 'published' } : row,
                        ),
                      )
                      Toast.success(t('skills.publishSuccess', { name: record.name }))
                    }}
                  >
                    {t('common.actions.publish')}
                  </Button>
                </Space>
              </Space>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title={t('skills.detailTitle')}
        visible={Boolean(previewSkill)}
        onCancel={() => setPreviewSkill(null)}
        footer={
          <Button type="primary" onClick={() => setPreviewSkill(null)}>
            {t('common.actions.confirm')}
          </Button>
        }
      >
        {previewSkill ? (
          <Space vertical spacing={8} align="start">
            <Typography.Text>
              <strong>{t('skills.fields.name')}：</strong>
              {previewSkill.name}
            </Typography.Text>
            <Typography.Text>
              <strong>{t('skills.fields.description')}：</strong>
              {t(previewSkill.descriptionKey)}
            </Typography.Text>
            <Typography.Text>
              <strong>{t('skills.fields.binding')}：</strong>
              {previewSkill.mcpBinding}
            </Typography.Text>
            <Typography.Text>
              <strong>{t('skills.fields.version')}：</strong>
              {previewSkill.version}
            </Typography.Text>
            <Typography.Text>
              <strong>{t('skills.fields.status')}：</strong>
              {t(`common.status.${previewSkill.status}`)}
            </Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </PageShell>
  )
}
