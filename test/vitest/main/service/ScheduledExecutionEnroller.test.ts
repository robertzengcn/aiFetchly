// test/vitest/main/service/ScheduledExecutionEnroller.test.ts
//
// Slice 2 Unit 9 — T02 scheduled enrollment helper (FR-02/05/07/12/20,
// AC-01-05/17/30/32). The helper extracts the scheduled-path enrollment seam
// out of ScheduledAiMessageRunner so the same trusted decision boundary as
// manual runs runs BEFORE the engine dispatches the occurrence:
//
//   TaskRequestResolver.classify → TaskCriteriaResolver.compileCriteria →
//   TaskCompletionContractService.freeze → TaskExecutionCoordinator.startScheduled
//   → build LoopTaskExecutionBinding (executionKind: "scheduled") +
//   ScheduledLoopPolicyBinding (getDecision + evidenceService).
//
// What these tests lock (the approved plan File 7):
//   - 54/100 contacts: "Save 100 qualifying contacts to campaign camp-1" →
//     record_count { minimum: 100, targetId: "camp-1" } criterion + frozen
//     contract + loopBinding executionKind "scheduled" + policyBinding
//     getDecision/evidenceService.
//   - Observation route: "Check the deployment status for prod" → observation
//     criterion targetId "the-deployment" (preserves recurring observation
//     semantics — Slice 1's hardcode to task_best_effort is gone).
//   - One binding per occurrence (no second occurrence/user message).
//   - response_only/preparation skip: ambiguous message → {status:"skipped"}.
//   - Contract failure → null contract (controlled degradation, NFR-12):
//     compileCriteria throws → still enrolled with contract: null.
//
// Mocks: TaskExecutionCoordinator (constructor returns {startScheduled +
// freezeContract}; startScheduled returns a fake binding so the helper builds
// real bindings on top of it) + AiTaskExecutionModule (BaseModule TDZ —
// required; getExecution → null, persistBudgetConsumption → void). Everything
// else is the REAL implementation: TaskRequestResolver (structural classify),
// compileCriteria (real structural compiler — exercised via the delegating
// mock pattern), hashUserAuthoredText (pure SHA-256), TaskEvidenceService +
// makeModuleBackedStore (real, no-op store), TaskProgressTracker (real),
// TaskRunBudget (real, with buildScheduledBudgetLimits), and the controller
// handed back by the coordinator mock (so the loopBinding's consult closure
// calls a real TaskCompletionController.decide against the frozen contract).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { enrollScheduledExecution } from "@/service/aiTaskExecution/ScheduledExecutionEnroller";
import type { TaskCompletionContract } from "@/entityTypes/aiTaskExecutionTypes";
import type { TaskExecutionBinding } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import { buildScheduledBudgetLimits } from "@/service/aiTaskExecution/budgetDefaults";

// vi.mock factories are hoisted above top-level vars, so declare the mock fns
// inside vi.hoisted() to make them visible to the factories.
const {
  startScheduledMock,
  freezeContractMock,
  compileCriteriaMock,
  compileCriteriaHolder,
} = vi.hoisted(() => ({
  startScheduledMock: vi.fn(),
  freezeContractMock: vi.fn(),
  compileCriteriaMock: vi.fn(),
  // Holder for the REAL compileCriteria, assigned by the vi.mock factory
  // below (factories run before top-level lets — a bare `let` here hits the
  // module-top-level TDZ crash class). The real fn is captured here so the
  // 54/100 + observation tests exercise the real structural parser, while
  // the failure-injection test overrides the implementation.
  compileCriteriaHolder: {
    real:
      undefined as unknown as typeof import("@/service/aiTaskExecution/TaskCriteriaResolver").compileCriteria,
  },
}));

// --- TaskCriteriaResolver mock: configurable, defaults to REAL compiler ---
vi.mock("@/service/aiTaskExecution/TaskCriteriaResolver", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/service/aiTaskExecution/TaskCriteriaResolver")
  >();
  compileCriteriaHolder.real = actual.compileCriteria;
  return {
    ...actual,
    compileCriteria: (...args: Parameters<typeof actual.compileCriteria>) =>
      compileCriteriaMock(...args),
  };
});

// --- TaskExecutionCoordinator mock: startScheduled + freezeContract -------
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: vi.fn().mockImplementation(function () {
    return {
      startScheduled: startScheduledMock,
      freezeContract: freezeContractMock,
    };
  }),
}));

// --- AiTaskExecutionModule mock (helper constructs it for the store) -----
// BaseModule TDZ — required. The helper constructs `new AiTaskExecutionModule()`
// inside enrollScheduledExecution so the evidence store can read execution
// state. Mocking the module keeps the test off the DB.
vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: vi.fn().mockImplementation(function () {
    return {
      getExecution: vi.fn().mockResolvedValue(null),
      applyShadowDecisionCas: vi.fn().mockResolvedValue(false),
      persistBudgetConsumption: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// --- Feature flag mock: the helper itself does NOT check the flag (the
// runner guards the call site), but transitive imports (engine, etc.) read
// it. Default OFF — the helper is exercised directly, not via the runner.
vi.mock("@/config/featureFlags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...actual,
    isAiTaskCompletionPolicyV1Enabled: vi.fn().mockReturnValue(false),
  };
});

// --- Token mock: AiTaskExecutionModule extends BaseModule, which reads
// USERSDBPATH via Token at construction. Return a temp path so it never
// touches a real DB.
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn().mockReturnValue("/tmp/test-enroller-db") };
  }),
}));

/** Build a fake coordinator binding the helper builds on top of. */
function makeFakeBinding(
  overrides?: Partial<TaskExecutionBinding> & {
    contract?: TaskCompletionContract | null;
  }
): TaskExecutionBinding {
  return {
    executionId: "exec-scheduled-1",
    conversationId: "conv-scheduled",
    sourceUserMessageId: "scheduled-user-sched-1-1",
    origin: {
      type: "scheduled",
      taskId: 1,
      runId: 1,
      occurrenceKey: "scheduled-loop:1:1",
    },
    route: "task_best_effort",
    completionOwner: "standalone",
    leaseGeneration: 0,
    ledgerId: "ledger-scheduled-1",
    contract: overrides?.contract ?? null,
    contractHash: overrides?.contract ? "hash-scheduled" : null,
    // Real controller + real budget so the loopBinding's consult closure
    // exercises a real decide() against the frozen contract (fail-closed:
    // RecordCountAdapter has no provider → "unknown" → never verified).
    controller: new TaskCompletionController(),
    budget: new TaskRunBudget({
      maxContinuations: 3,
      maxProviderAttempts: 60,
      maxCheckerAttempts: 6,
      maxToolExecutions: 50,
      maxTokens: 128_000,
      maxActiveRuntimeMs: 10 * 60 * 1000,
      maxWaitMs: 60 * 60 * 1000,
      maxNoProgressStreak: 3,
    }),
    ...overrides,
  } as TaskExecutionBinding;
}

/** Standard enrollment input for the 54/100 contacts case. */
function makeInput(overrides?: { taskMessage?: string }) {
  return {
    conversationId: "conv-scheduled",
    sourceUserMessageId: "scheduled-user-sched-1-1",
    taskMessage: overrides?.taskMessage ?? "Save 100 qualifying contacts to campaign camp-1",
    taskId: 1,
    runId: 1,
    scheduleId: 1,
    occurrence: 1,
    occurrenceKey: "scheduled-loop:1:1",
    // Real BudgetLimitsInput shape via the same builder the runner uses.
    budgetLimits: buildScheduledBudgetLimits({
      maxContinueCalls: 3,
      maxToolCalls: 50,
      maxRuntimeMs: 10 * 60 * 1000,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: freezeContract is a real-ish pass-through that returns the
  // criteria it was given (the helper builds the contract via the
  // coordinator, so the test asserts the FROZEN contract structure, not a
  // mocked one). Tests that need to assert the contract goes null on
  // failure override compileCriteriaMock to throw.
  compileCriteriaMock.mockReset();
  compileCriteriaMock.mockImplementation(
    (input: Parameters<NonNullable<typeof compileCriteriaHolder.real>>[0]) =>
      compileCriteriaHolder.real!(input)
  );
  freezeContractMock.mockReset();
  freezeContractMock.mockImplementation(
    (input: {
      mode: string;
      criteria: readonly { id: string; kind: string; required: boolean }[];
    }) => ({
      schemaVersion: 1 as const,
      contractId: "contract-scheduled-1",
      contractHash: "hash-scheduled",
      objective: input.criteria.length ? "scheduled task" : "scheduled task",
      sourceUserMessageId: "scheduled-user-sched-1-1",
      approvedSourceMessageIds: ["scheduled-user-sched-1-1"],
      mode: input.mode as "best_effort",
      criteria: input.criteria,
    })
  );
});

describe("enrollScheduledExecution — T02 scheduled enrollment helper", () => {
  it("54/100 contacts: compiles record_count {minimum:100, targetId:camp-1}, freezes contract, builds scheduled loop + policy bindings", async () => {
    const fakeBinding = makeFakeBinding();
    // freezeContract returns a contract carrying the REAL compiled criteria
    // so the loopBinding's consult closure exercises a real decide().
    freezeContractMock.mockImplementation(
      (input: {
        mode: string;
        criteria: readonly { id: string; kind: string; required: boolean }[];
      }) => ({
        schemaVersion: 1 as const,
        contractId: "contract-scheduled-1",
        contractHash: "hash-scheduled",
        objective: "Save 100 qualifying contacts to campaign camp-1",
        sourceUserMessageId: "scheduled-user-sched-1-1",
        approvedSourceMessageIds: ["scheduled-user-sched-1-1"],
        mode: input.mode as "best_effort",
        criteria: input.criteria,
      })
    );
    startScheduledMock.mockResolvedValue({
      status: "created",
      binding: fakeBinding,
    });

    const result = await enrollScheduledExecution(makeInput());

    expect(result.status).toBe("created");
    // The helper called freezeContract with mode best_effort and the REAL
    // compiled criteria (T01 structural parser, exercised via the
    // delegating mock). The record_count criterion for the 100-contact
    // request must be present with minimum 100 + targetId "camp-1".
    expect(freezeContractMock).toHaveBeenCalledTimes(1);
    const freezeInput = freezeContractMock.mock.calls[0][0] as {
      mode: string;
      criteria: readonly {
        kind: string;
        minimum?: number;
        targetId?: string;
        required: boolean;
      }[];
    };
    expect(freezeInput.mode).toBe("best_effort");
    const rc = freezeInput.criteria.find((c) => c.kind === "record_count");
    expect(rc).toBeDefined();
    expect(rc!.minimum).toBe(100);
    expect(rc!.targetId).toBe("camp-1");
    expect(rc!.required).toBe(true);

    // startScheduled got the frozen contract + the occurrence's
    // requestHash (hashUserAuthoredText, pure SHA-256 — exercised real).
    expect(startScheduledMock).toHaveBeenCalledTimes(1);
    const startInput = startScheduledMock.mock.calls[0][0] as {
      route: string;
      requestHash: string;
      contract: TaskCompletionContract | null;
      occurrenceKey: string;
    };
    expect(startInput.route).toBe("task_best_effort");
    expect(startInput.requestHash).not.toBe("");
    expect(startInput.occurrenceKey).toBe("scheduled-loop:1:1");
    expect(startInput.contract).not.toBeNull();
    expect(startInput.contract!.criteria.length).toBeGreaterThan(0);

    // D2: loop binding carries executionKind "scheduled" + the slot
    // closures (recordDecision sets the slot; consult calls the real
    // controller.decide against the frozen contract + evidence service).
    expect(result.loopBinding).toBeDefined();
    expect(result.loopBinding!.executionKind).toBe("scheduled");
    expect(result.loopBinding!.executionId).toBe("exec-scheduled-1");
    expect(result.loopBinding!.policyAccepted).toBe(true);
    expect(typeof result.loopBinding!.consult).toBe("function");
    expect(typeof result.loopBinding!.recordDecision).toBe("function");
    expect(typeof result.loopBinding!.persistBudget).toBe("function");

    // D3: policy binding carries getDecision + evidenceService +
    // evidenceContext so the sink's complete-event consult reads the slot
    // first (no double-consult) and falls back with evidence.
    expect(result.policyBinding).toBeDefined();
    expect(result.policyBinding!.executionId).toBe("exec-scheduled-1");
    expect(result.policyBinding!.policyAccepted).toBe(true);
    expect(typeof result.policyBinding!.getDecision).toBe("function");
    expect(result.policyBinding!.evidenceService).toBeDefined();
    expect(result.policyBinding!.evidenceContext).toBeDefined();
    expect(result.policyBinding!.evidenceContext!.source).toBe(
      "scheduled_sink_consult"
    );

    // policyExecution snapshot for the runner's finalizeScheduledPolicyRun.
    expect(result.policyExecution).toBeDefined();
    expect(result.policyExecution!.executionId).toBe("exec-scheduled-1");
    expect(result.policyExecution!.expectedVersion).toBe(0);
    expect(result.policyExecution!.idempotencyKey).toBe("scheduled-loop:1:1");
  });

  it("shared slot: recordDecision on the loop binding populates getDecision on the policy binding (no double-consult)", async () => {
    const fakeBinding = makeFakeBinding();
    startScheduledMock.mockResolvedValue({
      status: "created",
      binding: fakeBinding,
    });

    const result = await enrollScheduledExecution(makeInput());
    expect(result.status).toBe("created");

    // Before any consult, the slot is empty.
    expect(result.policyBinding!.getDecision!()).toBeNull();

    // Simulate the loop's in-loop consult recording a verified_complete
    // decision via recordDecision. The slot is the SAME one the policy
    // binding's getDecision reads — so the sink's consult reads it without
    // re-consulting the controller.
    const verified = {
      type: "finish" as const,
      outcome: "verified_complete" as const,
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: [],
      summary: "100/100 contacts saved",
      remainingWork: [],
    };
    result.loopBinding!.recordDecision!(verified);
    expect(result.policyBinding!.getDecision!()).toBe(verified);
  });

  it("loop consult against the real controller + Slice-2-stub record_count adapter yields incomplete (fail-closed: no provider wired → unknown → never verified)", async () => {
    // This is the honest T02 regression assertion. The controller's
    // maybeEvaluateEvidence runs the RecordCountAdapter; with no
    // recordCountProvider wired (Slice 2 stub), the adapter returns
    // "unknown" → the criterion is unmet → canVerify is false → the
    // decision is finish(incomplete) with the record_count criterion in
    // remainingWork. Verified completion needs T03 (authoritative
    // providers) — T02 asserts the contract structure + the fail-closed
    // path, not a verified_complete.
    //
    // The real coordinator threads input.contract onto binding.contract;
    // the mock echoes it via mockImplementation so the loopBinding's
    // consult closure sees the frozen contract (without it,
    // maybeEvaluateEvidence returns undefined → no required criteria →
    // empty remainingWork, which would hide the fail-closed path).
    startScheduledMock.mockImplementation(async (input: {
      contract: TaskCompletionContract | null;
    }) => ({
      status: "created",
      binding: makeFakeBinding({ contract: input.contract }),
    }));

    const result = await enrollScheduledExecution(makeInput());
    expect(result.status).toBe("created");

    // Build a response_end candidate the way the loop's consult closure
    // does (provenance "provider", streamTerminalSeen true, boundary
    // response_end) and consult via the loop binding.
    const candidate = {
      candidateId: "cand:exec-scheduled-1:response_end",
      executionId: "exec-scheduled-1",
      content: "I saved 54 of 100 contacts.",
      finishReason: "stop",
      provenance: "provider" as const,
      streamTerminalSeen: true,
      boundary: "response_end" as const,
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: false,
    };
    const decision = await result.loopBinding!.consult!(candidate);
    // The in-loop consult at response_end sees unmet record_count work
    // with a live, non-exhausted budget + provider provenance + true
    // terminal → the LIVE continuation branch (§7.2 step 10, FR-07) fires:
    // the decision is `continue` with a §7.3 prompt and the record_count
    // criterion id in unmetCriterionIds. This is the same-occurrence
    // recovery T02 enables (54/100 → continue → 100/100). The
    // `continue → incomplete NO_PROGRESS` mapping only applies at the SINK
    // (after the loop exited) — covered by ScheduledLoopEventSinkPolicy.
    expect(decision.type).toBe("continue");
    if (decision.type === "continue") {
      expect(decision.unmetCriterionIds.length).toBeGreaterThan(0);
      expect(decision.prompt).not.toBe("");
    }
    // The loop's consultLoopEndCandidate helper calls recordDecision after
    // consult (covered by the shared-slot test above). The raw consult
    // closure the enroller wires does NOT auto-record — that's by design:
    // recording is the loop's responsibility, so the slot stays empty
    // until the loop consults.
  });

  it("observation route: 'Check the deployment status for prod' compiles an observation criterion (preserves recurring observation semantics)", async () => {
    const fakeBinding = makeFakeBinding({
      route: "task_best_effort",
    });
    startScheduledMock.mockResolvedValue({
      status: "created",
      binding: fakeBinding,
    });

    const result = await enrollScheduledExecution(
      makeInput({ taskMessage: "Check the deployment status for prod" })
    );

    expect(result.status).toBe("created");
    expect(freezeContractMock).toHaveBeenCalledTimes(1);
    const freezeInput = freezeContractMock.mock.calls[0][0] as {
      mode: string;
      criteria: readonly {
        kind: string;
        targetId?: string;
        required: boolean;
      }[];
    };
    // The structural compiler emits an observation criterion for the
    // "check the X status" pattern. The targetId is the slugified noun
    // ("the-deployment" or similar — the exact slug is the structural
    // parser's responsibility, asserted in T01 tests). The point is the
    // kind + targetId presence, NOT the hardcode to task_best_effort with
    // no criteria that Slice 1 shipped.
    const obs = freezeInput.criteria.find((c) => c.kind === "observation");
    expect(obs).toBeDefined();
    expect(obs!.targetId).toBeDefined();
    expect(obs!.required).toBe(true);
  });

  it("one binding per occurrence: a second distinct occurrence gets a distinct executionId (no second user message during recovery)", async () => {
    const fakeBinding1 = makeFakeBinding({ executionId: "exec-occ-1" });
    const fakeBinding2 = makeFakeBinding({ executionId: "exec-occ-2" });
    startScheduledMock
      .mockResolvedValueOnce({ status: "created", binding: fakeBinding1 })
      .mockResolvedValueOnce({ status: "created", binding: fakeBinding2 });

    const r1 = await enrollScheduledExecution({
      ...makeInput(),
      occurrence: 1,
      occurrenceKey: "scheduled-loop:1:1",
    });
    const r2 = await enrollScheduledExecution({
      ...makeInput(),
      occurrence: 2,
      occurrenceKey: "scheduled-loop:1:2",
    });

    expect(r1.status).toBe("created");
    expect(r2.status).toBe("created");
    expect(r1.loopBinding!.executionId).toBe("exec-occ-1");
    expect(r2.loopBinding!.executionId).toBe("exec-occ-2");
    // Distinct slots: recording on r1's binding does NOT leak into r2's
    // policy binding (each occurrence has its own slot).
    const verified = {
      type: "finish" as const,
      outcome: "verified_complete" as const,
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: [],
      summary: "done",
      remainingWork: [],
    };
    r1.loopBinding!.recordDecision!(verified);
    expect(r1.policyBinding!.getDecision!()).toBe(verified);
    expect(r2.policyBinding!.getDecision!()).toBeNull();
  });

  it("response_only route: 'What does ROI mean?' skips enrollment (non-actionable)", async () => {
    // compileCriteria + freezeContract are real-ish (delegating mock). The
    // resolver classifies "What does ROI mean?" as response_only → the
    // helper returns skipped BEFORE calling the coordinator.
    const result = await enrollScheduledExecution(
      makeInput({ taskMessage: "What does ROI mean?" })
    );
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("response_only");
    expect(startScheduledMock).not.toHaveBeenCalled();
    expect(result.loopBinding).toBeUndefined();
    expect(result.policyBinding).toBeUndefined();
  });

  it("preparation route: ambiguous message skips enrollment (non-actionable)", async () => {
    // "Send the thing." is ambiguous (no count, no target) — the resolver
    // routes it to preparation, and the helper skips enrollment.
    const result = await enrollScheduledExecution(
      makeInput({ taskMessage: "Send the thing." })
    );
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("preparation");
    expect(startScheduledMock).not.toHaveBeenCalled();
  });

  it("compileCriteria throws: helper still enrolls with contract=null (controlled degradation, NFR-12)", async () => {
    compileCriteriaMock.mockImplementationOnce(() => {
      throw new Error("compiler invariant violated");
    });
    const fakeBinding = makeFakeBinding({ contract: null });
    startScheduledMock.mockResolvedValue({
      status: "created",
      binding: fakeBinding,
    });

    const result = await enrollScheduledExecution(
      makeInput({ taskMessage: "Save 50 contacts" })
    );

    // Controlled non-success (NFR-12): enrollment is NOT bypassed —
    // startScheduled still ran (identity registered, Stop available). The
    // null contract means the controller can never verify (never
    // verified_complete). Controlled non-success, not a silent legacy
    // fallback.
    expect(startScheduledMock).toHaveBeenCalledTimes(1);
    const startInput = startScheduledMock.mock.calls[0][0] as {
      contract: TaskCompletionContract | null;
    };
    expect(startInput.contract).toBeNull();
    expect(result.status).toBe("created");
    expect(result.loopBinding).toBeDefined();
    expect(result.loopBinding!.executionKind).toBe("scheduled");
  });

  it("reused status: returns the status with no bindings (transport retry — runner handles as before)", async () => {
    startScheduledMock.mockResolvedValue({
      status: "reused",
      existing: {
        executionId: "exec-old",
        finalized: false,
        taskOutcome: null,
      },
    });

    const result = await enrollScheduledExecution(makeInput());
    expect(result.status).toBe("reused");
    expect(result.loopBinding).toBeUndefined();
    expect(result.policyBinding).toBeUndefined();
    expect(result.policyExecution).toBeUndefined();
  });

  it("conflict status: returns the status with no bindings (submission conflict — runner handles as before)", async () => {
    startScheduledMock.mockResolvedValue({
      status: "conflict",
      reasonCode: "SUBMISSION_CONFLICT",
      existing: {
        executionId: "exec-conflict",
        finalized: false,
        taskOutcome: null,
      },
    });

    const result = await enrollScheduledExecution(makeInput());
    expect(result.status).toBe("conflict");
    expect(result.loopBinding).toBeUndefined();
  });

  it("denied status: returns the status with no bindings (lineage ledger denial)", async () => {
    startScheduledMock.mockResolvedValue({
      status: "denied",
      reasonCode: "LINEAGE_LEDGER_NOT_ACTIVE",
    });

    const result = await enrollScheduledExecution(makeInput());
    expect(result.status).toBe("denied");
    expect(result.loopBinding).toBeUndefined();
  });
});
