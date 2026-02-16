import { Banner, Button, Card, Input, Space, Table, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { JsonInline } from "../components/admin/JsonInline";
import { getGatewayClient, type GatewayAuditItem, type GatewayAuditQueryParams } from "../lib/gateway-client";
import { useScopeStore } from "../stores/scope-store";
import { formatDate, parseOptionalNumber, toErrorMessage } from "./shared";

export function AuditPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<GatewayAuditItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
  const [filters, setFilters] = useState({
    action: "",
    actor: "",
    resourceType: "",
    resourceId: "",
    from: "",
    to: "",
    limit: "20"
  });

  const buildParams = useCallback(
    (cursor?: number): GatewayAuditQueryParams => ({
      tenantId,
      workspaceId,
      ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
      ...(filters.from.trim() ? { from: filters.from.trim() } : {}),
      ...(filters.to.trim() ? { to: filters.to.trim() } : {}),
      ...(parseOptionalNumber(filters.limit) ? { limit: parseOptionalNumber(filters.limit) } : {}),
      ...(cursor ? { cursor } : {})
    }),
    [filters.action, filters.from, filters.limit, filters.to, tenantId, workspaceId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.queryAudit(buildParams());
      const filtered = result.items.filter((item) => (filters.actor.trim() ? String(item.actor ?? "").includes(filters.actor.trim()) : true)).filter((item) =>
        filters.resourceType.trim() ? String(item.resourceType ?? "").includes(filters.resourceType.trim()) : true
      ).filter((item) => (filters.resourceId.trim() ? String(item.resourceId ?? "").includes(filters.resourceId.trim()) : true));
      setItems(filtered);
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [buildParams, client, filters.actor, filters.resourceId, filters.resourceType]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.queryAudit(buildParams(nextCursor));
      const filtered = result.items.filter((item) => (filters.actor.trim() ? String(item.actor ?? "").includes(filters.actor.trim()) : true)).filter((item) =>
        filters.resourceType.trim() ? String(item.resourceType ?? "").includes(filters.resourceType.trim()) : true
      ).filter((item) => (filters.resourceId.trim() ? String(item.resourceId ?? "").includes(filters.resourceId.trim()) : true));
      setItems((prev) => [...prev, ...filtered]);
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [buildParams, client, filters.actor, filters.resourceId, filters.resourceType, nextCursor]);

  const columns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: "action", dataIndex: "action", width: 220 },
      { title: "actor", dataIndex: "actor", width: 160 },
      { title: "resourceType", dataIndex: "resourceType", width: 150 },
      { title: "resourceId", dataIndex: "resourceId", width: 220 },
      {
        title: "createdAt",
        dataIndex: "createdAt",
        width: 180,
        render: (value: string | undefined) => (
          <Typography.Text size="small" type="tertiary">
            {formatDate(value)}
          </Typography.Text>
        )
      }
    ],
    []
  );

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("audit.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}
      <Card title={t("audit.title")} style={{ width: "100%" }}>
        <Space wrap style={{ marginBottom: 10 }}>
          <Input style={{ width: 170 }} placeholder={t("audit.action")} value={filters.action} onChange={(value) => setFilters((prev) => ({ ...prev, action: value }))} />
          <Input style={{ width: 170 }} placeholder="actor" value={filters.actor} onChange={(value) => setFilters((prev) => ({ ...prev, actor: value }))} />
          <Input
            style={{ width: 170 }}
            placeholder="resourceType"
            value={filters.resourceType}
            onChange={(value) => setFilters((prev) => ({ ...prev, resourceType: value }))}
          />
          <Input
            style={{ width: 170 }}
            placeholder="resourceId"
            value={filters.resourceId}
            onChange={(value) => setFilters((prev) => ({ ...prev, resourceId: value }))}
          />
          <Input style={{ width: 190 }} placeholder={t("audit.from")} value={filters.from} onChange={(value) => setFilters((prev) => ({ ...prev, from: value }))} />
          <Input style={{ width: 190 }} placeholder={t("audit.to")} value={filters.to} onChange={(value) => setFilters((prev) => ({ ...prev, to: value }))} />
          <Input style={{ width: 90 }} placeholder="limit" value={filters.limit} onChange={(value) => setFilters((prev) => ({ ...prev, limit: value }))} />
          <Button theme="solid" onClick={() => void load()}>
            {t("common.apply")}
          </Button>
          <Button
            theme="light"
            onClick={() => {
              setFilters({
                action: "",
                actor: "",
                resourceType: "",
                resourceId: "",
                from: "",
                to: "",
                limit: "20"
              });
              void load();
            }}
          >
            {t("common.clear")}
          </Button>
        </Space>

        <Table
          loading={loading}
          rowKey={(record?: GatewayAuditItem) => String(record?.id ?? `${record?.action ?? "row"}-${record?.createdAt ?? Math.random()}`)}
          columns={columns as any}
          dataSource={items}
          pagination={false}
          empty={<Typography.Text type="tertiary">{t("common.noData")}</Typography.Text>}
          expandedRowRender={(record?: GatewayAuditItem) => <JsonInline value={record?.metadata ?? {}} />}
        />

        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography.Text type="tertiary" size="small">
            rows={items.length} · nextCursor={nextCursor ?? "-"}
          </Typography.Text>
          <Space>
            <Button theme="light" onClick={() => void load()}>
              Reset To First Page
            </Button>
            <Button theme="solid" disabled={!nextCursor} loading={loading} onClick={() => void loadMore()}>
              {t("common.next")}
            </Button>
          </Space>
        </div>
      </Card>
    </Space>
  );
}

