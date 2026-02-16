import {
  IconActivity,
  IconCommentStroked,
  IconClock,
  IconHistogram,
  IconSafe,
  IconServer,
  IconSetting,
  IconUserGroup
} from "@douyinfe/semi-icons";
import { Button, Input, Layout, Nav, Space, Typography } from "@douyinfe/semi-ui";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import i18n from "../../i18n";
import { resolveConsolePermissions } from "../permissions";
import { useAuthStore } from "../../stores/auth-store";
import { useScopeStore } from "../../stores/scope-store";
import { useUiStore } from "../../stores/ui-store";

type NavDef = {
  key: string;
  path: string;
  text: string;
  icon: JSX.Element;
  visible: boolean;
};

export function ConsoleLayout(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const principal = useAuthStore((state) => state.principal);
  const logout = useAuthStore((state) => state.logout);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);
  const setTenantId = useScopeStore((state) => state.setTenantId);
  const setWorkspaceId = useScopeStore((state) => state.setWorkspaceId);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);

  const permissions = resolveConsolePermissions(principal);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  const navItems = useMemo<NavDef[]>(
    () => [
      { key: "chat", path: "/chat", text: t("nav.chat"), icon: <IconCommentStroked />, visible: permissions.canAccessChat },
      {
        key: "dashboard",
        path: "/admin/dashboard",
        text: t("nav.dashboard"),
        icon: <IconHistogram />,
        visible: permissions.canAccessAdmin
      },
      { key: "sessions", path: "/admin/sessions", text: t("nav.sessions"), icon: <IconActivity />, visible: permissions.canAccessAdmin },
      {
        key: "users",
        path: "/admin/users",
        text: t("nav.users"),
        icon: <IconUserGroup />,
        visible: permissions.canReadUsers
      },
      {
        key: "policies",
        path: "/admin/policies",
        text: t("nav.policies"),
        icon: <IconSafe />,
        visible: permissions.canAccessAdmin
      },
      {
        key: "secrets",
        path: "/admin/secrets",
        text: t("nav.secrets"),
        icon: <IconServer />,
        visible: permissions.canReadSecrets
      },
      { key: "audit", path: "/admin/audit", text: t("nav.audit"), icon: <IconClock />, visible: permissions.canAccessAdmin },
      { key: "agents", path: "/admin/agents", text: t("nav.agents"), icon: <IconSetting />, visible: permissions.canAccessAdmin },
      { key: "targets", path: "/admin/targets", text: t("nav.targets"), icon: <IconSetting />, visible: permissions.canAccessAdmin },
      { key: "budget", path: "/admin/budget", text: t("nav.budget"), icon: <IconSetting />, visible: permissions.canAccessAdmin },
      { key: "context", path: "/admin/context", text: t("nav.context"), icon: <IconSetting />, visible: permissions.canAccessAdmin },
      { key: "infra", path: "/admin/infra", text: t("nav.infra"), icon: <IconServer />, visible: permissions.canReadInfra }
    ],
    [permissions.canAccessAdmin, permissions.canAccessChat, permissions.canReadInfra, permissions.canReadSecrets, permissions.canReadUsers, t]
  );

  const visibleNav = navItems.filter((item) => item.visible);

  const selectedKey = useMemo(() => {
    const hit = visibleNav.find((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));
    return hit?.key ?? "dashboard";
  }, [location.pathname, visibleNav]);

  const isChat = selectedKey === "chat";

  return (
    <Layout className="console-root">
      <Layout.Sider className="console-sider">
        <div className="brand">{t("app.brand")}</div>
        <Typography.Text type="tertiary" size="small" style={{ margin: "0 8px 12px", display: "block" }}>
          {t("app.subtitle")}
        </Typography.Text>
        <Nav
          selectedKeys={[selectedKey]}
          items={visibleNav.map((item) => ({ itemKey: item.key, text: item.text, icon: item.icon }))}
          onSelect={(data) => {
            const key = String(data.itemKey);
            const target = visibleNav.find((item) => item.key === key);
            if (target) {
              navigate(target.path);
            }
          }}
          footer={{ collapseButton: false }}
        />
      </Layout.Sider>

      <Layout>
        <Layout.Header className="console-header">
          <Space>
            <Input
              size="small"
              style={{ width: 130 }}
              value={tenantId}
              placeholder={t("common.tenantId")}
              disabled={!permissions.canAccessAdmin}
              onChange={(value) => setTenantId(value)}
            />
            <Input
              size="small"
              style={{ width: 130 }}
              value={workspaceId}
              placeholder={t("common.workspaceId")}
              disabled={!permissions.canAccessAdmin}
              onChange={(value) => setWorkspaceId(value)}
            />
            <Button
              size="small"
              theme="light"
              onClick={() => setLanguage(language === "zh-CN" ? "en-US" : "zh-CN")}
            >
              {t("common.language")}: {language}
            </Button>
            <Button size="small" onClick={() => void logout()}>
              {t("common.logout")}
            </Button>
          </Space>
        </Layout.Header>

        <Layout.Content className={isChat ? "console-content console-content-chat" : "console-content"}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
