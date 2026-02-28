import { useState } from 'react'
import { Banner, Button, Card, Form, Radio, Tag } from '@douyinfe/semi-ui'
import { PageShell } from '@/components/shared/page-shell'

interface SsoFormValues {
  provider: 'oidc' | 'saml'
  issuer: string
  clientId: string
  callbackUrl: string
}

export default function SsoPage() {
  const [savedConfig, setSavedConfig] = useState<SsoFormValues | null>(null)

  return (
    <PageShell
      title="SSO 配置"
      description="建议先接 OIDC，再扩展到 SAML。这里先做纯前端交互。"
    >
      {savedConfig ? (
        <Banner
          type="success"
          fullMode={false}
          description={`最近保存：${savedConfig.provider.toUpperCase()} / ${savedConfig.issuer}`}
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
            label="协议"
            extraText="企业建议优先 OIDC，兼容需求再启用 SAML"
          >
            <Radio value="oidc">OIDC</Radio>
            <Radio value="saml">SAML</Radio>
          </Form.RadioGroup>

          <Form.Input
            field="issuer"
            label="Issuer / Entity ID"
            trigger="blur"
            rules={[{ required: true, message: '请填写 Issuer / Entity ID' }]}
          />
          <Form.Input
            field="clientId"
            label="Client ID"
            trigger="blur"
            rules={[{ required: true, message: '请填写 Client ID' }]}
          />
          <Form.Input
            field="callbackUrl"
            label="Callback URL"
            trigger="blur"
            rules={[{ required: true, message: '请填写回调地址' }]}
          />

          <Button htmlType="submit" type="primary">
            保存 SSO 配置
          </Button>
        </Form>
      </Card>

      <Card>
        能力状态：
        <Tag color="cyan" style={{ marginLeft: 8 }}>
          OIDC Ready
        </Tag>
        <Tag color="light-blue" style={{ marginLeft: 8 }}>
          SAML Planned
        </Tag>
      </Card>
    </PageShell>
  )
}
