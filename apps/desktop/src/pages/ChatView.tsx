import { Button, Card, Input, Space, Typography } from "@douyinfe/semi-ui";
import {
  IconApps,
  IconArrowUp,
  IconArticle,
  IconCopy,
  IconImage,
  IconLikeHeart,
  IconLightningStroked,
  IconPlusCircle,
  IconPuzzle,
  IconSearch,
  IconShareStroked,
  IconUserGroup
} from "@douyinfe/semi-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getGatewayClient, type RpcEvent } from "../lib/gateway-client";
import { useAppStore } from "../store/app-store";

type ChatRole = "user" | "assistant" | "system" | "tool";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

const MAX_MESSAGES_PER_SESSION = 120;

export function ChatView({ sessionId, sessionTitle }: { sessionId: string; sessionTitle: string }) {
  const { t } = useTranslation();
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const llmConfig = useAppStore((state) => state.llmConfig);
  const gatewayClient = useMemo(() => getGatewayClient(), []);
  const historyCache = useRef<Record<string, ChatMessage[]>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [gatewayReady, setGatewayReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");

  const chatCards = [
    {
      title: t("chat.skillsTitle"),
      desc: t("chat.skillsDesc"),
      tone: "skills",
      icon: <IconPuzzle />
    },
    {
      title: t("chat.automationsTitle"),
      desc: t("chat.automationsDesc"),
      tone: "automations",
      icon: <IconLightningStroked />
    },
    {
      title: t("chat.teamsTitle"),
      desc: t("chat.teamsDesc"),
      tone: "teams",
      icon: <IconUserGroup />
    }
  ] as const;

  const quickActions = [
    { text: t("quickActions.joinMoltbook"), icon: <IconLikeHeart /> },
    { text: t("quickActions.createSkill"), icon: <IconPuzzle /> },
    { text: t("quickActions.nanoBanana"), icon: <IconImage /> },
    { text: t("quickActions.createSlides"), icon: <IconArticle /> },
    { text: t("quickActions.frontendDesign"), icon: <IconApps /> },
    { text: t("quickActions.copymailSkill"), icon: <IconCopy /> },
    { text: t("quickActions.researchSkills"), icon: <IconSearch /> }
  ] as const;

  useEffect(() => {
    setMessages(historyCache.current[sessionId] ?? []);
    setRuntimeError("");
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await gatewayClient.ensureConnected();
        if (!cancelled) {
          setGatewayReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setGatewayReady(false);
          setRuntimeError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayClient]);

  const applyMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev).slice(-MAX_MESSAGES_PER_SESSION);
      historyCache.current[sessionId] = next;
      return next;
    });
  };

  const pushMessage = (message: ChatMessage) => {
    applyMessages((prev) => [...prev, message]);
  };

  const handleSend = async (rawInput?: string): Promise<void> => {
    if (busy) {
      return;
    }
    const userText = (rawInput ?? inputValue).trim();
    if (!userText) {
      return;
    }

    if (!rawInput) {
      setInputValue("");
    }
    setRuntimeError("");
    pushMessage({
      id: createMessageId(),
      role: "user",
      text: userText
    });

    setBusy(true);
    try {
      await gatewayClient.ensureConnected();
      setGatewayReady(true);

      const result = await gatewayClient.runAgent({
        sessionId,
        input: userText,
        runtimeMode,
        llm: {
          ...(llmConfig.provider.trim() ? { provider: llmConfig.provider.trim() } : {}),
          ...(llmConfig.modelId.trim() ? { modelId: llmConfig.modelId.trim() } : {}),
          ...(llmConfig.apiKey.trim() ? { apiKey: llmConfig.apiKey.trim() } : {}),
          ...(llmConfig.baseUrl.trim() ? { baseUrl: llmConfig.baseUrl.trim() } : {})
        }
      });

      const rendered = renderAssistantMessages(result.events, t);
      if (rendered.length === 0) {
        pushMessage({
          id: createMessageId(),
          role: "assistant",
          text: "(empty output)"
        });
      } else {
        applyMessages((prev) => [...prev, ...rendered]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGatewayReady(false);
      setRuntimeError(message);
      pushMessage({
        id: createMessageId(),
        role: "system",
        text: message
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="workspace-panel" bodyStyle={{ padding: 0 }}>
      <div className="workspace-header chat-top-header">
        <Space>
          <Typography.Title heading={3} className="workspace-title">
            {sessionTitle}
          </Typography.Title>
        </Space>
        <Button icon={<IconShareStroked />} theme="light" type="primary">
          {t("chat.share")}
        </Button>
      </div>

      <div className="tab-strip">
        <button type="button" className="strip-tab active">
          <IconLightningStroked /> {t("chat.session")}
        </button>
        <button type="button" className="strip-tab add-tab">
          +
        </button>
      </div>

      <div className="workspace-body">
        <div className="gateway-status-bar">
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
        </div>

        <div className="chat-feed">
          {messages.length === 0 ? (
            <>
              <div className="feature-grid">
                {chatCards.map((item) => (
                  <Card key={item.title} className={`feature-card ${item.tone}`} bodyStyle={{ padding: 0 }}>
                    <div className="feature-head">
                      <Space>
                        {item.icon}
                        <Typography.Title heading={5}>{item.title}</Typography.Title>
                      </Space>
                      <Typography.Text type="tertiary">{item.desc}</Typography.Text>
                    </div>
                    <div className="feature-art" />
                  </Card>
                ))}
              </div>
              <Typography.Text type="tertiary">{t("chat.emptyState")}</Typography.Text>
            </>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <div key={message.id} className={`message-row ${message.role}`}>
                  <Typography.Text className="message-role">{renderRole(message.role, t)}</Typography.Text>
                  <Typography.Text className="message-text">{message.text}</Typography.Text>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="quick-start">
          <Typography.Title heading={4}>{t("chat.quickStartTitle")}</Typography.Title>
          <div className="chips">
            {quickActions.map((action) => (
              <Button
                key={action.text}
                icon={action.icon}
                theme="light"
                type="tertiary"
                className="action-chip"
                disabled={busy}
                onClick={() => {
                  void handleSend(action.text);
                }}
              >
                {action.text}
              </Button>
            ))}
          </div>
        </div>

        <div className="composer-wrap">
          <Input
            className="composer-input"
            value={inputValue}
            onChange={(value) => setInputValue(value)}
            onEnterPress={() => {
              void handleSend();
            }}
            disabled={busy}
            placeholder={t("chat.askPlaceholder")}
            suffix={
              <div className="composer-actions">
                <Button
                  icon={<IconArrowUp />}
                  theme="solid"
                  type="primary"
                  circle
                  className="composer-send-btn"
                  loading={busy}
                  onClick={() => {
                    void handleSend();
                  }}
                />
              </div>
            }
          />
          <div className="composer-footer">
            <div className="composer-left-actions">
              <Button theme="borderless" icon={<IconPlusCircle />}>
                {t("chat.add")}
              </Button>
              <Button theme="borderless" icon={<IconPuzzle />}>
                {t("chat.skills")}
              </Button>
            </div>
            <Typography.Text type="secondary">
              {busy ? t("chat.sending") : t("chat.ready")}
              {runtimeError ? ` · ${runtimeError}` : ""}
            </Typography.Text>
          </div>
        </div>
      </div>
    </Card>
  );
}

function renderAssistantMessages(events: RpcEvent[], t: (key: string) => string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let deltaText = "";
  let completedOutput = "";
  for (const event of events) {
    if (event.event === "agent.delta") {
      deltaText += asString(event.payload.delta) ?? "";
      continue;
    }
    if (event.event === "agent.completed") {
      completedOutput = asString(event.payload.output) ?? completedOutput;
      continue;
    }
    if (event.event === "agent.tool_call") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const argsText = safeJson(event.payload.args);
      messages.push({
        id: createMessageId(),
        role: "tool",
        text: `${t("chat.toolCall")} ${toolName} ${argsText}`
      });
      continue;
    }
    if (event.event === "agent.tool_result") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const output = asString(event.payload.output) ?? "";
      messages.push({
        id: createMessageId(),
        role: "tool",
        text: `${t("chat.toolResult")} ${toolName} ${output}`
      });
      continue;
    }
    if (event.event === "agent.failed") {
      const code = asString(event.payload.code) ?? "INTERNAL_ERROR";
      const message = asString(event.payload.message) ?? "Unknown error";
      messages.push({
        id: createMessageId(),
        role: "system",
        text: `[${code}] ${message}`
      });
    }
  }

  const finalOutput = completedOutput || deltaText;
  if (finalOutput.trim().length > 0) {
    messages.push({
      id: createMessageId(),
      role: "assistant",
      text: finalOutput.trim()
    });
  }
  return messages;
}

function renderRole(role: ChatRole, t: (key: string) => string): string {
  if (role === "user") {
    return t("chat.roleUser");
  }
  if (role === "assistant") {
    return t("chat.roleAssistant");
  }
  if (role === "tool") {
    return t("chat.roleTool");
  }
  return t("chat.roleSystem");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function createMessageId(): string {
  return `m_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}
