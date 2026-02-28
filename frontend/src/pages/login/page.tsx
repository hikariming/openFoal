import { useMemo } from 'react'
import { Button, Card, Form, Space, Typography } from '@douyinfe/semi-ui'
import { useLocation, useNavigate } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantStore } from '@/stores/tenant-store'

interface LoginFormValues {
  email: string
  tenantId: string
}

interface RedirectState {
  from?: string
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const loginAsDemo = useAuthStore((state) => state.loginAsDemo)
  const tenants = useTenantStore((state) => state.tenants)
  const currentTenantId = useTenantStore((state) => state.currentTenantId)
  const setCurrentTenant = useTenantStore((state) => state.setCurrentTenant)

  const redirectTo = useMemo(() => {
    const state = location.state as RedirectState | null
    return state?.from || routePaths.dashboard
  }, [location.state])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <Card style={{ width: 420 }}>
        <Typography.Title heading={3}>企业版登录</Typography.Title>
        <Typography.Paragraph type="tertiary">
          当前为前端阶段，先选择租户再进入控制台。
        </Typography.Paragraph>

        <Form<LoginFormValues>
          labelPosition="top"
          initValues={{ email: 'owner@openfoal.com', tenantId: currentTenantId }}
          onSubmit={(values) => {
            setCurrentTenant(values.tenantId)
            loginAsDemo(values.email)
            navigate(redirectTo, { replace: true })
          }}
        >
          <Form.Select
            field="tenantId"
            label="租户"
            optionList={tenants.map((tenant) => ({
              value: tenant.id,
              label: `${tenant.name} (${tenant.region})`,
            }))}
            rules={[{ required: true, message: '请选择租户' }]}
          />
          <Form.Input
            field="email"
            label="企业邮箱"
            trigger="blur"
            rules={[{ required: true, message: '请输入企业邮箱' }]}
          />
          <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
            <Button htmlType="submit" type="primary" block>
              登录并进入企业控制台
            </Button>
            <Button
              block
              theme="light"
              type="tertiary"
              onClick={() => navigate(routePaths.userPrototype)}
            >
              进入用户端原型
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  )
}
