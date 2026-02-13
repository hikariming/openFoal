import {
  Badge,
  Banner,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Layout,
  List,
  Nav,
  Progress,
  Row,
  Space,
  Tag,
  Typography
} from "@douyinfe/semi-ui";
import {
  IconActivity,
  IconCheckList,
  IconClock,
  IconHistogram,
  IconSafe,
  IconServer,
  IconSetting,
  IconUserGroup
} from "@douyinfe/semi-icons";

const sessions = [
  { channel: "slack", target: "#ops / thread-4432", status: "streaming" },
  { channel: "telegram", target: "dm / u-2931", status: "needs-review" },
  { channel: "discord", target: "channel-23", status: "active" },
  { channel: "web", target: "console-session", status: "active" }
];

const approvals = [
  "bash.exec: kubectl apply -f prod.yaml",
  "http.request: api.external-risky.com",
  "file.write: /secrets/runtime.env"
];

const audits = [
  "23:10 model.policy.update by admin@tenant",
  "23:09 tool.exec.approved by owner@tenant",
  "23:07 session.reset.manual by developer@workspace",
  "23:04 memory.flush.run by system"
];

function statusTag(status: string) {
  if (status === "needs-review") {
    return <Tag color="orange">needs review</Tag>;
  }
  if (status === "streaming") {
    return <Tag color="blue">streaming</Tag>;
  }
  return <Tag color="green">active</Tag>;
}

function KpiCard(props: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <Typography.Text type="tertiary">{props.title}</Typography.Text>
      <Typography.Title heading={2} style={{ margin: "6px 0 2px" }}>
        {props.value}
      </Typography.Title>
      {props.hint ? (
        <Typography.Text size="small" type="tertiary">
          {props.hint}
        </Typography.Text>
      ) : null}
    </Card>
  );
}

export function App() {
  return (
    <Layout className="console-root">
      <Layout.Sider className="console-sider">
        <div className="brand">OpenFoal Console</div>
        <Nav
          style={{ maxWidth: 240 }}
          defaultSelectedKeys={["dashboard"]}
          items={[
            { itemKey: "dashboard", text: "总览", icon: <IconHistogram /> },
            { itemKey: "sessions", text: "会话", icon: <IconActivity /> },
            { itemKey: "policies", text: "策略", icon: <IconSafe /> },
            { itemKey: "approvals", text: "审批", icon: <IconCheckList /> },
            { itemKey: "audit", text: "审计", icon: <IconClock /> },
            { itemKey: "models", text: "模型", icon: <IconServer /> },
            { itemKey: "settings", text: "设置", icon: <IconSetting /> }
          ]}
          footer={{ collapseButton: false }}
        />
        <Divider margin="12px" />
        <Typography.Text type="tertiary" size="small">
          Workspace: w-enterprise
        </Typography.Text>
        <br />
        <Typography.Text type="tertiary" size="small">
          Agent: support-main
        </Typography.Text>
      </Layout.Sider>

      <Layout>
        <Layout.Header className="console-header">
          <Space>
            <Typography.Title heading={4} style={{ margin: 0 }}>
              企业控制台原型
            </Typography.Title>
            <Badge count="Prototype v0.1" type="primary" />
          </Space>
          <Button theme="solid" icon={<IconUserGroup />}>
            切换 Tenant
          </Button>
        </Layout.Header>

        <Layout.Content className="console-content">
          <Banner
            type="info"
            description="当前原型用于冻结 IA 与流程，后续绑定 Gateway API（sessions.list/policy.get/audit.query）。"
            closeIcon={null}
          />

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col span={6}>
              <KpiCard title="今日请求" value="12,430" hint="QPS / 渠道趋势" />
            </Col>
            <Col span={6}>
              <KpiCard title="错误率" value="0.82%" hint="按 connector 细分" />
            </Col>
            <Col span={6}>
              <KpiCard title="模型成本" value="$142" hint="tenant 日预算 64%" />
            </Col>
            <Col span={6}>
              <KpiCard title="待审批" value="9" hint="高风险工具调用" />
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginTop: 4 }}>
            <Col span={14}>
              <Card title="活跃会话（sessions.list）">
                <List
                  dataSource={sessions}
                  renderItem={(item) => (
                    <List.Item
                      main={
                        <Space>
                          <Tag>{item.channel}</Tag>
                          <Typography.Text>{item.target}</Typography.Text>
                        </Space>
                      }
                      extra={statusTag(item.status)}
                    />
                  )}
                />
              </Card>
            </Col>

            <Col span={10}>
              <Card title="审批中心（approval.queue）">
                <List
                  dataSource={approvals}
                  renderItem={(item) => (
                    <List.Item
                      main={<Typography.Text>{item}</Typography.Text>}
                      extra={<Tag color="red">pending</Tag>}
                    />
                  )}
                />
              </Card>
            </Col>

            <Col span={12}>
              <Card title="策略概览（policy.get）">
                <Descriptions
                  data={[
                    { key: "DM 策略", value: "pairing" },
                    { key: "Tool 默认策略", value: "deny" },
                    { key: "高风险工具", value: "approval-required" },
                    { key: "模型 fallback", value: "enabled" }
                  ]}
                />
                <Divider margin="10px" />
                <Typography.Text type="tertiary">日预算使用率</Typography.Text>
                <Progress percent={64} showInfo />
              </Card>
            </Col>

            <Col span={12}>
              <Card title="审计日志（audit.query）">
                <List
                  dataSource={audits}
                  renderItem={(item) => (
                    <List.Item main={<Typography.Text>{item}</Typography.Text>} />
                  )}
                />
              </Card>
            </Col>
          </Row>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
