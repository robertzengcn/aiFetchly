import { describe, expect, it } from "vitest";
import type { AiMessageTaskRunStatus } from "@/entityTypes/aiMessageTaskTypes";

describe("AiMessageTaskRunStatus includes recovery-visible statuses", () => {
  it("accepts 'incomplete' (PRD §6.1, FR-12)", () => {
    const s: AiMessageTaskRunStatus = "incomplete";
    expect(s).toBe("incomplete");
  });

  it("accepts 'needs_user_input' (PRD §6.1, FR-07/12)", () => {
    const s: AiMessageTaskRunStatus = "needs_user_input";
    expect(s).toBe("needs_user_input");
  });

  it("still accepts the pre-existing statuses (additive)", () => {
    const legacy: AiMessageTaskRunStatus[] = [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
      "blocked_by_policy",
      "timeout",
      "waiting_for_conversation",
      "coalesced",
      "interrupted",
    ];
    expect(legacy).toContain("completed");
  });
});
