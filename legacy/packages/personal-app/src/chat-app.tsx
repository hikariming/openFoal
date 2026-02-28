import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GatewayClient,
  GatewayRpcError,
  type GatewaySession,
  type GatewayTranscriptItem,
  type PersonalGatewayClientOptions,
  type RpcEvent,
  type RuntimeMode,
  type RunAgentParams
} from "./gateway-client";
import "./chat-app.css";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export type ChatLabels = {
  brand: string;
  newSession: string;
  emptySessionPreview: string;
  noSessionTitle: string;
  noActiveSession: string;
  refresh: string;
  refreshing: string;
  noMessages: string;
  composerPlaceholder: string;
  send: string;
  running: string;
  roleUser: string;
  roleAssistant: string;
  roleSystem: string;
  home: string;
};

const DEFAULT_CHAT_LABELS: ChatLabels = {
  brand: "OpenFoal Personal",
  newSession: "+ New Session",
  emptySessionPreview: "empty",
  noSessionTitle: "No Session",
  noActiveSession: "No active session",
  refresh: "Refresh",
  refreshing: "Refreshing...",
  noMessages: "No messages yet.",
  composerPlaceholder: "Type a message...",
  send: "Send",
  running: "Running...",
  roleUser: "user",
  roleAssistant: "assistant",
  roleSystem: "system",
  home: "Back"
};

export interface PersonalChatAppProps {
  shell?: "standalone" | "embedded";
  fixedSessionId?: string;
  fixedSessionTitle?: string;
  runtimeMode?: RuntimeMode;
  llm?: RunAgentParams["llm"];
  clientOptions?: PersonalGatewayClientOptions;
  labels?: Partial<ChatLabels>;
  homePath?: string;
  showHomeButton?: boolean;
}

export function PersonalChatApp(props: PersonalChatAppProps) {
  const shell = props.shell ?? "standalone";
  const defaultRuntimeMode = props.runtimeMode ?? "local";
  const labels = useMemo<ChatLabels>(
    () => ({
      ...DEFAULT_CHAT_LABELS,
      ...(props.labels ?? {})
    }),
    [props.labels]
  );
  const assistantDraftId = useRef<string | null>(null);
  const client = useMemo(() => new GatewayClient(props.clientOptions), [props.clientOptions]);

  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const effectiveSessionId = shell === "embedded" ? props.fixedSessionId ?? "" : activeSessionId;
  const activeSession = sessions.find((item) => item.id === effectiveSessionId);
  const headerTitle =
    shell === "embedded"
      ? props.fixedSessionTitle ?? activeSession?.title ?? labels.noSessionTitle
      : activeSession?.title ?? labels.noSessionTitle;

  const loadSessions = useCallback(async () => {
    if (shell !== "standalone") {
      return;
    }
    setLoading(true);
    setError("");
    try {
      await client.ensureConnected();
      let listed = await client.listSessions();
      if (listed.length === 0) {
        const created = await client.createSession({ title: "personal", runtimeMode: defaultRuntimeMode });
        listed = [created];
      }
      setSessions(listed);
      setActiveSessionId((prev) => (prev && listed.some((item) => item.id === prev) ? prev : listed[0].id));
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, defaultRuntimeMode, shell]);

  const loadHistory = useCallback(
    async (sessionId: string) => {
      if (!sessionId) {
        setMessages([]);
        return;
      }
      setError("");
      try {
        await client.ensureConnected();
        const history = await client.getSessionHistory({ sessionId, limit: 200 });
        setMessages(buildMessagesFromHistory(history));
      } catch (historyError) {
        setError(toErrorMessage(historyError));
      }
    },
    [client]
  );

  useEffect(() => {
    if (shell === "standalone") {
      void loadSessions();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await client.ensureConnected();
        if (!cancelled) {
          setError("");
        }
      } catch (connectError) {
        if (!cancelled) {
          setError(toErrorMessage(connectError));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, loadSessions, shell]);

  useEffect(() => {
    assistantDraftId.current = null;
    void loadHistory(effectiveSessionId);
  }, [effectiveSessionId, loadHistory]);

  const addMessage = (next: ChatMessage) => {
    setMessages((prev) => [...prev, next]);
  };

  const upsertMessage = (id: string, updater: (current: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((item) => (item.id === id ? updater(item) : item)));
  };

  const ensureAssistantMessage = (): string => {
    if (assistantDraftId.current) {
      return assistantDraftId.current;
    }
    const createdId = createId();
    assistantDraftId.current = createdId;
    addMessage({
      id: createdId,
      role: "assistant",
      text: ""
    });
    return createdId;
  };

  const handleRunEvent = (event: RpcEvent) => {
    if (event.event === "agent.delta") {
      const delta = readDeltaPayload(event.payload);
      if (!delta) {
        return;
      }
      const id = ensureAssistantMessage();
      upsertMessage(id, (current) => ({
        ...current,
        text: `${current.text}${delta}`
      }));
      return;
    }

    if (event.event === "agent.completed") {
      const output = asString(event.payload.output) ?? "";
      if (!output) {
        return;
      }
      const id = ensureAssistantMessage();
      upsertMessage(id, (current) => ({
        ...current,
        text: output
      }));
      return;
    }

    if (event.event === "agent.failed") {
      const code = asString(event.payload.code) ?? "INTERNAL_ERROR";
      const message = asString(event.payload.message) ?? "Unknown error";
      addMessage({
        id: createId(),
        role: "system",
        text: `[${code}] ${message}`
      });
    }
  };

  const handleSend = async () => {
    if (busy) {
      return;
    }
    const text = input.trim();
    if (!text || !effectiveSessionId) {
      return;
    }
    setInput("");
    setError("");
    setBusy(true);
    assistantDraftId.current = null;
    addMessage({
      id: createId(),
      role: "user",
      text
    });

    try {
      await client.runAgentStream(
        {
          sessionId: effectiveSessionId,
          input: text,
          runtimeMode: defaultRuntimeMode,
          ...(props.llm ? { llm: props.llm } : {})
        },
        {
          onEvent: (event) => {
            handleRunEvent(event);
          }
        }
      );

      if (shell === "standalone") {
        const listed = await client.listSessions();
        setSessions(listed);
      }
    } catch (runError) {
      const message = toErrorMessage(runError);
      setError(message);
      addMessage({
        id: createId(),
        role: "system",
        text: message
      });
    } finally {
      setBusy(false);
      assistantDraftId.current = null;
    }
  };

  const createSession = async () => {
    if (shell !== "standalone") {
      return;
    }
    setError("");
    try {
      const created = await client.createSession({
        title: `session-${new Date().toISOString().slice(11, 19)}`,
        runtimeMode: defaultRuntimeMode
      });
      setSessions((prev) => [created, ...prev]);
      setActiveSessionId(created.id);
    } catch (createError) {
      setError(toErrorMessage(createError));
    }
  };

  const handleHome = () => {
    if (!props.homePath || typeof window === "undefined") {
      return;
    }
    window.location.assign(props.homePath);
  };

  const roleLabel = (role: ChatMessage["role"]): string => {
    if (role === "user") {
      return labels.roleUser;
    }
    if (role === "assistant") {
      return labels.roleAssistant;
    }
    return labels.roleSystem;
  };

  return (
    <div className={shell === "standalone" ? "pchat-shell" : "pchat-shell pchat-shell-embedded"}>
      {shell === "standalone" ? (
        <aside className="pchat-sidebar">
          <div className="pchat-brand">{labels.brand}</div>
          <button className="pchat-primary-btn" onClick={() => void createSession()}>
            {labels.newSession}
          </button>
          <div className="pchat-session-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={session.id === effectiveSessionId ? "pchat-session-item active" : "pchat-session-item"}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="pchat-session-title">{session.title}</span>
                <span className="pchat-session-preview">{session.preview || labels.emptySessionPreview}</span>
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      <main className="pchat-main">
        <header className="pchat-header">
          <div>
            <h1>{headerTitle}</h1>
            <p>{effectiveSessionId ? `${effectiveSessionId} · ${defaultRuntimeMode}` : labels.noActiveSession}</p>
          </div>
          <div className="pchat-header-actions">
            {props.showHomeButton ? (
              <button className="pchat-ghost-btn" onClick={handleHome}>
                {labels.home}
              </button>
            ) : null}
            <button
              className="pchat-ghost-btn"
              onClick={() => {
                if (shell === "standalone") {
                  void loadSessions();
                } else {
                  void loadHistory(effectiveSessionId);
                }
              }}
              disabled={loading}
            >
              {loading ? labels.refreshing : labels.refresh}
            </button>
          </div>
        </header>

        {error ? <div className="pchat-error-banner">{error}</div> : null}

        <div className="pchat-messages">
          {messages.length === 0 ? <div className="pchat-empty">{labels.noMessages}</div> : null}
          {messages.map((message) => (
            <article key={message.id} className={`pchat-msg ${message.role}`}>
              <div className="pchat-msg-role">{roleLabel(message.role)}</div>
              <pre>{message.text}</pre>
            </article>
          ))}
        </div>

        <footer className="pchat-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={labels.composerPlaceholder}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void handleSend();
              }
            }}
            disabled={busy || !effectiveSessionId}
          />
          <button className="pchat-primary-btn" onClick={() => void handleSend()} disabled={busy || !effectiveSessionId}>
            {busy ? labels.running : labels.send}
          </button>
        </footer>
      </main>
    </div>
  );
}

function buildMessagesFromHistory(items: GatewayTranscriptItem[]): ChatMessage[] {
  const mapped: ChatMessage[] = [];
  const assistantByRunId = new Map<string, string>();

  for (const item of items) {
    if (item.event === "user.input") {
      const input = asString(item.payload.input) ?? "";
      if (input) {
        mapped.push({
          id: `hist_${item.id}`,
          role: "user",
          text: input
        });
      }
      continue;
    }

    if (item.event === "agent.delta") {
      const delta = readDeltaPayload(item.payload);
      if (!delta) {
        continue;
      }
      const runId = item.runId ?? `run_${item.id}`;
      const existing = assistantByRunId.get(runId);
      if (existing) {
        const index = mapped.findIndex((entry) => entry.id === existing);
        if (index >= 0) {
          mapped[index] = {
            ...mapped[index],
            text: `${mapped[index].text}${delta}`
          };
        }
      } else {
        const id = `hist_${item.id}`;
        assistantByRunId.set(runId, id);
        mapped.push({ id, role: "assistant", text: delta });
      }
      continue;
    }

    if (item.event === "agent.completed") {
      const output = asString(item.payload.output) ?? "";
      if (!output) {
        continue;
      }
      const runId = item.runId ?? `run_${item.id}`;
      const existing = assistantByRunId.get(runId);
      if (existing) {
        const index = mapped.findIndex((entry) => entry.id === existing);
        if (index >= 0) {
          mapped[index] = {
            ...mapped[index],
            text: output
          };
          continue;
        }
      }
      const id = `hist_${item.id}`;
      assistantByRunId.set(runId, id);
      mapped.push({ id, role: "assistant", text: output });
      continue;
    }

    if (item.event === "agent.failed") {
      const code = asString(item.payload.code) ?? "INTERNAL_ERROR";
      const message = asString(item.payload.message) ?? "Unknown error";
      mapped.push({
        id: `hist_${item.id}`,
        role: "system",
        text: `[${code}] ${message}`
      });
    }
  }

  return mapped;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readDeltaPayload(payload: Record<string, unknown>): string {
  return asString(payload.delta) ?? asString(payload.text) ?? "";
}

function createId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof GatewayRpcError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
