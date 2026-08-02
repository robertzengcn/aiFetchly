import {
  AiChatApi,
  type ToolExecutionResult,
} from "@/api/aiChatApi";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatModelFallbackService } from "@/service/AIChatModelFallbackService";
import { canAutoApproveScheduledTool } from "@/service/ScheduledAiToolPolicy";
import type { AiMessageTaskToolPolicy } from "@/entityTypes/aiMessageTaskTypes";

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
   * Create a dedicated engine for a scheduled occurrence. Tool execution is
   * task-scoped (design §13.3): only allowlisted, policy-approved built-in
   * tools run with auto-approval; everything else returns a structured failed
   * tool result so the model continues. No interactive permission prompt is
   * ever shown (FR-16).
   *
   * Optional interactive services (compact agent, auto-dream) are omitted — the
   * engine runs fine without them; all deps are optional.
   */
  createScheduled(policy: AiMessageTaskToolPolicy): AIChatQueryEngine {
    return new AIChatQueryEngine(this.createQueryLoop(policy), {});
  }

  /** Build the production query loop with task-scoped tool enforcement. */
  private createQueryLoop(policy: AiMessageTaskToolPolicy): AIChatQueryLoop {
    const deps: AIChatQueryLoopDeps = {
      streamChatCompletion: (request, onChunk, options) => {
        const api = new AiChatApi();
        return api.openAIChatCompletionStream(request, onChunk, options);
      },
      executeTool: (name, args, context) =>
        this.executeScheduledTool(name, args, context, policy),
      getSkillDefinition: (name) => SkillRegistry.getSkill(name) ?? undefined,
      resolveFallbackModel: async ({ originalModel, currentModel, reason }) => {
        const svc = new AIChatModelFallbackService();
        return svc.resolve({ originalModel, currentModel, reason });
      },
    };
    return new AIChatQueryLoop(deps);
  }

  /**
   * Task-scoped tool executor for scheduled (unattended) turns.
   *
   * 1. Confirm the requested tool exists in the registry.
   * 2. Revalidate it against the task policy via canAutoApproveScheduledTool.
   * 3. Execute with skipPermissionCheck only when allowed.
   * 4. Otherwise return a structured failed tool result so the model can
   *    continue. Never opens an interactive permission prompt (FR-16).
   */
  private async executeScheduledTool(
    name: string,
    args: Record<string, unknown>,
    context: Parameters<AIChatQueryLoopDeps["executeTool"]>[2],
    policy: AiMessageTaskToolPolicy
  ): Promise<ToolExecutionResult> {
    const skill = SkillRegistry.getSkill(name);
    if (!skill || skill.source !== "built-in") {
      return this.blockedToolResult(name, context, `Tool "${name}" is not available.`);
    }
    const decision = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy,
      toolName: name,
    });
    if (!decision.allowed) {
      return this.blockedToolResult(
        name,
        context,
        decision.reason ?? `Tool "${name}" is blocked by the scheduled task policy.`
      );
    }
    return SkillExecutor.execute(name, args, {
      ...context,
      skipPermissionCheck: true,
    });
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
