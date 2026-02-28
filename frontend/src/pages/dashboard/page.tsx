import { Banner, Card, Tag, Typography } from '@douyinfe/semi-ui'
import { PageShell } from '@/components/shared/page-shell'

export default function DashboardPage() {
  return (
    <PageShell
      title="企业控制台总览"
      description="租户状态、权限风险和企业账户健康度总览。"
    >
      <Banner
        type="success"
        fullMode={false}
        description="当前是前端静态阶段：数据由页面内 mock 提供，后续可无缝替换后端接口。"
      />

      <div className="page-grid">
        <Card className="page-col-4" title="活跃成员">
          <Typography.Title heading={2} style={{ margin: 0 }}>
            64
          </Typography.Title>
          <Typography.Text type="tertiary">近 7 天 +12%</Typography.Text>
        </Card>

        <Card className="page-col-4" title="高风险权限">
          <Typography.Title heading={2} style={{ margin: 0 }}>
            3
          </Typography.Title>
          <Typography.Text type="tertiary">需完成季度复核</Typography.Text>
        </Card>

        <Card className="page-col-4" title="审计告警">
          <Typography.Title heading={2} style={{ margin: 0 }}>
            1
          </Typography.Title>
          <Typography.Text type="tertiary">来自 SSO 配置变更</Typography.Text>
        </Card>

        <Card className="page-col-12" title="企业准备度">
          <Typography.Paragraph>
            已启用能力：
            <Tag color="green" style={{ marginLeft: 8 }}>
              租户隔离
            </Tag>
            <Tag color="blue" style={{ marginLeft: 8 }}>
              RBAC
            </Tag>
            <Tag color="orange" style={{ marginLeft: 8 }}>
              审计日志
            </Tag>
            <Tag color="cyan" style={{ marginLeft: 8 }}>
              SSO
            </Tag>
            <Tag color="blue" style={{ marginLeft: 8 }}>
              企业 MCP
            </Tag>
            <Tag color="light-blue" style={{ marginLeft: 8 }}>
              企业 Skill
            </Tag>
          </Typography.Paragraph>
        </Card>
      </div>
    </PageShell>
  )
}
