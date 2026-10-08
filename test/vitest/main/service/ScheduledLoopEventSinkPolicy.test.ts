// test/vitest/main/service/ScheduledLoopEventSinkPolicy.test.ts
//
// Slice 2 Unit 6 — Sink DI seam + missing-outcome rejection (GAP-S2 #8,
// FR-05/12, AC-15/17/18).
//
// When the completion-policy flag is on AND the sink is constructed with a
// policyBinding, the sink consults the controller on the `complete` event
// BEFORE the first-wins guard commits a blind `completed` outcome. The
// decision maps to a ScheduledTurnOutcome:
//   - verified_complete → kind "completed" (§6.1 mapping)
//   - incomplete → kind "incomplete" (carries reasonCode + remainingWork)
//   - failed/timeout → kind "failed"
//   - needs_user_input / blocked_by_policy / wait → kind "blocked"
//   - cancelled → kind "cancelled"
//   - finish_response → kind "incomplete" with RESPONSE_ENDED
//   - continue (defensive at response_end) → kind "incomplete" NO_PROGRESS
// On a consult error the sink commits missing_outcome (NEVER success).
// failOutstanding when the binding is present commits missing_outcome with
// STREAM_INCOMPLETE (never verified).
// Flag-off (no policyBinding): the existing blind `complete → completed`
// mapping is byte-identical.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ScheduledLoopEventSink,
  type ScheduledLoopPolicyBinding,
} from "@/service/ScheduledLoopEventSink";
import type { AIChatQueryEvent } from "@/service/AIChatQueryEvents";
import type { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import type { TaskCompletionDecision } from "@/entityTypes/aiTaskExecutionTypes";

// --- Feature flag mock -----------------------------------------------------
const flagMock = vi.hoisted(() => vi.fn<() => boolean>());
vi.mock("@/config/featureFlags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...actual,
    isAiTaskCompletionPolicyV1Enabled: flagMock,
  };
});

// --- Controller mock -------------------------------------------------------
// The sink's fallback consult calls controller.decide(candidate, context)
// with a two-arg signature; typing the mock's second arg as unknown lets
// the T02 evidence-fallback test assert on the context object.
type DecideFn = (
  candidate: unknown,
  context?: unknown
) => Promise<TaskCompletionDecision>;
const decideMock = vi.hoisted(() => vi.fn<DecideFn>());

// --- Binding helper --------------------------------------------------------
// The sink only calls controller.decide() on the consult path, so the stub
// carries just that member; cast through unknown because the production
// TaskCompletionController type has more surface than the stub exercises.
function makeBinding(
  overrides?: {
    decide?: DecideFn;
    policyAccepted?: boolean;
    getDecision?: () => TaskCompletionDecision | null;
    evidenceService?: { checkCandidate: () => Promise<unknown> };
    evidenceContext?: { content: string; source: string; sourceRevision: string };
  }
): ScheduledLoopPolicyBinding {
  return {
    executionId: "exec-sink-1",
    controller: {
      decide: overrides?.decide ?? decideMock,
    } as unknown as TaskCompletionController,
    route: "task_best_effort",
    expectedVersion: 0,
    // T16: the frozen flag-at-enrollment value. Defaults to true because
    // most tests exercise the policy-on path; the flag-off path tests pass
    // `policyAccepted: false` (or omit the binding) to exercise the blind
    // legacy mapping.
    policyAccepted: overrides?.policyAccepted ?? true,
    // T02 (D3): slot-first consult + evidence-backed fallback. When
    // getDecision returns a decision, the sink commits it WITHOUT calling
    // controller.decide (no double-consult). When it returns null, the
    // sink falls back to controller.decide WITH evidenceService +
    // evidenceContext in DecideContext.
    getDecision: overrides?.getDecision,
    evidenceService:
      overrides?.evidenceService as unknown as ScheduledLoopPolicyBinding["evidenceService"],
    evidenceContext: overrides?.evidenceContext,
  };
}

function completeEvent(fullContent = "Extracted 12 contacts."): AIChatQueryEvent {
  return {
    type: "complete",
    conversationId: "v2-conv",
    messageId: "assistant-1",
    fullContent,
    finishReason: "stop",
  } as unknown as AIChatQueryEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  flagMock.mockReturnValue(false);
  decideMock.mockResolvedValue({
    type: "finish",
    outcome: "verified_complete",
    reasonCode: "CRITERIA_SATISFIED",
    evidenceIds: [],
    summary: "done",
    remainingWork: [],
  });
});

describe("ScheduledLoopEventSink — policy DI consult", () => {
  it("flag-off: blind complete→completed mapping unchanged, decide never called", () => {
    flagMock.mockReturnValue(false);
    // T16: a binding constructed while the flag was OFF carries
    // policyAccepted=false → blind legacy mapping, decide never called.
    const sink = new ScheduledLoopEventSink(
      undefined,
      makeBinding({ policyAccepted: false })
    );
    sink.emit(completeEvent());
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("completed");
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("flag-on: consults the controller with a response_end candidate BEFORE committing", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockResolvedValue({
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: [],
      summary: "partial",
      remainingWork: ["verify_email_column"],
    });
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.emit(completeEvent());
    // emit() is sync but the consult is fire-and-forget — wait a tick.
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    expect(decideMock).toHaveBeenCalledTimes(1);
    const candidate = decideMock.mock.calls[0][0] as Record<string, unknown>;
    expect(candidate.content).toBe("Extracted 12 contacts.");
    expect(candidate.provenance).toBe("provider");
    expect(candidate.streamTerminalSeen).toBe(true);
    expect(candidate.boundary).toBe("response_end");
    // The consult's decision won: incomplete, not the blind completed.
    expect(sink.getOutcome()?.kind).toBe("incomplete");
  });

  it("verified_complete maps to kind completed", async () => {
    flagMock.mockReturnValue(true);
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.emit(completeEvent());
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    expect(sink.getOutcome()?.kind).toBe("completed");
  });

  it("needs_user_input maps to kind blocked (pause per FR-12)", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockResolvedValue({
      type: "finish",
      outcome: "needs_user_input",
      reasonCode: "CLARIFICATION_REQUIRED",
      evidenceIds: [],
      summary: "needs a question",
      remainingWork: [],
    });
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.emit(completeEvent());
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    expect(sink.getOutcome()?.kind).toBe("blocked");
  });

  it("cancelled maps to kind cancelled", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockResolvedValue({
      type: "finish",
      outcome: "cancelled",
      reasonCode: "USER_CANCELLED",
      evidenceIds: [],
      summary: "cancelled",
      remainingWork: [],
    });
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.emit(completeEvent());
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    expect(sink.getOutcome()?.kind).toBe("cancelled");
  });

  it("finish_response maps to kind incomplete with RESPONSE_ENDED", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockResolvedValue({ type: "finish_response", result: "response_ended" });
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.emit(completeEvent());
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("incomplete");
    if (outcome?.kind === "incomplete") {
      expect(outcome.reasonCode).toBe("RESPONSE_ENDED");
    }
  });

  it("consult error commits missing_outcome (never success)", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockRejectedValue(new Error("db gone"));
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.emit(completeEvent());
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("missing_outcome");
    if (outcome?.kind === "missing_outcome") {
      expect(outcome.reasonCode).toBe("MISSING_TASK_OUTCOME");
    }
  });

  it("waitForTerminalOutcome resolves with the consult's mapped outcome", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockResolvedValue({
      type: "finish",
      outcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      evidenceIds: [],
      summary: "partial",
      remainingWork: [],
    });
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.emit(completeEvent());
    const outcome = await sink.waitForTerminalOutcome();
    expect(outcome.kind).toBe("incomplete");
  });

  // --- T02 (D3): slot-first consult + evidence-backed fallback -------------

  it("T02 slot-first: getDecision returns verified_complete → commits completed WITHOUT calling controller.decide (no double-consult)", async () => {
    flagMock.mockReturnValue(true);
    // The loop's in-loop consult already recorded a verified_complete
    // decision into the shared slot. The sink's complete-event consult
    // reads the slot first → commits completed → never calls decide (which
    // could disagree and overwrite a verified_complete with incomplete).
    const verified = {
      type: "finish" as const,
      outcome: "verified_complete" as const,
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: [],
      summary: "100/100 contacts saved",
      remainingWork: [],
    };
    const sink = new ScheduledLoopEventSink(
      undefined,
      makeBinding({ getDecision: () => verified })
    );
    sink.emit(completeEvent());
    // Slot-first commit is synchronous (no consult promise to await).
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("completed");
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("T02 slot-first: getDecision returns a finish(incomplete) decision → commits incomplete WITHOUT calling controller.decide", () => {
    flagMock.mockReturnValue(true);
    const incomplete = {
      type: "finish" as const,
      outcome: "incomplete" as const,
      reasonCode: "CONTINUATION_LIMIT",
      evidenceIds: [],
      summary: "partial",
      remainingWork: ["crit-record_count-0"],
    };
    const sink = new ScheduledLoopEventSink(
      undefined,
      makeBinding({ getDecision: () => incomplete })
    );
    sink.emit(completeEvent());
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("incomplete");
    if (outcome?.kind === "incomplete") {
      expect(outcome.reasonCode).toBe("CONTINUATION_LIMIT");
      expect(outcome.remainingWork).toContain("crit-record_count-0");
    }
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("T02 fallback: getDecision returns null → calls controller.decide WITH evidenceService + evidenceContext in DecideContext (mirrors finalizeManualAtCompleteGate)", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockResolvedValue({
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-1"],
      summary: "done",
      remainingWork: [],
    });
    const evidenceService = { checkCandidate: vi.fn().mockResolvedValue({}) };
    const evidenceContext = {
      content: "I saved 100 contacts.",
      source: "scheduled_sink_consult",
      sourceRevision: "slice2-t02-scheduled",
    };
    const sink = new ScheduledLoopEventSink(
      undefined,
      makeBinding({ getDecision: () => null, evidenceService, evidenceContext })
    );
    sink.emit(completeEvent("I saved 100 contacts."));
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    // The fallback consult called controller.decide with the
    // evidenceService + evidenceContext the runner wired, so a
    // verified_complete is real (not a blind guess).
    expect(decideMock).toHaveBeenCalledTimes(1);
    const context = decideMock.mock.calls[0][1] as {
      evidenceService?: unknown;
      evidenceContext?: { content: string; source: string; sourceRevision: string };
      route?: string;
    };
    expect(context.evidenceService).toBe(evidenceService);
    expect(context.evidenceContext).toBeDefined();
    expect(context.evidenceContext!.source).toBe("scheduled_sink_consult");
    expect(context.evidenceContext!.content).toBe("I saved 100 contacts.");
    expect(sink.getOutcome()?.kind).toBe("completed");
  });

  it("T02 fallback continue: getDecision null + decide returns continue → incomplete NO_PROGRESS with remainingWork = unmetCriterionIds (loop is gone)", async () => {
    flagMock.mockReturnValue(true);
    decideMock.mockResolvedValue({
      type: "continue",
      continuationId: "cont:cand-1",
      prompt: "Continue the task.",
      unmetCriterionIds: ["crit-record_count-0"],
    });
    const sink = new ScheduledLoopEventSink(
      undefined,
      makeBinding({ getDecision: () => null })
    );
    sink.emit(completeEvent());
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    // The loop already exited (response_end); a continuation cannot be
    // dispatched from the sink → honest outcome is incomplete NO_PROGRESS,
    // never a success.
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("incomplete");
    if (outcome?.kind === "incomplete") {
      expect(outcome.reasonCode).toBe("NO_PROGRESS");
      expect(outcome.remainingWork).toContain("crit-record_count-0");
    }
  });
});

describe("ScheduledLoopEventSink — failOutstanding missing-outcome rejection", () => {
  it("binding present + flag on: commits missing_outcome with STREAM_INCOMPLETE", () => {
    flagMock.mockReturnValue(true);
    const sink = new ScheduledLoopEventSink(undefined, makeBinding());
    sink.failOutstanding("backstop auto-deny");
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("missing_outcome");
    if (outcome?.kind === "missing_outcome") {
      expect(outcome.reasonCode).toBe("STREAM_INCOMPLETE");
    }
  });

  it("no binding (legacy): commits failed as before", () => {
    flagMock.mockReturnValue(true);
    const sink = new ScheduledLoopEventSink();
    sink.failOutstanding("backstop auto-deny");
    expect(sink.getOutcome()?.kind).toBe("failed");
  });

  // T16 — Freeze accepted policy across flag rollback (NFR-12, AC-12/32).
  // A binding constructed while the flag was ON carries policyAccepted=true
  // (frozen at enrollment). Turning the live flag OFF midstream must NOT
  // convert accepted unfinished work to unchecked success: the consult
  // still runs and the controller's decision still wins over the blind
  // complete→completed mapping.
  it("T16: flag-off midstream + policyAccepted=true binding → consult still runs (no blind success fallback)", async () => {
    flagMock.mockReturnValue(false);
    decideMock.mockResolvedValue({
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: [],
      summary: "partial",
      remainingWork: ["verify_email_column"],
    });
    const sink = new ScheduledLoopEventSink(
      undefined,
      makeBinding({ policyAccepted: true })
    );
    sink.emit(completeEvent());
    await vi.waitFor(() => {
      expect(sink.getOutcome()).not.toBeNull();
    });
    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(sink.getOutcome()?.kind).toBe("incomplete");
  });

  it("T16: flag-off midstream + policyAccepted=true binding → failOutstanding still commits missing_outcome", () => {
    flagMock.mockReturnValue(false);
    const sink = new ScheduledLoopEventSink(
      undefined,
      makeBinding({ policyAccepted: true })
    );
    sink.failOutstanding("backstop auto-deny");
    const outcome = sink.getOutcome();
    expect(outcome?.kind).toBe("missing_outcome");
    if (outcome?.kind === "missing_outcome") {
      expect(outcome.reasonCode).toBe("STREAM_INCOMPLETE");
    }
  });
});

describe("ScheduledLoopEventSink — legacy behavior (no binding)", () => {
  it("complete → completed blind mapping unchanged", () => {
    const sink = new ScheduledLoopEventSink();
    sink.emit(completeEvent());
    expect(sink.getOutcome()?.kind).toBe("completed");
  });

  it("error → failed unchanged", () => {
    const sink = new ScheduledLoopEventSink();
    sink.emit({
      type: "error",
      conversationId: "v2-conv",
      messageId: "a1",
      errorMessage: "boom",
    } as unknown as AIChatQueryEvent);
    expect(sink.getOutcome()?.kind).toBe("failed");
  });

  it("plan_blocked_tool → blocked unchanged", () => {
    const sink = new ScheduledLoopEventSink();
    sink.emit({
      type: "plan_blocked_tool",
      conversationId: "v2-conv",
      messageId: "a1",
      toolCallId: "t1",
      toolName: "shell",
      fullContent: "",
      planBlockedToolName: "shell",
    } as unknown as AIChatQueryEvent);
    expect(sink.getOutcome()?.kind).toBe("blocked");
  });

  it("first-wins: second terminal event ignored", () => {
    const sink = new ScheduledLoopEventSink();
    sink.emit(completeEvent("first"));
    sink.emit(completeEvent("second"));
    expect(sink.getOutcome()?.kind).toBe("completed");
  });
});
