import { Avatar, Button, Layout, Modal, Nav, Popover, Space, Tag, Typography } from "@douyinfe/semi-ui";
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
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/app-store";

type SideMenu = "new" | "skills" | "automations";
type SettingsMenu = "account" | "capyMail" | "runtimeModel" | "subscription" | "referral" | "experimental";
type RuntimeMode = "local" | "cloud";

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const [userMenuVisible, setUserMenuVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [activeSettingsMenu, setActiveSettingsMenu] = useState<SettingsMenu>("account");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("local");
  const { sessions, activeSessionId, setActiveSession } = useAppStore();

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
        onSelect={(data) => {
          if (data.itemKey === "skills") {
            navigate("/skills");
            return;
          }
          navigate("/chat");
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
            <Typography.Text type="tertiary" className="session-meta">
              {session.updatedAt}
            </Typography.Text>
            <Typography.Text type="tertiary" className="session-preview">
              {session.preview}
            </Typography.Text>
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
                      onClick={() => setRuntimeMode("local")}
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
                      onClick={() => setRuntimeMode("cloud")}
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
