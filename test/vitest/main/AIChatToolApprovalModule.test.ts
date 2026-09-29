import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression tests for AIChatToolApprovalModule startup-reset behavior.
 *
 * The scheduled-loop runner (ScheduledAiMessageRunner →
 * AIChatQueryEngineFactory.createScheduled) resolves the conversation's
 * approval mode via getModeForScheduledRunner(). BackgroundScheduler can fire
 * a scheduled occurrence at app startup — before the user ever opens the chat
 * or re-selects "Full access". This suite proves that:
 *
 *  1. The interactive getMode() downgrades a persisted full_access on the
 *     first read of a fresh process (PRD §4.3 session consent) — the original
 *     bug that parked unattended turns behind permission cards.
 *  2. getModeForScheduledRunner() EXEMPTS conversations with an active
 *     scheduled loop from that downgrade, so unattended turns auto-approve.
 *  3. The exemption is precise: a conversation with no active schedule still
 *     downgrades (the loop was deleted/expired), preserving PRD §4.3.
 *  4. approve_for_me passes through unchanged on both paths.
 *  5. A DB lookup failure on the scheduled-runner path falls back to the
 *     interactive downgrade rather than escalating — a transient error must
 *     not promote full_access for a conversation that may not have a loop.
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
  // A fresh module graph resets the process-static downgradedThisProcess /
  // fullAccessExplicitlySet flags, simulating a new app process.
  vi.resetModules();
  return await import("@/modules/AIChatToolApprovalModule");
}

beforeEach(() => {
  tokenStore.clear();
  loopStore.clear();
});

const modeKey = (conv: string) =>
  `AI_CHAT_V2_TOOL_APPROVAL_MODE_${conv}`;

describe("AIChatToolApprovalModule — interactive getMode startup reset", () => {
  it("downgrades persisted full_access on the first read of a fresh process (bug repro)", async () => {
    // Simulate a PRIOR session: the user set full_access and it persisted to
    // disk (the Token store). The process then quit.
    tokenStore.set(modeKey("v2-conv-1"), "full_access");

    // Fresh process: no setMode("full_access") has run here, so the
    // fullAccessExplicitlySet flag is false. The scheduled runner fires at
    // startup (catch-up occurrence) and is the FIRST reader of the mode via
    // the interactive getMode().
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = module.getMode("v2-conv-1");

    // This documents the root cause: the first interactive read downgrades
    // full_access to ask_for_approval before the scheduled runner can use it,
    // so unattended turns see ask_for_approval and park for a permission card.
    expect(mode).toBe("ask_for_approval");
  });

  it("does NOT downgrade when the user re-selected full_access in the current process", async () => {
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    // The user opens the chat and re-selects full_access in THIS process.
    module.setMode("v2-conv-2", "full_access");

    // Now the scheduled runner reads it — the explicit-set flag is true.
    const mode = module.getMode("v2-conv-2");
    expect(mode).toBe("full_access");
  });

  it("passes approve_for_me through unchanged", async () => {
    tokenStore.set(modeKey("v2-conv-3"), "approve_for_me");
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    expect(module.getMode("v2-conv-3")).toBe("approve_for_me");
  });
});

describe("AIChatToolApprovalModule — getModeForScheduledRunner (the fix)", () => {
  it("honors persisted full_access when the conversation has an active scheduled loop", async () => {
    // Prior session: user granted full_access and configured a scheduled loop.
    tokenStore.set(modeKey("v2-conv-loop"), "full_access");
    loopStore.set("v2-conv-loop", "active");

    // Fresh process — BackgroundScheduler fires catch-up as the FIRST reader.
    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("v2-conv-loop");

    // The fix: the scheduled-runner path exempts conversations with an active
    // loop from the startup reset, so unattended turns auto-approve.
    expect(mode).toBe("full_access");
  });

  it("still downgrades when the conversation has NO active scheduled loop", async () => {
    // Prior session: user granted full_access, but the loop was deleted or
    // expired before restart. There is no active schedule for this conv.
    tokenStore.set(modeKey("v2-conv-noloop"), "full_access");
    // loopStore has no entry for "v2-conv-noloop" → findChatScheduledLoop
    // returns null.

    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("v2-conv-noloop");

    // PRD §4.3 still applies: no active schedule means the user is not
    // expecting unattended full_access turns on this conversation.
    expect(mode).toBe("ask_for_approval");
  });

  it("falls back to the interactive downgrade when the schedule lookup throws", async () => {
    // Transient DB error on the schedule lookup must NOT escalate full_access
    // for a conversation that may not have a loop.
    tokenStore.set(modeKey("v2-conv-dberr"), "full_access");
    loopStore.set("v2-conv-dberr", "throw");

    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    const mode = await module.getModeForScheduledRunner("v2-conv-dberr");

    // Safe fallback: downgrade rather than promote on an unknown state.
    expect(mode).toBe("ask_for_approval");
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

  // Regression: the interactive getMode() startup-reset (PRD §4.3) used to
  // PERSIST the full_access → ask_for_approval downgrade to the Token store on
  // the first read of a fresh process. When the user opened the conversation in
  // the chat UI before the scheduler's catch-up fired, handleGetToolApprovalMode
  // → getMode() overwrote the persisted full_access with ask_for_approval. The
  // scheduled runner then read the now-downgraded persisted value via
  // getModeForScheduledRunner and returned ask_for_approval, so unattended
  // turns (e.g. extract_contact_info, an uncategorized built-in) parked behind
  // a permission card the user was not present to answer — defeating the
  // active-loop exemption.
  //
  // The fix: the interactive downgrade is tracked IN-MEMORY per conversation,
  // never persisted, so the persisted full_access grant survives for the
  // scheduled runner. This test proves the grant survives an interactive
  // getMode() read that fires BEFORE the scheduled runner.
  it("honors full_access for an active loop EVEN after interactive getMode fired first (regression)", async () => {
    // Prior session: user granted full_access and configured a scheduled loop.
    tokenStore.set(modeKey("v2-conv-poisoned"), "full_access");
    loopStore.set("v2-conv-poisoned", "active");

    const { AIChatToolApprovalModule } = await importFreshModule();
    const module = new AIChatToolApprovalModule();

    // The user opens the conversation in the chat UI before the scheduler
    // fires. handleGetToolApprovalMode → getMode() downgrades full_access to
    // ask_for_approval FOR THE INTERACTIVE SESSION, but must NOT overwrite the
    // persisted grant on disk (the poisoning that broke the scheduled runner).
    const interactiveMode = module.getMode("v2-conv-poisoned");
    expect(interactiveMode).toBe("ask_for_approval");
    // The persisted value must STILL be full_access — the downgrade is
    // in-memory only, so the durable grant survives for the scheduled runner.
    expect(tokenStore.get(modeKey("v2-conv-poisoned"))).toBe("full_access");

    // The scheduler fires catch-up. getModeForScheduledRunner honors the
    // SURVIVING persisted full_access because the conversation has an active
    // scheduled loop — the durable unattended consent the loop represents is
    // not defeated by the earlier interactive read.
    const scheduledMode = await module.getModeForScheduledRunner(
      "v2-conv-poisoned"
    );
    expect(scheduledMode).toBe("full_access");
  });
});
