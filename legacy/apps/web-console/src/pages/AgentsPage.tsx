import { Banner, Button, Form, Input, Select, Space, Tag, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { CrudSheet } from "../components/admin/CrudSheet";
import { RowActions } from "../components/admin/RowActions";
import { getGatewayClient, type GatewayAgent, type RuntimeMode } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { formatDate, toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

type AgentForm = {
  agentId: string;
  name: string;
  runtimeMode: RuntimeMode;
  executionTargetId: string;
  policyScopeKey: string;
  enabled: boolean;
  configJson: string;
};

export function AgentsPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);

  const [loading, setLoading] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<GatewayAgent[]>([]);
  const [runtimeFilter, setRuntimeFilter] = useState<"all" | RuntimeMode>("all");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<GatewayAgent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.listAgents({ tenantId, workspaceId });
      setItems(next);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, tenantId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return items
      .filter((item) => (runtimeFilter === "all" ? true : item.runtimeMode === runtimeFilter))
      .filter((item) => (enabledFilter === "all" ? true : enabledFilter === "enabled" ? item.enabled : !item.enabled));
  }, [enabledFilter, items, runtimeFilter]);

  const table = useClientTableState<GatewayAgent, "updatedAt" | "agentId">({
    items: filtered,
    initialPageSize: 20,
    initialSortKey: "updatedAt",
    initialSortOrder: "desc",
    searchableText: (item) => `${item.agentId} ${item.name} ${item.executionTargetId ?? ""} ${item.policyScopeKey ?? ""}`,
    comparators: {
      updatedAt: (left, right) => left.updatedAt.localeCompare(right.updatedAt),
      agentId: (left, right) => left.agentId.localeCompare(right.agentId)
    }
  });

  const saveAgent = useCallback(
    async (values: AgentForm) => {
      if (!permissions.canWriteGovernance) {
        return;
      }
      const agentId = values.agentId.trim();
      if (!agentId) {
        setError("agentId required");
        return;
      }
      setSheetLoading(true);
      setError(undefined);
      try {
        await client.upsertAgent({
          tenantId,
          workspaceId,
          agentId,
          name: values.name.trim() || undefined,
          runtimeMode: values.runtimeMode,
          executionTargetId: values.executionTargetId.trim() || undefined,
          policyScopeKey: values.policyScopeKey.trim() || undefined,
          enabled: values.enabled,
          config: JSON.parse(values.configJson)
        });
        setSheetVisible(false);
        setEditing(null);
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setSheetLoading(false);
      }
    },
    [client, load, permissions.canWriteGovernance, tenantId, workspaceId]
  );

  const toggleEnabled = useCallback(
    async (item: GatewayAgent) => {
      if (!permissions.canWriteGovernance) {
        return;
      }
      const nextEnabled = !item.enabled;
      setLoading(true);
      setError(undefined);
      try {
        await client.upsertAgent({
          tenantId,
          workspaceId,
          agentId: item.agentId,
          name: item.name,
          runtimeMode: item.runtimeMode,
          executionTargetId: item.executionTargetId,
          policyScopeKey: item.policyScopeKey,
          enabled: nextEnabled,
          config: item.config
        });
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setLoading(false);
      }
    },
    [client, load, permissions.canWriteGovernance, tenantId, workspaceId]
  );

  const columns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: t("agents.agentId"), dataIndex: "agentId", width: 180 },
      { title: t("agents.name"), dataIndex: "name", width: 180 },
      {
        title: t("common.runtimeMode"),
        dataIndex: "runtimeMode",
        width: 120,
        render: (value: RuntimeMode) => <Tag>{value}</Tag>
      },
      {
        title: t("agents.executionTargetId"),
        dataIndex: "executionTargetId",
        render: (value: string | undefined) => value ?? "-"
      },
      {
        title: t("agents.policyScopeKey"),
        dataIndex: "policyScopeKey",
        render: (value: string | undefined) => value ?? "default"
      },
      {
        title: t("common.enabled"),
        dataIndex: "enabled",
        width: 120,
        render: (value: boolean) => <Tag color={value ? "green" : "grey"}>{value ? "enabled" : "disabled"}</Tag>
      },
      {
        title: "version",
        dataIndex: "version",
        width: 90
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
      },
      {
        title: t("common.actions"),
        dataIndex: "actions",
        width: 220,
        render: (_: unknown, row: GatewayAgent) => (
          <RowActions
            actions={[
              {
                key: "edit",
                text: t("common.edit"),
                onClick: () => {
                  setEditing(row);
                  setSheetVisible(true);
                },
                disabled: !permissions.canWriteGovernance
              },
              {
                key: "toggle",
                text: row.enabled ? t("common.disabled") : t("common.enabled"),
                onClick: () => void toggleEnabled(row),
                disabled: !permissions.canWriteGovernance
              }
            ]}
          />
        )
      }
    ],
    [permissions.canWriteGovernance, t, toggleEnabled]
  );

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("agents.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}
      <AdminTableCard
        title={t("agents.title")}
        loading={loading}
        columns={columns}
        dataSource={table.pageItems}
        rowKey="agentId"
        emptyText={t("common.noData")}
        page={table.query.page}
        pageSize={table.query.pageSize}
        total={table.total}
        totalPages={table.totalPages}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        toolbar={
          <Space wrap>
            <Input style={{ width: 220 }} placeholder={`${t("common.search")} agentId/name`} value={table.query.search} onChange={(value) => table.setSearch(value)} />
            <Select
              style={{ width: 140 }}
              value={runtimeFilter}
              optionList={[
                { label: "all", value: "all" },
                { label: "local", value: "local" },
                { label: "cloud", value: "cloud" }
              ]}
              onChange={(value) => {
                setRuntimeFilter((value as "all" | RuntimeMode) ?? "all");
                table.resetPage();
              }}
            />
            <Select
              style={{ width: 140 }}
              value={enabledFilter}
              optionList={[
                { label: "all", value: "all" },
                { label: "enabled", value: "enabled" },
                { label: "disabled", value: "disabled" }
              ]}
              onChange={(value) => {
                setEnabledFilter((value as "all" | "enabled" | "disabled") ?? "all");
                table.resetPage();
              }}
            />
            <Button
              theme="solid"
              disabled={!permissions.canWriteGovernance}
              onClick={() => {
                setEditing(null);
                setSheetVisible(true);
              }}
            >
              {t("common.createNew")}
            </Button>
          </Space>
        }
      />

      <CrudSheet<AgentForm>
        visible={sheetVisible}
        title={editing ? t("common.edit") : t("common.create")}
        mode={editing ? "edit" : "create"}
        loading={sheetLoading}
        initValues={{
          agentId: editing?.agentId ?? "",
          name: editing?.name ?? "",
          runtimeMode: editing?.runtimeMode ?? "local",
          executionTargetId: editing?.executionTargetId ?? "",
          policyScopeKey: editing?.policyScopeKey ?? "default",
          enabled: editing?.enabled ?? true,
          configJson: JSON.stringify(editing?.config ?? {}, null, 2)
        }}
        onCancel={() => {
          setSheetVisible(false);
          setEditing(null);
        }}
        onSubmit={saveAgent}
      >
        <Form.Input field="agentId" label={t("agents.agentId")} disabled={Boolean(editing)} />
        <Form.Input field="name" label={t("agents.name")} />
        <Form.Select
          field="runtimeMode"
          label={t("common.runtimeMode")}
          optionList={[
            { label: "local", value: "local" },
            { label: "cloud", value: "cloud" }
          ]}
        />
        <Form.Input field="executionTargetId" label={t("agents.executionTargetId")} />
        <Form.Input field="policyScopeKey" label={t("agents.policyScopeKey")} />
        <Form.Switch field="enabled" label={t("common.enabled")} />
        <Form.TextArea field="configJson" label="config JSON" autosize={{ minRows: 6, maxRows: 16 }} />
      </CrudSheet>
    </Space>
  );
}

