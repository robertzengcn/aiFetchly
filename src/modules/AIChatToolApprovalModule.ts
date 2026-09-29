import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import type { ChatToolApprovalMode } from "@/entityTypes/aiChatV2Types";
import type { ScheduleTaskModel } from "@/model/ScheduleTask.model";

const TOOL_APPROVAL_MODE_PREFIX = "AI_CHAT_V2_TOOL_APPROVAL_MODE_";
const DEFAULT_MODE: ChatToolApprovalMode = "ask_for_approval";

function tokenKey(conversationId: string): string {
  return `${TOOL_APPROVAL_MODE_PREFIX}${conversationId}`;
}

/**
 * Lazily-built schedule model. Constructed on first scheduled-runner read
 * only, so the interactive `getMode` hot path (called per tool call) never
 * pays for a repository / dbpath lookup. The scheduled runner reads the
 * mode once per occurrence, where a single `findChatScheduledLoop` query is
 * acceptable.
 *
 * The dbpath is resolved from the Token service (same source as BaseModule /
 * BackgroundScheduler) so the model's repository points at the user's live
 * SQLite connection, not the fallback temp dir.
 *
 * Returns a Promise (dynamic import) so:
 *  - TypeORM repositories are not loaded at module import time, keeping the
 *    interactive hot path cheap;
 *  - the lazy load is reliably intercepted by vitest module mocks (an ESM
 *    `import()` matches vi.mock keys, whereas CommonJS `require` does not).
 */
async function getScheduleTaskModel(): Promise<ScheduleTaskModel> {
  const { ScheduleTaskModel } = await import("@/model/ScheduleTask.model");
  const dbpath = new Token().getValue(USERSDBPATH);
  return new ScheduleTaskModel(dbpath);
}

export class AIChatToolApprovalModule {
  private token: Token;

  /**
   * Conversation IDs whose persisted `full_access` has been downgraded to
   * `ask_for_approval` IN-MEMORY during this process (PRD §4.3 startup-reset).
   *
   * The downgrade is deliberately NOT persisted: persisting it would overwrite
   * the durable `full_access` grant on disk, so when the user opens the chat
   * conversation before `BackgroundScheduler` fires a catch-up occurrence, the
   * interactive `getMode` would poison the store and `getModeForScheduledRunner`
   * would later read the downgraded value and park every unattended tool behind
   * a permission card the user is not present to answer. Tracking the reset
   * in-memory (per conversation) keeps the persisted grant intact as the durable
   * intent for scheduled loops while still downgrading interactive reads.
   */
  private static downgradedThisProcess: Set<string> = new Set();

  /**
   * Set to true whenever setMode("full_access") is called in this
   * process. The startup reset in getMode() checks this flag: if the
   * user explicitly re-selected "Full access" in the current session,
   * we do NOT downgrade it. This preserves the security guarantee that
   * full_access does not survive across app restarts while allowing
   * the user to enable it within a session.
   */
  private static fullAccessExplicitlySet = false;

  constructor() {
    this.token = new Token();
  }

  getMode(conversationId: string): ChatToolApprovalMode {
    if (!conversationId) return DEFAULT_MODE;
    const raw = this.token.getValue(tokenKey(conversationId));
    if (raw === "approve_for_me") {
      return raw;
    }
    if (raw === "full_access") {
      // If the user explicitly re-selected "Full access" in this session,
      // honor it as-is — do NOT fire the startup-reset on tool-execution
      // reads right after the user set it.
      if (AIChatToolApprovalModule.fullAccessExplicitlySet) {
        return raw;
      }
      // PRD §4.3 startup-reset: downgrade full_access on the first read of a
      // fresh process. Tracked IN-MEMORY per conversation (see the comment on
      // `downgradedThisProcess`) so the persisted grant survives for the
      // scheduled runner. Subsequent reads in this process stay downgraded.
      if (AIChatToolApprovalModule.downgradedThisProcess.has(conversationId)) {
        return DEFAULT_MODE;
      }
      AIChatToolApprovalModule.downgradedThisProcess.add(conversationId);
      return DEFAULT_MODE;
    }
    return DEFAULT_MODE;
  }

  setMode(conversationId: string, mode: ChatToolApprovalMode): void {
    if (!conversationId) return;
    if (mode === "full_access") {
      AIChatToolApprovalModule.fullAccessExplicitlySet = true;
      // Re-selecting full_access clears any in-memory startup-reset downgrade
      // recorded for this conversation so subsequent reads honor full_access.
      AIChatToolApprovalModule.downgradedThisProcess.delete(conversationId);
    } else {
      // Explicitly choosing a non-full_access mode also clears the in-memory
      // downgrade flag — the persisted value is now authoritative for this
      // conversation.
      AIChatToolApprovalModule.downgradedThisProcess.delete(conversationId);
    }
    this.token.setValue(tokenKey(conversationId), mode);
  }

  /**
   * Resolve the approval mode for an UNATTENDED (scheduled-loop) turn.
   *
   * The interactive `getMode` startup-reset (PRD §4.3) downgrades a persisted
   * `full_access` to `ask_for_approval` on the first read of a fresh process,
   * treating full_access as a session consent that must NOT survive a restart
   * silently. That reset is correct for ad-hoc interactive chats: a user who
   * forgot full_access on should not stay in full_access after a restart. The
   * downgrade is tracked IN-MEMORY per conversation (never persisted), so the
   * persisted grant survives as durable intent for scheduled loops.
   *
   * `BackgroundScheduler` can fire a scheduled occurrence at app startup
   * (catch-up) — possibly AFTER the user has already opened the chat
   * conversation and the interactive `getMode` recorded its in-memory
   * downgrade. This method must still honor the persisted `full_access` for
   * conversations with an ACTIVE scheduled loop, because the loop's existence
   * is the durable signal that the user configured unattended full_access
   * turns. Without that exemption, the scheduled turn would see
   * `ask_for_approval` and park every tool behind a permission card the user
   * is not present to answer.
   *
   * The exemption is precise: a conversation with NO active schedule falls
   * through to `getMode` (honoring the in-memory interactive downgrade),
   * preserving PRD §4.3 for conversations that lost their schedule. The
   * schedule-existence check runs once per scheduled occurrence (an acceptable
   * cost); the interactive hot path never calls this method.
   */
  async getModeForScheduledRunner(
    conversationId: string
  ): Promise<ChatToolApprovalMode> {
    if (!conversationId) return DEFAULT_MODE;
    const raw = this.token.getValue(tokenKey(conversationId));
    if (raw === "approve_for_me") return raw;
    if (raw === "full_access") {
      // A scheduled loop exists for this conversation → honor the persisted
      // full_access across restarts (the user configured it to run unattended).
      // Falls back to the interactive startup-reset when no active schedule is
      // found, preserving PRD §4.3 for conversations that lost their schedule.
      try {
        const model = await getScheduleTaskModel();
        const hasActiveLoop =
          (await model.findChatScheduledLoop(conversationId)) != null;
        if (hasActiveLoop) return "full_access";
      } catch {
        // If the schedule lookup fails, fall through to getMode's interactive
        // semantics rather than escalating — a transient DB error should not
        // promote full_access for a conversation that may not have a schedule.
      }
      return this.getMode(conversationId);
    }
    return DEFAULT_MODE;
  }
}
