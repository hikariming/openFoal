import { Banner, Button, Card, Checkbox, Input, Select, Space, TextArea, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import {
  getGatewayClient,
  type GatewaySkillBundle,
  type GatewaySkillBundleSummary,
  type GatewaySkillSyncConfigPatch,
  type GatewaySkillSyncConfigResponse,
  type GatewaySkillSyncStatusResponse,
  type SkillSyncScope
} from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { toErrorMessage } from "./shared";

type SyncDraft = {
  autoSyncEnabled: boolean;
  syncTime: string;
  timezone: string;
  syncMode: "online" | "bundle_only";
  sourceFiltersText: string;
  licenseFiltersText: string;
  tagFiltersText: string;
  manualOnly: boolean;
};

export function SkillSyncPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);
  const userId = useScopeStore((state) => state.userId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");

  const [tenantConfig, setTenantConfig] = useState<GatewaySkillSyncConfigResponse | undefined>(undefined);
  const [workspaceConfig, setWorkspaceConfig] = useState<GatewaySkillSyncConfigResponse | undefined>(undefined);
  const [userConfig, setUserConfig] = useState<GatewaySkillSyncConfigResponse | undefined>(undefined);

  const [tenantStatus, setTenantStatus] = useState<GatewaySkillSyncStatusResponse | undefined>(undefined);
  const [workspaceStatus, setWorkspaceStatus] = useState<GatewaySkillSyncStatusResponse | undefined>(undefined);
  const [userStatus, setUserStatus] = useState<GatewaySkillSyncStatusResponse | undefined>(undefined);

  const [tenantDraft, setTenantDraft] = useState<SyncDraft>(() => buildDraft());
  const [workspaceDraft, setWorkspaceDraft] = useState<SyncDraft>(() => buildDraft());
  const [userDraft, setUserDraft] = useState<SyncDraft>(() => buildDraft());

  const [bundles, setBundles] = useState<GatewaySkillBundleSummary[]>([]);
  const [bundleExportName, setBundleExportName] = useState("bundle-enterprise");
  const [bundleText, setBundleText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const [tenantCfg, workspaceCfg, userCfg, tenantStat, workspaceStat, userStat, bundleItems] = await Promise.all([
        permissions.canReadSkillSync
          ? safeGetConfig(client, {
              scope: "tenant",
              tenantId,
              timezone
            })
          : Promise.resolve(undefined),
        permissions.canReadSkillSync
          ? safeGetConfig(client, {
              scope: "workspace",
              tenantId,
              workspaceId,
              timezone
            })
          : Promise.resolve(undefined),
        permissions.canReadSkillSync
          ? safeGetConfig(client, {
              scope: "user",
              tenantId,
              workspaceId,
              userId,
              timezone
            })
          : Promise.resolve(undefined),
        permissions.canReadSkillSync
          ? safeGetStatus(client, {
              scope: "tenant",
              tenantId,
              timezone
            })
          : Promise.resolve(undefined),
        permissions.canReadSkillSync
          ? safeGetStatus(client, {
              scope: "workspace",
              tenantId,
              workspaceId,
              timezone
            })
          : Promise.resolve(undefined),
        permissions.canReadSkillSync
          ? safeGetStatus(client, {
              scope: "user",
              tenantId,
              workspaceId,
              userId,
              timezone
            })
          : Promise.resolve(undefined),
        permissions.canManageSkillBundles ? client.listSkillBundles() : Promise.resolve([])
      ]);

      setTenantConfig(tenantCfg);
      setWorkspaceConfig(workspaceCfg);
      setUserConfig(userCfg);
      setTenantStatus(tenantStat);
      setWorkspaceStatus(workspaceStat);
      setUserStatus(userStat);
      setBundles(bundleItems);
      setTenantDraft(buildDraft(tenantCfg));
      setWorkspaceDraft(buildDraft(workspaceCfg));
      setUserDraft(buildDraft(userCfg));
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, permissions.canManageSkillBundles, permissions.canReadSkillSync, tenantId, userId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveScope = useCallback(
    async (scope: SkillSyncScope, draft: SyncDraft) => {
      setLoading(true);
      setError(undefined);
      setNotice("");
      try {
        const timezone = draft.timezone.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const saved = await client.upsertSkillSyncConfig({
          scope,
          tenantId,
          workspaceId,
          userId,
          timezone,
          config: toPatch(draft)
        });
        setNotice(`${scope} ${t("skillSync.saved")}`);
        if (scope === "tenant") {
          setTenantConfig(saved);
        } else if (scope === "workspace") {
          setWorkspaceConfig(saved);
        } else {
          setUserConfig(saved);
        }
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setLoading(false);
      }
    },
    [client, load, t, tenantId, userId, workspaceId]
  );

  const runScopeNow = useCallback(
    async (scope: SkillSyncScope) => {
      setLoading(true);
      setError(undefined);
      setNotice("");
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = await client.runSkillSyncNow({
          scope,
          tenantId,
          workspaceId,
          userId,
          timezone
        });
        setNotice(`${scope} ${t("skillSync.lastOutcome")}: ${result.run.status}`);
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setLoading(false);
      }
    },
    [client, load, t, tenantId, userId, workspaceId]
  );

  const exportBundle = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setNotice("");
    try {
      const bundle = await client.exportSkillBundle({
        name: bundleExportName.trim() || undefined
      });
      setBundleText(JSON.stringify(bundle, null, 2));
      setNotice(t("skillSync.bundleExported"));
      await load();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setLoading(false);
    }
  }, [bundleExportName, client, load, t]);

  const importBundle = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setNotice("");
    try {
      const parsed = JSON.parse(bundleText) as GatewaySkillBundle;
      await client.importSkillBundle({ bundle: parsed });
      setNotice(t("skillSync.bundleImported"));
      await load();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setLoading(false);
    }
  }, [bundleText, client, load, t]);

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("skillSync.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}
      {notice ? <Banner type="success" closeIcon={null} description={notice} /> : null}

      <SkillSyncScopeCard
        title={t("skillSync.tenant")}
        enabled={permissions.canWriteTenantSkillSync}
        draft={tenantDraft}
        status={tenantStatus?.status}
        effective={tenantConfig?.effectiveConfig}
        onDraftChange={setTenantDraft}
        onSave={() => void saveScope("tenant", tenantDraft)}
        onRunNow={() => void runScopeNow("tenant")}
        t={t}
        loading={loading}
      />

      <SkillSyncScopeCard
        title={t("skillSync.workspace")}
        enabled={permissions.canWriteWorkspaceSkillSync}
        draft={workspaceDraft}
        status={workspaceStatus?.status}
        effective={workspaceConfig?.effectiveConfig}
        onDraftChange={setWorkspaceDraft}
        onSave={() => void saveScope("workspace", workspaceDraft)}
        onRunNow={() => void runScopeNow("workspace")}
        t={t}
        loading={loading}
      />

      <SkillSyncScopeCard
        title={t("skillSync.user")}
        enabled={permissions.canWriteUserSkillSync}
        draft={userDraft}
        status={userStatus?.status}
        effective={userConfig?.effectiveConfig}
        onDraftChange={setUserDraft}
        onSave={() => void saveScope("user", userDraft)}
        onRunNow={() => void runScopeNow("user")}
        t={t}
        loading={loading}
      />

      {permissions.canManageSkillBundles ? (
        <Card title={t("skillSync.bundle")} style={{ width: "100%" }}>
          <Space vertical align="start" style={{ width: "100%" }}>
            <Input
              style={{ width: 320 }}
              value={bundleExportName}
              onChange={(value) => setBundleExportName(value)}
              placeholder="bundle-enterprise"
            />
            <Space>
              <Button theme="solid" loading={loading} onClick={() => void exportBundle()}>
                {t("skillSync.export")}
              </Button>
              <Button theme="light" loading={loading} onClick={() => void importBundle()}>
                {t("skillSync.import")}
              </Button>
            </Space>
            <TextArea value={bundleText} rows={10} onChange={(value) => setBundleText(value)} placeholder="bundle json" />
            <Typography.Text type="tertiary">{t("skillSync.bundleHistory")}: {bundles.length}</Typography.Text>
            {bundles.map((item) => (
              <Typography.Text key={item.bundleId} type="tertiary">
                {item.bundleId} · {item.name} · {item.itemCount}
              </Typography.Text>
            ))}
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}

type SkillSyncScopeCardProps = {
  title: string;
  enabled: boolean;
  draft: SyncDraft;
  status?: GatewaySkillSyncStatusResponse["status"];
  effective?: GatewaySkillSyncConfigResponse["effectiveConfig"];
  onDraftChange: (next: SyncDraft) => void;
  onSave: () => void;
  onRunNow: () => void;
  t: (key: string) => string;
  loading: boolean;
};

function SkillSyncScopeCard(props: SkillSyncScopeCardProps): JSX.Element {
  return (
    <Card title={props.title} style={{ width: "100%" }}>
      <Space vertical align="start" style={{ width: "100%" }}>
        <Space>
          <Checkbox checked={props.draft.autoSyncEnabled} onChange={(event: any) => props.onDraftChange({ ...props.draft, autoSyncEnabled: Boolean(event?.target?.checked) })}>
            {props.t("skillSync.autoSync")}
          </Checkbox>
          <Checkbox checked={props.draft.manualOnly} onChange={(event: any) => props.onDraftChange({ ...props.draft, manualOnly: Boolean(event?.target?.checked) })}>
            {props.t("skillSync.manualOnly")}
          </Checkbox>
        </Space>
        <Space wrap>
          <Input style={{ width: 150 }} value={props.draft.syncTime} onChange={(value) => props.onDraftChange({ ...props.draft, syncTime: value })} placeholder="03:00" />
          <Input style={{ width: 220 }} value={props.draft.timezone} onChange={(value) => props.onDraftChange({ ...props.draft, timezone: value })} placeholder="Asia/Shanghai" />
          <Select
            style={{ width: 180 }}
            value={props.draft.syncMode}
            optionList={[
              { label: "online", value: "online" },
              { label: "bundle_only", value: "bundle_only" }
            ]}
            onChange={(value: unknown) => {
              if (value !== "online" && value !== "bundle_only") {
                return;
              }
              props.onDraftChange({ ...props.draft, syncMode: value });
            }}
          />
        </Space>
        <Input value={props.draft.sourceFiltersText} onChange={(value) => props.onDraftChange({ ...props.draft, sourceFiltersText: value })} placeholder="source1,source2" />
        <Input value={props.draft.licenseFiltersText} onChange={(value) => props.onDraftChange({ ...props.draft, licenseFiltersText: value })} placeholder="allow,review" />
        <Input value={props.draft.tagFiltersText} onChange={(value) => props.onDraftChange({ ...props.draft, tagFiltersText: value })} placeholder="tag1,tag2" />
        <Space>
          <Button theme="solid" disabled={!props.enabled} loading={props.loading} onClick={props.onSave}>
            {props.t("common.save")}
          </Button>
          <Button theme="light" loading={props.loading} onClick={props.onRunNow}>
            {props.t("skillSync.runNow")}
          </Button>
        </Space>
        <Typography.Text type="tertiary">{props.t("skillSync.lastRun")}: {props.status?.lastRunAt ?? "-"}</Typography.Text>
        <Typography.Text type="tertiary">{props.t("skillSync.nextRun")}: {props.status?.nextRunAt ?? "-"}</Typography.Text>
        <Typography.Text type="tertiary">{props.t("skillSync.lastError")}: {props.status?.lastError ?? "-"}</Typography.Text>
        <Typography.Text type="tertiary">{props.t("skillSync.effective")}: {formatEffective(props.effective)}</Typography.Text>
      </Space>
    </Card>
  );
}

async function safeGetConfig(
  client: ReturnType<typeof getGatewayClient>,
  input: { scope: SkillSyncScope; tenantId: string; workspaceId?: string; userId?: string; timezone?: string }
): Promise<GatewaySkillSyncConfigResponse | undefined> {
  try {
    return await client.getSkillSyncConfig(input);
  } catch {
    return undefined;
  }
}

async function safeGetStatus(
  client: ReturnType<typeof getGatewayClient>,
  input: { scope: SkillSyncScope; tenantId: string; workspaceId?: string; userId?: string; timezone?: string }
): Promise<GatewaySkillSyncStatusResponse | undefined> {
  try {
    return await client.getSkillSyncStatus(input);
  } catch {
    return undefined;
  }
}

function buildDraft(config?: GatewaySkillSyncConfigResponse): SyncDraft {
  const effective = config?.effectiveConfig;
  return {
    autoSyncEnabled: effective?.autoSyncEnabled ?? true,
    syncTime: effective?.syncTime ?? "03:00",
    timezone: effective?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    syncMode: effective?.syncMode ?? "online",
    sourceFiltersText: (effective?.sourceFilters ?? []).join(", "),
    licenseFiltersText: (effective?.licenseFilters ?? ["allow", "review"]).join(","),
    tagFiltersText: (effective?.tagFilters ?? []).join(", "),
    manualOnly: effective?.manualOnly ?? false
  };
}

function toPatch(draft: SyncDraft): GatewaySkillSyncConfigPatch {
  return {
    autoSyncEnabled: draft.autoSyncEnabled,
    syncTime: normalizeTime(draft.syncTime),
    timezone: draft.timezone.trim() || "UTC",
    syncMode: draft.syncMode,
    sourceFilters: splitCsv(draft.sourceFiltersText),
    licenseFilters: normalizeLicenses(splitCsv(draft.licenseFiltersText)),
    tagFilters: splitCsv(draft.tagFiltersText),
    manualOnly: draft.manualOnly
  };
}

function normalizeTime(value: string): string {
  const trimmed = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed) ? trimmed : "03:00";
}

function splitCsv(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    seen.add(trimmed);
  }
  return [...seen.values()];
}

function normalizeLicenses(value: string[]): Array<"allow" | "review" | "deny"> {
  const out: Array<"allow" | "review" | "deny"> = [];
  for (const item of value) {
    const normalized = item.toLowerCase();
    if (normalized === "allow" || normalized === "review" || normalized === "deny") {
      out.push(normalized);
    }
  }
  return out.length > 0 ? out : ["allow", "review"];
}

function formatEffective(config?: GatewaySkillSyncConfigResponse["effectiveConfig"]): string {
  if (!config) {
    return "-";
  }
  return `${config.syncMode} @ ${config.syncTime} ${config.timezone} · source=${config.sourceFilters.length} · license=${config.licenseFilters.join(",")}`;
}
