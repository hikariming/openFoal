import { Card, Space, Typography } from "@douyinfe/semi-ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChatView, getActiveSession, useAppStore } from "@openfoal/personal-app/workbench";

export function ChatPage(): JSX.Element {
  const { t } = useTranslation();
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activeSession = useMemo(() => getActiveSession(sessions, activeSessionId), [activeSessionId, sessions]);

  if (!activeSession) {
    return (
      <Card className="workspace-panel workspace-panel-chat">
        <Space vertical align="start" style={{ width: "100%" }}>
          <Typography.Title heading={4}>{t("chat.noActiveSession")}</Typography.Title>
          <Typography.Text type="tertiary">{t("common.loading")}</Typography.Text>
        </Space>
      </Card>
    );
  }

  return <ChatView sessionId={activeSession.id} sessionTitle={activeSession.title} />;
}
