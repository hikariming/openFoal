import { Button, Card, Input, MarkdownRender, Select, Space, Typography } from "@douyinfe/semi-ui";
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
import { GatewayRpcError, getGatewayClient, type GatewayTranscriptItem, type RpcEvent } from "../lib/gateway-client";
import { getActiveLlmProfile, getSessionRuntimeMode, useAppStore, type LlmProfile } from "../store/app-store";

type ChatRole = "user" | "assistant" | "system" | "tool";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  toolMeta?: {
    toolCallId: string;
    kind: "call" | "result";
    toolName: string;
    detail: string;
    preview: string;
    inProgress?: boolean;
  };
};

type RunRenderState = {
  assistantMessageId?: string;
  toolMessageIds: Record<string, string>;
};

type ReplayRunState = {
  assistantMessageId?: string;
  toolMessageIds: Record<string, string>;
};

type AcceptedLlmInfo = {
  modelRef?: string;
  provider?: string;
  modelId?: string;
  baseUrl?: string;
};

const MAX_MESSAGES_PER_SESSION = 120;

export function ChatView({ sessionId, sessionTitle }: { sessionId: string; sessionTitle: string }) {
  const { t } = useTranslation();
  const runtimeMode = useAppStore((state) => getSessionRuntimeMode(state.sessions, state.activeSessionId));
  const llmConfig = useAppStore((state) => state.llmConfig);
  const setLlmConfig = useAppStore((state) => state.setLlmConfig);
  const upsertSession = useAppStore((state) => state.upsertSession);
  const activeLlmProfile = useMemo(() => getActiveLlmProfile(llmConfig), [llmConfig]);
  const llmProfileOptions = useMemo(
    () =>
      llmConfig.profiles.map((profile) => ({
        label: formatLlmProfileOptionLabel(profile),
        value: profile.id
      })),
    [llmConfig.profiles]
  );
  const gatewayClient = useMemo(() => getGatewayClient(), []);
  const historyCache = useRef<Record<string, ChatMessage[]>>({});
  const acceptedLlmCache = useRef<Record<string, AcceptedLlmInfo | undefined>>({});
  const runRenderRef = useRef<RunRenderState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [acceptedLlm, setAcceptedLlm] = useState<AcceptedLlmInfo | undefined>(undefined);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const requestedLlm = useMemo(() => buildRequestedLlm(activeLlmProfile), [activeLlmProfile]);

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
    runRenderRef.current = null;
    setRuntimeError("");
    setMessages(historyCache.current[sessionId] ?? []);
    setAcceptedLlm(acceptedLlmCache.current[sessionId]);
    let cancelled = false;
    void (async () => {
      try {
        const transcript = await gatewayClient.getSessionHistory({
          sessionId,
          limit: 200
        });
        if (cancelled) {
          return;
        }
        const rebuilt = buildMessagesFromTranscript(transcript);
        historyCache.current[sessionId] = rebuilt.messages;
        acceptedLlmCache.current[sessionId] = rebuilt.latestAcceptedLlm;
        setMessages(rebuilt.messages);
        setAcceptedLlm(rebuilt.latestAcceptedLlm);
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayClient, sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await gatewayClient.ensureConnected();
      } catch (error) {
        if (!cancelled) {
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

  const updateMessage = (messageId: string, updater: (message: ChatMessage) => ChatMessage) => {
    applyMessages((prev) => prev.map((message) => (message.id === messageId ? updater(message) : message)));
  };

  const getRunRenderState = (): RunRenderState => {
    if (!runRenderRef.current) {
      runRenderRef.current = {
        toolMessageIds: {}
      };
    }
    return runRenderRef.current;
  };

  const ensureAssistantMessage = (initialText: string): string => {
    const state = getRunRenderState();
    if (state.assistantMessageId) {
      return state.assistantMessageId;
    }
    const id = createMessageId();
    pushMessage({
      id,
      role: "assistant",
      text: initialText
    });
    state.assistantMessageId = id;
    return id;
  };

  const ensureToolMessage = (kind: "call" | "result", toolCallId: string, toolName: string): string => {
    const state = getRunRenderState();
    const key = `${kind}:${toolCallId}`;
    const existing = state.toolMessageIds[key];
    if (existing) {
      return existing;
    }
    const id = createMessageId();
    pushMessage({
      id,
      role: "tool",
      text: "",
      toolMeta: {
        toolCallId,
        kind,
        toolName,
        detail: "",
        preview: "(streaming...)",
        inProgress: true
      }
    });
    state.toolMessageIds[key] = id;
    return id;
  };

  const appendToolDetail = (
    kind: "call" | "result",
    toolCallId: string,
    toolName: string,
    delta: string,
    inProgress: boolean
  ): void => {
    const id = ensureToolMessage(kind, toolCallId, toolName);
    updateMessage(id, (message) => {
      const current = message.toolMeta;
      if (!current) {
        return message;
      }
      const nextDetail = `${current.detail}${delta}`;
      return {
        ...message,
        toolMeta: {
          ...current,
          toolName,
          detail: nextDetail,
          preview: summarizeForPreview(nextDetail),
          inProgress
        }
      };
    });
  };

  const setToolDetail = (
    kind: "call" | "result",
    toolCallId: string,
    toolName: string,
    detail: string,
    inProgress: boolean
  ): void => {
    const id = ensureToolMessage(kind, toolCallId, toolName);
    updateMessage(id, (message) => {
      const current = message.toolMeta;
      if (!current) {
        return message;
      }
      return {
        ...message,
        toolMeta: {
          ...current,
          toolName,
          detail,
          preview: summarizeForPreview(detail),
          inProgress
        }
      };
    });
  };

  const applyRunEvent = (event: RpcEvent): void => {
    if (event.event === "agent.accepted") {
      const resolved = readAcceptedLlm(event.payload);
      if (resolved) {
        acceptedLlmCache.current[sessionId] = resolved;
        setAcceptedLlm(resolved);
      }
      return;
    }

    if (event.event === "agent.delta") {
      const delta = readDeltaPayload(event.payload);
      if (delta.length === 0) {
        return;
      }
      const messageId = ensureAssistantMessage("");
      updateMessage(messageId, (message) => ({
        ...message,
        text: `${message.text}${delta}`
      }));
      return;
    }

    if (event.event === "agent.completed") {
      const output = asString(event.payload.output) ?? "";
      if (output.trim().length === 0) {
        return;
      }
      const messageId = ensureAssistantMessage(output);
      updateMessage(messageId, (message) => ({
        ...message,
        text: output
      }));
      return;
    }

    if (event.event === "agent.tool_call_start") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const toolCallId = asString(event.payload.toolCallId) ?? `call_${toolName}`;
      ensureToolMessage("call", toolCallId, toolName);
      return;
    }

    if (event.event === "agent.tool_call_delta") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const toolCallId = asString(event.payload.toolCallId) ?? `call_${toolName}`;
      const delta = asString(event.payload.delta) ?? "";
      appendToolDetail("call", toolCallId, toolName, delta, true);
      return;
    }

    if (event.event === "agent.tool_call") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const toolCallId = asString(event.payload.toolCallId) ?? `call_${toolName}`;
      setToolDetail("call", toolCallId, toolName, formatToolDetail(event.payload.args), false);
      return;
    }

    if (event.event === "agent.tool_result_start") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const toolCallId = asString(event.payload.toolCallId) ?? `result_${toolName}`;
      ensureToolMessage("result", toolCallId, toolName);
      return;
    }

    if (event.event === "agent.tool_result_delta") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const toolCallId = asString(event.payload.toolCallId) ?? `result_${toolName}`;
      const delta = asString(event.payload.delta) ?? "";
      appendToolDetail("result", toolCallId, toolName, delta, true);
      return;
    }

    if (event.event === "agent.tool_result") {
      const toolName = asString(event.payload.toolName) ?? "tool";
      const toolCallId = asString(event.payload.toolCallId) ?? `result_${toolName}`;
      setToolDetail("result", toolCallId, toolName, formatToolDetail(event.payload.output), false);
      return;
    }

    if (event.event === "agent.failed") {
      const code = asString(event.payload.code) ?? "INTERNAL_ERROR";
      const message = asString(event.payload.message) ?? "Unknown error";
      const mapped = mapGatewayFailure(code, message);
      setRuntimeError(mapped.inline);
      pushMessage({
        id: createMessageId(),
        role: "system",
        text: mapped.detail
      });
      return;
    }
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
    runRenderRef.current = {
      toolMessageIds: {}
    };
    try {
      await gatewayClient.runAgentStream(
        {
          sessionId,
          input: userText,
          runtimeMode,
          ...(requestedLlm ? { llm: requestedLlm } : {})
        },
        {
          onEvent: (event) => {
            applyRunEvent(event);
          }
        }
      );
      const refreshedSession = await gatewayClient.getSession(sessionId);
      if (refreshedSession) {
        upsertSession({
          id: refreshedSession.id,
          sessionKey: refreshedSession.sessionKey,
          title: refreshedSession.title,
          preview: refreshedSession.preview,
          runtimeMode: refreshedSession.runtimeMode,
          syncState: refreshedSession.syncState as "local_only" | "syncing" | "synced" | "conflict",
          contextUsage: refreshedSession.contextUsage,
          compactionCount: refreshedSession.compactionCount,
          memoryFlushState: refreshedSession.memoryFlushState,
          ...(refreshedSession.memoryFlushAt ? { memoryFlushAt: refreshedSession.memoryFlushAt } : {}),
          updatedAt: refreshedSession.updatedAt
        });
      }
    } catch (error) {
      const mapped = mapRuntimeRequestError(error);
      setRuntimeError(mapped.inline);
      pushMessage({
        id: createMessageId(),
        role: "system",
        text: mapped.detail
      });
    } finally {
      runRenderRef.current = null;
      setBusy(false);
    }
  };

  const runtimeModelLabel = formatAcceptedLlmLabel(acceptedLlm, {
    ...(activeLlmProfile?.modelRef ? { modelRef: activeLlmProfile.modelRef } : {}),
    ...(activeLlmProfile?.provider ? { provider: activeLlmProfile.provider } : {}),
    ...(activeLlmProfile?.modelId ? { modelId: activeLlmProfile.modelId } : {})
  });

  return (
    <Card className="workspace-panel workspace-panel-chat" bodyStyle={{ padding: 0 }}>
      <div className="workspace-header chat-top-header">
        <Space spacing={8} align="center">
          <Typography.Title heading={3} className="workspace-title">
            {sessionTitle}
          </Typography.Title>
          <Typography.Text type="tertiary" className="chat-runtime-model-pill">
            {t("chat.runtimeModelUsed")}: {runtimeModelLabel}
          </Typography.Text>
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
                  {message.toolMeta ? (
                    <div className="tool-message-card">
                      <Typography.Text className="tool-message-head">
                        {message.toolMeta.kind === "call" ? t("chat.toolCall") : t("chat.toolResult")}{" "}
                        <span className="tool-message-name">{message.toolMeta.toolName}</span>
                        {message.toolMeta.inProgress ? <span className="tool-message-live"> · streaming</span> : null}
                      </Typography.Text>
                      <Typography.Text className="tool-message-preview">{message.toolMeta.preview}</Typography.Text>
                      <details className="tool-message-details">
                        <summary>{t("chat.toolViewFull")}</summary>
                        <pre>{message.toolMeta.detail}</pre>
                      </details>
                    </div>
                  ) : (
                    <div className="message-text">
                      <MarkdownRender raw={message.text} format="md" />
                    </div>
                  )}
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
                {llmProfileOptions.length > 0 ? (
                  <div className="composer-model-select-wrap">
                    <Typography.Text type="tertiary" className="composer-model-select-label">
                      {t("chat.runtimeModelUsed")}
                    </Typography.Text>
                    <Select
                      className="composer-model-select"
                      size="small"
                      value={llmConfig.activeProfileId}
                      optionList={llmProfileOptions}
                      disabled={busy}
                      onChange={(value: unknown) => {
                        if (typeof value !== "string") {
                          return;
                        }
                        setLlmConfig({
                          activeProfileId: value
                        });
                      }}
                    />
                  </div>
                ) : (
                  <Typography.Text type="tertiary" className="composer-model-select-empty">
                    {t("chat.runtimeModelAuto")}
                  </Typography.Text>
                )}
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

function formatLlmProfileOptionLabel(profile: LlmProfile): string {
  const name = profile.name.trim();
  if (name) {
    return name;
  }
  const modelRef = profile.modelRef.trim();
  if (modelRef) {
    return modelRef;
  }
  const provider = profile.provider.trim();
  const modelId = profile.modelId.trim();
  if (provider && modelId) {
    return `${provider} · ${modelId}`;
  }
  return provider || modelId || profile.id;
}

function buildRequestedLlm(
  profile: LlmProfile | undefined
):
  | {
      modelRef?: string;
      provider?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  | undefined {
  if (!profile) {
    return undefined;
  }
  const modelRef = profile.modelRef.trim();
  const provider = profile.provider.trim();
  const modelId = profile.modelId.trim();
  const apiKey = profile.apiKey.trim();
  const baseUrl = profile.baseUrl.trim();
  if (!modelRef && !provider && !modelId && !apiKey && !baseUrl) {
    return undefined;
  }
  return {
    ...(modelRef ? { modelRef } : {}),
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
}

function buildMessagesFromTranscript(items: GatewayTranscriptItem[]): {
  messages: ChatMessage[];
  latestAcceptedLlm?: AcceptedLlmInfo;
} {
  const messages: ChatMessage[] = [];
  const runState = new Map<string, ReplayRunState>();
  let latestAcceptedLlm: AcceptedLlmInfo | undefined;

  const getState = (runId: string): ReplayRunState => {
    const existing = runState.get(runId);
    if (existing) {
      return existing;
    }
    const created: ReplayRunState = {
      toolMessageIds: {}
    };
    runState.set(runId, created);
    return created;
  };

  const pushMessage = (message: ChatMessage): void => {
    messages.push(message);
  };

  const updateMessage = (messageId: string, updater: (message: ChatMessage) => ChatMessage): void => {
    const index = messages.findIndex((item) => item.id === messageId);
    if (index === -1) {
      return;
    }
    messages[index] = updater(messages[index]);
  };

  const ensureAssistantMessage = (runId: string, initialText: string): string => {
    const state = getState(runId);
    if (state.assistantMessageId) {
      return state.assistantMessageId;
    }
    const id = createMessageId();
    pushMessage({
      id,
      role: "assistant",
      text: initialText
    });
    state.assistantMessageId = id;
    return id;
  };

  const ensureToolMessage = (runId: string, kind: "call" | "result", toolCallId: string, toolName: string): string => {
    const state = getState(runId);
    const key = `${kind}:${toolCallId}`;
    const existing = state.toolMessageIds[key];
    if (existing) {
      return existing;
    }
    const id = createMessageId();
    pushMessage({
      id,
      role: "tool",
      text: "",
      toolMeta: {
        toolCallId,
        kind,
        toolName,
        detail: "",
        preview: "(streaming...)",
        inProgress: false
      }
    });
    state.toolMessageIds[key] = id;
    return id;
  };

  for (const item of items) {
    const runId = asString(item.payload.runId) ?? item.runId ?? "run_unknown";
    if (item.event === "user.input") {
      const inputText = asString(item.payload.input) ?? "";
      if (inputText.trim().length > 0) {
        pushMessage({
          id: createMessageId(),
          role: "user",
          text: inputText
        });
      }
      continue;
    }

    if (item.event === "agent.accepted") {
      const accepted = readAcceptedLlm(item.payload);
      if (accepted) {
        latestAcceptedLlm = accepted;
      }
      continue;
    }

    if (item.event === "agent.delta") {
      const delta = readDeltaPayload(item.payload);
      if (!delta) {
        continue;
      }
      const messageId = ensureAssistantMessage(runId, "");
      updateMessage(messageId, (message) => ({
        ...message,
        text: `${message.text}${delta}`
      }));
      continue;
    }

    if (item.event === "agent.completed") {
      const output = asString(item.payload.output) ?? "";
      if (!output.trim()) {
        continue;
      }
      const messageId = ensureAssistantMessage(runId, output);
      updateMessage(messageId, (message) => ({
        ...message,
        text: output
      }));
      continue;
    }

    if (item.event === "agent.failed") {
      const code = asString(item.payload.code) ?? "INTERNAL_ERROR";
      const message = asString(item.payload.message) ?? "Unknown error";
      const mapped = mapGatewayFailure(code, message);
      pushMessage({
        id: createMessageId(),
        role: "system",
        text: mapped.detail
      });
      continue;
    }

    if (item.event === "agent.tool_call_start" || item.event === "agent.tool_call_delta" || item.event === "agent.tool_call") {
      const toolName = asString(item.payload.toolName) ?? "tool";
      const toolCallId = asString(item.payload.toolCallId) ?? `call_${toolName}`;
      const id = ensureToolMessage(runId, "call", toolCallId, toolName);
      updateMessage(id, (message) => {
        const current = message.toolMeta;
        if (!current) {
          return message;
        }
        const detail =
          item.event === "agent.tool_call_delta"
            ? `${current.detail}${asString(item.payload.delta) ?? ""}`
            : item.event === "agent.tool_call"
              ? formatToolDetail(item.payload.args)
              : current.detail;
        return {
          ...message,
          toolMeta: {
            ...current,
            toolName,
            detail,
            preview: summarizeForPreview(detail),
            inProgress: item.event === "agent.tool_call_start" || item.event === "agent.tool_call_delta"
          }
        };
      });
      continue;
    }

    if (
      item.event === "agent.tool_result_start" ||
      item.event === "agent.tool_result_delta" ||
      item.event === "agent.tool_result"
    ) {
      const toolName = asString(item.payload.toolName) ?? "tool";
      const toolCallId = asString(item.payload.toolCallId) ?? `result_${toolName}`;
      const id = ensureToolMessage(runId, "result", toolCallId, toolName);
      updateMessage(id, (message) => {
        const current = message.toolMeta;
        if (!current) {
          return message;
        }
        const detail =
          item.event === "agent.tool_result_delta"
            ? `${current.detail}${asString(item.payload.delta) ?? ""}`
            : item.event === "agent.tool_result"
              ? formatToolDetail(item.payload.output)
              : current.detail;
        return {
          ...message,
          toolMeta: {
            ...current,
            toolName,
            detail,
            preview: summarizeForPreview(detail),
            inProgress: item.event === "agent.tool_result_start" || item.event === "agent.tool_result_delta"
          }
        };
      });
      continue;
    }

  }

  return {
    messages: messages.slice(-MAX_MESSAGES_PER_SESSION),
    ...(latestAcceptedLlm ? { latestAcceptedLlm } : {})
  };
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

function readDeltaPayload(payload: Record<string, unknown>): string {
  return asString(payload.delta) ?? asString(payload.text) ?? "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readAcceptedLlm(payload: Record<string, unknown>): AcceptedLlmInfo | undefined {
  const nested = asRecord(payload.llm);
  const source = nested ?? payload;
  const modelRef = asString(source.modelRef)?.trim();
  const provider = asString(source.provider)?.trim();
  const modelId = asString(source.modelId)?.trim();
  const baseUrl = asString(source.baseUrl)?.trim();
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

function formatAcceptedLlmLabel(
  accepted: AcceptedLlmInfo | undefined,
  fallback: { modelRef?: string; provider?: string; modelId?: string }
): string {
  const modelRef = accepted?.modelRef?.trim();
  if (modelRef) {
    return modelRef;
  }
  const provider = accepted?.provider?.trim();
  const modelId = accepted?.modelId?.trim();
  if (provider && modelId) {
    return `${provider} · ${modelId}`;
  }
  if (modelId) {
    return modelId;
  }
  if (provider) {
    return provider;
  }

  const fallbackRef = fallback.modelRef?.trim() ?? "";
  if (fallbackRef) {
    return fallbackRef;
  }
  const fallbackProvider = fallback.provider?.trim() ?? "";
  const fallbackModelId = fallback.modelId?.trim() ?? "";
  if (fallbackProvider && fallbackModelId) {
    return `${fallbackProvider} · ${fallbackModelId}`;
  }
  return fallbackProvider || fallbackModelId || "-";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function formatToolDetail(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return safeJson(value);
}

function summarizeForPreview(detail: string): string {
  const compact = detail.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(empty)";
  }
  if (compact.length <= 180) {
    return compact;
  }
  return `${compact.slice(0, 180)}...`;
}

function createMessageId(): string {
  return `m_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function mapRuntimeRequestError(error: unknown): { inline: string; detail: string } {
  if (error instanceof GatewayRpcError) {
    return mapGatewayFailure(error.code, error.message);
  }
  if (error instanceof Error) {
    return mapGatewayFailure("INTERNAL_ERROR", error.message);
  }
  return mapGatewayFailure("INTERNAL_ERROR", String(error));
}

function mapGatewayFailure(code: string, message: string): { inline: string; detail: string } {
  const detailText = `${code} ${message}`.toLowerCase();
  const isModelUnavailable =
    code === "MODEL_UNAVAILABLE" ||
    detailText.includes("no api key for provider") ||
    detailText.includes("no model configured");

  if (isModelUnavailable) {
    return {
      inline: "未配置模型/API Key",
      detail: [
        "当前未配置可用模型，无法生成回答。",
        "",
        "请按以下步骤配置：",
        "1. 点击左下角头像，打开 Settings。",
        "2. 进入 Runtime Model。",
        "3. 选择 Provider / Model，并填写 API Key。",
        "4. 点击保存后重新发送消息。"
      ].join("\n")
    };
  }

  return {
    inline: `[${code}] ${message}`,
    detail: `[${code}] ${message}`
  };
}
