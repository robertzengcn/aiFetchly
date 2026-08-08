import { describe, expect, it } from "vitest";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import { isPlanStateActive } from "@/views/components/aiChatV2/planStateUtil";

const makeState = (
  status: AIChatPlanStateView["status"]
): AIChatPlanStateView => ({
  conversationId: "conv-1",
  planId: "plan-1",
  status,
  title: "Test plan",
  objective: "Test objective",
  currentVersion: 1,
});

describe("planStateUtil - isPlanStateActive", () => {
  it("returns false for null (no plan state)", () => {
    expect(isPlanStateActive(null)).toBe(false);
  });

  it.each([
    "draft",
    "awaiting_question",
    "awaiting_approval",
    "approved",
    "executing",
  ] as const)("returns true for an in-progress plan status (%s)", (status) => {
    expect(isPlanStateActive(makeState(status))).toBe(true);
  });

  it.each(["completed", "cancelled", "rejected"] as const)(
    "returns false for a terminal plan status (%s)",
    (status) => {
      expect(isPlanStateActive(makeState(status))).toBe(false);
    }
  );
});
