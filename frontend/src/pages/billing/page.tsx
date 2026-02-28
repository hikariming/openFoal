import { Button, Card, Table, Tag, Typography } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/components/shared/page-shell'

const invoiceRows = [
  { id: 'inv_2026_001', period: '2026-01', amount: '$4,000', status: 'paid' },
  { id: 'inv_2026_002', period: '2026-02', amount: '$4,000', status: 'pending' },
]

export default function BillingPage() {
  const { t } = useTranslation()

  return (
    <PageShell
      title={t('billing.title')}
      description={t('billing.description')}
      actions={<Button type="primary">{t('billing.upgradePlan')}</Button>}
    >
      <div className="page-grid">
        <Card className="page-col-6" title={t('billing.currentPlan')}>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            Enterprise Annual
          </Typography.Title>
          <Typography.Text type="tertiary">
            {t('billing.expiresAt', { date: '2027-02-27' })}
          </Typography.Text>
        </Card>

        <Card className="page-col-6" title={t('billing.contractStatus')}>
          <Typography.Paragraph style={{ margin: 0 }}>
            {t('billing.contractNo', { contractId: 'CTR-2026-001' })}
          </Typography.Paragraph>
          <Tag color="green">{t('common.status.active')}</Tag>
        </Card>

        <Card className="page-col-12" title={t('billing.invoiceHistory')}>
          <Table
            pagination={false}
            rowKey="id"
            dataSource={invoiceRows}
            columns={[
              { title: t('billing.columns.invoiceId'), dataIndex: 'id' },
              { title: t('billing.columns.period'), dataIndex: 'period' },
              { title: t('billing.columns.amount'), dataIndex: 'amount' },
              {
                title: t('billing.columns.status'),
                dataIndex: 'status',
                render: (value: 'paid' | 'pending') => (
                  <Tag color={value === 'paid' ? 'green' : 'orange'}>{t(`common.status.${value}`)}</Tag>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </PageShell>
  )
}
