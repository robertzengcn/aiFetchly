// test/vitest/utilitycode/approvedPlanContextBlock.test.ts
//
// Unit tests for buildApprovedPlanContextBlock — the mode-independent
// injection that carries an approved plan's markdown into execution rounds
// after the chat returns to "chat" mode (where buildPlanModeSystemPrompt is
// no longer used).

import { describe, expect, it } from "vitest";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import { buildApprovedPlanContextBlock } from "@/service/ApprovedPlanContextBlock";

const MARKDOWN = "# Campaign plan\n1. Step one\n2. Step two";

function makeApproved(
  overrides: Partial<AIChatPlanStateView> = {}
): AIChatPlanStateView {
  return {
    conversationId: "v2-conv",
    planId: "plan-1",
    status: "approved",
    title: "Campaign plan",
    objective: "Launch a Facebook campaign",
    currentVersion: 1,
    approvedAt: "2026-09-03T12:00:00.000Z",
    latestVersion: {
      planId: "plan-1",
      version: 1,
      planMarkdown: MARKDOWN,
      createdAt: "2026-09-03T11:00:00.000Z",
      createdBy: "assistant",
    },
    ...overrides,
  };
}

describe("buildApprovedPlanContextBlock", () => {
  it("includes the plan markdown so the model can see the steps to execute", () => {
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved(),
    });
    expect(block).toContain(MARKDOWN);
  });

  it("states that the plan is approved and execution should begin", () => {
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved(),
    });
    expect(block).toMatch(/approved/i);
    expect(block).toMatch(/execute/i);
  });

  it("includes title, objective, plan id, and version", () => {
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved(),
    });
    expect(block).toContain("Title: Campaign plan");
    expect(block).toContain("Objective: Launch a Facebook campaign");
    expect(block).toContain("Plan ID: plan-1");
    expect(block).toContain("Current version: 1");
  });

  it("includes the approved-at timestamp when present", () => {
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved(),
    });
    expect(block).toContain("Approved at: 2026-09-03T12:00:00.000Z");
  });

  it("omits the approved-at line when not set", () => {
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved({ approvedAt: undefined }),
    });
    expect(block).not.toContain("Approved at");
  });

  it("truncates plan markdown at the 4000-char cap to bound context size", () => {
    const long = "x".repeat(6000);
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved({
        latestVersion: {
          planId: "plan-1",
          version: 1,
          planMarkdown: long,
          createdAt: "2026-09-03T11:00:00.000Z",
          createdBy: "assistant",
        },
      }),
    });
    // The markdown region is fenced; the 6000-char input must be sliced to 4000.
    expect(block).toContain("x".repeat(4000));
    expect(block).not.toContain("x".repeat(4001));
  });

  it("omits the markdown section when latestVersion is absent", () => {
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved({ latestVersion: undefined }),
    });
    expect(block).not.toContain("Plan markdown");
    expect(block).toContain("Plan ID: plan-1");
  });

  it("handles a missing objective gracefully", () => {
    const block = buildApprovedPlanContextBlock({
      planState: makeApproved({ objective: "" }),
    });
    expect(block).toContain("Objective: (not set)");
  });
});
