// src/service/AgentRuntime.ts
import { randomUUID } from "crypto";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import type { AIChatQueryEventSink } from "@/service/AIChatQueryEvents";
import type { OpenAITool } from "@/api/aiChatApi";
import { AiChatApi } from "@/api/aiChatApi";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import { AgentPromptBuilder } from "@/service/AgentPromptBuilder";
import { AgentOutputParser } from "@/service/AgentOutputParser";
import { AgentTranscriptService } from "@/service/AgentTranscriptService";
import { AgentToolPolicyService } from "@/service/AgentToolPolicyService";
import type {
  AgentDefinitionView,
  AgentResult,
  AgentTaskSnapshot,
  RunAgentRequest,
} from "@/entityTypes/agentTypes";

function toOpenAITool(
  name: string,
  def: { description?: string; parameters?: Record<string, unknown> }
): OpenAITool {
  return {
    type: "function",
    function: {
      name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}

export interface AgentRuntimeDeps {
  /** Override the AI transport (used in tests). Defaults to AiChatApi. */
  streamChatCompletion?: AIChatQueryLoopDeps["streamChatCompletion"];
  /** Override tool execution (used in tests). Defaults to SkillExecutor. */
  executeTool?: AIChatQueryLoopDeps["executeTool"];
  /** Override skill lookup (used in tests). Defaults to SkillRegistry. */
  getSkillDefinition?: AIChatQueryLoopDeps["getSkillDefinition"];
  /** Inject an event sink for streaming (foreground only). */
  eventSink?: AIChatQueryEventSink;
}

/**
 * Runs one specialist agent task by wrapping AIChatQueryLoop with an
 * agent-scoped tool policy gate and self-contained task packet prompts.
 * The loop is reused as-is; this class layers on persistence, policy,
 * prompt assembly, and output parsing.
 */
export class AgentRuntime {
  private readonly policy = new AgentToolPolicyService();
  private readonly promptBuilder = new AgentPromptBuilder();
  private readonly outputParser = new AgentOutputParser();
  private readonly defModule = new AgentDefinitionModule();
  private readonly taskModule = new AgentTaskModule();
  private readonly api = new AiChatApi();

  async runSync(
    request: RunAgentRequest,
    deps?: AgentRuntimeDeps
  ): Promise<AgentResult> {
    const definition = await this.defModule.getActiveById(request.agentId);
    if (!definition) {
      return this.fail(
        request,
        `Unknown or disabled agent: ${request.agentId}`
      );
    }

    const agentTaskId = `agt-${randomUUID()}`;
    const agentConversationId = `agent-v2-${randomUUID()}`;
    const transcript = new AgentTranscriptService(this.taskModule);

    // 1. Persist task + initial transcript.
    await this.taskModule.createTask({
      agentTaskId,
      workflowRunId: request.workflowRunId,
      parentTaskId: request.parentTaskId,
      parentConversationId: request.parentConversationId,
      agentConversationId,
      agentId: definition.id,
      agentVersion: definition.version,
      prompt: request.prompt,
      taskPacket: request.taskPacket,
    });

    const { systemMessage, userMessage } = this.promptBuilder.build({
      definition,
      packet: request.taskPacket,
    });
    await transcript.appendSystemText(agentTaskId, systemMessage.content);
    await this.taskModule.appendMessage({
      agentTaskId,
      role: "user",
      content: userMessage.content,
    });

    await this.taskModule.setStatus(agentTaskId, "running", {
      startedAt: new Date(),
    });

    // 2. Build filtered tools (agent allowlist ∩ registered skills).
    const allTools = await SkillRegistry.getAllToolFunctions();
    const exposedNames = this.policy.filterExposedToolNames({
      allowedTools: definition.allowedTools,
      availableToolNames: allTools
        .filter((t) => t.type === "function" && typeof t.name === "string")
        .map((t) => t.name),
      blockedTools: request.taskPacket.constraints.blockedTools,
    });
    const exposedTools: OpenAITool[] = exposedNames.map((name) => {
      const def = allTools.find((t) => t.name === name);
      return toOpenAITool(name, {
        description: def?.description,
        parameters: def?.parameters,
      });
    });

    // 3. Injected executeTool enforces the agent allowlist at runtime.
    const baseExecute =
      deps?.executeTool ??
      ((name: string, args, ctx) => SkillExecutor.execute(name, args, ctx));
    const getSkill =
      deps?.getSkillDefinition ??
      ((name: string) => SkillRegistry.getSkill(name) ?? undefined);

    let executedToolCalls = 0;
    const policyCheckedExecute: AIChatQueryLoopDeps["executeTool"] = async (
      name,
      args,
      ctx
    ) => {
      const startedAt = Date.now();
      if (executedToolCalls >= definition.maxToolCalls) {
        const message = `Agent ${definition.id} exceeded max tool calls (${definition.maxToolCalls}).`;
        await transcript.recordToolCall({
          agentTaskId,
          toolCallId: ctx.toolCallId,
          toolName: name,
          argumentsSummary: args,
          status: "blocked",
          errorMessage: message,
          durationMs: Date.now() - startedAt,
        });
        throw new Error(message);
      }

      const decision = this.policy.checkToolCall({
        definition,
        toolName: name,
        executionMode: request.executionMode,
        allowInteractivePermissionPrompts:
          request.taskPacket.constraints.allowInteractivePermissionPrompts ??
          true,
        blockedTools: request.taskPacket.constraints.blockedTools,
      });
      if (!decision.allowed) {
        await transcript.recordToolCall({
          agentTaskId,
          toolCallId: ctx.toolCallId,
          toolName: name,
          argumentsSummary: args,
          status: "blocked",
          errorMessage: decision.reason,
          durationMs: Date.now() - startedAt,
        });
        return {
          tool_call_id: ctx.toolCallId,
          tool_name: name,
          success: false,
          result: { agentPolicyBlocked: true, reason: decision.reason },
          execution_time_ms: Date.now() - startedAt,
        };
      }
      executedToolCalls += 1;
      const res = await baseExecute(name, args, ctx);
      const summary = res.result.summary;
      await transcript.recordToolCall({
        agentTaskId,
        toolCallId: ctx.toolCallId,
        toolName: name,
        argumentsSummary: args,
        status: res.success ? "completed" : "failed",
        resultSummary:
          typeof summary === "string"
            ? summary
            : JSON.stringify(res.result).slice(0, 200),
        errorMessage: res.success ? undefined : "tool execution failed",
        durationMs: res.execution_time_ms,
      });
      await this.taskModule.incrementToolCalls(agentTaskId);
      return res;
    };

    // 4. Build the loop with injected deps.
    const streamChat =
      deps?.streamChatCompletion ??
      ((req, onChunk, options) =>
        this.api.openAIChatCompletionStream(req, onChunk, options));

    const loop = new AIChatQueryLoop({
      streamChatCompletion: streamChat,
      executeTool: policyCheckedExecute,
      getSkillDefinition: getSkill,
    });

    // 5. Run with abort controller + runtime timeout.
    const abortController = new AbortController();
    const timer = setTimeout(() => {
      abortController.abort();
    }, definition.maxRuntimeMs);

    let finalText = "";
    const sink: AIChatQueryEventSink = deps?.eventSink ?? {
      emit: () => {
        // no-op sink for headless runs
      },
    };

    try {
      const loopInput = {
        conversationId: agentConversationId,
        assistantMessageId: `agent-assistant-${agentTaskId}`,
        messages: [systemMessage, userMessage],
        request: {
          message: request.prompt,
          model: request.model ?? definition.defaultModel,
          conversationId: agentConversationId,
          mode: "chat" as const,
        },
        openAITools: exposedTools,
        abortController,
        eventSink: sink,
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(loopInput);

      if (result.type === "completed") {
        finalText = result.fullContent;
      } else if (result.type === "cancelled") {
        finalText = result.partialContent;
        await this.taskModule.setStatus(agentTaskId, "cancelled", {
          finishedAt: new Date(),
        });
        return this.buildResult(
          agentTaskId,
          definition,
          "cancelled",
          finalText
        );
      } else if (result.type === "failed") {
        finalText = result.partialContent;
        await this.taskModule.setStatus(agentTaskId, "failed", {
          finishedAt: new Date(),
          errorMessage: String(result.error),
        });
        return this.buildResult(
          agentTaskId,
          definition,
          "failed",
          finalText,
          String(result.error)
        );
      } else {
        // paused_for_permission / paused_for_plan_question: not wired for v1
        // foreground specialist runs. Treat as failed with a clear message.
        const msg =
          result.type === "paused_for_permission"
            ? "Agent task paused for permission (not supported in v1 runtime)."
            : "Agent task paused for plan question (not supported in v1 runtime).";
        await this.taskModule.setStatus(agentTaskId, "failed", {
          finishedAt: new Date(),
          errorMessage: msg,
        });
        return this.buildResult(
          agentTaskId,
          definition,
          "failed",
          finalText,
          msg
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.taskModule.setStatus(agentTaskId, "failed", {
        finishedAt: new Date(),
        errorMessage: msg,
      });
      return this.buildResult(
        agentTaskId,
        definition,
        "failed",
        finalText,
        msg
      );
    } finally {
      clearTimeout(timer);
    }

    // 6. Parse output.
    await transcript.appendAssistantText(agentTaskId, finalText);
    const parseResult = this.outputParser.parse(
      finalText,
      definition.outputSchema as { required?: string[] }
    );
    if (!parseResult.ok) {
      await this.taskModule.setStatus(agentTaskId, "failed", {
        finishedAt: new Date(),
        errorMessage: parseResult.error,
      });
      return this.buildResult(
        agentTaskId,
        definition,
        "failed",
        finalText,
        parseResult.error
      );
    }

    const outputObj = parseResult.output;
    // Trust boundary: validate LLM-generated values before persistence.
    // sourceUrls must be http(s) URLs (PRD §14.4 + SSRF defense for later
    // milestones that may resolve them). confidence must be a finite number.
    const rawUrls = Array.isArray(outputObj.sourceUrls)
      ? (outputObj.sourceUrls as unknown[])
      : [];
    const sourceUrls = rawUrls.filter((u): u is string => {
      if (typeof u !== "string") return false;
      try {
        const parsed = new URL(u);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    });
    const rawConfidence = outputObj.confidence;
    const confidence =
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
        ? rawConfidence
        : undefined;

    const result: AgentResult = {
      agentTaskId,
      agentId: definition.id,
      agentVersion: definition.version,
      status: "completed",
      output: outputObj,
      text: finalText,
      toolCallsCount: 0,
      sourceUrls,
      confidence,
    };
    await this.taskModule.saveResult(agentTaskId, result);
    await this.taskModule.setStatus(agentTaskId, "completed", {
      finishedAt: new Date(),
    });
    const snap = await this.taskModule.getSnapshot(agentTaskId);
    result.toolCallsCount = snap?.toolCallsCount ?? 0;
    return result;
  }

  async getTask(agentTaskId: string): Promise<AgentTaskSnapshot | null> {
    return this.taskModule.getSnapshot(agentTaskId);
  }

  private async fail(
    request: RunAgentRequest,
    message: string
  ): Promise<AgentResult> {
    return {
      agentTaskId: `agt-failed-${randomUUID()}`,
      agentId: request.agentId,
      agentVersion: 0,
      status: "failed",
      toolCallsCount: 0,
      sourceUrls: [],
      errorMessage: message,
    };
  }

  private buildResult(
    agentTaskId: string,
    definition: AgentDefinitionView,
    status: AgentResult["status"],
    text: string,
    errorMessage?: string
  ): AgentResult {
    return {
      agentTaskId,
      agentId: definition.id,
      agentVersion: definition.version,
      status,
      text,
      toolCallsCount: 0,
      sourceUrls: [],
      errorMessage,
    };
  }
}
