import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { type Model } from "@mariozechner/pi-ai";
import { createLocalToolExecutor } from "../../../packages/tool-executor/dist/index.js";
import { mapPiEvent } from "./pi-events.js";
import { ensurePiProviders, resolveApiKey, resolvePiRuntimeSettings, resolvePiStreamFn } from "./pi-model.js";
import { createPiTools } from "./pi-tools.js";
import {
  AsyncQueue,
  cloneAgentMessages,
  extractLatestAssistantText,
  toErrorMessage,
  trimSessionMessages,
  type ActiveRun,
  type CoreContinueInput,
  type CoreEvent,
  type CoreRunInput,
  type CoreService,
  type RuntimeCoreOptions
} from "./shared.js";
import { buildSystemPromptWithWorkspace } from "./workspace-prompt.js";

export function createPiCoreService(options: RuntimeCoreOptions = {}): CoreService {
  const toolExecutor = options.toolExecutor ?? createLocalToolExecutor();
  const piOptions = options.pi ?? {};
  const running = new Map<string, ActiveRun>();
  const sessionMessageHistory = new Map<string, AgentMessage[]>();
  let runCounter = 0;

  ensurePiProviders();

  return {
    async *run(input: CoreRunInput): AsyncIterable<CoreEvent> {
      const runId = `run_${++runCounter}`;
      const activeRun: ActiveRun = { aborted: false };
      running.set(runId, activeRun);

      yield {
        type: "accepted",
        runId,
        sessionId: input.sessionId,
        runtimeMode: input.runtimeMode
      };

      if (activeRun.aborted) {
        yield {
          type: "failed",
          runId,
          code: "ABORTED",
          message: "Run aborted"
        };
        running.delete(runId);
        return;
      }

      const queue = new AsyncQueue<CoreEvent>();
      let failed = false;
      let completed = false;
      let outputText = "";

      try {
        const runtimeSettings = resolvePiRuntimeSettings({
          ...piOptions,
          ...(input.llm ?? {})
        });
        if (!runtimeSettings.model && (!runtimeSettings.provider || !runtimeSettings.modelId)) {
          yield {
            type: "failed",
            runId,
            code: "MODEL_UNAVAILABLE",
            message: "No model configured. Set provider/modelId and API key."
          };
          return;
        }
        if (runtimeSettings.provider) {
          const providerApiKey = resolveApiKey(runtimeSettings.provider, runtimeSettings, piOptions);
          if (!providerApiKey) {
            yield {
              type: "failed",
              runId,
              code: "MODEL_UNAVAILABLE",
              message: `No API key for provider: ${runtimeSettings.provider}`
            };
            return;
          }
        }
        const systemPrompt = buildSystemPromptWithWorkspace(piOptions);
        const streamFn = resolvePiStreamFn(piOptions);
        const tools = createPiTools(toolExecutor, {
          runId,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode
        });
        const previousMessages = sessionMessageHistory.get(input.sessionId);

        const agent = new Agent({
          initialState: {
            ...(runtimeSettings.model ? { model: runtimeSettings.model as Model<any> } : {}),
            systemPrompt,
            tools,
            ...(previousMessages && previousMessages.length > 0
              ? { messages: cloneAgentMessages(previousMessages) }
              : {})
          },
          streamFn,
          getApiKey: (provider) => resolveApiKey(provider, runtimeSettings, piOptions),
          sessionId: input.sessionId
        });
        activeRun.agent = agent;

        const unsubscribe = agent.subscribe((event: AgentEvent) => {
          if (completed) {
            return;
          }
          const mapped = mapPiEvent(event, runId);
          for (const coreEvent of mapped) {
            queue.push(coreEvent);
            if (coreEvent.type === "failed") {
              failed = true;
            }
          }
        });

        const promptTask = (async () => {
          try {
            await agent.prompt(input.input);
            outputText = extractLatestAssistantText(agent.state.messages);
            if (!failed) {
              queue.push({
                type: "completed",
                runId,
                output: outputText.length > 0 ? outputText : "(empty output)"
              });
            }
          } catch (error) {
            if (!failed) {
              queue.push({
                type: "failed",
                runId,
                code: activeRun.aborted ? "ABORTED" : "INTERNAL_ERROR",
                message: toErrorMessage(error)
              });
            }
          } finally {
            completed = true;
            sessionMessageHistory.set(
              input.sessionId,
              trimSessionMessages(cloneAgentMessages(agent.state.messages))
            );
            unsubscribe();
            running.delete(runId);
            queue.close();
          }
        })();

        while (true) {
          const event = await queue.next();
          if (!event) {
            break;
          }
          yield event;
        }

        await promptTask;
      } finally {
        running.delete(runId);
      }
    },

    async *continue(input: CoreContinueInput): AsyncIterable<CoreEvent> {
      const run = running.get(input.runId);
      if (!run?.agent) {
        yield {
          type: "failed",
          runId: input.runId,
          code: "INVALID_REQUEST",
          message: "run 不存在或不可继续"
        };
        return;
      }

      try {
        await run.agent.continue();
        const output = extractLatestAssistantText(run.agent.state.messages);
        yield {
          type: "delta",
          runId: input.runId,
          text: output
        };
        yield {
          type: "completed",
          runId: input.runId,
          output
        };
      } catch (error) {
        yield {
          type: "failed",
          runId: input.runId,
          code: "INTERNAL_ERROR",
          message: toErrorMessage(error)
        };
      }
    },

    async abort(runId: string): Promise<void> {
      const run = running.get(runId);
      if (run) {
        run.aborted = true;
        run.agent?.abort();
      }
    }
  };
}
