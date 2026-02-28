import { Banner, Card, Col, Row, Space, Typography, Button, List, Tag } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { getGatewayClient, type GatewayAuditItem, type GatewayMetricsSummary, type GatewaySession } from "../lib/gateway-client";
import { useScopeStore } from "../stores/scope-store";
import { formatDate, toErrorMessage } from "./shared";

type MetricsCardProps = {
  title: string;
  value: string;
};

function MetricsCard(props: MetricsCardProps): JSX.Element {
  return (
    <Card>
      <Typography.Text type="tertiary">{props.title}</Typography.Text>
      <Typography.Title heading={3} style={{ margin: "8px 0 0" }}>
        {props.value}
      </Typography.Title>
    </Card>
  );
}

const EMPTY_METRICS: GatewayMetricsSummary = {
  runsTotal: 0,
  runsFailed: 0,
  toolCallsTotal: 0,
  toolFailures: 0,
  p95LatencyMs: 0
};

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [metrics, setMetrics] = useState<GatewayMetricsSummary>(EMPTY_METRICS);
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [audits, setAudits] = useState<GatewayAuditItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextMetrics, nextSessions, nextAudits] = await Promise.all([
        client.getMetricsSummary({ tenantId, workspaceId }),
        client.listSessions({ tenantId, workspaceId }),
        client.queryAudit({ tenantId, workspaceId, limit: 8 })
      ]);
      setMetrics(nextMetrics);
      setSessions(nextSessions.slice(0, 8));
      setAudits(nextAudits.items);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, tenantId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("dashboard.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />

      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}

      <Row gutter={[12, 12]} style={{ width: "100%" }}>
        <Col span={6}>
          <MetricsCard title={t("dashboard.runsTotal")} value={String(metrics.runsTotal)} />
        </Col>
        <Col span={6}>
          <MetricsCard title={t("dashboard.runsFailed")} value={String(metrics.runsFailed)} />
        </Col>
        <Col span={6}>
          <MetricsCard title={t("dashboard.toolCalls")} value={String(metrics.toolCallsTotal)} />
        </Col>
        <Col span={6}>
          <MetricsCard title={t("dashboard.p95")} value={`${metrics.p95LatencyMs} ms`} />
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ width: "100%" }}>
        <Col span={12}>
          <Card title={t("dashboard.recentSessions")}>
            {sessions.length === 0 ? (
              <Typography.Text type="tertiary">{t("common.noData")}</Typography.Text>
            ) : (
              <List
                dataSource={sessions}
                renderItem={(item) => (
                  <List.Item
                    main={
                      <div>
                        <Space spacing={6}>
                          <Tag>{item.runtimeMode}</Tag>
                          <Typography.Text>{item.title}</Typography.Text>
                        </Space>
                        <br />
                        <Typography.Text type="tertiary" size="small">
                          {item.id} · {formatDate(item.updatedAt)}
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
          <Card title={t("dashboard.recentAudit")}>
            {audits.length === 0 ? (
              <Typography.Text type="tertiary">{t("common.noData")}</Typography.Text>
            ) : (
              <List
                dataSource={audits}
                renderItem={(item) => (
                  <List.Item
                    main={
                      <div>
                        <Typography.Text>
                          {typeof item.action === "string" ? item.action : "audit.event"} ·{" "}
                          {typeof item.actor === "string" ? item.actor : "unknown"}
                        </Typography.Text>
                        <br />
                        <Typography.Text type="tertiary" size="small">
                          {formatDate(typeof item.createdAt === "string" ? item.createdAt : undefined)}
                        </Typography.Text>
                      </div>
                    }
                  />
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
