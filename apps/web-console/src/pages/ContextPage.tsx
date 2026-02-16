import { Banner, Button, Form, Input, Select, Space, Typography } from "@douyinfe/semi-ui";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { CrudSheet } from "../components/admin/CrudSheet";
import { RowActions } from "../components/admin/RowActions";
import { getGatewayClient, type ContextFile, type ContextLayer } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

const FILE_OPTIONS: ContextFile[] = ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md"];
const LAYER_OPTIONS: ContextLayer[] = ["tenant", "workspace", "user"];

type ContextRow = {
  key: string;
  layer: ContextLayer;
  file: ContextFile;
  userId: string;
  canWrite: boolean;
};

type ContextForm = {
  layer: ContextLayer;
  file: ContextFile;
  userId: string;
  text: string;
};

export function ContextPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);
  const defaultUserId = useScopeStore((state) => state.userId);

  const [loading, setLoading] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [layerFilter, setLayerFilter] = useState<"all" | ContextLayer>("all");
  const [fileFilter, setFileFilter] = useState<"all" | ContextFile>("all");
  const [selectedUserId, setSelectedUserId] = useState(defaultUserId);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<ContextForm | null>(null);

  const canWrite = useCallback(
    (layer: ContextLayer, userId: string) => {
      if (layer === "tenant") {
        return permissions.canWriteInfra;
      }
      if (layer === "workspace") {
        return permissions.canWriteGovernance;
      }
      if (userId.trim().length === 0 || userId.trim() === defaultUserId) {
        return true;
      }
      return permissions.canReadCrossUserContext;
    },
    [defaultUserId, permissions.canReadCrossUserContext, permissions.canWriteGovernance, permissions.canWriteInfra]
  );

  const rows = useMemo<ContextRow[]>(
    () =>
      LAYER_OPTIONS.flatMap((layer) =>
        FILE_OPTIONS.map((file) => {
          const userId = layer === "user" ? selectedUserId.trim() || defaultUserId : "";
          return {
            key: `${layer}:${file}:${userId || "-"}`,
            layer,
            file,
            userId,
            canWrite: canWrite(layer, userId)
          };
        })
      ),
    [canWrite, defaultUserId, selectedUserId]
  );

  const filteredRows = useMemo(
    () =>
      rows
        .filter((row) => (layerFilter === "all" ? true : row.layer === layerFilter))
        .filter((row) => (fileFilter === "all" ? true : row.file === fileFilter)),
    [fileFilter, layerFilter, rows]
  );

  const table = useClientTableState({
    items: filteredRows,
    initialPageSize: 12,
    searchableText: (row) => `${row.layer} ${row.file} ${row.userId}`
  });

  const loadContext = useCallback(
    async (row: ContextRow) => {
      setSheetLoading(true);
      setError(undefined);
      try {
        const result = await client.getContext({
          layer: row.layer,
          file: row.file,
          tenantId,
          workspaceId,
          ...(row.layer === "user" && row.userId.trim() ? { userId: row.userId.trim() } : {})
        });
        setEditing({
          layer: row.layer,
          file: row.file,
          userId: row.userId,
          text: result.text
        });
        setSheetVisible(true);
      } catch (loadError) {
        setError(toErrorMessage(loadError));
      } finally {
        setSheetLoading(false);
      }
    },
    [client, tenantId, workspaceId]
  );

  const saveContext = useCallback(
    async (values: ContextForm) => {
      if (!canWrite(values.layer, values.userId)) {
        return;
      }
      setSheetLoading(true);
      setError(undefined);
      try {
        await client.upsertContext({
          layer: values.layer,
          file: values.file,
          content: values.text,
          tenantId,
          workspaceId,
          ...(values.layer === "user" && values.userId.trim() ? { userId: values.userId.trim() } : {})
        });
        setSheetVisible(false);
      } catch (saveError) {
        setError(toErrorMessage(saveError));
      } finally {
        setSheetLoading(false);
      }
    },
    [canWrite, client, tenantId, workspaceId]
  );

  const columns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: t("context.layer"), dataIndex: "layer", width: 140 },
      { title: t("context.file"), dataIndex: "file", width: 160 },
      {
        title: t("common.userId"),
        dataIndex: "userId",
        width: 180,
        render: (value: string) => value || "-"
      },
      {
        title: t("common.enabled"),
        dataIndex: "canWrite",
        width: 120,
        render: (value: boolean) => (value ? "write" : "read-only")
      },
      {
        title: t("common.actions"),
        dataIndex: "actions",
        width: 160,
        render: (_: unknown, row: ContextRow) => (
          <RowActions
            actions={[
              {
                key: "edit",
                text: t("common.edit"),
                onClick: () => void loadContext(row)
              }
            ]}
          />
        )
      }
    ],
    [loadContext, t]
  );

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader title={t("context.title")} />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}

      <AdminTableCard
        title={t("context.title")}
        loading={loading || sheetLoading}
        columns={columns}
        dataSource={table.pageItems}
        rowKey="key"
        emptyText={t("common.noData")}
        page={table.query.page}
        pageSize={table.query.pageSize}
        total={table.total}
        totalPages={table.totalPages}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        toolbar={
          <Space wrap>
            <Input style={{ width: 220 }} placeholder={`${t("common.search")} layer/file/user`} value={table.query.search} onChange={(value) => table.setSearch(value)} />
            <Select
              style={{ width: 140 }}
              value={layerFilter}
              optionList={[{ label: "all", value: "all" }, ...LAYER_OPTIONS.map((item) => ({ label: item, value: item }))]}
              onChange={(value) => {
                setLayerFilter((value as "all" | ContextLayer) ?? "all");
                table.resetPage();
              }}
            />
            <Select
              style={{ width: 160 }}
              value={fileFilter}
              optionList={[{ label: "all", value: "all" }, ...FILE_OPTIONS.map((item) => ({ label: item, value: item }))]}
              onChange={(value) => {
                setFileFilter((value as "all" | ContextFile) ?? "all");
                table.resetPage();
              }}
            />
            <Input
              style={{ width: 180 }}
              placeholder={t("common.userId")}
              value={selectedUserId}
              onChange={(value) => {
                setSelectedUserId(value);
                table.resetPage();
              }}
            />
          </Space>
        }
      />

      <CrudSheet<ContextForm>
        visible={sheetVisible}
        title={t("context.title")}
        mode="edit"
        loading={sheetLoading}
        initValues={
          editing ?? {
            layer: "user",
            file: "AGENTS.md",
            userId: defaultUserId,
            text: ""
          }
        }
        onCancel={() => {
          setSheetVisible(false);
          setEditing(null);
        }}
        onSubmit={saveContext}
      >
        <Form.Select field="layer" label={t("context.layer")} optionList={LAYER_OPTIONS.map((item) => ({ label: item, value: item }))} />
        <Form.Select field="file" label={t("context.file")} optionList={FILE_OPTIONS.map((item) => ({ label: item, value: item }))} />
        <Form.Input field="userId" label={t("common.userId")} />
        <Form.TextArea field="text" label={t("context.content")} autosize={{ minRows: 16, maxRows: 30 }} />
      </CrudSheet>
    </Space>
  );
}

