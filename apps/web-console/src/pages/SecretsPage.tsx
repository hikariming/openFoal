import { Banner, Button, Form, Input, Select, Space, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { CrudSheet } from "../components/admin/CrudSheet";
import { RowActions } from "../components/admin/RowActions";
import { getGatewayClient, type GatewayModelKeyMeta } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { formatDate, toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

type PresetOption = {
  label: string;
  value: string;
};

type ProviderPreset = {
  provider: string;
  label: string;
  modelPresets: PresetOption[];
  baseUrls: PresetOption[];
};

const TENANT_SCOPE_OPTION_VALUE = "__tenant_scope__";

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: "kimi",
    label: "Kimi",
    modelPresets: [{ label: "k2p5", value: "k2p5" }],
    baseUrls: [{ label: "Kimi CN", value: "https://api.moonshot.cn/v1" }]
  },
  {
    provider: "openai",
    label: "OpenAI",
    modelPresets: [{ label: "gpt-4o-mini", value: "gpt-4o-mini" }],
    baseUrls: [{ label: "OpenAI", value: "https://api.openai.com/v1" }]
  },
  {
    provider: "anthropic",
    label: "Anthropic",
    modelPresets: [{ label: "claude-sonnet-4-5", value: "claude-sonnet-4-5" }],
    baseUrls: [{ label: "Anthropic", value: "https://api.anthropic.com" }]
  },
  {
    provider: "gemini",
    label: "Gemini",
    modelPresets: [{ label: "gemini-2.5-flash", value: "gemini-2.5-flash" }],
    baseUrls: [{ label: "Gemini(OpenAI Compatible)", value: "https://generativelanguage.googleapis.com/v1beta/openai" }]
  },
  {
    provider: "deepseek",
    label: "DeepSeek",
    modelPresets: [{ label: "deepseek-chat", value: "deepseek-chat" }],
    baseUrls: [{ label: "DeepSeek", value: "https://api.deepseek.com/v1" }]
  },
  {
    provider: "qwen",
    label: "Qwen",
    modelPresets: [{ label: "qwen-plus", value: "qwen-plus" }],
    baseUrls: [{ label: "DashScope", value: "https://dashscope.aliyuncs.com/compatible-mode/v1" }]
  },
  {
    provider: "doubao",
    label: "Doubao",
    modelPresets: [{ label: "doubao-seed-1-6", value: "doubao-seed-1-6" }],
    baseUrls: [{ label: "Volcengine Ark", value: "https://ark.cn-beijing.volces.com/api/v3" }]
  },
  {
    provider: "openrouter",
    label: "OpenRouter",
    modelPresets: [{ label: "openai/gpt-4o-mini", value: "openai/gpt-4o-mini" }],
    baseUrls: [{ label: "OpenRouter", value: "https://openrouter.ai/api/v1" }]
  },
  {
    provider: "ollama",
    label: "Ollama",
    modelPresets: [{ label: "qwen3:latest", value: "qwen3:latest" }],
    baseUrls: [{ label: "Local Ollama", value: "http://127.0.0.1:11434/v1" }]
  }
];

type SecretForm = {
  provider: string;
  workspaceId: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function SecretsPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const currentWorkspaceId = useScopeStore((state) => state.workspaceId);

  const [loading, setLoading] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<GatewayModelKeyMeta[]>([]);
  const [providerFilter, setProviderFilter] = useState("all");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<GatewayModelKeyMeta | null>(null);

  const load = useCallback(async () => {
    if (!permissions.canReadSecrets) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.getModelKeyMeta({ tenantId });
      setItems(next);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, permissions.canReadSecrets, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return items
      .filter((item) => (providerFilter === "all" ? true : item.provider === providerFilter))
      .filter((item) => (workspaceFilter.trim() ? (item.workspaceId ?? "tenant").includes(workspaceFilter.trim()) : true));
  }, [items, providerFilter, workspaceFilter]);

  const table = useClientTableState<GatewayModelKeyMeta, "updatedAt" | "provider">({
    items: filtered,
    initialPageSize: 20,
    initialSortKey: "updatedAt",
    initialSortOrder: "desc",
    searchableText: (item) => `${item.provider} ${item.modelId ?? ""} ${item.baseUrl ?? ""} ${item.workspaceId ?? ""}`,
    comparators: {
      provider: (left, right) => left.provider.localeCompare(right.provider),
      updatedAt: (left, right) => left.updatedAt.localeCompare(right.updatedAt)
    }
  });

  const workspaceQuickOptions = useMemo(() => {
    const workspaceIds = new Set<string>();
    const activeWorkspace = normalizeText(currentWorkspaceId);
    if (activeWorkspace) {
      workspaceIds.add(activeWorkspace);
    }
    for (const id of principal?.workspaceIds ?? []) {
      const value = normalizeText(id);
      if (value) {
        workspaceIds.add(value);
      }
    }
    return [
      { label: t("secrets.workspaceTenantOption"), value: TENANT_SCOPE_OPTION_VALUE },
      ...Array.from(workspaceIds)
        .sort((left, right) => left.localeCompare(right))
        .map((item) => ({ label: item, value: item }))
    ];
  }, [currentWorkspaceId, principal?.workspaceIds, t]);

  const baseUrlQuickOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const preset of PROVIDER_PRESETS) {
      for (const baseUrl of preset.baseUrls) {
        if (!map.has(baseUrl.value)) {
          map.set(baseUrl.value, `${preset.label} · ${baseUrl.label}`);
        }
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, []);

  const saveSecret = useCallback(
    async (values: SecretForm) => {
      if (!permissions.canWriteSecrets) {
        return;
      }
      const provider = normalizeText(values.provider).toLowerCase();
      const apiKey = normalizeText(values.apiKey);
      const workspaceId = normalizeText(values.workspaceId);
      const modelId = normalizeText(values.modelId);
      const baseUrl = normalizeText(values.baseUrl);
      if (!provider || !apiKey) {
        setError(t("secrets.providerApiKeyRequired"));
        return;
      }
      setSheetLoading(true);
      setError(undefined);
      try {
        const resolvedWorkspaceId = workspaceId || currentWorkspaceId || "w_default";
        await client.upsertModelKey({
          tenantId,
          provider,
          workspaceId: resolvedWorkspaceId,
          modelId: modelId || undefined,
          baseUrl: baseUrl || undefined,
          apiKey
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
    [client, currentWorkspaceId, load, permissions.canWriteSecrets, t, tenantId]
  );

  const columns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: t("secrets.provider"), dataIndex: "provider", width: 130 },
      {
        title: t("secrets.modelId"),
        dataIndex: "modelId",
        width: 180,
        render: (value: string | undefined) => value ?? "-"
      },
      {
        title: t("secrets.baseUrl"),
        dataIndex: "baseUrl",
        render: (value: string | undefined) => value ?? "-"
      },
      {
        title: t("common.workspaceId"),
        dataIndex: "workspaceId",
        width: 140,
        render: (value: string | undefined) => value ?? "tenant"
      },
      { title: t("secrets.masked"), dataIndex: "maskedKey", width: 180 },
      { title: "updatedBy", dataIndex: "updatedBy", width: 160 },
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
        render: (_: unknown, row: GatewayModelKeyMeta) => (
          <RowActions
            actions={[
              {
                key: "edit",
                text: t("common.edit"),
                onClick: () => {
                  setEditing(row);
                  setSheetVisible(true);
                },
                disabled: !permissions.canWriteSecrets
              },
              {
                key: "copy",
                text: "Copy Config",
                onClick: () => {
                  const text = JSON.stringify(
                    {
                      provider: row.provider,
                      modelId: row.modelId,
                      baseUrl: row.baseUrl
                    },
                    null,
                    2
                  );
                  void navigator.clipboard.writeText(text);
                }
              }
            ]}
          />
        )
      }
    ],
    [permissions.canWriteSecrets, t]
  );

  if (!permissions.canReadSecrets) {
    return <Banner type="warning" closeIcon={null} description={t("common.forbidden")} />;
  }

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("secrets.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}
      <AdminTableCard
        title={t("secrets.masked")}
        loading={loading}
        columns={columns}
        dataSource={table.pageItems}
        rowKey={(record?: GatewayModelKeyMeta) => `${record?.tenantId ?? "tenant"}:${record?.workspaceId ?? "tenant"}:${record?.provider ?? "provider"}`}
        emptyText={t("common.noData")}
        page={table.query.page}
        pageSize={table.query.pageSize}
        total={table.total}
        totalPages={table.totalPages}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        toolbar={
          <Space wrap>
            <Input
              style={{ width: 260 }}
              placeholder={t("secrets.searchPlaceholder")}
              value={table.query.search}
              onChange={(value) => table.setSearch(value)}
            />
            <Select
              style={{ width: 150 }}
              value={providerFilter}
              optionList={[{ label: "all", value: "all" }, ...PROVIDER_PRESETS.map((item) => ({ label: item.label, value: item.provider }))]}
              onChange={(value) => {
                setProviderFilter((value as string) || "all");
                table.resetPage();
              }}
            />
            <Input
              style={{ width: 180 }}
              placeholder={t("common.workspaceId")}
              value={workspaceFilter}
              onChange={(value) => {
                setWorkspaceFilter(value);
                table.resetPage();
              }}
            />
            <Button
              theme="solid"
              disabled={!permissions.canWriteSecrets}
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

      <CrudSheet<SecretForm>
        visible={sheetVisible}
        title={editing ? t("common.edit") : t("secrets.formTitle")}
        mode={editing ? "edit" : "create"}
        loading={sheetLoading}
        initValues={{
          provider: editing?.provider ?? "openai",
          workspaceId: editing?.workspaceId ?? "",
          modelId: editing?.modelId ?? "",
          baseUrl: editing?.baseUrl ?? "",
          apiKey: ""
        }}
        onCancel={() => {
          setSheetVisible(false);
          setEditing(null);
        }}
        onSubmit={saveSecret}
      >
        {(formApi) => (
          <>
            <Typography.Text type="tertiary">{t("secrets.formHint")}</Typography.Text>
            <Space wrap style={{ marginBottom: 8 }}>
              {PROVIDER_PRESETS.map((item) => (
                <Button
                  key={item.provider}
                  size="small"
                  theme="light"
                  onClick={() => {
                    formApi?.setValues?.({
                      provider: item.provider,
                      modelId: item.modelPresets[0]?.value ?? "",
                      baseUrl: item.baseUrls[0]?.value ?? ""
                    });
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Space>
            <Form.Input field="provider" label={t("secrets.provider")} />
            <Typography.Text type="tertiary" size="small">
              {t("secrets.workspaceHint")}
            </Typography.Text>
            <Select
              style={{ width: "100%" }}
              placeholder={t("secrets.workspaceQuickPick")}
              optionList={workspaceQuickOptions}
              onChange={(value) => {
                const normalized = (value as string) ?? "";
                formApi?.setValues?.({
                  workspaceId: normalized === TENANT_SCOPE_OPTION_VALUE ? "" : normalized
                });
              }}
            />
            <Form.Input field="workspaceId" label={t("common.workspaceId")} placeholder={t("secrets.workspaceInputPlaceholder")} />
            <Form.Input field="modelId" label={t("secrets.modelId")} />
            <Typography.Text type="tertiary" size="small">
              {t("secrets.baseUrlHint")}
            </Typography.Text>
            <Select
              style={{ width: "100%" }}
              placeholder={t("secrets.baseUrlQuickPick")}
              optionList={baseUrlQuickOptions}
              onChange={(value) => {
                formApi?.setValues?.({
                  baseUrl: ((value as string) ?? "").trim()
                });
              }}
            />
            <Form.Input field="baseUrl" label={t("secrets.baseUrl")} placeholder={t("secrets.baseUrlInputPlaceholder")} />
            <Form.Input field="apiKey" type="password" label={t("secrets.apiKey")} />
          </>
        )}
      </CrudSheet>
    </Space>
  );
}
