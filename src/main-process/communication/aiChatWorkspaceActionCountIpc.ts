import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { aiChatWorkspaceActionCountSchema } from "@/schemas/ipc/aiChatWorkspaceActionCount";
import { AI_CHAT_WORKSPACE_ACTION_COUNT } from "@/config/channellist";
// R8 §2 (design §18.1 / PRD §20): bounded workspace action counter.
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";

/**
 * Register the renderer-originated workspace action counter IPC (R8 §2).
 *
 * Actions that happen RENDERER-side (report dialog opened, generated-image
 * chooser open, batch confirm/retry/stop, voice record/playback/install/
 * capability-state) must count into the SAME workspace action counter the
 * main-process handlers use. The schema bounds every label: capability is a
 * strict enum, action/outcome are short snake tokens — never prompts, file
 * names, paths, tokens, or payloads. Counting failures must never break the
 * user action: the handler always resolves to a standard envelope.
 */
export function registerAiChatWorkspaceActionCountIpcHandlers(): void {
  registerValidatedHandler(
    AI_CHAT_WORKSPACE_ACTION_COUNT,
    aiChatWorkspaceActionCountSchema,
    async (input) => {
      aiChatQueueCounters.recordWorkspaceAction(
        input.capability,
        input.action,
        input.outcome
      );
      return null;
    }
  );
}
