import { Banner, Button, Card, Checkbox, Input, Space, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { getGatewayClient, type GatewayBudgetResult } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { parseNullableNumber, toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

export function BudgetPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);
  const scopeKey = useScopeStore((state) => state.scopeKey);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [budget, setBudget] = useState<GatewayBudgetResult | null>(null);
  const [queryDate, setQueryDate] = useState("");
  const [form, setForm] = useState({
    tokenDailyLimit: "",
    costMonthlyUsdLimit: "",
    hardLimit: true
  });

  const load = useCallback(
    async (date?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const next = await client.getBudget({ scopeKey, ...(date ? { date } : {}) });
        setBudget(next);
        setForm({
          tokenDailyLimit: next.policy.tokenDailyLimit === null ? "null" : String(next.policy.tokenDailyLimit),
          costMonthlyUsdLimit: next.policy.costMonthlyUsdLimit === null ? "null" : String(next.policy.costMonthlyUsdLimit),
          hardLimit: next.policy.hardLimit
        });
      } catch (loadError) {
        setError(toErrorMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [client, scopeKey]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!permissions.canWriteGovernance) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.updateBudget({
        tenantId,
        workspaceId,
        scopeKey,
        tokenDailyLimit: parseNullableNumber(form.tokenDailyLimit),
        costMonthlyUsdLimit: parseNullableNumber(form.costMonthlyUsdLimit),
        hardLimit: form.hardLimit
      });
      setBudget(next);
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setLoading(false);
    }
  }, [client, form.costMonthlyUsdLimit, form.hardLimit, form.tokenDailyLimit, permissions.canWriteGovernance, scopeKey, tenantId, workspaceId]);

  const usageRows = useMemo(() => (budget ? [budget.usage] : []), [budget]);
  const usageTable = useClientTableState({
    items: usageRows,
    initialPageSize: 10,
    searchableText: (item) => `${item.scopeKey} ${item.date} ${item.month}`
  });

  const columns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: "scopeKey", dataIndex: "scopeKey" },
      { title: "date", dataIndex: "date", width: 140 },
      { title: "month", dataIndex: "month", width: 140 },
      { title: "tokensUsedDaily", dataIndex: "tokensUsedDaily", width: 140 },
      { title: "costUsdMonthly", dataIndex: "costUsdMonthly", width: 140 },
      { title: "runsRejectedDaily", dataIndex: "runsRejectedDaily", width: 150 }
    ],
    []
  );

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("budget.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load(queryDate.trim() || undefined)}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}

      <Card title={t("budget.title")} style={{ width: "100%" }}>
        <Space wrap>
          <Input
            style={{ width: 200 }}
            placeholder={t("budget.tokenDailyLimit")}
            value={form.tokenDailyLimit}
            onChange={(value) => setForm((prev) => ({ ...prev, tokenDailyLimit: value }))}
          />
          <Input
            style={{ width: 220 }}
            placeholder={t("budget.costMonthlyUsdLimit")}
            value={form.costMonthlyUsdLimit}
            onChange={(value) => setForm((prev) => ({ ...prev, costMonthlyUsdLimit: value }))}
          />
          <Checkbox checked={form.hardLimit} onChange={(event: any) => setForm((prev) => ({ ...prev, hardLimit: event.target.checked }))}>
            {t("budget.hardLimit")}
          </Checkbox>
          <Button theme="solid" disabled={!permissions.canWriteGovernance} loading={loading} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </Space>
        {budget ? (
          <Typography.Text type="tertiary" size="small">
            version={budget.policy.version} · updatedAt={budget.policy.updatedAt}
          </Typography.Text>
        ) : null}
      </Card>

      <AdminTableCard
        title={t("budget.usage")}
        loading={loading}
        columns={columns}
        dataSource={usageTable.pageItems}
        rowKey={(row?: { scopeKey?: string; date?: string }) => `${row?.scopeKey ?? "scope"}:${row?.date ?? "date"}`}
        emptyText={t("common.noData")}
        page={usageTable.query.page}
        pageSize={usageTable.query.pageSize}
        total={usageTable.total}
        totalPages={usageTable.totalPages}
        onPageChange={usageTable.setPage}
        onPageSizeChange={usageTable.setPageSize}
        toolbar={
          <Space wrap>
            <Input
              style={{ width: 180 }}
              placeholder="YYYY-MM-DD"
              value={queryDate}
              onChange={(value) => setQueryDate(value)}
            />
            <Button theme="light" onClick={() => void load(queryDate.trim() || undefined)}>
              {t("common.apply")}
            </Button>
            <Button
              theme="light"
              onClick={() => {
                setQueryDate("");
                void load();
              }}
            >
              {t("common.clear")}
            </Button>
          </Space>
        }
      />
    </Space>
  );
}

