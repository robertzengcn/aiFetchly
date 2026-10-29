import { windowInvoke } from "@/views/utils/apirequest";
import { AI_CHAT_WORKSPACE_ACTION_COUNT } from "@/config/channellist";
import type { AIChatWorkspaceActionCapability } from "@/service/AIChatQueueCounters";

/**
 * Renderer → main workspace action count (R8 §2, design §18.1 / PRD §20).
 *
 * Actions that happen RENDERER-side (report dialog opened, generated-image
 * chooser open, batch confirm/retry/stop, voice record/playback/install/
 * capability-state) count into the SAME bounded workspace action counter the
 * main-process handlers use. Fire-and-forget: metrics must never break or
 * delay the user action, so every failure is swallowed.
 *
 * Labels are bounded enum-like tokens (validated again by the main-process
 * zod schema) — never prompts, file names, paths, tokens, or payloads.
 */
export async function recordWorkspaceActionCount(
  capability: AIChatWorkspaceActionCapability,
  action: string,
  outcome: string
): Promise<void> {
  try {
    await windowInvoke(AI_CHAT_WORKSPACE_ACTION_COUNT, {
      capability,
      action,
      outcome,
    });
  } catch {
    // Metrics are best-effort — a missing/unavailable channel must not
    // surface to the user.
  }
}
