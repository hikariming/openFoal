import { Avatar, Button, Input, Layout, Modal, Nav, Popover, Select, Space, Tag, Typography } from "@douyinfe/semi-ui";
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
import { getGatewayClient, type GatewaySession } from "../lib/gateway-client";
import {
  createLlmProfile,
  getSessionRuntimeMode,
  useAppStore,
  type LlmConfig,
  type LlmProfile,
  type RuntimeMode
} from "../store/app-store";

type SideMenu = "new" | "skills" | "automations";
type SettingsMenu = "account" | "capyMail" | "runtimeModel" | "subscription" | "referral" | "experimental";

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const [userMenuVisible, setUserMenuVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [activeSettingsMenu, setActiveSettingsMenu] = useState<SettingsMenu>("account");
  const [runtimePending, setRuntimePending] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [llmSavedNotice, setLlmSavedNotice] = useState("");
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
    { key: "subscription", label: t("sidebar.subscription"), icon: <IconCreditCardStroked /> },
    { key: "referral", label: t("sidebar.referral"), icon: <IconLink /> },
    { key: "experimental", label: t("sidebar.experimental"), icon: <IconGiftStroked /> }
  ];
  const providerOptions = [
    { label: "Kimi", value: "kimi" },
    { label: "OpenAI", value: "openai" },
    { label: "Anthropic", value: "anthropic" }
  ];
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

  useEffect(() => {
    setLlmDraft(llmConfig);
    setEditingLlmProfileId(llmConfig.activeProfileId);
  }, [llmConfig, settingsModalVisible]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = getGatewayClient();
        let listed = await client.listSessions();
        if (listed.length === 0) {
          const created = await client.createSession();
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
  }, [setSessions]);

  const applyRuntimeMode = async (nextMode: RuntimeMode): Promise<void> => {
    if (!activeSessionId || nextMode === runtimeMode || runtimePending) {
      return;
    }
    setRuntimeError("");
    setRuntimePending(true);
    const prevMode = runtimeMode;
    setRuntimeMode(nextMode);
    try {
      const client = getGatewayClient();
      await client.setRuntimeMode(activeSessionId, nextMode);
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
      provider: base?.provider ?? "kimi",
      modelId: base?.modelId ?? "k2p5",
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
          const created = await getGatewayClient().createSession();
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
        onClick={(data) => {
          handleSideNavAction(data.itemKey);
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
          <Typography.Text type="tertiary">{t("sidebar.usage")}</Typography.Text>
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
                  <Typography.Text className="account-name">啵鸣喵</Typography.Text>
                  <Typography.Text type="tertiary" className="account-email">
                    OpenFoal@example.com
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
              <button type="button" className="account-menu-btn account-menu-btn-danger">
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
              <Typography.Text className="user-trigger-name">啵鸣喵</Typography.Text>
              <Typography.Text type="tertiary" className="user-trigger-plan">
                OpenFoal@example.com
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
                  {runtimePending ? <Typography.Text type="tertiary">Syncing runtime mode...</Typography.Text> : null}
                  {runtimeError ? (
                    <Typography.Text type="danger">Runtime mode sync failed: {runtimeError}</Typography.Text>
                  ) : null}

                  <div className="llm-config-wrap">
                    <Typography.Text className="settings-label">{t("sidebar.llmProfileActive")}</Typography.Text>
                    <Select
                      value={llmDraft.activeProfileId}
                      optionList={llmDraft.profiles.map((profile) => ({
                        label: profile.name,
                        value: profile.id
                      }))}
                      placeholder={t("sidebar.llmProfileActive")}
                      onChange={(value) => {
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
                      onChange={(value) => {
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
                      onChange={(value) => {
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
                      onChange={(value) => {
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
    updatedAt: session.updatedAt
  };
}
