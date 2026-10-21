/**
 * Regression for the `OUTPUT_NOT_AVAILABLE` denial-recovery class.
 *
 * Background: a model that just received a saved-result receipt for
 * `out_a76191c1...` turned around and called `tool_result_search` with a
 * DIFFERENT id `out_5cb02128...` that the app never issued. The app correctly
 * denied with `OUTPUT_NOT_AVAILABLE` (AC-11 collapses missing/unauthorized so
 * existence never leaks), but returned a BARE stub `{ error }` with no recovery
 * guidance — which invites the model to retry and fabricate further ids. This
 * mirrors the `check_tool_job_status` hallucination class (fix 6a25f7b56):
 * pair every negative lookup result with a recovery instruction.
 *
 * These tests pin the contract that a denial envelope carries a `recovery`
 * field telling the model to use the output_id exactly as printed in a
 * receipt and never to invent one. They FAIL without the fix (no `recovery`
 * field is returned today) and PASS once the handlers add it.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { ToolResultErrorCode } from "@/entityTypes/toolResultTypes";

// Stub the trusted-context factory so these tests never touch a real DB or
// filesystem: we inject a controlled `ToolResultToolContext` whose
// `resolveTarget` reproduces the fabricated-id denial path.
vi.mock("@/service/agentTools/toolResultContext", async () => {
  const actual = await vi.importActual<
    typeof import("@/service/agentTools/toolResultContext")
  >("@/service/agentTools/toolResultContext");
  return {
    ...actual,
    getToolResultContext: () => currentContext,
  };
});

// Keep the metrics singleton from accumulating cross-test state.
vi.mock("@/service/toolResult/ToolResultMetrics", () => ({
  toolResultMetrics: {
    record: () => undefined,
    recordLatency: () => undefined,
  },
}));

// Stub the inline-bound fitter so the success path never runs against the
// real tokenizer; only the denial paths are asserted here.
vi.mock("@/service/toolResult/retrievalInlineBound", () => ({
  fitWrappedRetrievalResult: (input: unknown) => input,
}));
vi.mock("@/service/ToolResultTextUtil", () => ({
  countTextTokens: () => 0,
}));

import { handleToolResultSearch } from "@/service/agentTools/toolResultSearchTool";
import { handleToolResultRead } from "@/service/agentTools/toolResultReadTool";
import type { ToolResultToolContext } from "@/service/agentTools/toolResultContext";

let currentContext: ToolResultToolContext | null = null;

function buildContext(opts: {
  resolveTargetCode?: ToolResultErrorCode;
  noTrustedContext?: boolean;
}): ToolResultToolContext | null {
  if (opts.noTrustedContext) return null;
  const code = opts.resolveTargetCode ?? "OUTPUT_NOT_AVAILABLE";
  return {
    module: {} as never,
    retrieval: {} as never,
    resolveTarget: async () => ({ ok: false as const, code }),
    reserveWork: async () => ({ ok: true as const }),
    settleWork: async () => undefined,
  };
}

function buildSkillContext(): SkillExecutionContext {
  return {
    conversationId: "v2-test-conversation",
    toolCallId: "call_test",
    skillName: "tool_result_search",
  } as SkillExecutionContext;
}

describe("tool_result_search denial recovery", () => {
  beforeEach(() => {
    currentContext = null;
  });

  it("returns a recovery instruction when resolveTarget denies a fabricated id", async () => {
    currentContext = buildContext({ resolveTargetCode: "OUTPUT_NOT_AVAILABLE" });
    const res = await handleToolResultSearch(
      { output_id: "out_5cb021289856b41b869773e8030f28f4", query: "Website" },
      buildSkillContext()
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("OUTPUT_NOT_AVAILABLE");
    // The recovery field MUST be present and tell the model to stop inventing
    // ids and to use the output_id from an existing receipt verbatim.
    expect(res.result.recovery).toBeTruthy();
    const recovery = String(res.result.recovery);
    expect(recovery.length).toBeGreaterThan(20);
    expect(recovery.toLowerCase()).toMatch(/receipt|output_id|exactly|never|fabricat|invent/);
  });

  it("still surfaces a recovery instruction when no trusted context exists", async () => {
    // The module mock returns `currentContext`, which is null here — the same
    // path a real call hits when the SkillExecutionContext carries no
    // conversation id (e.g. a sub-agent whose wiring never resolved).
    currentContext = buildContext({ noTrustedContext: true });
    const res = await handleToolResultSearch(
      { output_id: "out_a76191c16901e01ef6493ccd4829fea2", query: "lead" },
      buildSkillContext()
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("OUTPUT_NOT_AVAILABLE");
    expect(res.result.recovery).toBeTruthy();
  });
});

describe("tool_result_read denial recovery", () => {
  beforeEach(() => {
    currentContext = null;
  });

  it("returns a recovery instruction when resolveTarget denies a fabricated id", async () => {
    currentContext = buildContext({ resolveTargetCode: "OUTPUT_NOT_AVAILABLE" });
    const res = await handleToolResultRead(
      { output_id: "out_5cb021289856b41b869773e8030f28f4" },
      buildSkillContext()
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("OUTPUT_NOT_AVAILABLE");
    expect(res.result.recovery).toBeTruthy();
    const recovery = String(res.result.recovery);
    expect(recovery.length).toBeGreaterThan(20);
    expect(recovery.toLowerCase()).toMatch(/receipt|output_id|exactly|never|fabricat|invent/);
  });

  it("returns the CURSOR-specific recovery for INVALID_OUTPUT_CURSOR, not the generic denial text", async () => {
    // A damaged cursor must steer the model to drop it and restart from a
    // verbatim next_cursor — the generic denial text (re-use a receipt id)
    // is wrong guidance for this code.
    currentContext = buildContext({ resolveTargetCode: "INVALID_OUTPUT_CURSOR" });
    const res = await handleToolResultRead(
      { output_id: "out_5cb021289856b41b869773e8030f28f4", cursor: "mangled.sig" },
      buildSkillContext()
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("INVALID_OUTPUT_CURSOR");
    const recovery = String(res.result.recovery);
    expect(recovery).toBeTruthy();
    expect(recovery.toLowerCase()).toMatch(/cursor/);
    expect(recovery.toLowerCase()).not.toMatch(/not found or is not available/);
  });

  it("returns an argument recovery instruction when the read schema rejects the arguments", async () => {
    // A bare INVALID_OUTPUT_ARGUMENTS code makes the model retry the same
    // illegal arguments; the envelope must say which fields read accepts.
    currentContext = buildContext({});
    const res = await handleToolResultRead(
      { output_id: 1234, max_tokens: "lots" },
      buildSkillContext()
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("INVALID_OUTPUT_ARGUMENTS");
    const recovery = String(res.result.recovery);
    expect(recovery).toBeTruthy();
    expect(recovery.toLowerCase()).toMatch(/output_id/);
    expect(recovery.toLowerCase()).toMatch(/verbatim/);
  });
});
