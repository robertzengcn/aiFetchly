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
   * Tracks whether the startup-reset has already been applied in this
   * process. When true, full_access reads pass through as-is.
   */
  private static startupResetApplied = false;

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
      // Downgrade full_access on first read after app startup (PRD §4.3),
      // but ONLY if the user has NOT explicitly re-selected it in this
      // session. This prevents the reset from firing on tool-execution
      // reads right after the user set "Full access".
      if (
        !AIChatToolApprovalModule.startupResetApplied &&
        !AIChatToolApprovalModule.fullAccessExplicitlySet
      ) {
        AIChatToolApprovalModule.startupResetApplied = true;
        this.setMode(conversationId, "ask_for_approval");
        return "ask_for_approval";
      }
      return raw;
    }
    return DEFAULT_MODE;
  }

  setMode(conversationId: string, mode: ChatToolApprovalMode): void {
    if (!conversationId) return;
    if (mode === "full_access") {
      AIChatToolApprovalModule.fullAccessExplicitlySet = true;
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
   * forgot full_access on should not stay in full_access after a restart.
   *
   * But `BackgroundScheduler` can fire a scheduled occurrence at app startup
   * (catch-up) as the FIRST reader of the conversation's mode — before the
   * user re-opens the chat or re-selects full_access. If that first read
   * downgrades, the scheduled turn sees `ask_for_approval` and parks every
   * tool behind a permission card the user is not present to answer. The
   * scheduled loop the user explicitly configured to run unattended with
   * full_access silently loses the grant it was created with.
   *
   * This method exempts conversations that have an ACTIVE scheduled loop from
   * the startup-reset: the user's persisted full_access is honored as the
   * durable intent for that scheduled conversation, while conversations with
   * no active schedule keep the interactive downgrade. The schedule-existence
   * check runs once per scheduled occurrence (an acceptable cost); the
   * interactive hot path never calls this method.
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
