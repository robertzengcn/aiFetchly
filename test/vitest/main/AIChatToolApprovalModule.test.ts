import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression tests for AIChatToolApprovalMode persistence behavior.
 *
 * The scheduled-loop runner (ScheduledAiMessageRunner →
 * AIChatQueryEngineFactory.createScheduled) resolves the conversation's
 * approval mode via getModeForScheduledRunner(). BackgroundScheduler can fire
 * a scheduled occurrence at app startup — before the user ever opens the chat.
 * This suite proves that:
 *
 *  1. Persisted full_access SURVIVES a fresh process on the interactive
 *     getMode() path (PRD §4.3 override, 2026-09-29: full_access persists
 *     across restarts; the prior session-consent downgrade was removed).
 *  2. getModeForScheduledRunner() honors persisted full_access for a
 *     conversation with an active scheduled loop, so unattended turns
 *     auto-approve.
 *  3. A conversation with persisted full_access but NO active scheduled loop
 *     still returns full_access on the scheduled path (persisted intent wins;
 *     the runner only fires for active schedules so this is a race/deletion
 *     edge case).
 *  4. A transient DB error on the schedule lookup does NOT downgrade a
 *     persisted `full_access` grant. After the PRD §4.3 override made
 *     `full_access` durable consent (and ScheduledAiMessageRunner verifies
 *     the schedule is active upstream at `:253` before `createScheduled`),
 *     the re-query inside `getModeForScheduledRunner` is vestigial; its
 *     transient failure carries no consent signal. A transient SQLITE_BUSY
 *     used to silently strip a scheduled outreach loop of its scraping/contact
 *     tools mid-run — `full_access` reverted to `ask_for_approval`, the three
 *     outreach tools (`scrape_urls_from_search_engine`, `extract_contact_info`,
 *     `read_url_content`) were filtered out before catalog building, and even
 *     `tool_catalog_search` could not surface them. Honoring persisted intent
 *     here aligns the DB-error case with the no-active-loop case.
 *  5. approve_for_me passes through unchanged on both paths.
 */

// --- In-memory backing stores so persisted mode survives a "restart" ---
const tokenStore = new Map<string, string>();

// Controls whether findChatScheduledLoop reports an active loop for a given
// conversation. undefined → no loop; object → loop exists; "throw" → simulate
// a DB error.
const loopStore = new Map<string, "active" | "throw">();

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      return tokenStore.get(key) ?? "";
    }
    setValue(key: string, value: string): void {
      tokenStore.set(key, value);
    }
  },
}));

vi.mock("@/model/ScheduleTask.model", () => ({
  ScheduleTaskModel: class {
    async findChatScheduledLoop(conversationId: string) {
      const state = loopStore.get(conversationId);
      if (state === "throw") {
        throw new Error("simulated DB error");
      }
      if (state === "active") {
        return {
          id: 1,
          source_conversation_id: conversationId,
          is_active: true,
          trigger_type: "interval",
        };
      }
      return null;
    }
  },
}));

async function importFreshModule(): Promise<
  typeof import("@/modules/AIChatToolApprovalModule")
> {
  // A fresh module graph simulates a new app process. (There are no
  // process-static flags after the §4.3 override, but resetting keeps the
  // harness stable for future state.)
  vi.resetModules();
  return await import("@/modules/AIChatToolApprovalModule");
}

beforeEach(() => {
  tokenStore.clear();
  loopStore.clear();
});

const modeKey = (conv: string) =>
  `AI_CHAT_V2_TOOL_APPROVAL_MODE_${conv}`;

describe("AIChatToolApprovalModule — interactive getMode persistence", () => {
  it("restores persisted full_access on the first read of a fresh process", async () => {
    // Simulate a PRIOR session: the user set full_access and it persisted to
    // disk (the Token store). The process then quit.
    tokenStore.set(modeKey("v2-conv-1"), "full_access");

    // Fresh process — the load-from-history path reads the mode via
    // interactive getMode(). PRD §4.3 override: full_access survives restarts.
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = module.getMode("v2-conv-1");

    // full_access is restored, not downgraded — load-from-history shows the
    // persisted mode the user chose.
    expect(mode).toBe("full_access");
  });

  it("round-trips: setMode full_access then getMode returns full_access", async () => {
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    module.setMode("v2-conv-2", "full_access");

    expect(module.getMode("v2-conv-2")).toBe("full_access");
  });

  it("passes approve_for_me through unchanged", async () => {
    tokenStore.set(modeKey("v2-conv-3"), "approve_for_me");
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    expect(module.getMode("v2-conv-3")).toBe("approve_for_me");
  });
});

describe("AIChatToolApprovalModule — getModeForScheduledRunner", () => {
  it("honors persisted full_access when the conversation has an active scheduled loop", async () => {
    // Prior session: user granted full_access and configured a scheduled loop.
    tokenStore.set(modeKey("v2-conv-loop"), "full_access");
    loopStore.set("v2-conv-loop", "active");

    // Fresh process — BackgroundScheduler fires catch-up as the FIRST reader.
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("v2-conv-loop");

    // The scheduled-runner path honors persisted full_access for an active
    // loop, so unattended turns auto-approve.
    expect(mode).toBe("full_access");
  });

  it("returns full_access for a conversation with NO active scheduled loop", async () => {
    // Prior session: user granted full_access, but the loop was deleted or
    // expired before restart. Persisted intent is still full_access.
    tokenStore.set(modeKey("v2-conv-noloop"), "full_access");
    // loopStore has no entry for "v2-conv-noloop" → findChatScheduledLoop
    // returns null.

    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("v2-conv-noloop");

    // No active schedule is a race/deletion edge case (the runner only fires
    // for active schedules). Persisted intent wins → full_access.
    expect(mode).toBe("full_access");
  });

  it("honors persisted full_access when the schedule lookup throws (transient DB error must not strip scheduled-loop tools)", async () => {
    // Regression: a transient DB error (e.g. SQLITE_BUSY) on the
    // findChatScheduledLoop re-query used to downgrade a persisted full_access
    // grant to ask_for_approval on the scheduled path. That downgrade was the
    // ONLY non-full_access outcome for a persisted-full_access conversation
    // (the active-loop branch returns full_access; the no-loop branch returns
    // full_access). With approvalMode no longer full_access, the scheduled
    // toolFilter (canAutoApproveScheduledTool) removed the three outreach
    // tools — scrape_urls_from_search_engine / extract_contact_info /
    // read_url_content (uncategorized built-ins, absent from all three
    // curated tiers) — BEFORE the deferred catalog was built, so even
    // tool_catalog_search could not surface them; BuiltInToolCapabilitiesPromptSection
    // advertises them in the system prompt, so the model searched, found
    // nothing, and reported the tools "not available in this session".
    //
    // Post-§4.3 override, persisted full_access IS the durable unattended
    // consent signal, and ScheduledAiMessageRunner verifies schedule.is_active
    // upstream before createScheduled — so the re-query is vestigial and its
    // transient failure carries no consent signal. Honor persisted intent,
    // matching the no-active-loop branch.
    tokenStore.set(modeKey("v2-conv-dberr"), "full_access");
    loopStore.set("v2-conv-dberr", "throw");

    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("v2-conv-dberr");

    // Persisted full_access survives a transient schedule-lookup DB error —
    // the outreach loop keeps its lead-discovery tools.
    expect(mode).toBe("full_access");
  });

  it("passes approve_for_me through unchanged", async () => {
    tokenStore.set(modeKey("v2-conv-afm"), "approve_for_me");
    loopStore.set("v2-conv-afm", "active");

    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("v2-conv-afm");
    expect(mode).toBe("approve_for_me");
  });

  it("returns default mode for an empty conversationId", async () => {
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("");
    expect(mode).toBe("ask_for_approval");
  });

  // Regression guard: an interactive getMode() read that fires BEFORE the
  // scheduled runner must not poison the persisted value. (The original bug
  // persisted the downgrade to disk; a prior fix made the downgrade in-memory,
  // and the §4.3 override removed the downgrade entirely. This test guards
  // against reintroducing persistence poisoning of any kind.)
  it("honors full_access for an active loop EVEN after interactive getMode fired first (regression)", async () => {
    // Prior session: user granted full_access and configured a scheduled loop.
    tokenStore.set(modeKey("v2-conv-poisoned"), "full_access");
    loopStore.set("v2-conv-poisoned", "active");

    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    // The user opens the conversation in the chat UI before the scheduler
    // fires. handleGetToolApprovalMode → getMode() must return full_access
    // (persisted intent), and must NOT overwrite the persisted grant on disk.
    const interactiveMode = module.getMode("v2-conv-poisoned");
    expect(interactiveMode).toBe("full_access");
    expect(tokenStore.get(modeKey("v2-conv-poisoned"))).toBe("full_access");

    // The scheduler fires catch-up. getModeForScheduledRunner honors the
    // persisted full_access because the conversation has an active scheduled
    // loop — the durable unattended consent the loop represents is intact.
    const scheduledMode = await module.getModeForScheduledRunner(
      "v2-conv-poisoned"
    );
    expect(scheduledMode).toBe("full_access");
  });
});
