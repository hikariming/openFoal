import { Button, Card, Space, Tag, Typography } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'

export default function UserPrototypePage() {
  const navigate = useNavigate()

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 24,
        background: 'linear-gradient(180deg, #f7faff 0%, #f8fafc 100%)',
      }}
    >
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <Space align="center" spacing={8}>
            <Typography.Title heading={3} style={{ margin: 0 }}>
              用户端原型工作台
            </Typography.Title>
            <Tag color="cyan">Prototype</Tag>
          </Space>
          <Typography.Paragraph type="tertiary" style={{ marginBottom: 0 }}>
            这里是用户端原型入口。你可以在这里快速搭建用户视角的页面流程，不影响企业控制台。 
          </Typography.Paragraph>
        </Card>

        <div className="page-grid">
          <Card className="page-col-4" title="原型模块 A">
            <Typography.Text type="tertiary">用户首页、推荐流、入口分发</Typography.Text>
          </Card>
          <Card className="page-col-4" title="原型模块 B">
            <Typography.Text type="tertiary">个人资料、偏好设置、通知中心</Typography.Text>
          </Card>
          <Card className="page-col-4" title="原型模块 C">
            <Typography.Text type="tertiary">互动流程、反馈闭环、历史记录</Typography.Text>
          </Card>
        </div>

        <Card>
          <Space>
            <Button type="primary">开始设计用户端页面</Button>
            <Button onClick={() => navigate(routePaths.login)}>返回登录页</Button>
          </Space>
        </Card>
      </div>
    </div>
  )
}
