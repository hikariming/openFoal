import { useMemo } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@douyinfe/semi-ui";
import { AppSidebar } from "./components/AppSidebar";
import { ChatView } from "./pages/ChatView";
import { SkillStoreView } from "./pages/SkillStoreView";
import { useAppStore } from "./store/app-store";

export function App() {
  return (
    <HashRouter>
      <DesktopLayout />
    </HashRouter>
  );
}

function DesktopLayout() {
  const { sessions, activeSessionId } = useAppStore();

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );

  return (
    <Layout className="desktop-shell">
      <AppSidebar />

      <Layout.Content className="desktop-main-wrap">
        <Routes>
          <Route path="/chat" element={<ChatView sessionId={activeSession.id} sessionTitle={activeSession.title} />} />
          <Route path="/skills" element={<SkillStoreView />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </Layout.Content>
    </Layout>
  );
}
