import { AiChatApi } from "@/api/aiChatApi";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatModelFallbackService } from "@/service/AIChatModelFallbackService";
import { AIChatToolApprovalModule } from "@/modules/AIChatToolApprovalModule";
import { evaluateToolApproval } from "@/service/AIChatToolApprovalPolicyService";

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
 *
 * The loop deps mirror the interactive construction. Tool execution honors the
 * conversation's tool-approval mode; a scheduled turn that needs an
 * unapproved tool surfaces as a pause (FR-16) rather than an interactive prompt.
 */
export class AIChatQueryEngineFactory {
  /**
   * Create a dedicated engine for a scheduled occurrence. Optional interactive
   * services (compact agent, auto-dream) are omitted — the engine runs fine
   * without them; all deps are optional.
   */
  createScheduled(): AIChatQueryEngine {
    return new AIChatQueryEngine(this.createQueryLoop(), {});
  }

  /** Build the production query loop with real service deps. */
  private createQueryLoop(): AIChatQueryLoop {
    const deps: AIChatQueryLoopDeps = {
      streamChatCompletion: (request, onChunk, options) => {
        const api = new AiChatApi();
        return api.openAIChatCompletionStream(request, onChunk, options);
      },
      executeTool: (name, args, context) => {
        // Honor the conversation's tool-approval mode; auto-approve eligible
        // tools without an interactive prompt. Tools that require approval in
        // ask_for_approval mode surface as a pause the scheduler handles.
        if (context.conversationId) {
          try {
            const module = new AIChatToolApprovalModule();
            const mode = module.getMode(context.conversationId);
            if (mode !== "ask_for_approval") {
              const decision = evaluateToolApproval({
                conversationId: context.conversationId,
                mode,
                toolName: name,
                isDependencyInstall: name.startsWith(
                  "install_system_dependency"
                ),
              });
              if (decision.autoApprove) {
                context = { ...context, skipPermissionCheck: true };
              }
            }
          } catch {
            // Non-fatal: fall back to the normal permission flow.
          }
        }
        return SkillExecutor.execute(name, args, context);
      },
      getSkillDefinition: (name) => SkillRegistry.getSkill(name) ?? undefined,
      resolveFallbackModel: async ({ originalModel, currentModel, reason }) => {
        const svc = new AIChatModelFallbackService();
        return svc.resolve({ originalModel, currentModel, reason });
      },
    };
    return new AIChatQueryLoop(deps);
  }
}
