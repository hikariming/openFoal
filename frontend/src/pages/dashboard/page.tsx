import { Banner, Card, Tag, Typography } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/shared/page-shell'

export default function DashboardPage() {
  const { t } = useTranslation()

  return (
    <PageShell title={t('dashboard.title')} description={t('dashboard.description')}>
      <Banner type="success" fullMode={false} description={t('dashboard.staticBanner')} />

      <div className="page-grid">
        <Card className="page-col-4" title={t('dashboard.activeMembers')}>
          <Typography.Title heading={2} style={{ margin: 0 }}>
            64
          </Typography.Title>
          <Typography.Text type="tertiary">{t('dashboard.activeMembersTrend')}</Typography.Text>
        </Card>

        <Card className="page-col-4" title={t('dashboard.highRiskPermissions')}>
          <Typography.Title heading={2} style={{ margin: 0 }}>
            3
          </Typography.Title>
          <Typography.Text type="tertiary">{t('dashboard.quarterlyReview')}</Typography.Text>
        </Card>

        <Card className="page-col-4" title={t('dashboard.auditAlerts')}>
          <Typography.Title heading={2} style={{ margin: 0 }}>
            1
          </Typography.Title>
          <Typography.Text type="tertiary">{t('dashboard.alertFromSso')}</Typography.Text>
        </Card>

        <Card className="page-col-12" title={t('dashboard.enterpriseReadiness')}>
          <Typography.Paragraph>
            {t('dashboard.enabledCapabilities')}
            <Tag color="green" style={{ marginLeft: 8 }}>
              {t('dashboard.capabilityTenantIsolation')}
            </Tag>
            <Tag color="blue" style={{ marginLeft: 8 }}>
              {t('dashboard.capabilityRbac')}
            </Tag>
            <Tag color="orange" style={{ marginLeft: 8 }}>
              {t('dashboard.capabilityAudit')}
            </Tag>
            <Tag color="cyan" style={{ marginLeft: 8 }}>
              {t('dashboard.capabilitySso')}
            </Tag>
            <Tag color="blue" style={{ marginLeft: 8 }}>
              {t('dashboard.capabilityMcp')}
            </Tag>
            <Tag color="light-blue" style={{ marginLeft: 8 }}>
              {t('dashboard.capabilitySkill')}
            </Tag>
          </Typography.Paragraph>
        </Card>
      </div>
    </PageShell>
  )
}
