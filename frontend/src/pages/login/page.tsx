import { useMemo } from 'react'
import { Button, Card, Form, Space, Typography } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'
import { LanguageSwitch } from '@/components/shared/language-switch'
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
  const { t } = useTranslation()
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
        <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
          <LanguageSwitch />
          <Typography.Title heading={3}>{t('login.title')}</Typography.Title>
          <Typography.Paragraph type="tertiary">{t('login.description')}</Typography.Paragraph>
        </Space>

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
            label={t('login.tenant')}
            optionList={tenants.map((tenant) => ({
              value: tenant.id,
              label: `${tenant.name} (${tenant.region})`,
            }))}
            rules={[{ required: true, message: t('login.tenantRequired') }]}
          />
          <Form.Input
            field="email"
            label={t('login.email')}
            trigger="blur"
            rules={[{ required: true, message: t('login.emailRequired') }]}
          />
          <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
            <Button htmlType="submit" type="primary" block>
              {t('login.submit')}
            </Button>
            <Button
              block
              theme="light"
              type="tertiary"
              onClick={() => navigate(routePaths.userPrototype)}
            >
              {t('login.userPrototype')}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  )
}
