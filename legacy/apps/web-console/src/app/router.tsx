import { Card, Layout, Typography } from "@douyinfe/semi-ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ConsoleLayout } from "./layout/ConsoleLayout";
import { UserWorkbenchLayout } from "./layout/UserWorkbenchLayout";
import { resolveConsolePermissions } from "./permissions";
import { useAuthStore } from "../stores/auth-store";
import { ChatPage } from "../pages/ChatPage";
import { SkillStorePage } from "../pages/SkillStorePage";
import { DashboardPage } from "../pages/DashboardPage";
import { SessionsPage } from "../pages/SessionsPage";
import { UsersPage } from "../pages/UsersPage";
import { PoliciesPage } from "../pages/PoliciesPage";
import { SecretsPage } from "../pages/SecretsPage";
import { AuditPage } from "../pages/AuditPage";
import { AgentsPage } from "../pages/AgentsPage";
import { TargetsPage } from "../pages/TargetsPage";
import { BudgetPage } from "../pages/BudgetPage";
import { ContextPage } from "../pages/ContextPage";
import { InfraPage } from "../pages/InfraPage";
import { LoginPage } from "../pages/LoginPage";
import { SkillSyncPage } from "../pages/SkillSyncPage";

export function AppRouter(): JSX.Element {
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginGate />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<RoleHomeRedirect />} />
          <Route element={<UserWorkbenchLayout />}>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/skills" element={<SkillStorePage />} />
          </Route>

          <Route element={<ConsoleLayout />}>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin/dashboard" element={<DashboardPage />} />
              <Route path="/admin/sessions" element={<SessionsPage />} />
              <Route path="/admin/users" element={<UsersPage />} />
              <Route path="/admin/policies" element={<PoliciesPage />} />
              <Route path="/admin/secrets" element={<SecretsPage />} />
              <Route path="/admin/audit" element={<AuditPage />} />
              <Route path="/admin/agents" element={<AgentsPage />} />
              <Route path="/admin/targets" element={<TargetsPage />} />
              <Route path="/admin/budget" element={<BudgetPage />} />
              <Route path="/admin/context" element={<ContextPage />} />
              <Route path="/admin/skill-sync" element={<SkillSyncPage />} />
              <Route path="/admin/infra" element={<InfraPage />} />
            </Route>

            <Route path="/dashboard" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/sessions" element={<Navigate to="/admin/sessions" replace />} />
            <Route path="/users" element={<Navigate to="/admin/users" replace />} />
            <Route path="/policies" element={<Navigate to="/admin/policies" replace />} />
            <Route path="/secrets" element={<Navigate to="/admin/secrets" replace />} />
            <Route path="/audit" element={<Navigate to="/admin/audit" replace />} />
            <Route path="/agents" element={<Navigate to="/admin/agents" replace />} />
            <Route path="/targets" element={<Navigate to="/admin/targets" replace />} />
            <Route path="/budget" element={<Navigate to="/admin/budget" replace />} />
            <Route path="/context" element={<Navigate to="/admin/context" replace />} />
            <Route path="/skill-sync" element={<Navigate to="/admin/skill-sync" replace />} />
            <Route path="/infra" element={<Navigate to="/admin/infra" replace />} />
          </Route>
          <Route path="*" element={<RoleHomeRedirect />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function RequireAuth(): JSX.Element {
  const { t } = useTranslation();
  const checking = useAuthStore((state) => state.checking);
  const authenticated = useAuthStore((state) => state.authenticated);

  if (checking) {
    return (
      <Layout className="console-root">
        <Layout.Content className="console-content">
          <Card>
            <Typography.Text>{t("common.loading")}</Typography.Text>
          </Card>
        </Layout.Content>
      </Layout>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function LoginGate(): JSX.Element {
  const checking = useAuthStore((state) => state.checking);
  const authenticated = useAuthStore((state) => state.authenticated);

  if (!checking && authenticated) {
    return <RoleHomeRedirect />;
  }

  return <LoginPage />;
}

function RequireAdmin(): JSX.Element {
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  if (!permissions.canAccessAdmin) {
    return <Navigate to="/chat" replace />;
  }
  return <Outlet />;
}

function RoleHomeRedirect(): JSX.Element {
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  if (permissions.canAccessAdmin) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return <Navigate to="/chat" replace />;
}
