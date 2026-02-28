import { useState } from 'react'
import { Banner, Button, Card, Form, Radio, Tag } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/shared/page-shell'

interface SsoFormValues {
  provider: 'oidc' | 'saml'
  issuer: string
  clientId: string
  callbackUrl: string
}

export default function SsoPage() {
  const { t } = useTranslation()
  const [savedConfig, setSavedConfig] = useState<SsoFormValues | null>(null)

  return (
    <PageShell title={t('sso.title')} description={t('sso.description')}>
      {savedConfig ? (
        <Banner
          type="success"
          fullMode={false}
          description={t('sso.recentSaved', {
            provider: savedConfig.provider.toUpperCase(),
            issuer: savedConfig.issuer,
          })}
        />
      ) : null}

      <Card>
        <Form<SsoFormValues>
          labelPosition="top"
          initValues={{
            provider: 'oidc',
            issuer: 'https://auth.example.com',
            clientId: 'openfoal-enterprise-web',
            callbackUrl: 'https://enterprise.openfoal.com/sso/callback',
          }}
          onSubmit={(values) => {
            setSavedConfig(values)
          }}
        >
          <Form.RadioGroup
            field="provider"
            label={t('sso.providerLabel')}
            extraText={t('sso.providerHint')}
          >
            <Radio value="oidc">OIDC</Radio>
            <Radio value="saml">SAML</Radio>
          </Form.RadioGroup>

          <Form.Input
            field="issuer"
            label={t('sso.issuerLabel')}
            trigger="blur"
            rules={[{ required: true, message: t('sso.issuerRequired') }]}
          />
          <Form.Input
            field="clientId"
            label={t('sso.clientIdLabel')}
            trigger="blur"
            rules={[{ required: true, message: t('sso.clientIdRequired') }]}
          />
          <Form.Input
            field="callbackUrl"
            label={t('sso.callbackLabel')}
            trigger="blur"
            rules={[{ required: true, message: t('sso.callbackRequired') }]}
          />

          <Button htmlType="submit" type="primary">
            {t('sso.save')}
          </Button>
        </Form>
      </Card>

      <Card>
        {t('sso.capabilityStatus')}
        <Tag color="cyan" style={{ marginLeft: 8 }}>
          {t('sso.oidcReady')}
        </Tag>
        <Tag color="light-blue" style={{ marginLeft: 8 }}>
          {t('sso.samlPlanned')}
        </Tag>
      </Card>
    </PageShell>
  )
}
