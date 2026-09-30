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

  constructor() {
    this.token = new Token();
  }

  /**
   * Resolve the persisted approval mode for a conversation.
   *
   * `full_access` is honored as-is across app restarts (PRD §4.3 override,
   * 2026-09-29: the prior session-consent downgrade that reset
   * `full_access` → `ask_for_approval` on the first read of a fresh process
   * was removed by product-owner decision — loading a chat from history now
   * restores the persisted mode, including `full_access`). The one-time
   * enable-time confirmation dialog in the selector is the consent gate.
   *
   * `approve_for_me` is a persisted productivity preference and passes through
   * unchanged. Anything else (unset / unrecognized) falls back to the safe
   * default.
   */
  getMode(conversationId: string): ChatToolApprovalMode {
    if (!conversationId) return DEFAULT_MODE;
    const raw = this.token.getValue(tokenKey(conversationId));
    if (raw === "approve_for_me") {
      return raw;
    }
    if (raw === "full_access") {
      return "full_access";
    }
    return DEFAULT_MODE;
  }

  /**
   * Persist the approval mode for a conversation. Every mode — including
   * `full_access` — is written to the Token store and survives app restarts.
   */
  setMode(conversationId: string, mode: ChatToolApprovalMode): void {
    if (!conversationId) return;
    this.token.setValue(tokenKey(conversationId), mode);
  }

  /**
   * Resolve the approval mode for an UNATTENDED (scheduled-loop) turn.
   *
   * `BackgroundScheduler` can fire a scheduled occurrence at app startup
   * (catch-up). This method honors the persisted `full_access` for
   * conversations with an ACTIVE scheduled loop: the loop's existence is the
   * durable signal that the user configured unattended full_access turns.
   *
   * For a conversation whose persisted mode is `full_access` but whose
   * schedule lookup returns NO active loop, the persisted mode is still
   * honored via `getMode` (the runner only fires for active schedules, so the
   * no-loop case is a race/deletion edge case — persisted intent wins).
   *
   * If the schedule lookup ITSELF throws (transient DB error during unattended
   * execution — e.g. SQLITE_BUSY on the re-query), the method honors the
   * persisted mode via `getMode` rather than downgrading. After the PRD §4.3
   * override made `full_access` durable consent, the persisted grant IS the
   * trusted signal; `ScheduledAiMessageRunner` verifies `schedule.is_active`
   * upstream before reaching `createScheduled`, so the re-query here is
   * vestigial and its transient failure carries no consent signal. The Token
   * read above (`:102`) just succeeded, so the DB was readable milliseconds
   * prior. Downgrading on this transient error used to strip a scheduled
   * outreach loop of its lead-discovery tools mid-run: the three outreach
   * tools (`scrape_urls_from_search_engine`, `extract_contact_info`,
   * `read_url_content`) were filtered out before catalog building and even
   * `tool_catalog_search` could not surface them. The schedule-existence
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
      // full_access (the user configured it to run unattended).
      try {
        const model = await getScheduleTaskModel();
        const hasActiveLoop =
          (await model.findChatScheduledLoop(conversationId)) != null;
        if (hasActiveLoop) return "full_access";
      } catch {
        // Transient DB error on the vestigial schedule re-query (e.g.
        // SQLITE_BUSY). The persisted full_access grant is durable consent
        // (PRD §4.3 override), the Token read above just succeeded, and
        // ScheduledAiMessageRunner verifies schedule.is_active upstream
        // before createScheduled — so this transient failure carries no
        // consent signal. Honor persisted intent (matching the no-active-loop
        // branch) instead of downgrading, which used to strip the outreach
        // loop's scraping/contact tools mid-run.
        return this.getMode(conversationId);
      }
      // No active loop found — still honor the persisted full_access via the
      // interactive resolution (the runner only fires for active schedules, so
      // this is a race/deletion edge case; persisted intent wins).
      return this.getMode(conversationId);
    }
    return DEFAULT_MODE;
  }
}
