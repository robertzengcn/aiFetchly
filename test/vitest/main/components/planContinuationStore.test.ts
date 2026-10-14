import { beforeEach, describe, expect, it } from "vitest";
import {
  savePlanContinuationIntent,
  loadPlanContinuationIntent,
  clearPlanContinuationIntent,
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
