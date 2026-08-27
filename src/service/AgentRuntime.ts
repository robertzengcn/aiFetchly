// src/service/AgentRuntime.ts
import { randomUUID } from "crypto";
import { log } from "@/modules/Logger";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import type { AIChatQueryEventSink } from "@/service/AIChatQueryEvents";
import type { OpenAITool } from "@/api/aiChatApi";
import { AiChatApi } from "@/api/aiChatApi";
import type { OpenAIChatImage } from "@/api/aiChatApi";
import { AIChatGeneratedImageStorageService } from "@/service/AIChatGeneratedImageStorageService";
import {
  persistAgentImages,
  type AgentImageStorage,
} from "@/service/persistAgentImages";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import { AgentPromptBuilder } from "@/service/AgentPromptBuilder";
import { AgentOutputParser } from "@/service/AgentOutputParser";
import { AgentTranscriptService } from "@/service/AgentTranscriptService";
import { AgentToolPolicyService } from "@/service/AgentToolPolicyService";
import {
  isClaudeModelAlias,
  normalizeClaudeAgentToolName,
} from "@/service/pluginCompat/ClaudeAgentFormatAdapter";
import {
  resolveToolCatalogMode,
  resolvePositiveIntEnv,
  TOOL_CATALOG_ENV,
} from "@/config/toolCatalogConfig";
import { ToolCatalogService } from "@/service/ToolCatalogService";
import { ToolPromptBudgetService } from "@/service/ToolPromptBudgetService";
import type {
  ToolCatalog,
  ToolCatalogModeDecision,
  ToolCatalogRuntimeContext,
} from "@/entityTypes/toolCatalogTypes";
import type { AIAutoDreamService } from "@/service/AIAutoDreamService";
import type { AIWorkspaceAutoDreamService } from "@/service/AIWorkspaceAutoDreamService";
import type {
  AgentDefinitionView,
  AgentResult,
  AgentTaskSnapshot,
  AgentWorkflowConstraints,
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

function normalizeRuntimeDefinition(
  definition: AgentDefinitionView
): AgentDefinitionView {
  const normalizedTools = definition.allowedTools
    .map((name) => normalizeClaudeAgentToolName(name))
    .filter((name): name is string => typeof name === "string");
  const defaultModel =
    definition.defaultModel && isClaudeModelAlias(definition.defaultModel)
      ? undefined
      : definition.defaultModel;
  const normalized: AgentDefinitionView = {
    ...definition,
    allowedTools: Array.from(new Set(normalizedTools)),
  };
  if (defaultModel) {
    normalized.defaultModel = defaultModel;
  } else {
    delete normalized.defaultModel;
  }
  return normalized;
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
  /** Optional. When provided, the runtime triggers auto-dream consolidation
   * after a completed task. Failures are logged and swallowed. */
  autoDreamService?: AIAutoDreamService;
  /** Optional. When provided, the runtime triggers workspace-scoped auto-dream
   * consolidation after a completed task. Runs independently of the user-memory
   * service. Failures are logged and swallowed. */
  workspaceAutoDreamService?: AIWorkspaceAutoDreamService;
  /** Optional. Persists generated images (e.g. a batch worker's edited
   * outputs) to disk so their file paths can be returned without carrying
   * bytes. Defaults to AIChatGeneratedImageStorageService when images are
   * present. */
  generatedImageStorage?: AgentImageStorage;
  /** Optional parent cancellation signal. Batch coordinators use this to
   * cancel every in-flight item when the user stops the outer tool job. */
  signal?: AbortSignal;
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
  private readonly agentCatalogService = new ToolCatalogService();
  private readonly agentBudgetService = new ToolPromptBudgetService();
  private readonly defModule = new AgentDefinitionModule();
  private readonly taskModule = new AgentTaskModule();
  private readonly api = new AiChatApi();

  async runSync(
    request: RunAgentRequest,
    deps?: AgentRuntimeDeps
  ): Promise<AgentResult> {
    const storedDefinition = await this.defModule.getActiveById(
      request.agentId
    );
    if (!storedDefinition) {
      return this.fail(
        request,
        `Unknown or disabled agent: ${request.agentId}`
      );
    }
    const definition = normalizeRuntimeDefinition(storedDefinition);

    const agentTaskId = `agt-${randomUUID()}`;
    const agentConversationId = `agent-v2-${randomUUID()}`;
    const transcript = new AgentTranscriptService(this.taskModule);

    // Normalize constraints — AI-generated taskPackets may omit this object.
    const constraints: AgentWorkflowConstraints =
      request.taskPacket.constraints ?? {};

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

    const { systemMessage, userMessage, userMessageText } =
      this.promptBuilder.build({
        definition,
        packet: request.taskPacket,
        // Trusted runtime-only channel: artifacts ride into the prompt here
        // and nowhere else. createTask above persists the packet only, and
        // the transcript below records the text projection (no bytes).
        initialImageArtifacts: request.initialImageArtifacts,
      });
    await transcript.appendSystemText(agentTaskId, systemMessage.content);
    await this.taskModule.appendMessage({
      agentTaskId,
      role: "user",
      content: userMessageText,
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
      blockedTools: constraints.blockedTools,
    });
    const exposedTools: OpenAITool[] = exposedNames.map((name) => {
      const def = allTools.find((t) => t.name === name);
      return toOpenAITool(name, {
        description: def?.description,
        parameters: def?.parameters,
      });
    });

    // Build a deferred tool catalog scoped to the agent's allowlist. The
    // catalog is constructed from the already-allowlisted exposedTools and the
    // runtime context carries allowedToolNames/blockedToolNames, so discovery
    // can never surface a blocked or non-allowlisted tool (AC-4). Agent tasks
    // are ephemeral, so discovered state is per-task (in-memory) — no
    // persistence. Small allowlists stay standard under auto mode (design §16).
    const agentToolCatalogContext = this.buildAgentToolCatalog({
      tools: exposedTools,
      conversationId: agentConversationId,
      userMessage: request.prompt,
      model: request.model ?? definition.defaultModel,
      allowedToolNames: new Set(exposedNames),
      blockedToolNames: new Set(constraints.blockedTools ?? []),
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
          constraints.allowInteractivePermissionPrompts ?? true,
        blockedTools: constraints.blockedTools,
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

      // Headless agents have no UI to surface SkillExecutor's interactive
      // permission prompt, and the v1 runtime has no pause/resume path for
      // them — letting the prompt result through makes AIChatQueryLoop return
      // paused_for_permission, which fails the whole task (see the loop result
      // handling below). Rewrite the prompt into an explicit denied result so
      // the loop feeds the failure back to the agent's model, which can adapt
      // (switch tools or report the permission gap) instead of dying. This is
      // the headless semantics AgentToolPolicyService.checkToolCall documents:
      // "the runtime surfaces [the permission prompt] as a blocked tool result
      // in headless mode". Agents stay limited to tools the user has already
      // granted (persistent Token grants or session grants) — we never bypass
      // the permission system itself.
      const rawResult = res.result as Record<string, unknown> | undefined;
      if (rawResult?.needsPermissionPrompt === true) {
        const category =
          typeof rawResult.permissionCategory === "string"
            ? rawResult.permissionCategory
            : "unknown";
        const message =
          `Permission for tool "${name}" (category: ${category}) has not been ` +
          "granted, and headless agent tasks cannot show a permission prompt. " +
          "Do not retry this tool call within this task. The user can grant " +
          "the permission by calling the tool once in the main chat and " +
          "approving the prompt, then re-run the task.";
        await transcript.recordToolCall({
          agentTaskId,
          toolCallId: ctx.toolCallId,
          toolName: name,
          argumentsSummary: args,
          status: "blocked",
          errorMessage: message,
          durationMs: Date.now() - startedAt,
        });
        return {
          tool_call_id: ctx.toolCallId,
          tool_name: name,
          success: false,
          result: { agentPermissionDenied: true, error: message },
          execution_time_ms: Date.now() - startedAt,
        };
      }

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
    const abortFromParent = (): void => abortController.abort();
    if (deps?.signal?.aborted) {
      abortController.abort();
    } else {
      deps?.signal?.addEventListener("abort", abortFromParent, { once: true });
    }
    const timer = setTimeout(() => {
      abortController.abort();
    }, definition.maxRuntimeMs);

    let finalText = "";
    let capturedImages: OpenAIChatImage[] | undefined;
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
        // Retry transient content failures instantly. Agents run under a tight
        // maxRuntimeMs deadline (the abort timer above); spending that budget
        // on exponential backoff sleeps can starve actual work. The agent's
        // own abort signal still bounds total runtime regardless.
        transientRetryConfig: { baseDelayMs: 0 },
        toolCatalog: agentToolCatalogContext.toolCatalog,
        toolCatalogModeDecision:
          agentToolCatalogContext.toolCatalogModeDecision,
      };
      const result = await loop.run(loopInput);

      if (result.type === "completed") {
        finalText = result.fullContent;
        capturedImages = result.images;
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
        // paused_for_permission / paused_for_plan_question fallback. The
        // permission case is normally intercepted in policyCheckedExecute
        // above (rewritten as a denied tool result so the loop continues);
        // reaching this branch means a prompt slipped through another path —
        // surface an actionable message instead of an opaque v1 note.
        const msg =
          result.type === "paused_for_permission"
            ? `Agent task paused for permission on tool "${result.pending.toolName}" — headless agent tasks cannot show permission prompts. Grant the tool permission in the main chat (run it once and approve) or in settings, then re-run this task.`
            : "Agent task paused for plan question (not supported in headless agent runtime).";
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
      deps?.signal?.removeEventListener("abort", abortFromParent);
    }

    // 6. Parse output.
    await transcript.appendAssistantText(agentTaskId, finalText);

    // Caller-supplied narrower schema takes precedence over the agent default.
    // (Fixes a bug where outputSchemaOverride was plumbed through RunAgentRequest
    // but silently ignored here — callers could not actually narrow the schema.)
    const effectiveSchema =
      (request.outputSchemaOverride as { required?: string[] } | undefined) ??
      (definition.outputSchema as { required?: string[] });
    const parseResult = this.outputParser.parse(finalText, effectiveSchema);

    // Trust boundary: validate LLM-generated values before persistence.
    // sourceUrls must be http(s) URLs (PRD §14.4 + SSRF defense for later
    // milestones that may resolve them). confidence must be a finite number.
    const extractSourceUrls = (obj: Record<string, unknown>): string[] => {
      const raw = Array.isArray(obj.sourceUrls)
        ? (obj.sourceUrls as unknown[])
        : [];
      return raw.filter((u): u is string => {
        if (typeof u !== "string") return false;
        try {
          const parsed = new URL(u);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      });
    };
    const extractConfidence = (
      obj: Record<string, unknown>
    ): number | undefined => {
      const v = obj.confidence;
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    };

    let outputObj: Record<string, unknown>;
    let sourceUrls: string[];
    let confidence: number | undefined;
    let parseWarning: string | undefined;

    if (parseResult.ok) {
      outputObj = parseResult.output;
      sourceUrls = extractSourceUrls(outputObj);
      confidence = extractConfidence(outputObj);
    } else {
      // Lenient fallback: the agent finished its loop but its final text
      // wasn't valid JSON matching the schema (a common failure when a model
      // hits an "I can't complete this" state and writes a prose summary
      // instead). Salvage the work as a low-confidence partial result rather
      // than failing the whole task — callers already handle low confidence,
      // and the agent's research is often still useful in the text body.
      parseWarning = parseResult.error;
      const base = parseResult.partial ?? {};
      const fallbackSummary =
        typeof base.businessSummary === "string" &&
        base.businessSummary.trim().length > 0
          ? base.businessSummary
          : finalText.trim().slice(0, 4000);
      outputObj = {
        ...base,
        businessSummary: fallbackSummary,
        sourceUrls: Array.isArray(base.sourceUrls) ? base.sourceUrls : [],
        confidence:
          typeof base.confidence === "number" &&
          Number.isFinite(base.confidence)
            ? base.confidence
            : 0,
      };
      sourceUrls = extractSourceUrls(outputObj);
      confidence = extractConfidence(outputObj) ?? 0;
    }

    // Persist any edited/generated images the sub-agent's loop produced
    // (e.g. a batch worker's attach_local_images edits) to local storage and
    // derive their on-disk paths + descriptors. Bytes are never carried on
    // AgentResult (PRD non-goal 8). Failure is swallowed by persistAgentImages
    // so a storage hiccup never fails an otherwise-successful task.
    //
    // The default AIChatGeneratedImageStorageService reads Electron's
    // app.getPath("userData") at construction, so it is constructed LAZILY —
    // only when there are images to persist. This keeps image-less runs (incl.
    // tests without an Electron `app`) from touching Electron at all.
    let outputFilePaths: string[] | undefined;
    let outputImages: OpenAIChatImage[] | undefined;
    let storageWarning: string | undefined;
    if (capturedImages && capturedImages.length > 0) {
      const persisted = await persistAgentImages({
        images: capturedImages,
        conversationId: agentConversationId,
        messageId: `agent-assistant-${agentTaskId}`,
        storage:
          deps?.generatedImageStorage ??
          new AIChatGeneratedImageStorageService(),
      });
      outputFilePaths = persisted.outputFilePaths;
      outputImages = persisted.outputImages;
      storageWarning = persisted.storageWarning;
    }

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
      ...(parseWarning ? { parseWarning } : {}),
      ...(outputFilePaths ? { outputFilePaths } : {}),
      ...(outputImages ? { outputImages } : {}),
      ...(storageWarning ? { storageWarning } : {}),
    };
    await this.taskModule.saveResult(agentTaskId, result);
    await this.taskModule.setStatus(agentTaskId, "completed", {
      finishedAt: new Date(),
    });
    const snap = await this.taskModule.getSnapshot(agentTaskId);
    result.toolCallsCount = snap?.toolCallsCount ?? 0;
    if (deps?.autoDreamService) {
      deps.autoDreamService
        .evaluateAfterAgentTask({
          agentTaskId,
          reason: "agent_task_completed",
        })
        .catch((err) =>
          log.error("[ai-auto-dream] agent trigger failed:", err)
        );
    }
    if (deps?.workspaceAutoDreamService) {
      deps.workspaceAutoDreamService
        .evaluateAfterAgentTask({
          agentTaskId,
          reason: "agent_task_completed",
        })
        .catch((err) =>
          log.error("[workspace-auto-dream] agent trigger failed:", err)
        );
    }
    return result;
  }

  async getTask(agentTaskId: string): Promise<AgentTaskSnapshot | null> {
    return this.taskModule.getSnapshot(agentTaskId);
  }

  /**
   * Build a deferred tool catalog scoped to the agent's allowlist (AC-4).
   * The catalog is constructed from the already-allowlisted tool set, and the
   * runtime context carries allowedToolNames/blockedToolNames as defense in
   * depth so discovery can never surface a blocked tool. Returns empty when
   * the flag is off, the catalog build throws, or auto mode stays standard
   * (small allowlists).
   */
  private buildAgentToolCatalog(input: {
    readonly tools: readonly OpenAITool[];
    readonly conversationId: string;
    readonly userMessage: string;
    readonly model?: string;
    readonly allowedToolNames: ReadonlySet<string>;
    readonly blockedToolNames: ReadonlySet<string>;
  }): {
    toolCatalog?: ToolCatalog;
    toolCatalogModeDecision?: ToolCatalogModeDecision;
  } {
    const mode = resolveToolCatalogMode(process.env[TOOL_CATALOG_ENV.mode]);
    if (mode.mode === "off") return {};

    const context: ToolCatalogRuntimeContext = {
      conversationId: input.conversationId,
      model: input.model,
      isPlanMode: false,
      autoPlanEnabled: false,
      currentUserMessage: input.userMessage,
      uploadedFileTypes: [],
      allowedToolNames: input.allowedToolNames,
      blockedToolNames: input.blockedToolNames,
    };

    let catalog: ToolCatalog;
    try {
      catalog = this.agentCatalogService.buildFromOpenAITools({
        tools: input.tools,
        context,
      });
    } catch (err) {
      console.warn(
        `[agent-runtime] catalog build failed, using standard mode:`,
        err
      );
      return {};
    }

    const thresholdPercent = resolvePositiveIntEnv(
      process.env[TOOL_CATALOG_ENV.thresholdPercent]
    );
    const decision = this.agentBudgetService.resolveMode({
      configuredMode: mode.mode,
      deferredEstimatedTokens: catalog.deferredEstimatedTokens,
      thresholdPercent,
    });
    if (decision.mode === "standard") return {};

    return { toolCatalog: catalog, toolCatalogModeDecision: decision };
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
