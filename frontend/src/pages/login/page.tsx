import { useEffect, useState } from 'react'
import { Button, Card, Form, Space, Typography } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'
import { LanguageSwitch } from '@/components/shared/language-switch'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantStore } from '@/stores/tenant-store'

interface LoginFormValues {
  email: string
  password: string
  tenantId: string
}

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((state) => state.login)
  const session = useAuthStore((state) => state.session)
  const tenants = useTenantStore((state) => state.tenants)
  const currentTenantId = useTenantStore((state) => state.currentTenantId)
  const setCurrentTenant = useTenantStore((state) => state.setCurrentTenant)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session) {
      return
    }

    navigate(session.role === 'admin' ? routePaths.dashboard : routePaths.userPrototype, {
      replace: true,
    })
  }, [navigate, session])

  const handleSubmit = async (values: LoginFormValues) => {
    setSubmitting(true)
    setError('')

    try {
      setCurrentTenant(values.tenantId)
      const session = await login(values)

      navigate(session.role === 'admin' ? routePaths.dashboard : routePaths.userPrototype, {
        replace: true,
      })
    } catch {
      setError(t('login.loginFailed'))
    } finally {
      setSubmitting(false)
    }
  }

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
          initValues={{
            email: 'admin@openfoal.dev',
            password: '',
            tenantId: currentTenantId,
          }}
          onSubmit={handleSubmit}
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
          <Form.Input
            field="password"
            mode="password"
            label={t('login.password')}
            trigger="blur"
            rules={[{ required: true, message: t('login.passwordRequired') }]}
          />

          {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}

          <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
            <Button htmlType="submit" type="primary" block loading={submitting}>
              {t('login.submit')}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  )
}
