import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GatewayRpcError,
  getGatewayClient,
  type GatewaySession,
  type GatewayTranscriptItem,
  type RpcEvent
} from "./lib/gateway-client";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export function App() {
  const client = useMemo(() => getGatewayClient(), []);
  const assistantDraftId = useRef<string | null>(null);
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeSession = sessions.find((item) => item.id === activeSessionId);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await client.ensureConnected();
      let listed = await client.listSessions();
      if (listed.length === 0) {
        const created = await client.createSession({ title: "personal web", runtimeMode: "local" });
        listed = [created];
      }
      setSessions(listed);
      setActiveSessionId((prev) => (prev && listed.some((item) => item.id === prev) ? prev : listed[0].id));
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client]);

  const loadHistory = useCallback(
    async (sessionId: string) => {
      setError("");
      try {
        const history = await client.getSessionHistory({ sessionId, limit: 200 });
        setMessages(buildMessagesFromHistory(history));
      } catch (historyError) {
        setError(toErrorMessage(historyError));
      }
    },
    [client]
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    assistantDraftId.current = null;
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    void loadHistory(activeSessionId);
  }, [activeSessionId, loadHistory]);

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
      const delta = asString(event.payload.delta) ?? "";
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
    if (!text || !activeSessionId) {
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
          sessionId: activeSessionId,
          input: text,
          runtimeMode: "local"
        },
        {
          onEvent: (event) => {
            handleRunEvent(event);
          }
        }
      );
      const listed = await client.listSessions();
      setSessions(listed);
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
    setError("");
    try {
      const created = await client.createSession({
        title: `session-${new Date().toISOString().slice(11, 19)}`,
        runtimeMode: "local"
      });
      setSessions((prev) => [created, ...prev]);
      setActiveSessionId(created.id);
    } catch (createError) {
      setError(toErrorMessage(createError));
    }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">OpenFoal Personal Web</div>
        <button className="primary-btn" onClick={() => void createSession()}>
          + New Session
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === activeSessionId ? "session-item active" : "session-item"}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span className="session-title">{session.title}</span>
              <span className="session-preview">{session.preview || "empty"}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="header">
          <div>
            <h1>{activeSession?.title ?? "No Session"}</h1>
            <p>{activeSession ? `${activeSession.id} · ${activeSession.runtimeMode}` : "Create or select a session"}</p>
          </div>
          <button className="ghost-btn" onClick={() => void loadSessions()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="messages">
          {messages.length === 0 ? <div className="empty">No messages yet.</div> : null}
          {messages.map((message) => (
            <article key={message.id} className={`msg ${message.role}`}>
              <div className="msg-role">{message.role}</div>
              <pre>{message.text}</pre>
            </article>
          ))}
        </div>

        <footer className="composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type a message..."
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void handleSend();
              }
            }}
            disabled={busy || !activeSessionId}
          />
          <button className="primary-btn" onClick={() => void handleSend()} disabled={busy || !activeSessionId}>
            {busy ? "Running..." : "Send"}
          </button>
        </footer>
      </main>
    </div>
  );
}

function buildMessagesFromHistory(items: GatewayTranscriptItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const assistantByRunId = new Map<string, string>();

  const ensureAssistant = (runId: string): string => {
    const existing = assistantByRunId.get(runId);
    if (existing) {
      return existing;
    }
    const id = createId();
    assistantByRunId.set(runId, id);
    messages.push({
      id,
      role: "assistant",
      text: ""
    });
    return id;
  };

  for (const item of items) {
    if (item.event === "user.input") {
      const text = asString(item.payload.input) ?? "";
      if (text) {
        messages.push({
          id: createId(),
          role: "user",
          text
        });
      }
      continue;
    }

    if (item.event === "agent.delta") {
      const runId = asString(item.payload.runId) ?? item.runId ?? "run_unknown";
      const delta = asString(item.payload.delta) ?? "";
      if (!delta) {
        continue;
      }
      const id = ensureAssistant(runId);
      const target = messages.find((message) => message.id === id);
      if (target) {
        target.text = `${target.text}${delta}`;
      }
      continue;
    }

    if (item.event === "agent.completed") {
      const runId = asString(item.payload.runId) ?? item.runId ?? "run_unknown";
      const output = asString(item.payload.output) ?? "";
      if (!output) {
        continue;
      }
      const id = ensureAssistant(runId);
      const target = messages.find((message) => message.id === id);
      if (target) {
        target.text = output;
      }
      continue;
    }

    if (item.event === "agent.failed") {
      const code = asString(item.payload.code) ?? "INTERNAL_ERROR";
      const message = asString(item.payload.message) ?? "Unknown error";
      messages.push({
        id: createId(),
        role: "system",
        text: `[${code}] ${message}`
      });
    }
  }

  return messages.slice(-200);
}

function createId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
