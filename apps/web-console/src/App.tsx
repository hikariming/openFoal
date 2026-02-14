import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  Layout,
  List,
  Nav,
  Row,
  Space,
  Tag,
  Typography
} from "@douyinfe/semi-ui";
import {
  IconActivity,
  IconClock,
  IconHistogram,
  IconSafe,
  IconServer,
  IconSetting,
  IconUserGroup
} from "@douyinfe/semi-icons";
import {
  getGatewayClient,
  type GatewayAuditItem,
  type GatewayAuditQueryParams,
  type GatewayMetricsSummary,
  type GatewayPolicy,
  type GatewaySession
} from "./lib/gateway-client";

const EMPTY_METRICS: GatewayMetricsSummary = {
  runsTotal: 0,
  runsFailed: 0,
  toolCallsTotal: 0,
  toolFailures: 0,
  p95LatencyMs: 0
};

type AuditFilters = {
  tenantId: string;
  workspaceId: string;
  action: string;
  from: string;
  to: string;
};

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
  const client = useMemo(() => getGatewayClient(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [policy, setPolicy] = useState<GatewayPolicy | null>(null);
  const [audits, setAudits] = useState<GatewayAuditItem[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<number | undefined>(undefined);
  const [auditLoadMoreLoading, setAuditLoadMoreLoading] = useState(false);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    tenantId: "t_default",
    workspaceId: "w_default",
    action: "",
    from: "",
    to: ""
  });
  const [auditDraft, setAuditDraft] = useState<AuditFilters>({
    tenantId: "t_default",
    workspaceId: "w_default",
    action: "",
    from: "",
    to: ""
  });
  const [metrics, setMetrics] = useState<GatewayMetricsSummary>(EMPTY_METRICS);

  const refreshDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const [nextSessions, nextPolicy, nextAudits, nextMetrics] = await Promise.all([
        client.listSessions(),
        client.getPolicy(),
        client.queryAudit({
          ...toAuditQueryParams(auditFilters),
          limit: 20
        }),
        client.getMetricsSummary()
      ]);
      setSessions(nextSessions);
      setPolicy(nextPolicy);
      setAudits(nextAudits.items);
      setAuditNextCursor(nextAudits.nextCursor);
      setMetrics(nextMetrics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [auditFilters, client]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const runsFailedRate = metrics.runsTotal > 0 ? (metrics.runsFailed / metrics.runsTotal) * 100 : 0;

  const applyAuditFilters = useCallback(() => {
    const normalized = normalizeAuditFilters(auditDraft);
    setAuditFilters(normalized);
  }, [auditDraft]);

  const resetAuditFilters = useCallback(() => {
    const next = {
      tenantId: "t_default",
      workspaceId: "w_default",
      action: "",
      from: "",
      to: ""
    };
    setAuditDraft(next);
    setAuditFilters(next);
  }, []);

  const loadMoreAudits = useCallback(async () => {
    if (!auditNextCursor) {
      return;
    }
    setAuditLoadMoreLoading(true);
    try {
      const next = await client.queryAudit({
        ...toAuditQueryParams(auditFilters),
        limit: 20,
        cursor: auditNextCursor
      });
      setAudits((prev) => [...prev, ...next.items]);
      setAuditNextCursor(next.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setAuditLoadMoreLoading(false);
    }
  }, [auditFilters, auditNextCursor, client]);

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
            { itemKey: "audit", text: "审计", icon: <IconClock /> },
            { itemKey: "models", text: "模型", icon: <IconServer /> },
            { itemKey: "settings", text: "设置", icon: <IconSetting /> }
          ]}
          footer={{ collapseButton: false }}
        />
        <Divider margin="12px" />
        <Typography.Text type="tertiary" size="small">
          Workspace: w_default
        </Typography.Text>
        <br />
        <Typography.Text type="tertiary" size="small">
          Scope: default
        </Typography.Text>
      </Layout.Sider>

      <Layout>
        <Layout.Header className="console-header">
          <Space>
            <Typography.Title heading={4} style={{ margin: 0 }}>
              企业控制台
            </Typography.Title>
            <Badge count={loading ? "Loading..." : "Live"} type={loading ? "warning" : "primary"} />
          </Space>
          <Space>
            <Button theme="light" onClick={() => void refreshDashboard()} loading={loading}>
              刷新
            </Button>
            <Button theme="solid" icon={<IconUserGroup />}>
              切换 Tenant
            </Button>
          </Space>
        </Layout.Header>

        <Layout.Content className="console-content">
          <Banner
            type={error ? "danger" : "info"}
            description={error ? `加载失败：${error}` : "已接入 Gateway API（sessions/policy/audit/metrics）。"}
            closeIcon={null}
          />

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col span={6}>
              <KpiCard title="Runs Total" value={String(metrics.runsTotal)} hint="metrics.summary.runsTotal" />
            </Col>
            <Col span={6}>
              <KpiCard
                title="Runs Failed"
                value={`${metrics.runsFailed} (${runsFailedRate.toFixed(1)}%)`}
                hint="metrics.summary.runsFailed"
              />
            </Col>
            <Col span={6}>
              <KpiCard title="Tool Calls" value={String(metrics.toolCallsTotal)} hint="metrics.summary.toolCallsTotal" />
            </Col>
            <Col span={6}>
              <KpiCard title="P95 Latency" value={`${metrics.p95LatencyMs} ms`} hint="metrics.summary.p95LatencyMs" />
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginTop: 4 }}>
            <Col span={12}>
              <Card title="活跃会话（sessions.list）">
                {sessions.length === 0 ? (
                  <Typography.Text type="tertiary">No sessions</Typography.Text>
                ) : (
                  <List
                    dataSource={sessions}
                    renderItem={(item: GatewaySession) => (
                      <List.Item
                        main={
                          <div>
                            <Space spacing={6}>
                              <Tag>{item.runtimeMode}</Tag>
                              <Typography.Text>{item.title}</Typography.Text>
                              {renderSyncStateTag(item.syncState)}
                            </Space>
                            <Typography.Text type="tertiary" size="small">
                              {item.id} · context {Math.round(item.contextUsage * 100)}% · compaction {item.compactionCount} ·
                              flush {item.memoryFlushState} · {formatDate(item.updatedAt)}
                            </Typography.Text>
                          </div>
                        }
                      />
                    )}
                  />
                )}
              </Card>
            </Col>

            <Col span={12}>
              <Card title="策略概览（policy.get）">
                {policy ? (
                  <>
                    <Descriptions
                      data={[
                        { key: "scopeKey", value: policy.scopeKey },
                        { key: "toolDefault", value: policy.toolDefault },
                        { key: "highRisk", value: policy.highRisk },
                        { key: "bashMode", value: policy.bashMode },
                        { key: "version", value: String(policy.version) },
                        { key: "updatedAt", value: formatDate(policy.updatedAt) }
                      ]}
                    />
                    <Divider margin="10px" />
                    <Typography.Text type="tertiary">tools overrides: {Object.keys(policy.tools).length}</Typography.Text>
                  </>
                ) : (
                  <Typography.Text type="tertiary">No policy</Typography.Text>
                )}
              </Card>
            </Col>

            <Col span={12}>
              <Card title="审计日志（audit.query）">
                <Space wrap style={{ marginBottom: 10 }}>
                  <Input
                    style={{ width: 150 }}
                    size="small"
                    placeholder="tenantId"
                    value={auditDraft.tenantId}
                    onChange={(value) => setAuditDraft((prev) => ({ ...prev, tenantId: value }))}
                  />
                  <Input
                    style={{ width: 150 }}
                    size="small"
                    placeholder="workspaceId"
                    value={auditDraft.workspaceId}
                    onChange={(value) => setAuditDraft((prev) => ({ ...prev, workspaceId: value }))}
                  />
                  <Input
                    style={{ width: 140 }}
                    size="small"
                    placeholder="action"
                    value={auditDraft.action}
                    onChange={(value) => setAuditDraft((prev) => ({ ...prev, action: value }))}
                  />
                  <Input
                    style={{ width: 180 }}
                    size="small"
                    placeholder="from (ISO)"
                    value={auditDraft.from}
                    onChange={(value) => setAuditDraft((prev) => ({ ...prev, from: value }))}
                  />
                  <Input
                    style={{ width: 180 }}
                    size="small"
                    placeholder="to (ISO)"
                    value={auditDraft.to}
                    onChange={(value) => setAuditDraft((prev) => ({ ...prev, to: value }))}
                  />
                  <Button theme="solid" size="small" onClick={applyAuditFilters} loading={loading}>
                    应用筛选
                  </Button>
                  <Button theme="light" size="small" onClick={resetAuditFilters} disabled={loading}>
                    重置
                  </Button>
                </Space>
                {audits.length === 0 ? (
                  <Typography.Text type="tertiary">No audit records</Typography.Text>
                ) : (
                  <List
                    dataSource={audits}
                    renderItem={(item: GatewayAuditItem) => (
                      <List.Item
                        main={
                          <div>
                            <Typography.Text>
                              {asString(item.action) ?? "audit.event"} · {asString(item.actor) ?? "unknown"} ·{" "}
                              {formatDate(asString(item.createdAt))}
                            </Typography.Text>
                            <br />
                            <Typography.Text type="tertiary" size="small">
                              {asString(item.tenantId) ?? "-"} / {asString(item.workspaceId) ?? "-"} ·{" "}
                              {asString(item.resourceType) ?? "resource"}:{asString(item.resourceId) ?? "-"}
                            </Typography.Text>
                            {item.metadata && typeof item.metadata === "object" ? (
                              <>
                                <br />
                                <Typography.Text type="tertiary" size="small">
                                  {clipJson(item.metadata, 180)}
                                </Typography.Text>
                              </>
                            ) : null}
                          </div>
                        }
                      />
                    )}
                  />
                )}
                {auditNextCursor ? (
                  <div style={{ marginTop: 10 }}>
                    <Button theme="light" size="small" onClick={() => void loadMoreAudits()} loading={auditLoadMoreLoading}>
                      加载更多
                    </Button>
                  </div>
                ) : null}
              </Card>
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginTop: 4 }}>
            <Col span={24}>
              <Card title="Metrics（metrics.summary）">
                <Descriptions
                  data={[
                    { key: "runsTotal", value: String(metrics.runsTotal) },
                    { key: "runsFailed", value: String(metrics.runsFailed) },
                    { key: "toolCallsTotal", value: String(metrics.toolCallsTotal) },
                    { key: "toolFailures", value: String(metrics.toolFailures) },
                    { key: "p95LatencyMs", value: `${metrics.p95LatencyMs} ms` }
                  ]}
                />
              </Card>
            </Col>
          </Row>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function renderSyncStateTag(syncState: GatewaySession["syncState"]): JSX.Element {
  if (syncState === "synced") {
    return <Tag color="green">synced</Tag>;
  }
  if (syncState === "syncing") {
    return <Tag color="blue">syncing</Tag>;
  }
  if (syncState === "conflict") {
    return <Tag color="red">conflict</Tag>;
  }
  return <Tag color="grey">local_only</Tag>;
}

function formatDate(input: string | undefined): string {
  if (!input) {
    return "-";
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toLocaleString();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeAuditFilters(source: AuditFilters): AuditFilters {
  return {
    tenantId: source.tenantId.trim(),
    workspaceId: source.workspaceId.trim(),
    action: source.action.trim(),
    from: source.from.trim(),
    to: source.to.trim()
  };
}

function toAuditQueryParams(filters: AuditFilters): GatewayAuditQueryParams {
  return {
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {})
  };
}

function clipJson(value: unknown, maxLength: number): string {
  const text = JSON.stringify(value);
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
