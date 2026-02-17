import { Avatar, Button, Checkbox, Input, Layout, Modal, Nav, Popover, Select, Space, Tabs, Tag, TextArea, Typography } from "@douyinfe/semi-ui";
import {
  IconBolt,
  IconChevronDown,
  IconChevronUp,
  IconCloudStroked,
  IconClose,
  IconCommentStroked,
  IconCreditCardStroked,
  IconDesktop,
  IconEditStroked,
  IconExit,
  IconGiftStroked,
  IconLink,
  IconMailStroked,
  IconPhoneStroked,
  IconPlusCircle,
  IconPuzzle,
  IconSettingStroked,
  IconSidebar,
  IconUserStroked
} from "@douyinfe/semi-icons";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getGatewayClient,
  type GatewayMemorySearchHit,
  type GatewayModelKeyMeta,
  type GatewaySandboxUsage,
  type GatewaySkillSyncConfigPatch,
  type GatewaySkillSyncConfigResponse,
  type GatewaySkillSyncStatusResponse,
  type GatewaySession,
  type GatewayTranscriptItem
} from "../lib/gateway-client";
import {
  createLlmProfile,
  getSessionRuntimeMode,
  useAppStore,
  type LlmConfig,
  type LlmProfile,
  type RuntimeMode
} from "../store/app-store";

type SideMenu = "new" | "skills" | "automations";
type SettingsMenu = "account" | "capyMail" | "runtimeModel" | "memory" | "skillSync" | "subscription" | "referral" | "experimental";
type RuntimeSettingsTab = "model" | "status";
type RuntimeResolvedLlm = {
  modelRef?: string;
  provider?: string;
  modelId?: string;
  baseUrl?: string;
};
type SkillSyncDraft = {
  autoSyncEnabled: boolean;
  syncTime: string;
  timezone: string;
  syncMode: "online" | "bundle_only";
  sourceFiltersText: string;
  licenseFiltersText: string;
  tagFiltersText: string;
  manualOnly: boolean;
};

type AppSidebarProps = {
  defaultRuntimeMode?: RuntimeMode;
  accountName?: string;
  accountEmail?: string;
  onSignOut?: () => void;
};

export function AppSidebar(props: AppSidebarProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const defaultRuntimeMode = props.defaultRuntimeMode ?? "local";
  const accountName = props.accountName?.trim() || "啵鸣喵";
  const accountEmail = props.accountEmail?.trim() || "OpenFoal@example.com";
  const [userMenuVisible, setUserMenuVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [activeSettingsMenu, setActiveSettingsMenu] = useState<SettingsMenu>("account");
  const [runtimePending, setRuntimePending] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [runtimeNotice, setRuntimeNotice] = useState("");
  const [runtimeStatusError, setRuntimeStatusError] = useState("");
  const [runtimeTab, setRuntimeTab] = useState<RuntimeSettingsTab>("model");
  const [gatewayReady, setGatewayReady] = useState(false);
  const [memoryTarget, setMemoryTarget] = useState<"global" | "daily">("global");
  const [memoryDate, setMemoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memoryLines, setMemoryLines] = useState("200");
  const [memoryText, setMemoryText] = useState("");
  const [memoryInfo, setMemoryInfo] = useState("");
  const [memoryAppendDraft, setMemoryAppendDraft] = useState("");
  const [memoryIncludeLongTerm, setMemoryIncludeLongTerm] = useState(false);
  const [memoryPending, setMemoryPending] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [memoryNotice, setMemoryNotice] = useState("");
  const [memorySearchQuery, setMemorySearchQuery] = useState("");
  const [memorySearchPending, setMemorySearchPending] = useState(false);
  const [memorySearchHits, setMemorySearchHits] = useState<GatewayMemorySearchHit[]>([]);
  const [memorySearchMeta, setMemorySearchMeta] = useState("");
  const [llmSavedNotice, setLlmSavedNotice] = useState("");
  const [runtimeResolvedLlm, setRuntimeResolvedLlm] = useState<RuntimeResolvedLlm | undefined>(undefined);
  const [sandboxUsage, setSandboxUsage] = useState<GatewaySandboxUsage | undefined>(undefined);
  const [skillSyncLoading, setSkillSyncLoading] = useState(false);
  const [skillSyncSaving, setSkillSyncSaving] = useState(false);
  const [skillSyncRunning, setSkillSyncRunning] = useState(false);
  const [skillSyncError, setSkillSyncError] = useState("");
  const [skillSyncNotice, setSkillSyncNotice] = useState("");
  const [skillSyncDraft, setSkillSyncDraft] = useState<SkillSyncDraft>(() => buildSkillSyncDraft());
  const [skillSyncCurrent, setSkillSyncCurrent] = useState<GatewaySkillSyncConfigResponse | undefined>(undefined);
  const [skillSyncStatus, setSkillSyncStatus] = useState<GatewaySkillSyncStatusResponse | undefined>(undefined);
  const { sessions, activeSessionId, setSessions, upsertSession, setActiveSession, setRuntimeMode, llmConfig, setLlmConfig } =
    useAppStore();
  const runtimeMode = useAppStore((state) => getSessionRuntimeMode(state.sessions, state.activeSessionId));
  const [llmDraft, setLlmDraft] = useState(llmConfig);
  const [editingLlmProfileId, setEditingLlmProfileId] = useState(llmConfig.activeProfileId);

  const activeMenu = useMemo<SideMenu>(() => {
    if (location.pathname === "/skills") {
      return "skills";
    }
    return "new";
  }, [location.pathname]);

  const settingsMenus: Array<{ key: SettingsMenu; label: string; icon: ReactNode }> = [
    { key: "account", label: t("sidebar.account"), icon: <IconUserStroked /> },
    { key: "capyMail", label: t("sidebar.capyMail"), icon: <IconMailStroked /> },
    { key: "runtimeModel", label: t("sidebar.runtimeModel"), icon: <IconCloudStroked /> },
    { key: "memory", label: t("sidebar.memory"), icon: <IconBolt /> },
    { key: "skillSync", label: t("sidebar.skillSync"), icon: <IconPuzzle /> },
    { key: "subscription", label: t("sidebar.subscription"), icon: <IconCreditCardStroked /> },
    { key: "referral", label: t("sidebar.referral"), icon: <IconLink /> },
    { key: "experimental", label: t("sidebar.experimental"), icon: <IconGiftStroked /> }
  ];
  const providerOptions = useMemo(() => buildProviderOptions(llmDraft.profiles), [llmDraft.profiles]);
  const baseUrlOptionsByProvider: Record<string, Array<{ label: string; value: string }>> = {
    kimi: [
      { label: "Kimi CN · api.moonshot.cn", value: "https://api.moonshot.cn/v1" },
      { label: "Kimi Global · api.moonshot.ai", value: "https://api.moonshot.ai/v1" }
    ],
    openai: [{ label: "OpenAI · api.openai.com", value: "https://api.openai.com/v1" }],
    anthropic: [{ label: "Anthropic · api.anthropic.com", value: "https://api.anthropic.com" }]
  };
  const activeLlmProfile =
    llmDraft.profiles.find((item) => item.id === llmDraft.activeProfileId) ?? llmDraft.profiles[0];
  const editingLlmProfile = llmDraft.profiles.find((item) => item.id === editingLlmProfileId) ?? activeLlmProfile;
  const baseUrlOptions = baseUrlOptionsByProvider[editingLlmProfile?.provider ?? ""] ?? [];
  const isLlmDirty = !sameLlmConfig(llmDraft, llmConfig);
  const activeSession = useMemo(() => sessions.find((item) => item.id === activeSessionId), [activeSessionId, sessions]);
  const sandboxUsageText = useMemo(
    () => (sandboxUsage?.available ? formatSandboxUsageLine(sandboxUsage, i18n.language) : ""),
    [i18n.language, sandboxUsage]
  );
  const showSandboxUsage = activeSession?.runtimeMode === "cloud" && sandboxUsage?.available === true;

  useEffect(() => {
    setLlmDraft(llmConfig);
    setEditingLlmProfileId(llmConfig.activeProfileId);
  }, [llmConfig, settingsModalVisible]);

  useEffect(() => {
    if (activeSettingsMenu !== "runtimeModel") {
      setRuntimeTab("model");
    }
  }, [activeSettingsMenu]);

  useEffect(() => {
    if (!settingsModalVisible || activeSettingsMenu !== "memory") {
      return;
    }
    void refreshMemory();
  }, [activeSettingsMenu, settingsModalVisible, memoryTarget, memoryDate]);

  useEffect(() => {
    if (!settingsModalVisible || activeSettingsMenu !== "skillSync") {
      return;
    }
    void refreshSkillSync();
  }, [activeSettingsMenu, settingsModalVisible]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = getGatewayClient();
        let listed = await client.listSessions();
        if (listed.length === 0) {
          const created = await client.createSession({
            runtimeMode: defaultRuntimeMode
          });
          listed = [created];
        }
        if (!cancelled) {
          setSessions(listed.map(mapGatewaySessionToStoreSession));
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultRuntimeMode, setSessions]);

  useEffect(() => {
    if (!settingsModalVisible || activeSettingsMenu !== "runtimeModel" || runtimeTab !== "status") {
      return;
    }
    let cancelled = false;
    setRuntimeStatusError("");
    void (async () => {
      try {
        const client = getGatewayClient();
        await client.ensureConnected();
        if (!cancelled) {
          setGatewayReady(true);
        }
        if (!activeSessionId) {
          return;
        }
        const refreshed = await client.getSession(activeSessionId);
        if (!cancelled && refreshed) {
          upsertSession(mapGatewaySessionToStoreSession(refreshed));
        }
      } catch (error) {
        if (!cancelled) {
          setGatewayReady(false);
          setRuntimeStatusError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, activeSettingsMenu, runtimeTab, settingsModalVisible, upsertSession]);

  useEffect(() => {
    if (!settingsModalVisible || activeSettingsMenu !== "runtimeModel") {
      return;
    }
    if (!activeSessionId) {
      setRuntimeResolvedLlm(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const client = getGatewayClient();
        await client.ensureConnected();
        const history = await client.getSessionHistory({
          sessionId: activeSessionId,
          limit: 120
        });
        if (!cancelled) {
          setRuntimeResolvedLlm(resolveRuntimeLlmFromTranscript(history));
        }
      } catch {
        if (!cancelled) {
          setRuntimeResolvedLlm(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, activeSettingsMenu, settingsModalVisible]);

  useEffect(() => {
    if (!settingsModalVisible || activeSettingsMenu !== "runtimeModel") {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const client = getGatewayClient();
        await client.ensureConnected();
        const issuedModelMeta = await client.getModelKeyMeta();
        if (!cancelled) {
          setLlmDraft((prev) => mergeIssuedProfilesIntoConfig(prev, issuedModelMeta));
        }
      } catch {
        // Ignore model meta sync failures to avoid blocking runtime settings usage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSettingsMenu, settingsModalVisible]);

  useEffect(() => {
    if (!activeSession || activeSession.runtimeMode !== "cloud") {
      setSandboxUsage(undefined);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refreshSandboxUsage = async () => {
      try {
        const client = getGatewayClient();
        await client.ensureConnected();
        const usage = await client.getSandboxUsage({
          sessionId: activeSession.id
        });
        if (!cancelled) {
          setSandboxUsage(usage);
        }
      } catch {
        if (!cancelled) {
          setSandboxUsage(undefined);
        }
      }
    };
    void refreshSandboxUsage();
    timer = setInterval(() => {
      void refreshSandboxUsage();
    }, 10_000);
    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [activeSession?.id, activeSession?.runtimeMode]);

  const runtimeIssuedModelLabel = formatRuntimeResolvedLlm(runtimeResolvedLlm) ?? t("sidebar.runtimeIssuedModelEmpty");

  const applyRuntimeMode = async (nextMode: RuntimeMode): Promise<void> => {
    if (!activeSessionId || nextMode === runtimeMode || runtimePending) {
      return;
    }
    setRuntimeError("");
    setRuntimeNotice("");
    setRuntimePending(true);
    const prevMode = runtimeMode;
    try {
      const client = getGatewayClient();
      const modeResult = await client.setRuntimeMode(activeSessionId, nextMode);
      if (modeResult.status === "queued-change") {
        setRuntimeNotice(t("sidebar.runtimeQueuedNotice"));
      } else {
        setRuntimeMode(nextMode);
        setRuntimeNotice(t("sidebar.runtimeAppliedNotice"));
      }
      const refreshed = await client.getSession(activeSessionId);
      if (refreshed) {
        upsertSession(mapGatewaySessionToStoreSession(refreshed));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("未知会话")) {
        return;
      }
      setRuntimeMode(prevMode);
      setRuntimeError(message);
    } finally {
      setRuntimePending(false);
    }
  };

  const buildMemoryPath = (): string => {
    if (memoryTarget === "daily") {
      return `.openfoal/memory/daily/${memoryDate || new Date().toISOString().slice(0, 10)}.md`;
    }
    return ".openfoal/memory/MEMORY.md";
  };

  const refreshMemory = async (): Promise<void> => {
    setMemoryPending(true);
    setMemoryError("");
    setMemoryNotice("");
    try {
      const client = getGatewayClient();
      const lines = Number(memoryLines);
      const result = await client.memoryGet({
        path: buildMemoryPath(),
        from: 1,
        ...(Number.isFinite(lines) && lines > 0 ? { lines: Math.floor(lines) } : {})
      });
      setMemoryText(result.text);
      setMemoryInfo(`${result.path} · total ${result.totalLines} lines`);
    } catch (error) {
      setMemoryText("");
      setMemoryInfo("");
      setMemoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryPending(false);
    }
  };

  const searchMemory = async (): Promise<void> => {
    const query = memorySearchQuery.trim();
    if (!query || memorySearchPending) {
      return;
    }
    setMemorySearchPending(true);
    setMemoryError("");
    setMemoryNotice("");
    try {
      const client = getGatewayClient();
      const result = await client.memorySearch({
        query,
        maxResults: 6
      });
      setMemorySearchHits(result.results);
      setMemorySearchMeta(
        `${result.mode} · ${result.results.length} hits · files ${result.indexStats.files} · chunks ${result.indexStats.chunks}`
      );
    } catch (error) {
      setMemorySearchHits([]);
      setMemorySearchMeta("");
      setMemoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setMemorySearchPending(false);
    }
  };

  const openMemorySearchHit = async (hit: GatewayMemorySearchHit): Promise<void> => {
    setMemoryPending(true);
    setMemoryError("");
    setMemoryNotice("");
    try {
      const client = getGatewayClient();
      const lines = Math.max(1, hit.endLine - hit.startLine + 1);
      const result = await client.memoryGet({
        path: hit.path,
        from: hit.startLine,
        lines
      });
      if (hit.path === ".openfoal/memory/MEMORY.md" || hit.path === "MEMORY.md") {
        setMemoryTarget("global");
      } else {
        const matched =
          /^\.openfoal\/memory\/daily\/(.+)\.md$/.exec(hit.path) ??
          /^memory\/(.+)\.md$/.exec(hit.path) ??
          /^daily\/(.+)\.md$/.exec(hit.path);
        setMemoryTarget("daily");
        if (matched?.[1]) {
          setMemoryDate(matched[1]);
        }
      }
      setMemoryText(result.text);
      setMemoryInfo(`${result.path} · lines ${result.from}-${result.from + Math.max(0, (result.lines ?? lines) - 1)}`);
      setMemoryNotice(`${t("sidebar.memorySearchOpened")} ${hit.path}:${hit.startLine}`);
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryPending(false);
    }
  };

  const appendMemory = async (): Promise<void> => {
    const content = memoryAppendDraft.trim();
    if (!content) {
      return;
    }

    setMemoryPending(true);
    setMemoryError("");
    setMemoryNotice("");
    try {
      const client = getGatewayClient();
      const result = await client.memoryAppendDaily({
        content,
        date: memoryDate,
        includeLongTerm: memoryIncludeLongTerm
      });
      setMemoryAppendDraft("");
      setMemoryNotice(`${t("sidebar.memoryAppendSuccess")} ${result.path}`);
      await refreshMemory();
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryPending(false);
    }
  };

  const archiveMemory = async (): Promise<void> => {
    setMemoryPending(true);
    setMemoryError("");
    setMemoryNotice("");
    try {
      const client = getGatewayClient();
      const result = await client.memoryArchive({
        date: memoryDate,
        includeLongTerm: true,
        clearDaily: true
      });
      setMemoryNotice(`${t("sidebar.memoryArchiveSuccess")} ${result.date}`);
      await refreshMemory();
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryPending(false);
    }
  };

  const refreshSkillSync = async (): Promise<void> => {
    setSkillSyncLoading(true);
    setSkillSyncError("");
    setSkillSyncNotice("");
    try {
      const client = getGatewayClient();
      const [config, status] = await Promise.all([
        client.getSkillSyncConfig({
          scope: "user",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }),
        client.getSkillSyncStatus({
          scope: "user",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      ]);
      setSkillSyncCurrent(config);
      setSkillSyncStatus(status);
      setSkillSyncDraft(buildSkillSyncDraft(config));
    } catch (error) {
      setSkillSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillSyncLoading(false);
    }
  };

  const saveSkillSync = async (): Promise<void> => {
    setSkillSyncSaving(true);
    setSkillSyncError("");
    setSkillSyncNotice("");
    try {
      const client = getGatewayClient();
      const configPatch = buildSkillSyncPatchFromDraft(skillSyncDraft);
      const saved = await client.upsertSkillSyncConfig({
        scope: "user",
        timezone: skillSyncDraft.timezone,
        config: configPatch
      });
      const status = await client.getSkillSyncStatus({
        scope: "user",
        timezone: skillSyncDraft.timezone
      });
      setSkillSyncCurrent(saved);
      setSkillSyncStatus(status);
      setSkillSyncNotice(t("sidebar.skillSyncSaved"));
    } catch (error) {
      setSkillSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillSyncSaving(false);
    }
  };

  const runSkillSyncNow = async (): Promise<void> => {
    setSkillSyncRunning(true);
    setSkillSyncError("");
    setSkillSyncNotice("");
    try {
      const client = getGatewayClient();
      const result = await client.runSkillSyncNow({
        scope: "user",
        timezone: skillSyncDraft.timezone
      });
      const status = await client.getSkillSyncStatus({
        scope: "user",
        timezone: skillSyncDraft.timezone
      });
      setSkillSyncStatus(status);
      setSkillSyncNotice(`${t("sidebar.skillSyncRunStatusPrefix")}${result.run.status}`);
    } catch (error) {
      setSkillSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillSyncRunning(false);
    }
  };

  const saveLlm = () => {
    setLlmConfig(llmDraft);
    setLlmSavedNotice(t("sidebar.llmSaved"));
    setTimeout(() => {
      setLlmSavedNotice("");
    }, 1200);
  };

  const updateEditingProfile = (patch: Partial<LlmProfile>) => {
    if (!editingLlmProfile) {
      return;
    }
    setLlmDraft((prev) => ({
      ...prev,
      profiles: prev.profiles.map((profile) =>
        profile.id === editingLlmProfile.id
          ? {
              ...profile,
              ...patch
            }
          : profile
      )
    }));
  };

  const addLlmProfile = () => {
    const base = editingLlmProfile ?? activeLlmProfile;
    const nextProfile = createLlmProfile({
      provider: base?.provider ?? "",
      modelId: base?.modelId ?? "",
      baseUrl: base?.baseUrl ?? ""
    });
    setLlmDraft((prev) => ({
      ...prev,
      activeProfileId: nextProfile.id,
      profiles: [...prev.profiles, nextProfile]
    }));
    setEditingLlmProfileId(nextProfile.id);
  };

  const removeEditingProfile = () => {
    if (!editingLlmProfile || llmDraft.profiles.length <= 1) {
      return;
    }
    const rest = llmDraft.profiles.filter((profile) => profile.id !== editingLlmProfile.id);
    const nextActiveId =
      llmDraft.activeProfileId === editingLlmProfile.id ? rest[0]?.id ?? llmDraft.activeProfileId : llmDraft.activeProfileId;
    setLlmDraft((prev) => {
      return {
        ...prev,
        activeProfileId: nextActiveId,
        profiles: rest
      };
    });
    setEditingLlmProfileId(nextActiveId);
  };

  const handleSideNavAction = (itemKey: string | number | undefined): void => {
    if (itemKey === "skills") {
      navigate("/skills");
      return;
    }
    if (itemKey === "new") {
      void (async () => {
        try {
          const created = await getGatewayClient().createSession({
            runtimeMode: defaultRuntimeMode
          });
          upsertSession(mapGatewaySessionToStoreSession(created));
          setActiveSession(created.id);
          navigate("/chat");
        } catch (error) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
        }
      })();
      return;
    }
    navigate("/chat");
  };

  return (
    <Layout.Sider className="desktop-sidebar">
      <div className="brand-row">
        <Avatar color="grey" size="small">
          F
        </Avatar>
        <Typography.Title heading={4} className="brand-name">
          OpenFoal
        </Typography.Title>
        <button type="button" className="icon-plain-btn" aria-label={t("sidebar.toggleSidebar")}>
          <IconSidebar />
        </button>
      </div>

      <Nav
        className="side-nav"
        selectedKeys={[activeMenu]}
        onClick={(data: { itemKey?: string | number }) => {
          handleSideNavAction(String(data.itemKey ?? "") as SideMenu);
        }}
        items={[
          { itemKey: "new", text: t("sidebar.newDesktop"), icon: <IconPlusCircle /> },
          { itemKey: "skills", text: t("sidebar.skillStore"), icon: <IconPuzzle /> },
          {
            itemKey: "automations",
            text: (
              <span className="side-label-with-tag">
                {t("sidebar.automations")} <Tag size="small">{t("common.beta")}</Tag>
              </span>
            ),
            icon: <IconBolt />
          }
        ]}
        footer={{ collapseButton: false }}
      />

      <Typography.Text type="tertiary" className="section-title section-history">
        {t("sidebar.history")}
      </Typography.Text>
      <div className="session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={activeSessionId === session.id ? "session-item active" : "session-item"}
            onClick={() => {
              setActiveSession(session.id);
              navigate("/chat");
            }}
          >
            <Typography.Text className="session-title">{session.title}</Typography.Text>
            <Typography.Text type="tertiary" className="session-preview">
              {session.preview.trim().length > 0 ? session.preview : t("sidebar.noPreview")}
            </Typography.Text>
            <Space spacing={4} className="session-meta">
              <Tag size="small" color={session.runtimeMode === "local" ? "cyan" : "purple"}>
                {session.runtimeMode === "local" ? t("sidebar.runtimeLocal") : t("sidebar.runtimeCloud")}
              </Tag>
              <Tag size="small" color={syncStateColor(session.syncState)}>
                {renderSyncStateLabel(session.syncState)}
              </Tag>
            </Space>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sandbox-box">
          <Typography.Text type="secondary">{t("sidebar.sandbox")}</Typography.Text>
          <Space spacing={6}>
            <span className="dot-green" />
            <Typography.Text type="secondary">{t("sidebar.running")}</Typography.Text>
          </Space>
          {showSandboxUsage ? <Typography.Text type="tertiary">{sandboxUsageText}</Typography.Text> : null}
        </div>
      </div>

      <div className="user-box">
        <Popover
          position="topLeft"
          trigger="click"
          spacing={10}
          showArrow={false}
          getPopupContainer={() => document.body}
          visible={userMenuVisible}
          onVisibleChange={setUserMenuVisible}
          content={
            <div className="account-popover">
              <div className="account-head">
                <Avatar color="orange" size="default">
                  啵鸣
                </Avatar>
                <div>
                  <Typography.Text className="account-name">{accountName}</Typography.Text>
                  <Typography.Text type="tertiary" className="account-email">
                    {accountEmail}
                  </Typography.Text>
                </div>
              </div>
              <div className="account-divider" />
              <button
                type="button"
                className="account-menu-btn"
                onClick={() => {
                  setActiveSettingsMenu("account");
                  setSettingsModalVisible(true);
                  setUserMenuVisible(false);
                }}
              >
                <IconSettingStroked />
                <span>{t("sidebar.settings")}</span>
              </button>
              <button type="button" className="account-menu-btn">
                <IconCommentStroked />
                <span>{t("sidebar.community")}</span>
              </button>
              <button type="button" className="account-menu-btn">
                <IconMailStroked />
                <span>{t("sidebar.contactUs")}</span>
              </button>
              <button type="button" className="account-menu-btn">
                <IconPhoneStroked />
                <span>{t("sidebar.iosApp")}</span>
              </button>
              <div className="account-divider" />
              <button
                type="button"
                className="account-menu-btn account-menu-btn-danger"
                onClick={() => {
                  props.onSignOut?.();
                }}
              >
                <IconExit />
                <span>{t("sidebar.signOut")}</span>
              </button>
            </div>
          }
        >
          <button type="button" className="user-trigger-card" aria-label={t("sidebar.settings")}>
            <Avatar color="orange" size="small">
              啵鸣
            </Avatar>
            <div className="user-trigger-copy">
              <Typography.Text className="user-trigger-name">{accountName}</Typography.Text>
              <Typography.Text type="tertiary" className="user-trigger-plan">
                {accountEmail}
              </Typography.Text>
            </div>
            {userMenuVisible ? <IconChevronUp className="muted-icon" /> : <IconChevronDown className="muted-icon" />}
          </button>
        </Popover>
      </div>

      {settingsModalVisible ? (
        <Modal
          title={null}
          footer={null}
          visible={settingsModalVisible}
          onCancel={() => setSettingsModalVisible(false)}
          width={1080}
          className="settings-modal"
          closeIcon={<IconClose />}
        >
          <div className="settings-layout">
            <div className="settings-side">
              <Typography.Title heading={3} className="settings-title">
                {t("sidebar.settings")}
              </Typography.Title>
              <div className="settings-side-list">
                {settingsMenus.map((menu) => (
                  <button
                    key={menu.key}
                    type="button"
                    className={activeSettingsMenu === menu.key ? "settings-nav-btn active" : "settings-nav-btn"}
                    onClick={() => setActiveSettingsMenu(menu.key)}
                  >
                    {menu.icon}
                    <span>{menu.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-content">
              <Typography.Title heading={3} className="settings-content-title">
                {settingsMenus.find((item) => item.key === activeSettingsMenu)?.label}
              </Typography.Title>
              {activeSettingsMenu === "account" ? (
                <>
                  <div className="settings-field">
                    <Typography.Text className="settings-label">{t("sidebar.username")}</Typography.Text>
                    <div className="settings-card settings-inline-edit">
                      <span>啵鸣喵</span>
                      <IconEditStroked />
                    </div>
                  </div>
                  <div className="settings-field">
                    <Typography.Text className="settings-label">{t("sidebar.avatar")}</Typography.Text>
                    <div className="settings-card settings-avatar-card">
                      <Avatar color="orange" size="large">
                        啵鸣
                      </Avatar>
                      <Button theme="outline">{t("sidebar.changeAvatar")}</Button>
                    </div>
                  </div>
                  <div className="settings-field">
                    <Typography.Text className="settings-label">{t("sidebar.email")}</Typography.Text>
                    <Typography.Text className="settings-value">OpenFoal@example.com</Typography.Text>
                  </div>
                  <div className="settings-field">
                    <Typography.Text className="settings-label">{t("sidebar.language")}</Typography.Text>
                    <Space spacing={8}>
                      <Button
                        size="small"
                        theme={i18n.resolvedLanguage === "zh-CN" ? "solid" : "light"}
                        onClick={() => {
                          void i18n.changeLanguage("zh-CN");
                        }}
                      >
                        {t("sidebar.languageZh")}
                      </Button>
                      <Button
                        size="small"
                        theme={i18n.resolvedLanguage === "en-US" ? "solid" : "light"}
                        onClick={() => {
                          void i18n.changeLanguage("en-US");
                        }}
                      >
                        {t("sidebar.languageEn")}
                      </Button>
                    </Space>
                  </div>
                </>
              ) : activeSettingsMenu === "runtimeModel" ? (
                <div className="runtime-mode-wrap">
                  <Tabs
                    activeKey={runtimeTab}
                    className="runtime-settings-tabs"
                    onChange={(itemKey: string) => {
                      if (itemKey === "model" || itemKey === "status") {
                        setRuntimeTab(itemKey);
                      }
                    }}
                  >
                    <Tabs.TabPane tab={t("sidebar.runtimeTabModel")} itemKey="model">
                      <Typography.Text className="settings-label">{t("sidebar.runtimeModeLabel")}</Typography.Text>
                      <div className="runtime-mode-grid">
                        <button
                          type="button"
                          className={runtimeMode === "local" ? "runtime-mode-card active" : "runtime-mode-card"}
                          disabled={!activeSessionId}
                          onClick={() => {
                            void applyRuntimeMode("local");
                          }}
                        >
                          <div className="runtime-mode-head">
                            <IconDesktop />
                            <Typography.Text className="runtime-mode-title">{t("sidebar.runtimeLocal")}</Typography.Text>
                          </div>
                          <Typography.Text type="tertiary" className="runtime-mode-desc">
                            {t("sidebar.runtimeLocalDesc")}
                          </Typography.Text>
                        </button>
                        <button
                          type="button"
                          className={runtimeMode === "cloud" ? "runtime-mode-card active" : "runtime-mode-card"}
                          disabled={!activeSessionId}
                          onClick={() => {
                            void applyRuntimeMode("cloud");
                          }}
                        >
                          <div className="runtime-mode-head">
                            <IconCloudStroked />
                            <Typography.Text className="runtime-mode-title">{t("sidebar.runtimeCloud")}</Typography.Text>
                          </div>
                          <Typography.Text type="tertiary" className="runtime-mode-desc">
                            {t("sidebar.runtimeCloudDesc")}
                          </Typography.Text>
                        </button>
                      </div>
                      {runtimePending ? <Typography.Text type="tertiary">{t("sidebar.runtimeSyncing")}</Typography.Text> : null}
                      {runtimeNotice ? <Typography.Text type="success">{runtimeNotice}</Typography.Text> : null}
                      {runtimeError ? (
                        <Typography.Text type="danger">
                          {t("sidebar.runtimeSyncFailed")}
                          {runtimeError}
                        </Typography.Text>
                      ) : null}

                      <div className="llm-config-wrap">
                        <Typography.Text className="settings-label">{t("sidebar.runtimeIssuedModel")}</Typography.Text>
                        <Typography.Text className="settings-value">{runtimeIssuedModelLabel}</Typography.Text>
                        <Typography.Text className="settings-label">{t("sidebar.llmProfileActive")}</Typography.Text>
                        <Select
                          value={llmDraft.activeProfileId}
                          optionList={llmDraft.profiles.map((profile) => ({
                            label: profile.name,
                            value: profile.id
                          }))}
                          placeholder={t("sidebar.llmProfileActive")}
                          onChange={(value: unknown) => {
                            if (typeof value !== "string") {
                              return;
                            }
                            setLlmDraft((prev) => ({
                              ...prev,
                              activeProfileId: value
                            }));
                            setEditingLlmProfileId(value);
                          }}
                        />
                        <div className="llm-profile-actions">
                          <Button theme="light" onClick={addLlmProfile}>
                            {t("sidebar.llmAddProfile")}
                          </Button>
                          <Button
                            theme="borderless"
                            type="danger"
                            disabled={llmDraft.profiles.length <= 1}
                            onClick={removeEditingProfile}
                          >
                            {t("sidebar.llmDeleteProfile")}
                          </Button>
                        </div>
                        <Typography.Text className="settings-label">{t("sidebar.llmProfileEdit")}</Typography.Text>
                        <Select
                          value={editingLlmProfile?.id}
                          optionList={llmDraft.profiles.map((profile) => ({
                            label: profile.name,
                            value: profile.id
                          }))}
                          placeholder={t("sidebar.llmProfileEdit")}
                          onChange={(value: unknown) => {
                            if (typeof value !== "string") {
                              return;
                            }
                            setEditingLlmProfileId(value);
                          }}
                        />
                        <Typography.Text className="settings-label">{t("sidebar.llmProfileName")}</Typography.Text>
                        <Input
                          value={editingLlmProfile?.name ?? ""}
                          placeholder="Kimi · k2p5"
                          onChange={(value) => {
                            updateEditingProfile({
                              name: value
                            });
                          }}
                        />
                        <Typography.Text className="settings-label">{t("sidebar.llmModelRef")}</Typography.Text>
                        <Input
                          value={editingLlmProfile?.modelRef ?? ""}
                          placeholder="kimi-default"
                          onChange={(value) => {
                            updateEditingProfile({
                              modelRef: value
                            });
                          }}
                        />
                        <Typography.Text className="settings-label">{t("sidebar.llmProvider")}</Typography.Text>
                        <Select
                          value={editingLlmProfile?.provider}
                          optionList={providerOptions}
                          placeholder="Select provider"
                          onChange={(value: unknown) => {
                            if (typeof value !== "string") {
                              return;
                            }
                            updateEditingProfile({
                              provider: value
                            });
                          }}
                        />
                        <Typography.Text className="settings-label">{t("sidebar.llmModelId")}</Typography.Text>
                        <Input
                          value={editingLlmProfile?.modelId ?? ""}
                          placeholder="k2p5"
                          onChange={(value) => {
                            updateEditingProfile({
                              modelId: value
                            });
                          }}
                        />
                        <Typography.Text className="settings-label">{t("sidebar.llmBasePreset")}</Typography.Text>
                        <Select
                          optionList={baseUrlOptions}
                          placeholder={t("sidebar.llmBasePreset")}
                          value={
                            baseUrlOptions.some((item) => item.value === (editingLlmProfile?.baseUrl ?? ""))
                              ? editingLlmProfile?.baseUrl
                              : undefined
                          }
                          onChange={(value: unknown) => {
                            if (typeof value !== "string") {
                              return;
                            }
                            updateEditingProfile({
                              baseUrl: value
                            });
                          }}
                        />
                        <Typography.Text className="settings-label">{t("sidebar.llmBaseUrl")}</Typography.Text>
                        <Input
                          value={editingLlmProfile?.baseUrl ?? ""}
                          placeholder="https://api.example.com/v1"
                          onChange={(value) => {
                            updateEditingProfile({
                              baseUrl: value
                            });
                          }}
                        />
                        <Typography.Text className="settings-label">{t("sidebar.llmApiKey")}</Typography.Text>
                        <Input
                          value={editingLlmProfile?.apiKey ?? ""}
                          mode="password"
                          placeholder="sk-***"
                          onChange={(value) => {
                            updateEditingProfile({
                              apiKey: value
                            });
                          }}
                        />
                        <div className="llm-config-actions">
                          <Button theme="solid" onClick={saveLlm} disabled={!isLlmDirty}>
                            {t("sidebar.llmSave")}
                          </Button>
                          <Button
                            theme="light"
                            disabled={!isLlmDirty}
                            onClick={() => {
                              setLlmDraft(llmConfig);
                              setEditingLlmProfileId(llmConfig.activeProfileId);
                            }}
                          >
                            {t("sidebar.llmReset")}
                          </Button>
                        </div>
                        {llmSavedNotice ? <Typography.Text type="success">{llmSavedNotice}</Typography.Text> : null}
                        <Typography.Text type="tertiary">{t("sidebar.llmConfigHint")}</Typography.Text>
                      </div>
                    </Tabs.TabPane>
                    <Tabs.TabPane tab={t("sidebar.runtimeTabStatus")} itemKey="status">
                      <div className="runtime-status-pane">
                        <div className="runtime-status-bar">
                          <Space spacing={16}>
                            <Typography.Text type={gatewayReady ? "success" : "danger"}>
                              {t("chat.gatewayStatus")}
                              {" · "}
                              {gatewayReady ? t("chat.gatewayOnline") : t("chat.gatewayOffline")}
                            </Typography.Text>
                            <Typography.Text type="tertiary">
                              {t("chat.runtimeMode")}
                              {" · "}
                              {runtimeMode === "local" ? t("chat.runtimeLocal") : t("chat.runtimeCloud")}
                            </Typography.Text>
                          </Space>
                          <Space spacing={12}>
                            <Typography.Text type="tertiary">
                              {t("chat.contextUsage")}
                              {" · "}
                              {formatUsage(activeSession?.contextUsage)}
                            </Typography.Text>
                            <Typography.Text type="tertiary">
                              {t("chat.compactionCount")}
                              {" · "}
                              {String(activeSession?.compactionCount ?? 0)}
                            </Typography.Text>
                            <Typography.Text type="tertiary">
                              {t("chat.memoryFlushState")}
                              {" · "}
                              {activeSession?.memoryFlushState ?? "idle"}
                            </Typography.Text>
                          </Space>
                        </div>
                        {!activeSession ? (
                          <Typography.Text type="tertiary">{t("sidebar.runtimeStatusNoSession")}</Typography.Text>
                        ) : null}
                        {runtimeStatusError ? <Typography.Text type="danger">{runtimeStatusError}</Typography.Text> : null}
                      </div>
                    </Tabs.TabPane>
                  </Tabs>
                </div>
              ) : activeSettingsMenu === "memory" ? (
                <div className="memory-settings-wrap">
                  <Typography.Text className="settings-label">{t("sidebar.memoryTarget")}</Typography.Text>
                  <Space spacing={8} className="memory-target-row">
                    <Button
                      size="small"
                      theme={memoryTarget === "global" ? "solid" : "light"}
                      onClick={() => setMemoryTarget("global")}
                    >
                      .openfoal/memory/MEMORY.md
                    </Button>
                    <Button
                      size="small"
                      theme={memoryTarget === "daily" ? "solid" : "light"}
                      onClick={() => setMemoryTarget("daily")}
                    >
                      {t("sidebar.memoryDailyFile")}
                    </Button>
                    {memoryTarget === "daily" ? (
                      <Input value={memoryDate} className="memory-date-input" onChange={(value) => setMemoryDate(value)} />
                    ) : null}
                    <Input
                      value={memoryLines}
                      className="memory-lines-input"
                      onChange={(value) => setMemoryLines(value)}
                      placeholder={t("sidebar.memoryLines")}
                    />
                    <Button theme="solid" loading={memoryPending} onClick={() => void refreshMemory()}>
                      {t("sidebar.memoryRefresh")}
                    </Button>
                  </Space>
                  {memoryInfo ? <Typography.Text type="tertiary">{memoryInfo}</Typography.Text> : null}

                  <Typography.Text className="settings-label">{t("sidebar.memoryCurrentContent")}</Typography.Text>
                  <TextArea
                    value={memoryText}
                    readOnly
                    rows={12}
                    className="memory-readonly"
                    placeholder={t("sidebar.memoryEmpty")}
                  />

                  <Typography.Text className="settings-label">{t("sidebar.memorySearchTitle")}</Typography.Text>
                  <Space spacing={8} align="start" className="memory-search-row">
                    <Input
                      value={memorySearchQuery}
                      className="memory-search-input"
                      onChange={(value) => setMemorySearchQuery(value)}
                      placeholder={t("sidebar.memorySearchPlaceholder")}
                    />
                    <Button theme="solid" loading={memorySearchPending} onClick={() => void searchMemory()}>
                      {t("sidebar.memorySearchAction")}
                    </Button>
                  </Space>
                  {memorySearchMeta ? <Typography.Text type="tertiary">{memorySearchMeta}</Typography.Text> : null}
                  <div className="memory-search-results">
                    {memorySearchHits.length === 0 ? (
                      <Typography.Text type="tertiary">{t("sidebar.memorySearchEmpty")}</Typography.Text>
                    ) : (
                      memorySearchHits.map((item) => (
                        <div key={`${item.path}:${item.startLine}:${item.endLine}`} className="memory-search-result-item">
                          <div className="memory-search-result-head">
                            <Typography.Text type="tertiary">
                              {item.path}:{item.startLine}-{item.endLine} · score {item.score.toFixed(3)}
                            </Typography.Text>
                            <Button size="small" theme="light" onClick={() => void openMemorySearchHit(item)}>
                              {t("sidebar.memorySearchOpen")}
                            </Button>
                          </div>
                          <Typography.Paragraph className="memory-search-snippet">{item.snippet}</Typography.Paragraph>
                        </div>
                      ))
                    )}
                  </div>

                  <Typography.Text className="settings-label">{t("sidebar.memoryAppendTitle")}</Typography.Text>
                  <TextArea
                    value={memoryAppendDraft}
                    rows={4}
                    onChange={(value: string) => setMemoryAppendDraft(value)}
                    placeholder={t("sidebar.memoryAppendPlaceholder")}
                  />
                  <Space spacing={8}>
                    <Button
                      size="small"
                      theme={memoryIncludeLongTerm ? "solid" : "light"}
                      onClick={() => setMemoryIncludeLongTerm((prev) => !prev)}
                    >
                      {memoryIncludeLongTerm ? t("sidebar.memoryIncludeLongTermOn") : t("sidebar.memoryIncludeLongTermOff")}
                    </Button>
                    <Button theme="solid" loading={memoryPending} onClick={() => void appendMemory()}>
                      {t("sidebar.memoryAppend")}
                    </Button>
                    <Button theme="light" type="danger" loading={memoryPending} onClick={() => void archiveMemory()}>
                      {t("sidebar.memoryArchive")}
                    </Button>
                  </Space>
                  {memoryNotice ? <Typography.Text type="success">{memoryNotice}</Typography.Text> : null}
                  {memoryError ? (
                    <Typography.Text type="danger">
                      {t("sidebar.memoryErrorPrefix")}
                      {memoryError}
                    </Typography.Text>
                  ) : null}
                </div>
              ) : activeSettingsMenu === "skillSync" ? (
                <div className="memory-settings-wrap">
                  <Typography.Text className="settings-label">{t("sidebar.skillSyncAutoSync")}</Typography.Text>
                  <Checkbox
                    checked={skillSyncDraft.autoSyncEnabled}
                    onChange={(event: any) =>
                      setSkillSyncDraft((prev) => ({
                        ...prev,
                        autoSyncEnabled: Boolean(event?.target?.checked)
                      }))
                    }
                  >
                    {t("sidebar.skillSyncAutoSync")}
                  </Checkbox>

                  <Typography.Text className="settings-label">{t("sidebar.skillSyncManualOnly")}</Typography.Text>
                  <Checkbox
                    checked={skillSyncDraft.manualOnly}
                    onChange={(event: any) =>
                      setSkillSyncDraft((prev) => ({
                        ...prev,
                        manualOnly: Boolean(event?.target?.checked)
                      }))
                    }
                  >
                    {t("sidebar.skillSyncManualOnly")}
                  </Checkbox>

                  <Typography.Text className="settings-label">{t("sidebar.skillSyncTime")}</Typography.Text>
                  <Input
                    value={skillSyncDraft.syncTime}
                    onChange={(value) => setSkillSyncDraft((prev) => ({ ...prev, syncTime: value }))}
                    placeholder="03:00"
                  />

                  <Typography.Text className="settings-label">{t("sidebar.skillSyncTimezone")}</Typography.Text>
                  <Input
                    value={skillSyncDraft.timezone}
                    onChange={(value) => setSkillSyncDraft((prev) => ({ ...prev, timezone: value }))}
                    placeholder="Asia/Shanghai"
                  />

                  <Typography.Text className="settings-label">{t("sidebar.skillSyncMode")}</Typography.Text>
                  <Select
                    value={skillSyncDraft.syncMode}
                    optionList={[
                      { label: "online", value: "online" },
                      { label: "bundle_only", value: "bundle_only" }
                    ]}
                    onChange={(value: unknown) => {
                      if (value !== "online" && value !== "bundle_only") {
                        return;
                      }
                      setSkillSyncDraft((prev) => ({ ...prev, syncMode: value }));
                    }}
                  />

                  <Typography.Text className="settings-label">{t("sidebar.skillSyncSources")}</Typography.Text>
                  <Input
                    value={skillSyncDraft.sourceFiltersText}
                    onChange={(value) => setSkillSyncDraft((prev) => ({ ...prev, sourceFiltersText: value }))}
                    placeholder="anthropics/skills, affaan-m/everything-claude-code"
                  />

                  <Typography.Text className="settings-label">{t("sidebar.skillSyncLicenses")}</Typography.Text>
                  <Input
                    value={skillSyncDraft.licenseFiltersText}
                    onChange={(value) => setSkillSyncDraft((prev) => ({ ...prev, licenseFiltersText: value }))}
                    placeholder="allow,review"
                  />

                  <Typography.Text className="settings-label">{t("sidebar.skillSyncTags")}</Typography.Text>
                  <Input
                    value={skillSyncDraft.tagFiltersText}
                    onChange={(value) => setSkillSyncDraft((prev) => ({ ...prev, tagFiltersText: value }))}
                    placeholder="coding,ops"
                  />

                  <Space spacing={8}>
                    <Button theme="solid" loading={skillSyncSaving} onClick={() => void saveSkillSync()}>
                      {t("sidebar.skillSyncSave")}
                    </Button>
                    <Button theme="light" loading={skillSyncRunning} onClick={() => void runSkillSyncNow()}>
                      {t("sidebar.skillSyncRunNow")}
                    </Button>
                    <Button theme="light" loading={skillSyncLoading} onClick={() => void refreshSkillSync()}>
                      {t("sidebar.skillSyncRefresh")}
                    </Button>
                  </Space>

                  {skillSyncNotice ? <Typography.Text type="success">{skillSyncNotice}</Typography.Text> : null}
                  {skillSyncError ? <Typography.Text type="danger">{skillSyncError}</Typography.Text> : null}

                  <Typography.Text type="tertiary">
                    {t("sidebar.skillSyncEffective")}
                    {": "}
                    {formatSkillSyncConfig(skillSyncCurrent?.effectiveConfig)}
                  </Typography.Text>
                  <Typography.Text type="tertiary">
                    {t("sidebar.skillSyncLastRun")}
                    {": "}
                    {skillSyncStatus?.status.lastRunAt ?? "-"}
                  </Typography.Text>
                  <Typography.Text type="tertiary">
                    {t("sidebar.skillSyncNextRun")}
                    {": "}
                    {skillSyncStatus?.status.nextRunAt ?? "-"}
                  </Typography.Text>
                  <Typography.Text type="tertiary">
                    {t("sidebar.skillSyncLastError")}
                    {": "}
                    {skillSyncStatus?.status.lastError ?? "-"}
                  </Typography.Text>
                </div>
              ) : (
                <div className="settings-placeholder">{t("sidebar.comingSoon")}</div>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
    </Layout.Sider>
  );
}

function buildSkillSyncDraft(config?: GatewaySkillSyncConfigResponse): SkillSyncDraft {
  const effective = config?.effectiveConfig;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    autoSyncEnabled: effective?.autoSyncEnabled ?? true,
    syncTime: effective?.syncTime ?? "03:00",
    timezone: effective?.timezone ?? timezone,
    syncMode: effective?.syncMode ?? "online",
    sourceFiltersText: (effective?.sourceFilters ?? []).join(", "),
    licenseFiltersText: (effective?.licenseFilters ?? ["allow", "review"]).join(","),
    tagFiltersText: (effective?.tagFilters ?? []).join(", "),
    manualOnly: effective?.manualOnly ?? false
  };
}

function buildSkillSyncPatchFromDraft(draft: SkillSyncDraft): GatewaySkillSyncConfigPatch {
  return {
    autoSyncEnabled: draft.autoSyncEnabled,
    syncTime: normalizeSkillSyncTime(draft.syncTime),
    timezone: draft.timezone.trim() || "UTC",
    syncMode: draft.syncMode,
    sourceFilters: splitCsv(draft.sourceFiltersText),
    licenseFilters: normalizeSkillSyncLicenses(splitCsv(draft.licenseFiltersText)),
    tagFilters: splitCsv(draft.tagFiltersText),
    manualOnly: draft.manualOnly
  };
}

function normalizeSkillSyncTime(value: string): string {
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

function normalizeSkillSyncLicenses(value: string[]): Array<"allow" | "review" | "deny"> {
  const valid: Array<"allow" | "review" | "deny"> = [];
  for (const item of value) {
    const normalized = item.toLowerCase();
    if (normalized === "allow" || normalized === "review" || normalized === "deny") {
      valid.push(normalized);
    }
  }
  return valid.length > 0 ? valid : ["allow", "review"];
}

function formatSkillSyncConfig(config: GatewaySkillSyncConfigResponse["effectiveConfig"] | undefined): string {
  if (!config) {
    return "-";
  }
  return `${config.syncMode} @ ${config.syncTime} ${config.timezone} · source=${config.sourceFilters.length} · license=${config.licenseFilters.join(",")} · tags=${config.tagFilters.join(",") || "-"}`;
}

function sameLlmConfig(a: LlmConfig, b: LlmConfig): boolean {
  if (a.activeProfileId !== b.activeProfileId) {
    return false;
  }
  if (a.profiles.length !== b.profiles.length) {
    return false;
  }
  for (let i = 0; i < a.profiles.length; i += 1) {
    const left = a.profiles[i];
    const right = b.profiles[i];
    if (!right) {
      return false;
    }
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.modelRef !== right.modelRef ||
      left.provider !== right.provider ||
      left.modelId !== right.modelId ||
      left.apiKey !== right.apiKey ||
      left.baseUrl !== right.baseUrl
    ) {
      return false;
    }
  }
  return true;
}

function mapGatewaySessionToStoreSession(session: GatewaySession) {
  return {
    id: session.id,
    sessionKey: session.sessionKey,
    title: session.title,
    preview: session.preview,
    runtimeMode: session.runtimeMode,
    syncState: session.syncState as "local_only" | "syncing" | "synced" | "conflict",
    contextUsage: session.contextUsage,
    compactionCount: session.compactionCount,
    memoryFlushState: session.memoryFlushState,
    ...(session.memoryFlushAt ? { memoryFlushAt: session.memoryFlushAt } : {}),
    updatedAt: session.updatedAt
  };
}

function renderSyncStateLabel(syncState: "local_only" | "syncing" | "synced" | "conflict"): string {
  if (syncState === "syncing") {
    return "syncing";
  }
  if (syncState === "synced") {
    return "synced";
  }
  if (syncState === "conflict") {
    return "conflict";
  }
  return "local_only";
}

function syncStateColor(syncState: "local_only" | "syncing" | "synced" | "conflict"): "grey" | "blue" | "green" | "red" {
  if (syncState === "syncing") {
    return "blue";
  }
  if (syncState === "synced") {
    return "green";
  }
  if (syncState === "conflict") {
    return "red";
  }
  return "grey";
}

function formatUsage(value: number | undefined): string {
  const usage = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return `${Math.round(usage * 100)}%`;
}

function formatSandboxUsageLine(value: GatewaySandboxUsage, language: string): string {
  const memoryLabel = language.toLowerCase().startsWith("zh") ? "内存" : "Mem";
  const diskLabel = language.toLowerCase().startsWith("zh") ? "磁盘" : "Disk";
  return `CPU ${formatPercent(value.cpuPercent)} · ${memoryLabel} ${formatPercent(value.memoryPercent)} · ${diskLabel} ${formatPercent(value.diskPercent)}`;
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function resolveRuntimeLlmFromTranscript(items: GatewayTranscriptItem[]): RuntimeResolvedLlm | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.event !== "agent.accepted") {
      continue;
    }
    const fromPayload = asRuntimeResolvedLlm(item.payload);
    if (fromPayload) {
      return fromPayload;
    }
    if (isObjectRecord(item.payload.llm)) {
      const fromNested = asRuntimeResolvedLlm(item.payload.llm);
      if (fromNested) {
        return fromNested;
      }
    }
  }
  return undefined;
}

function asRuntimeResolvedLlm(value: unknown): RuntimeResolvedLlm | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const modelRef = stringOrUndefined(value.modelRef);
  const provider = stringOrUndefined(value.provider);
  const modelId = stringOrUndefined(value.modelId);
  const baseUrl = stringOrUndefined(value.baseUrl);
  if (!modelRef && !provider && !modelId && !baseUrl) {
    return undefined;
  }
  return {
    ...(modelRef ? { modelRef } : {}),
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
}

function formatRuntimeResolvedLlm(value: RuntimeResolvedLlm | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.modelRef) {
    return value.modelRef;
  }
  if (value.provider && value.modelId) {
    return `${value.provider} · ${value.modelId}`;
  }
  if (value.modelId) {
    return value.modelId;
  }
  return value.provider;
}

function mergeIssuedProfilesIntoConfig(config: LlmConfig, items: GatewayModelKeyMeta[]): LlmConfig {
  const localProfiles = config.profiles.filter((profile) => !isIssuedProfileId(profile.id));
  const issuedProfiles = items
    .map(toIssuedLlmProfile)
    .filter((profile): profile is LlmProfile => Boolean(profile))
    .sort((left, right) => left.name.localeCompare(right.name));
  const profiles = [...localProfiles, ...issuedProfiles];
  const activeProfileId = profiles.some((profile) => profile.id === config.activeProfileId)
    ? config.activeProfileId
    : profiles[0]?.id ?? config.activeProfileId;
  return {
    ...config,
    activeProfileId,
    profiles
  };
}

function toIssuedLlmProfile(item: GatewayModelKeyMeta): LlmProfile | undefined {
  const provider = item.provider.trim().toLowerCase();
  if (!provider) {
    return undefined;
  }
  const modelId = item.modelId?.trim() || "default";
  const scopeSegment = sanitizeProfileSegment(item.workspaceId?.trim() || "tenant");
  const id = `profile_enterprise_issued_${sanitizeProfileSegment(provider)}_${sanitizeProfileSegment(modelId)}_${scopeSegment}`;
  const baseUrl = item.baseUrl?.trim() || defaultBaseUrlForProvider(provider);
  return {
    id,
    name: `${providerDisplayName(provider)} · ${modelId}（企业下发）`,
    modelRef: "",
    provider,
    modelId,
    apiKey: "",
    baseUrl
  };
}

function isIssuedProfileId(value: string): boolean {
  return value.startsWith("profile_enterprise_issued_");
}

function sanitizeProfileSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "default";
}

function providerDisplayName(provider: string): string {
  if (provider === "openai") {
    return "OpenAI";
  }
  if (provider === "anthropic") {
    return "Anthropic";
  }
  if (provider === "kimi" || provider.startsWith("kimi-") || provider.includes("moonshot")) {
    return "Kimi";
  }
  if (provider === "gemini") {
    return "Gemini";
  }
  if (provider === "qwen") {
    return "Qwen";
  }
  if (provider === "deepseek") {
    return "DeepSeek";
  }
  return provider;
}

function defaultBaseUrlForProvider(provider: string): string {
  if (provider === "openai") {
    return "https://api.openai.com/v1";
  }
  if (provider === "anthropic") {
    return "https://api.anthropic.com";
  }
  if (provider === "gemini") {
    return "https://generativelanguage.googleapis.com";
  }
  if (provider === "deepseek") {
    return "https://api.deepseek.com";
  }
  if (provider === "qwen") {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }
  return "https://api.moonshot.cn/v1";
}

function buildProviderOptions(profiles: LlmProfile[]): Array<{ label: string; value: string }> {
  const seed = ["kimi", "openai", "anthropic"];
  const providers = new Set<string>(seed);
  for (const profile of profiles) {
    const value = profile.provider.trim().toLowerCase();
    if (value) {
      providers.add(value);
    }
  }
  return Array.from(providers.values())
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({
      label: providerDisplayName(value),
      value
    }));
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
