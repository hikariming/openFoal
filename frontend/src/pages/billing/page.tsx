import { Button, Card, Table, Tag, Typography } from '@douyinfe/semi-ui'
import { PageShell } from '@/components/shared/page-shell'

const invoiceRows = [
  { id: 'inv_2026_001', period: '2026-01', amount: '$4,000', status: 'paid' },
  { id: 'inv_2026_002', period: '2026-02', amount: '$4,000', status: 'pending' },
]

export default function BillingPage() {
  return (
    <PageShell
      title="计费与合同"
      description="展示订阅计划、合同状态、发票记录。"
      actions={<Button type="primary">升级套餐</Button>}
    >
      <div className="page-grid">
        <Card className="page-col-6" title="当前套餐">
          <Typography.Title heading={4} style={{ margin: 0 }}>
            Enterprise Annual
          </Typography.Title>
          <Typography.Text type="tertiary">到期时间：2027-02-27</Typography.Text>
        </Card>

        <Card className="page-col-6" title="合同状态">
          <Typography.Paragraph style={{ margin: 0 }}>
            合同编号：CTR-2026-001
          </Typography.Paragraph>
          <Tag color="green">ACTIVE</Tag>
        </Card>

        <Card className="page-col-12" title="发票记录">
          <Table
            pagination={false}
            rowKey="id"
            dataSource={invoiceRows}
            columns={[
              { title: 'Invoice ID', dataIndex: 'id' },
              { title: '账期', dataIndex: 'period' },
              { title: '金额', dataIndex: 'amount' },
              {
                title: '状态',
                dataIndex: 'status',
                render: (value: string) => (
                  <Tag color={value === 'paid' ? 'green' : 'orange'}>{value}</Tag>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </PageShell>
  )
}
