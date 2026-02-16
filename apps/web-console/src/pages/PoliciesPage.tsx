import { Banner, Button, Card, Form, Input, Select, Space, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { JsonView } from "../components/JsonView";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { CrudSheet } from "../components/admin/CrudSheet";
import { RowActions } from "../components/admin/RowActions";
import { getGatewayClient, type GatewayPolicy, type PolicyDecision } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

type ToolOverrideRow = {
  toolName: string;
  decision: PolicyDecision;
};

type ToolOverrideForm = {
  toolName: string;
  decision: PolicyDecision;
};

export function PoliciesPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);
  const scopeKey = useScopeStore((state) => state.scopeKey);

  const [loading, setLoading] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [policy, setPolicy] = useState<GatewayPolicy | null>(null);
  const [toolDefault, setToolDefault] = useState<PolicyDecision>("allow");
  const [highRisk, setHighRisk] = useState<PolicyDecision>("deny");
  const [bashMode, setBashMode] = useState<"sandbox" | "host">("sandbox");
  const [tools, setTools] = useState<ToolOverrideRow[]>([]);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<ToolOverrideRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.getPolicy({ tenantId, workspaceId, scopeKey });
      setPolicy(next);
      setToolDefault(next.toolDefault);
      setHighRisk(next.highRisk);
      setBashMode(next.bashMode);
      setTools(
        Object.entries(next.tools).map(([toolName, decision]) => ({
          toolName,
          decision
        }))
      );
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, scopeKey, tenantId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const table = useClientTableState<ToolOverrideRow, "toolName">({
    items: tools,
    initialPageSize: 10,
    initialSortKey: "toolName",
    searchableText: (item) => `${item.toolName} ${item.decision}`,
    comparators: {
      toolName: (left, right) => left.toolName.localeCompare(right.toolName)
    }
  });

  const upsertTool = useCallback(
    (values: ToolOverrideForm) => {
      const toolName = values.toolName.trim();
      if (!toolName) {
        setError("toolName required");
        return;
      }
      setTools((prev) => {
        const next = prev.filter((item) => item.toolName !== (editing?.toolName ?? ""));
        return [...next, { toolName, decision: values.decision }];
      });
      setEditing(null);
      setSheetVisible(false);
    },
    [editing?.toolName]
  );

  const save = useCallback(async () => {
    if (!permissions.canWritePolicy) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const toolMap = tools.reduce<Record<string, PolicyDecision>>((acc, item) => {
        acc[item.toolName] = item.decision;
        return acc;
      }, {});
      const next = await client.updatePolicy({
        tenantId,
        workspaceId,
        scopeKey,
        patch: {
          toolDefault,
          highRisk,
          bashMode,
          tools: toolMap
        }
      });
      setPolicy(next);
      setTools(
        Object.entries(next.tools).map(([toolName, decision]) => ({
          toolName,
          decision
        }))
      );
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setLoading(false);
    }
  }, [bashMode, client, highRisk, permissions.canWritePolicy, scopeKey, tenantId, toolDefault, tools, workspaceId]);

  const columns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: "toolName", dataIndex: "toolName" },
      { title: "decision", dataIndex: "decision", width: 120 },
      {
        title: t("common.actions"),
        dataIndex: "actions",
        width: 180,
        render: (_: unknown, row: ToolOverrideRow) => (
          <RowActions
            actions={[
              {
                key: "edit",
                text: t("common.edit"),
                onClick: () => {
                  setEditing(row);
                  setSheetVisible(true);
                },
                disabled: !permissions.canWritePolicy
              },
              {
                key: "remove",
                text: "Remove",
                onClick: () => setTools((prev) => prev.filter((item) => item.toolName !== row.toolName)),
                disabled: !permissions.canWritePolicy,
                danger: true
              }
            ]}
          />
        )
      }
    ],
    [permissions.canWritePolicy, t]
  );

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("policies.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}

      <Card title={t("policies.title")} style={{ width: "100%" }}>
        <Space wrap>
          <Select
            style={{ width: 190 }}
            value={toolDefault}
            optionList={[
              { label: "allow", value: "allow" },
              { label: "deny", value: "deny" }
            ]}
            onChange={(value) => setToolDefault((value as PolicyDecision) ?? "allow")}
          />
          <Select
            style={{ width: 190 }}
            value={highRisk}
            optionList={[
              { label: "deny", value: "deny" },
              { label: "allow", value: "allow" }
            ]}
            onChange={(value) => setHighRisk((value as PolicyDecision) ?? "deny")}
          />
          <Select
            style={{ width: 190 }}
            value={bashMode}
            optionList={[
              { label: "sandbox", value: "sandbox" },
              { label: "host", value: "host" }
            ]}
            onChange={(value) => setBashMode((value as "sandbox" | "host") ?? "sandbox")}
          />
          <Button theme="solid" disabled={!permissions.canWritePolicy} loading={loading} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </Space>
      </Card>

      <AdminTableCard
        title={t("policies.toolsOverride")}
        loading={loading}
        columns={columns}
        dataSource={table.pageItems}
        rowKey="toolName"
        emptyText={t("common.noData")}
        page={table.query.page}
        pageSize={table.query.pageSize}
        total={table.total}
        totalPages={table.totalPages}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        toolbar={
          <Space wrap>
            <Input style={{ width: 260 }} value={table.query.search} onChange={(value) => table.setSearch(value)} placeholder={`${t("common.search")} toolName`} />
            <Button
              theme="solid"
              disabled={!permissions.canWritePolicy}
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

      <Card title="JSON Preview" style={{ width: "100%" }}>
        <JsonView
          value={{
            policy,
            draft: {
              toolDefault,
              highRisk,
              bashMode,
              tools
            }
          }}
        />
      </Card>

      <CrudSheet<ToolOverrideForm>
        visible={sheetVisible}
        title={editing ? t("common.edit") : t("common.create")}
        mode={editing ? "edit" : "create"}
        loading={sheetLoading}
        initValues={{
          toolName: editing?.toolName ?? "",
          decision: editing?.decision ?? "deny"
        }}
        onCancel={() => {
          setSheetVisible(false);
          setEditing(null);
        }}
        onSubmit={upsertTool}
      >
        <Form.Input field="toolName" label="toolName" disabled={Boolean(editing)} />
        <Form.Select
          field="decision"
          label="decision"
          optionList={[
            { label: "allow", value: "allow" },
            { label: "deny", value: "deny" }
          ]}
        />
      </CrudSheet>
    </Space>
  );
}
