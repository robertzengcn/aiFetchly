import { AiChatApi, type ToolExecutionResult } from "@/api/aiChatApi";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatModelFallbackService } from "@/service/AIChatModelFallbackService";
import { canAutoApproveScheduledTool } from "@/service/ScheduledAiToolPolicy";
import type { AiMessageTaskToolPolicy } from "@/entityTypes/aiMessageTaskTypes";
import type { ChatToolApprovalMode } from "@/entityTypes/aiChatV2Types";
import type { SkillDefinition } from "@/entityTypes/skillTypes";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import { dispatchSectionSummarize } from "@/service/AIChatSummarizeDispatch";
import { AIChatCompactionCoordinator } from "@/service/AIChatCompactionCoordinator";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import { AIChatCompactionModule } from "@/modules/AIChatCompactionModule";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatToolApprovalModule } from "@/modules/AIChatToolApprovalModule";

/**
 * Builds production {@link AIChatQueryEngine} instances for non-interactive
 * execution paths (the scheduled-loop runner), without importing the Chat V2
 * IPC handler (technical-design §13.1).
 *
 * The interactive Chat V2 path keeps its own singleton engine in
 * ai-chat-v2-ipc.ts. This factory produces a dedicated engine per scheduled
 * occurrence so its abort lifecycle is run-scoped and cannot collide with an
 * interactive turn on the same engine instance. The shared
 * {@link AIChatConversationTurnCoordinator} prevents separate instances from
 * racing on one conversation (design §13.2).
 */
export class AIChatQueryEngineFactory {
  /**
   * Create a dedicated engine for a scheduled occurrence. Tool exposure AND
   * execution are task-scoped (FR-16): only allowlisted, policy-approved
   * built-in tools are advertised to the model and run with auto-approval;
   * everything else is filtered out of the catalog and, as a backstop, returns
   * a structured failed tool result if somehow called. No interactive
   * permission prompt is ever shown.
   *
   * Optional interactive services (compact agent, auto-dream) are omitted — the
   * engine runs fine without them; all deps are optional.
   */
  createScheduled(
    policy: AiMessageTaskToolPolicy,
    conversationId?: string
  ): AIChatQueryEngine {
    // Resolve the conversation's approval mode ONCE so the catalog filter and
    // the execution backstop agree, and to avoid a Token read per tool call.
    // null when the conversation has no mode set or conversationId is absent —
    // preserves the pre-existing per-task gating for legacy callers/tests.
    const approvalMode: ChatToolApprovalMode | null = conversationId
      ? new AIChatToolApprovalModule().getMode(conversationId)
      : null;
    // §11 coordinator with a provider-backed summarize callback. The engine's
    // post-turn hook calls requestCompactionForTurn (§12 incremental path);
    // when AI is disabled or the provider call fails, the coordinator cancels
    // the run and the engine keeps the legacy behavior.
    const coordinator = new AIChatCompactionCoordinator({
      summarize: async (
        systemPrompt: string,
        userPrompt: string,
        model?: string
      ): Promise<string> =>
        dispatchSectionSummarize({
          systemPrompt,
          userPrompt,
          model,
          completeChat: (request) =>
            new AiChatApi().openAIChatCompletion(request),
        }),
    });
    // §12 assembler with the compaction reader + archive access: reads the
    // active generation's composite boundary + bounded overview instead of
    // the legacy timestamp-only trim, and retains token-budgeted complete
    // turns (FR-05). Degrades gracefully when nothing is published/indexed.
    const assembler = new AIChatContextAssembler({
      compactionReader: new AIChatCompactionModule(),
      archiveModule: new AIChatArchiveModule(),
    });
    return new AIChatQueryEngine(this.createQueryLoop(policy, approvalMode), {
      toolFilter: (name) => this.isToolAllowed(name, policy, approvalMode),
      compactionCoordinator: coordinator,
      contextAssembler: assembler,
    });
  }

  /** Build the production query loop with task-scoped tool enforcement. */
  private createQueryLoop(
    policy: AiMessageTaskToolPolicy,
    approvalMode: ChatToolApprovalMode | null
  ): AIChatQueryLoop {
    const deps: AIChatQueryLoopDeps = {
      streamChatCompletion: (request, onChunk, options) => {
        const api = new AiChatApi();
        return api.openAIChatCompletionStream(request, onChunk, options);
      },
      executeTool: (name, args, context) =>
        this.executeScheduledTool(name, args, context, policy, approvalMode),
      getSkillDefinition: (name) => SkillRegistry.getSkill(name) ?? undefined,
      resolveFallbackModel: async ({ originalModel, currentModel, reason }) => {
        const svc = new AIChatModelFallbackService();
        return svc.resolve({ originalModel, currentModel, reason });
      },
      // §8.5 complete-request budget preflight: rejects a turn before the
      // model call when the assembled context exceeds the model's window.
      requestBudgetService: new AIChatRequestBudgetService(),
    };
    return new AIChatQueryLoop(deps);
  }

  /**
   * Task-scoped policy check shared by the catalog filter and the execution
   * guard. Built-in tools follow the curated allowlist; extended capabilities
   * (imported skills, MCP, subagents) follow separate task flags.
   */
  private isToolAllowed(
    name: string,
    policy: AiMessageTaskToolPolicy,
    approvalMode: ChatToolApprovalMode | null
  ): boolean {
    const skill = SkillRegistry.getSkill(name) ?? null;
    return canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy,
      toolName: name,
      approvalMode,
    }).allowed;
  }

  /**
   * Task-scoped tool executor for scheduled (unattended) turns — the execution
   * backstop behind the catalog filter. Revalidates the tool against the task
   * policy and either runs it with auto-approval, pauses the run for an
   * interactive permission prompt (gated high-impact/automation tools not in
   * the allowlist), or returns a structured failed result for permanently
   * blocked tools so the model can continue (FR-16).
   */
  private async executeScheduledTool(
    name: string,
    args: Record<string, unknown>,
    context: Parameters<AIChatQueryLoopDeps["executeTool"]>[2],
    policy: AiMessageTaskToolPolicy,
    approvalMode: ChatToolApprovalMode | null
  ): Promise<ToolExecutionResult> {
    const skill = SkillRegistry.getSkill(name) ?? null;
    const decision = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy,
      toolName: name,
      approvalMode,
    });

    // Gated high-impact/automation tool not in the allowlist → pause for the
    // user. Synthesize the same needsPermissionPrompt result shape that
    // SkillExecutor produces so the loop's isPermissionPromptResult detection
    // fires and the turn parks in pendingPermissions. Never fail closed for a
    // tool the user could grant.
    if (!decision.allowed && decision.requiresInteractivePermission) {
      return this.permissionPromptResult(name, context, skill, args);
    }

    if (!decision.allowed) {
      return this.blockedToolResult(
        name,
        context,
        decision.reason ??
          `Tool "${name}" is blocked by the scheduled task policy.`
      );
    }
    return SkillExecutor.execute(name, args, {
      ...context,
      skipPermissionCheck: true,
    });
  }

  /**
   * Synthesize a permission-prompt {@link ToolExecutionResult} for a gated
   * scheduled tool call, mirroring SkillExecutor's permission-prompt result
   * shape so the loop pauses the turn and the existing permission-card UI
   * renders. The skill's buildPermissionPreview (if any) attaches a
   * metadata-only preview; items are display-only and re-validated by the
   * skill after approval.
   */
  private permissionPromptResult(
    name: string,
    context: Parameters<AIChatQueryLoopDeps["executeTool"]>[2],
    skill: SkillDefinition | null,
    args: Record<string, unknown>
  ): ToolExecutionResult {
    const preview = skill?.buildPermissionPreview?.(args);
    return {
      tool_call_id: context.toolCallId ?? name,
      tool_name: name,
      success: false,
      result: {
        error: "Permission required",
        needsPermissionPrompt: true,
        permissionCategory: skill?.permissionCategory,
        ...(preview ? { permissionPreview: preview } : {}),
      },
      execution_time_ms: 0,
    };
  }

  /** Build a structured failed tool result for a blocked scheduled tool call. */
  private blockedToolResult(
    name: string,
    context: Parameters<AIChatQueryLoopDeps["executeTool"]>[2],
    reason: string
  ): ToolExecutionResult {
    return {
      tool_call_id: context.toolCallId ?? name,
      tool_name: name,
      success: false,
      result: { error: reason, blocked_by_scheduled_policy: true },
      execution_time_ms: 0,
    };
  }
}
