import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { ai_auto_dream_enabled } from "@/config/settinggroupInit";
import { AIAutoDreamService } from "@/service/AIAutoDreamService";
import { AiChatApi } from "@/api/aiChatApi";

/**
 * Shared singleton factory for AIAutoDreamService. Both the chat-v2 IPC
 * (post-turn trigger) and the user-memory IPC (manual runNow) must use the
 * SAME instance so the in-process lock serializes concurrent runs.
 * Two separate instances would each have their own `inFlight` promise,
 * allowing a manual run and a chat-triggered run to race.
 */
let sharedAutoDreamService: AIAutoDreamService | null = null;

export function getSharedAutoDreamService(): AIAutoDreamService {
  if (!sharedAutoDreamService) {
    const tokenService = new Token();
    sharedAutoDreamService = new AIAutoDreamService({
      completeChat: (request) =>
        new AiChatApi().openAIChatCompletion(request),
      isAIEnabled: () => tokenService.getValue(USER_AI_ENABLED) === "true",
      isAutoDreamEnabled: async () => {
        try {
          const v = await new SystemSettingModule().getSettingValue(
            ai_auto_dream_enabled
          );
          return v !== "false";
        } catch (err) {
          console.error(
            "[ai-auto-dream] failed to read system_setting toggle:",
            err
          );
          return true;
        }
      },
    });
  }
  return sharedAutoDreamService;
}

/** Test-only: reset the cached singleton so mocks take effect. */
export function _resetSharedAutoDreamServiceForTesting(): void {
  sharedAutoDreamService = null;
}
