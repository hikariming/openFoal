import { Banner, Button, Space, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { JsonInline } from "../components/admin/JsonInline";
import { getGatewayClient, type GatewayInfraHealth, type GatewayReconcileResult } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { formatDate, toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

type HealthRow = {
  checkName: string;
  status: string;
  summary: string;
  updatedAt: string;
  raw: unknown;
};

type ReconcileRow = {
  runAt: string;
  uploaded: number;
  scanned: number;
  skipped: number;
  raw: GatewayReconcileResult;
};

export function InfraPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [health, setHealth] = useState<GatewayInfraHealth | null>(null);
  const [reconcileHistory, setReconcileHistory] = useState<ReconcileRow[]>([]);

  const loadHealth = useCallback(async () => {
    if (!permissions.canReadInfra) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.getInfraHealth();
      setHealth(next);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, permissions.canReadInfra]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const runReconcile = useCallback(async () => {
    if (!permissions.canWriteInfra) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.reconcileStorage();
      setReconcileHistory((prev) => [
        {
          runAt: new Date().toISOString(),
          uploaded: result.uploaded,
          scanned: result.scanned,
          skipped: typeof result.skipped === "number" ? result.skipped : 0,
          raw: result
        },
        ...prev
      ]);
      await loadHealth();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setLoading(false);
    }
  }, [client, loadHealth, permissions.canWriteInfra]);

  const healthRows = useMemo<HealthRow[]>(
    () =>
      Object.entries(health?.checks ?? {}).map(([checkName, value]) => {
        let status = "unknown";
        if (typeof value === "boolean") {
          status = value ? "ok" : "fail";
        } else if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          if (typeof record.status === "string") {
            status = record.status;
          } else if (typeof record.ok === "boolean") {
            status = record.ok ? "ok" : "fail";
          }
        }
        return {
          checkName,
          status,
          summary: typeof value === "string" ? value : JSON.stringify(value),
          updatedAt: health?.serverTime ?? "",
          raw: value
        };
      }),
    [health]
  );

  const healthTable = useClientTableState<HealthRow, "checkName" | "updatedAt">({
    items: healthRows,
    initialPageSize: 20,
    initialSortKey: "checkName",
    searchableText: (item) => `${item.checkName} ${item.status} ${item.summary}`,
    comparators: {
      checkName: (left, right) => left.checkName.localeCompare(right.checkName),
      updatedAt: (left, right) => left.updatedAt.localeCompare(right.updatedAt)
    }
  });

  const reconcileTable = useClientTableState<ReconcileRow, "runAt">({
    items: reconcileHistory,
    initialPageSize: 10,
    initialSortKey: "runAt",
    initialSortOrder: "desc",
    searchableText: (item) => `${item.runAt} ${item.uploaded} ${item.scanned} ${item.skipped}`,
    comparators: {
      runAt: (left, right) => left.runAt.localeCompare(right.runAt)
    }
  });

  const healthColumns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: "checkName", dataIndex: "checkName", width: 220 },
      { title: "status", dataIndex: "status", width: 120 },
      {
        title: "summary",
        dataIndex: "summary",
        render: (text: string) => (
          <Typography.Text size="small" type="tertiary">
            {text}
          </Typography.Text>
        )
      },
      {
        title: "updatedAt",
        dataIndex: "updatedAt",
        width: 180,
        render: (value: string) => (
          <Typography.Text size="small" type="tertiary">
            {formatDate(value)}
          </Typography.Text>
        )
      }
    ],
    []
  );

  const reconcileColumns = useMemo<Array<Record<string, unknown>>>(
    () => [
      {
        title: "runAt",
        dataIndex: "runAt",
        width: 180,
        render: (value: string) => (
          <Typography.Text size="small" type="tertiary">
            {formatDate(value)}
          </Typography.Text>
        )
      },
      { title: "uploaded", dataIndex: "uploaded", width: 120 },
      { title: "scanned", dataIndex: "scanned", width: 120 },
      { title: "skipped", dataIndex: "skipped", width: 120 }
    ],
    []
  );

  if (!permissions.canReadInfra) {
    return <Banner type="warning" closeIcon={null} description={t("common.forbidden")} />;
  }

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("infra.title")}
        actions={
          <Space>
            <Button theme="light" loading={loading} onClick={() => void loadHealth()}>
              {t("infra.health")}
            </Button>
            <Button theme="solid" disabled={!permissions.canWriteInfra} loading={loading} onClick={() => void runReconcile()}>
              {t("infra.reconcile")}
            </Button>
          </Space>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}

      <AdminTableCard
        title={t("infra.health")}
        loading={loading}
        columns={healthColumns}
        dataSource={healthTable.pageItems}
        rowKey="checkName"
        emptyText={t("common.noData")}
        page={healthTable.query.page}
        pageSize={healthTable.query.pageSize}
        total={healthTable.total}
        totalPages={healthTable.totalPages}
        onPageChange={healthTable.setPage}
        onPageSizeChange={healthTable.setPageSize}
        renderExpandedRow={(row: HealthRow) => <JsonInline value={row.raw} />}
      />

      <AdminTableCard
        title={t("infra.reconcile")}
        loading={loading}
        columns={reconcileColumns}
        dataSource={reconcileTable.pageItems}
        rowKey="runAt"
        emptyText={t("common.noData")}
        page={reconcileTable.query.page}
        pageSize={reconcileTable.query.pageSize}
        total={reconcileTable.total}
        totalPages={reconcileTable.totalPages}
        onPageChange={reconcileTable.setPage}
        onPageSizeChange={reconcileTable.setPageSize}
        renderExpandedRow={(row: ReconcileRow) => <JsonInline value={row.raw} />}
      />
    </Space>
  );
}

