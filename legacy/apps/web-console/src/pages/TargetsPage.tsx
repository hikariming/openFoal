import { Banner, Button, Form, Input, Select, Space, Tag, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { CrudSheet } from "../components/admin/CrudSheet";
import { RowActions } from "../components/admin/RowActions";
import { getGatewayClient, type GatewayExecutionTarget } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { formatDate, toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

type TargetKind = "local-host" | "docker-runner";

type TargetForm = {
  targetId: string;
  kind: TargetKind;
  endpoint: string;
  authToken: string;
  isDefault: boolean;
  enabled: boolean;
  configJson: string;
};

export function TargetsPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);

  const [loading, setLoading] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<GatewayExecutionTarget[]>([]);
  const [kindFilter, setKindFilter] = useState<"all" | TargetKind>("all");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [defaultFilter, setDefaultFilter] = useState<"all" | "default" | "non-default">("all");
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<GatewayExecutionTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.listExecutionTargets({ tenantId, workspaceId });
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
      .filter((item) => (kindFilter === "all" ? true : item.kind === kindFilter))
      .filter((item) => (enabledFilter === "all" ? true : enabledFilter === "enabled" ? item.enabled : !item.enabled))
      .filter((item) => (defaultFilter === "all" ? true : defaultFilter === "default" ? item.isDefault : !item.isDefault));
  }, [defaultFilter, enabledFilter, items, kindFilter]);

  const table = useClientTableState<GatewayExecutionTarget, "updatedAt" | "targetId">({
    items: filtered,
    initialPageSize: 20,
    initialSortKey: "updatedAt",
    initialSortOrder: "desc",
    searchableText: (item) => `${item.targetId} ${item.kind} ${item.endpoint ?? ""}`,
    comparators: {
      updatedAt: (left, right) => left.updatedAt.localeCompare(right.updatedAt),
      targetId: (left, right) => left.targetId.localeCompare(right.targetId)
    }
  });

  const saveTarget = useCallback(
    async (values: TargetForm) => {
      if (!permissions.canWriteGovernance) {
        return;
      }
      const targetId = values.targetId.trim();
      if (!targetId) {
        setError("targetId required");
        return;
      }
      setSheetLoading(true);
      setError(undefined);
      try {
        await client.upsertExecutionTarget({
          tenantId,
          workspaceId,
          targetId,
          kind: values.kind,
          endpoint: values.endpoint.trim() || undefined,
          authToken: values.authToken.trim() || undefined,
          isDefault: values.isDefault,
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

  const quickUpdate = useCallback(
    async (target: GatewayExecutionTarget, patch: { isDefault?: boolean; enabled?: boolean }) => {
      if (!permissions.canWriteGovernance) {
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        await client.upsertExecutionTarget({
          tenantId,
          workspaceId,
          targetId: target.targetId,
          kind: target.kind,
          endpoint: target.endpoint,
          authToken: target.authToken,
          isDefault: patch.isDefault ?? target.isDefault,
          enabled: patch.enabled ?? target.enabled,
          config: target.config
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
      { title: t("targets.targetId"), dataIndex: "targetId", width: 190 },
      { title: t("targets.kind"), dataIndex: "kind", width: 140 },
      {
        title: t("targets.endpoint"),
        dataIndex: "endpoint",
        render: (value: string | undefined) => value ?? "-"
      },
      {
        title: t("targets.isDefault"),
        dataIndex: "isDefault",
        width: 110,
        render: (value: boolean) => <Tag color={value ? "green" : "grey"}>{String(value)}</Tag>
      },
      {
        title: t("common.enabled"),
        dataIndex: "enabled",
        width: 110,
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
        width: 270,
        render: (_: unknown, row: GatewayExecutionTarget) => (
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
                key: "default",
                text: row.isDefault ? "Unset Default" : "Set Default",
                onClick: () => void quickUpdate(row, { isDefault: !row.isDefault }),
                disabled: !permissions.canWriteGovernance
              },
              {
                key: "enabled",
                text: row.enabled ? t("common.disabled") : t("common.enabled"),
                onClick: () => void quickUpdate(row, { enabled: !row.enabled }),
                disabled: !permissions.canWriteGovernance
              }
            ]}
          />
        )
      }
    ],
    [permissions.canWriteGovernance, quickUpdate, t]
  );

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("targets.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}
      <AdminTableCard
        title={t("targets.title")}
        loading={loading}
        columns={columns}
        dataSource={table.pageItems}
        rowKey="targetId"
        emptyText={t("common.noData")}
        page={table.query.page}
        pageSize={table.query.pageSize}
        total={table.total}
        totalPages={table.totalPages}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        toolbar={
          <Space wrap>
            <Input style={{ width: 220 }} placeholder={`${t("common.search")} targetId/endpoint`} value={table.query.search} onChange={(value) => table.setSearch(value)} />
            <Select
              style={{ width: 150 }}
              value={kindFilter}
              optionList={[
                { label: "all", value: "all" },
                { label: "local-host", value: "local-host" },
                { label: "docker-runner", value: "docker-runner" }
              ]}
              onChange={(value) => {
                setKindFilter((value as "all" | TargetKind) ?? "all");
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
            <Select
              style={{ width: 170 }}
              value={defaultFilter}
              optionList={[
                { label: "all", value: "all" },
                { label: "default", value: "default" },
                { label: "non-default", value: "non-default" }
              ]}
              onChange={(value) => {
                setDefaultFilter((value as "all" | "default" | "non-default") ?? "all");
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

      <CrudSheet<TargetForm>
        visible={sheetVisible}
        title={editing ? t("common.edit") : t("common.create")}
        mode={editing ? "edit" : "create"}
        loading={sheetLoading}
        initValues={{
          targetId: editing?.targetId ?? "",
          kind: editing?.kind ?? "docker-runner",
          endpoint: editing?.endpoint ?? "",
          authToken: editing?.authToken ?? "",
          isDefault: editing?.isDefault ?? false,
          enabled: editing?.enabled ?? true,
          configJson: JSON.stringify(editing?.config ?? {}, null, 2)
        }}
        onCancel={() => {
          setSheetVisible(false);
          setEditing(null);
        }}
        onSubmit={saveTarget}
      >
        <Form.Input field="targetId" label={t("targets.targetId")} disabled={Boolean(editing)} />
        <Form.Select
          field="kind"
          label={t("targets.kind")}
          optionList={[
            { label: "docker-runner", value: "docker-runner" },
            { label: "local-host", value: "local-host" }
          ]}
        />
        <Form.Input field="endpoint" label={t("targets.endpoint")} />
        <Form.Input field="authToken" label={t("targets.authToken")} />
        <Form.Switch field="isDefault" label={t("targets.isDefault")} />
        <Form.Switch field="enabled" label={t("common.enabled")} />
        <Form.TextArea field="configJson" label="config JSON" autosize={{ minRows: 6, maxRows: 16 }} />
      </CrudSheet>
    </Space>
  );
}

