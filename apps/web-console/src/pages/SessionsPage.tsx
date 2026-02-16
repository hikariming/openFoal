import { Banner, Button, Card, Col, Input, List, Row, Space, Tag, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { getGatewayClient, type GatewaySession, type GatewayTranscriptItem, type RuntimeMode } from "../lib/gateway-client";
import { useScopeStore } from "../stores/scope-store";
import { formatDate, toErrorMessage } from "./shared";

export function SessionsPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [selectedSession, setSelectedSession] = useState<GatewaySession | null>(null);
  const [history, setHistory] = useState<GatewayTranscriptItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    runtimeMode: "local" as RuntimeMode
  });

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const items = await client.listSessions({ tenantId, workspaceId });
      setSessions(items);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, tenantId, workspaceId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const createSession = useCallback(async () => {
    setCreating(true);
    setError(undefined);
    try {
      await client.createSession({
        title: createForm.title.trim() || undefined,
        runtimeMode: createForm.runtimeMode,
        tenantId,
        workspaceId
      });
      setCreateForm({ title: "", runtimeMode: "local" });
      await loadSessions();
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setCreating(false);
    }
  }, [client, createForm.runtimeMode, createForm.title, loadSessions, tenantId, workspaceId]);

  const viewSession = useCallback(
    async (sessionId: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const [session, transcript] = await Promise.all([
          client.getSession({ sessionId, tenantId, workspaceId }),
          client.getSessionHistory({ sessionId, tenantId, workspaceId, limit: 50 })
        ]);
        setSelectedSession(session);
        setHistory(transcript);
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setLoading(false);
      }
    },
    [client, tenantId, workspaceId]
  );

  const setRuntimeMode = useCallback(
    async (sessionId: string, runtimeMode: RuntimeMode) => {
      setLoading(true);
      setError(undefined);
      try {
        await client.setRuntimeMode({ sessionId, runtimeMode, tenantId, workspaceId });
        await loadSessions();
        if (selectedSession?.id === sessionId) {
          const updated = await client.getSession({ sessionId, tenantId, workspaceId });
          setSelectedSession(updated);
        }
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setLoading(false);
      }
    },
    [client, loadSessions, selectedSession?.id, tenantId, workspaceId]
  );

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("sessions.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void loadSessions()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}

      <Card title={t("sessions.createTitle")} style={{ width: "100%" }}>
        <Space wrap>
          <Input
            style={{ width: 220 }}
            value={createForm.title}
            placeholder={t("sessions.sessionTitle")}
            onChange={(value) => setCreateForm((prev) => ({ ...prev, title: value }))}
          />
          <Button
            theme={createForm.runtimeMode === "local" ? "solid" : "light"}
            onClick={() => setCreateForm((prev) => ({ ...prev, runtimeMode: "local" }))}
          >
            {t("sessions.local")}
          </Button>
          <Button
            theme={createForm.runtimeMode === "cloud" ? "solid" : "light"}
            onClick={() => setCreateForm((prev) => ({ ...prev, runtimeMode: "cloud" }))}
          >
            {t("sessions.cloud")}
          </Button>
          <Button theme="solid" loading={creating} onClick={() => void createSession()}>
            {t("common.create")}
          </Button>
        </Space>
      </Card>

      <Row gutter={[12, 12]} style={{ width: "100%" }}>
        <Col span={12}>
          <Card title={t("sessions.title")}>
            {sessions.length === 0 ? (
              <Typography.Text type="tertiary">{t("common.noData")}</Typography.Text>
            ) : (
              <List
                dataSource={sessions}
                renderItem={(item) => (
                  <List.Item
                    main={
                      <div>
                        <Space spacing={6}>
                          <Tag>{item.runtimeMode}</Tag>
                          <Typography.Text>{item.title}</Typography.Text>
                        </Space>
                        <br />
                        <Typography.Text type="tertiary" size="small">
                          {item.id} · {formatDate(item.updatedAt)}
                        </Typography.Text>
                        <br />
                        <Space spacing={6}>
                          <Button size="small" onClick={() => void viewSession(item.id)}>
                            {t("sessions.view")}
                          </Button>
                          <Button size="small" onClick={() => void setRuntimeMode(item.id, "local")}>
                            {t("sessions.local")}
                          </Button>
                          <Button size="small" onClick={() => void setRuntimeMode(item.id, "cloud")}>
                            {t("sessions.cloud")}
                          </Button>
                        </Space>
                      </div>
                    }
                  />
                )}
              />
            )}
          </Card>
        </Col>

        <Col span={12}>
          <Card title={t("sessions.history")}>
            {selectedSession ? (
              <>
                <Typography.Text>
                  {selectedSession.title} ({selectedSession.id})
                </Typography.Text>
                <DividerGap />
                {history.length === 0 ? (
                  <Typography.Text type="tertiary">{t("common.noData")}</Typography.Text>
                ) : (
                  <List
                    dataSource={history}
                    renderItem={(item) => (
                      <List.Item
                        main={
                          <div>
                            <Typography.Text>{item.role}</Typography.Text>
                            <br />
                            <Typography.Text type="tertiary" size="small">
                              {item.text}
                            </Typography.Text>
                          </div>
                        }
                      />
                    )}
                  />
                )}
              </>
            ) : (
              <Typography.Text type="tertiary">{t("common.noData")}</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function DividerGap(): JSX.Element {
  return <div style={{ height: 10 }} />;
}
