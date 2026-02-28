import { Button, Layout, Space, Tag, Typography } from "@douyinfe/semi-ui";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useNavigate } from "react-router-dom";
import { AppSidebar } from "@openfoal/personal-app/workbench";
import i18n from "../../i18n";
import { resolveConsolePermissions } from "../permissions";
import { getGatewayClient } from "../../lib/gateway-client";
import { useAuthStore } from "../../stores/auth-store";
import { useScopeStore } from "../../stores/scope-store";
import { useUiStore } from "../../stores/ui-store";

type RuntimeConfig = {
  gatewayUseWebSocket?: boolean;
  gatewayAccessToken?: string;
  tenantId?: string;
  workspaceId?: string;
  userId?: string;
  agentId?: string;
  actor?: string;
  [key: string]: unknown;
};

export function UserWorkbenchLayout(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const principal = useAuthStore((state) => state.principal);
  const logout = useAuthStore((state) => state.logout);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const permissions = resolveConsolePermissions(principal);
  const gatewayClient = useMemo(() => getGatewayClient(), []);

  if (typeof window !== "undefined") {
    const runtimeWindow = window as { __OPENFOAL_CONFIG__?: RuntimeConfig };
    const current = runtimeWindow.__OPENFOAL_CONFIG__ ?? {};
    const accessToken = gatewayClient.getAccessToken();
    runtimeWindow.__OPENFOAL_CONFIG__ = {
      ...current,
      gatewayUseWebSocket: false,
      gatewayAccessToken: accessToken,
      tenantId,
      workspaceId,
      userId: principal?.userId,
      agentId: "a_default",
      actor: principal?.displayName ?? principal?.subject ?? "enterprise-user"
    };
  }

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  return (
    <Layout className="enterprise-workbench-root">
      <Layout.Header className="enterprise-workbench-toolbar">
        <Space>
          <Typography.Title heading={6} style={{ margin: 0 }}>
            OpenFoal
          </Typography.Title>
        </Space>
        <Space>
          <Tag>{tenantId}</Tag>
          <Tag>{workspaceId}</Tag>
          <Button size="small" theme="light" onClick={() => setLanguage(language === "zh-CN" ? "en-US" : "zh-CN")}>
            {t("common.language")}: {language}
          </Button>
          {permissions.canAccessAdmin ? (
            <Button size="small" onClick={() => navigate("/admin/dashboard")}>
              {t("chat.backToAdmin")}
            </Button>
          ) : null}
          <Button size="small" onClick={() => void logout()}>
            {t("common.logout")}
          </Button>
        </Space>
      </Layout.Header>

      <Layout className="desktop-shell enterprise-workbench-shell">
        <AppSidebar
          defaultRuntimeMode="cloud"
          accountName={principal?.displayName ?? principal?.subject ?? "OpenFoal User"}
          accountEmail={principal?.subject}
          onSignOut={() => {
            void logout();
          }}
        />
        <Layout.Content className="desktop-main-wrap enterprise-workbench-main">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
