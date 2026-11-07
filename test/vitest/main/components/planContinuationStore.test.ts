import { beforeEach, describe, expect, it } from "vitest";
import {
  savePlanContinuationIntent,
  loadPlanContinuationIntent,
  clearPlanContinuationIntent,
  markPlanContinuationDismissed,
  isPlanContinuationDismissed,
  clearPlanContinuationDismissal,
  loadPlanContinuationDismissed,
} from "@/views/utils/planContinuationStore";

beforeEach(() => {
  localStorage.clear();
});

/**
 * B08: committed plan decisions persist a recoverable continuation intent.
 */
describe("planContinuationStore (B08)", () => {
  it("round-trips an intent per conversation", () => {
    savePlanContinuationIntent({
      conversationId: "conv-a",
      planId: "plan-1",
      version: 3,
      action: "approve-plan",
      feedback: "",
      savedAt: new Date().toISOString(),
    });
    const loaded = loadPlanContinuationIntent("conv-a");
    expect(loaded?.planId).toBe("plan-1");
    expect(loaded?.version).toBe(3);
    expect(loaded?.action).toBe("approve-plan");
    // Per-conversation isolation.
    expect(loadPlanContinuationIntent("conv-b")).toBeNull();
  });

  it("clear removes the intent (acceptance or dismiss)", () => {
    savePlanContinuationIntent({
      conversationId: "conv-a",
      planId: "plan-1",
      version: 1,
      action: "reject-plan",
      feedback: "too vague",
      savedAt: new Date().toISOString(),
    });
    clearPlanContinuationIntent("conv-a");
    expect(loadPlanContinuationIntent("conv-a")).toBeNull();
  });

  it("rejects malformed rows instead of surfacing them", () => {
    localStorage.setItem(
      "aifetchly.plan-continuation.conv-x",
      JSON.stringify({ planId: 42 })
    );
    expect(loadPlanContinuationIntent("conv-x")).toBeNull();
    localStorage.setItem(
      "aifetchly.plan-continuation.conv-y",
      "not-json{{{"
    );
    expect(loadPlanContinuationIntent("conv-y")).toBeNull();
  });
});

/**
 * R12: dismissing a continuation bar must stick across reselection, but
 * only for the exact identity (planId + version + action) — recovered
 * intents for a NEW decision must still surface.
 */
describe("planContinuationStore dismissal tombstones (R12)", () => {
  it("marks + reports an exact identity as dismissed", () => {
    expect(
      isPlanContinuationDismissed({
        conversationId: "conv-a",
        planId: "plan-1",
        version: 1,
        action: "approve-plan",
      })
    ).toBe(false);
    markPlanContinuationDismissed({
      conversationId: "conv-a",
      planId: "plan-1",
      version: 1,
      action: "approve-plan",
    });
    expect(
      isPlanContinuationDismissed({
        conversationId: "conv-a",
        planId: "plan-1",
        version: 1,
        action: "approve-plan",
      })
    ).toBe(true);
    expect(loadPlanContinuationDismissed("conv-a")?.planId).toBe("plan-1");
  });

  it("a different identity for the same conversation is NOT dismissed", () => {
    markPlanContinuationDismissed({
      conversationId: "conv-a",
      planId: "plan-1",
      version: 1,
      action: "approve-plan",
    });
    // New version.
    expect(
      isPlanContinuationDismissed({
        conversationId: "conv-a",
        planId: "plan-1",
        version: 2,
        action: "approve-plan",
      })
    ).toBe(false);
    // Different action.
    expect(
      isPlanContinuationDismissed({
        conversationId: "conv-a",
        planId: "plan-1",
        version: 1,
        action: "reject-plan",
      })
    ).toBe(false);
  });

  it("per-conversation isolation", () => {
    markPlanContinuationDismissed({
      conversationId: "conv-a",
      planId: "plan-1",
      version: 1,
      action: "approve-plan",
    });
    expect(
      isPlanContinuationDismissed({
        conversationId: "conv-b",
        planId: "plan-1",
        version: 1,
        action: "approve-plan",
      })
    ).toBe(false);
  });

  it("clearPlanContinuationDismissal forgets the tombstone", () => {
    markPlanContinuationDismissed({
      conversationId: "conv-a",
      planId: "plan-1",
      version: 1,
      action: "approve-plan",
    });
    clearPlanContinuationDismissal("conv-a");
    expect(
      isPlanContinuationDismissed({
        conversationId: "conv-a",
        planId: "plan-1",
        version: 1,
        action: "approve-plan",
      })
    ).toBe(false);
    expect(loadPlanContinuationDismissed("conv-a")).toBeNull();
  });

  it("rejects malformed tombstones instead of surfacing them", () => {
    localStorage.setItem(
      "aifetchly.plan-continuation-dismissed.conv-y",
      "not-json{{{"
    );
    expect(loadPlanContinuationDismissed("conv-y")).toBeNull();
    expect(
      isPlanContinuationDismissed({
        conversationId: "conv-y",
        planId: "plan-1",
        version: 1,
        action: "approve-plan",
      })
    ).toBe(false);
    localStorage.setItem(
      "aifetchly.plan-continuation-dismissed.conv-z",
      JSON.stringify({ planId: 42 })
    );
    expect(loadPlanContinuationDismissed("conv-z")).toBeNull();
  });
});
