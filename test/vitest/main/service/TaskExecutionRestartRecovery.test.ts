// test/vitest/main/service/TaskExecutionRestartRecovery.test.ts
//
// T24 (PRD NFR-05/10/12, AC-13) — restart interruption recovery:
//   - the startup sweep consumes unfinalized executions and finalizes
//     them as `incomplete` / `RESTART_INTERRUPTED` (NFR-05: restart
//     marks unfinished executions interrupted — the row is terminal but
//     never verified_complete; §12 rollback never fabricates success)
//   - checkpoints/evidence are preserved (T20 merge — recovery passes
//     empty evidence/remainingWork and never a replacement state)
//   - the ledger owner is released by the finalize transaction (§6.3)
//   - NO automatic action replay: recovery never dispatches continuations,
//     tools, or maker turns (PRD §3.3 non-goal) — it only finalizes
//   - already-finalized rows are skipped untouched (idempotent sweep;
//     the NFR-10 one-final-outcome guarantee)
//   - scheduled-origin rows recover through the same manual-style CAS
//     WITHOUT schedule-counter accounting (the run row is already marked
//     interrupted by BackgroundScheduler.recoverIntervalRuns; restart must
//     not double-apply schedule accounting)
//   - per-execution failures are isolated: one broken row does not abort
//     the sweep (fire-and-forget, log-and-continue idiom)
//   - the sweep is bounded (never unbounded over a corrupted table)
//   - flag off → pure no-op, zero module/coordinator calls (§17 rollback)
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import type { FinalizeManualInput } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import type { FinalizeResult } from "@/model/AiTaskExecution.model";
import {
  TaskExecutionRestartRecovery,
  RESTART_INTERRUPTED_REASON,
  RECOVERY_SWEEP_MAX_ROWS,
  buildFinalEventIdentity,
} from "@/service/aiTaskExecution/TaskExecutionRestartRecovery";

// ---- Mocks ---------------------------------------------------------------

const {
  getUnfinalizedExecutionsMock,
  releaseStrandedLedgerOwnersMock,
  finalizeManualMock,
  flagMock,
} = vi.hoisted(() => {
  const getUnfinalizedExecutionsMock = vi.fn();
  const releaseStrandedLedgerOwnersMock = vi.fn().mockResolvedValue(0);
  const finalizeManualMock = vi.fn();
  const flagMock = vi.fn(() => true);
  return {
    getUnfinalizedExecutionsMock,
    releaseStrandedLedgerOwnersMock,
    finalizeManualMock,
    flagMock,
  };
});

vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: class {
    getUnfinalizedExecutions = getUnfinalizedExecutionsMock;
    releaseStrandedLedgerOwners = releaseStrandedLedgerOwnersMock;
  },
}));

vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: class {
    finalizeManual = finalizeManualMock;
  },
}));

vi.mock("@/config/featureFlags", () => ({
  isAiTaskCompletionPolicyV1Enabled: flagMock,
}));

// ---- Helpers -------------------------------------------------------------

function makeUnfinalizedRow(
  overrides: Partial<AiTaskExecutionEntity> = {}
): AiTaskExecutionEntity {
  return {
    id: 1,
    execution_id: "exec-1",
    conversation_id: "conv-1",
    source_user_message_id: null,
    submission_id: null,
    assistant_result_message_id: null,
    request_hash: null,
    origin_type: "manual",
    route: "task",
    completion_owner: "standalone",
    stage: "active",
    schedule_id: null,
    run_id: null,
    occurrence_key: null,
    ledger_id: "ledger-1",
    lineage_ledger_id: "ledger-1",
    parent_execution_id: null,
    contract_snapshot_json: null,
    policy_snapshot_json: null,
    execution_state_json: null,
    contract_hash: null,
    execution_state_version: 3,
    finalized: false,
    finalized_at: null,
    task_outcome: null,
    outcome_reason_code: null,
    outcome_summary: null,
    final_event_identity: null,
    delivery_state: null,
    ...overrides,
  } as AiTaskExecutionEntity;
}

function recoveredResult(): FinalizeResult {
  return { ok: true };
}

function lastFinalizeCall(): FinalizeManualInput {
  const call = finalizeManualMock.mock.calls.at(-1);
  if (!call) throw new Error("finalizeManual was never called");
  return call[0] as FinalizeManualInput;
}

describe("TaskExecutionRestartRecovery (T24)", () => {
  let recovery: TaskExecutionRestartRecovery;

  beforeEach(() => {
    vi.clearAllMocks();
    flagMock.mockReturnValue(true);
    getUnfinalizedExecutionsMock.mockResolvedValue([]);
    releaseStrandedLedgerOwnersMock.mockResolvedValue(0);
    finalizeManualMock.mockResolvedValue(recoveredResult());
    recovery = new TaskExecutionRestartRecovery();
  });

  it("finalizes an unfinalized manual execution as incomplete/RESTART_INTERRUPTED (NFR-05)", async () => {
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-manual-1" }),
    ]);

    const summary = await recovery.recoverInterruptedExecutions();

    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    const call = lastFinalizeCall();
    expect(call.executionId).toBe("exec-manual-1");
    expect(call.outcome).toBe("incomplete");
    expect(call.reasonCode).toBe(RESTART_INTERRUPTED_REASON);
    expect(call.reasonCode).toBe("RESTART_INTERRUPTED");
    expect(summary.scanned).toBe(1);
    expect(summary.recovered).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it("marks interruption honestly — never verified_complete, never cancelled (§12 rollback)", async () => {
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-honest-1" }),
    ]);

    await recovery.recoverInterruptedExecutions();

    const call = lastFinalizeCall();
    expect(call.outcome).not.toBe("verified_complete");
    expect(call.outcome).not.toBe("cancelled");
    expect(call.summary).toContain("restart");
  });

  it("preserves the existing checkpoint (T20) — passes no replacement state", async () => {
    const existingState = JSON.stringify({
      evidence: [{ evidenceId: "ev-1" }],
      progressFingerprint: "abc",
    });
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({
        execution_id: "exec-ckpt-1",
        execution_state_json: existingState,
      }),
    ]);

    await recovery.recoverInterruptedExecutions();

    // The model's finalizeExecution merges via T20
    // mergeFinalizationCheckpoint — recovery must NOT pass a replacement
    // execution_state_json (it does not own one). It only supplies the
    // outcome/reason/summary plus empty evidence/remainingWork, so the
    // merge keeps the stored checkpoint intact.
    const call = lastFinalizeCall();
    expect(call.evidenceIds).toEqual([]);
    expect(call.remainingWork).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(call, "executionStateJson")).toBe(
      false
    );
  });

  it("recovers scheduled-origin rows via the CAS path WITHOUT schedule accounting", async () => {
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({
        execution_id: "exec-sched-1",
        origin_type: "scheduled",
        schedule_id: 42,
        run_id: 7,
        occurrence_key: "occ-1",
      }),
    ]);

    const summary = await recovery.recoverInterruptedExecutions();

    // Recovery finalizes via the coordinator's manual-style CAS path
    // (finalizeManual), never finalizeScheduledExecution — schedule
    // accounting must not run at restart (run rows were already marked
    // interrupted by BackgroundScheduler.recoverIntervalRuns).
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(lastFinalizeCall().executionId).toBe("exec-sched-1");
    expect(summary.recovered).toBe(1);
  });

  it("is idempotent: an ALREADY_FINALIZED race is skipped untouched", async () => {
    // The sweep only sees unfinalized rows; a concurrent finalizer winning
    // between the read and the finalize returns alreadyFinalized — skip it
    // (the row is terminal; exactly the NFR-10 outcome).
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-race-1" }),
    ]);
    finalizeManualMock.mockResolvedValue({
      ok: false,
      alreadyFinalized: true,
      reasonCode: "ALREADY_FINALIZED",
    });

    const summary = await recovery.recoverInterruptedExecutions();

    expect(summary.recovered).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("isolates per-row failures: one broken row does not abort the sweep", async () => {
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-bad-1" }),
      makeUnfinalizedRow({ execution_id: "exec-good-2" }),
    ]);
    finalizeManualMock.mockImplementation(async (input: FinalizeManualInput) => {
      if (input.executionId === "exec-bad-1") {
        throw new Error("disk on fire");
      }
      return recoveredResult();
    });

    const summary = await recovery.recoverInterruptedExecutions();

    expect(summary.recovered).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([
      { executionId: "exec-bad-1", reasonCode: "RECOVERY_ERROR" },
    ]);
    expect(finalizeManualMock).toHaveBeenCalledTimes(2);
  });

  it("counts STATE_CONFLICT after retry as failed, not recovered (ownership moved)", async () => {
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-conflict-1" }),
    ]);
    finalizeManualMock.mockResolvedValue({
      ok: false,
      reasonCode: "STATE_CONFLICT",
    });

    const summary = await recovery.recoverInterruptedExecutions();

    expect(summary.recovered).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.failures?.[0]?.reasonCode).toBe("STATE_CONFLICT");
  });

  it("counts MISSING_TASK_OUTCOME as failed, not recovered (fail closed)", async () => {
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-gone-1" }),
    ]);
    finalizeManualMock.mockResolvedValue({
      ok: false,
      reasonCode: "MISSING_TASK_OUTCOME",
    });

    const summary = await recovery.recoverInterruptedExecutions();

    expect(summary.recovered).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.failures?.[0]?.reasonCode).toBe("MISSING_TASK_OUTCOME");
  });

  it("flag off → pure no-op, zero module/coordinator calls (NFR-12/§17 rollback)", async () => {
    flagMock.mockReturnValue(false);
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-flag-off" }),
    ]);

    const summary = await recovery.recoverInterruptedExecutions();

    expect(getUnfinalizedExecutionsMock).not.toHaveBeenCalled();
    expect(finalizeManualMock).not.toHaveBeenCalled();
    expect(summary.recovered).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.listError).toBe(false);
  });

  it("is bounded: caps the sweep at RECOVERY_SWEEP_MAX_ROWS and reports the overflow", async () => {
    const rows = Array.from({ length: RECOVERY_SWEEP_MAX_ROWS + 5 }, (_, i) =>
      makeUnfinalizedRow({ execution_id: `exec-cap-${i}`, id: i + 1 })
    );
    getUnfinalizedExecutionsMock.mockResolvedValue(rows);

    const summary = await recovery.recoverInterruptedExecutions();

    expect(finalizeManualMock).toHaveBeenCalledTimes(RECOVERY_SWEEP_MAX_ROWS);
    expect(summary.scanned).toBe(RECOVERY_SWEEP_MAX_ROWS + 5);
    expect(summary.recovered).toBe(RECOVERY_SWEEP_MAX_ROWS);
    expect(summary.overflow).toBe(5);
  });

  it("handles a sweep-list failure without throwing (startup never fatal)", async () => {
    getUnfinalizedExecutionsMock.mockRejectedValue(new Error("db locked"));

    const summary = await recovery.recoverInterruptedExecutions();

    expect(finalizeManualMock).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(0);
    expect(summary.recovered).toBe(0);
    expect(summary.listError).toBe(true);
  });

  it("reconciles stranded ledger leases after finalizations (T24c, AC-13)", async () => {
    // Two owners recovered → both ledgers stranded; the module reports 2
    // releases and the summary surfaces them.
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-l-1" }),
      makeUnfinalizedRow({ execution_id: "exec-l-2" }),
    ]);
    releaseStrandedLedgerOwnersMock.mockResolvedValue(2);

    const summary = await recovery.recoverInterruptedExecutions();

    expect(releaseStrandedLedgerOwnersMock).toHaveBeenCalledTimes(1);
    expect(summary.ledgersReleased).toBe(2);
  });

  it("a stranded-ledger reconcile failure is logged, not fatal (next startup retries)", async () => {
    getUnfinalizedExecutionsMock.mockResolvedValue([
      makeUnfinalizedRow({ execution_id: "exec-l-3" }),
    ]);
    releaseStrandedLedgerOwnersMock.mockRejectedValue(new Error("ledger io"));

    const summary = await recovery.recoverInterruptedExecutions();

    expect(summary.recovered).toBe(1);
    expect(summary.ledgersReleased).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it("builds the stable delivery dedup identity execution-result:<executionId> (design §6.3)", () => {
    expect(buildFinalEventIdentity("exec-abc")).toBe(
      "execution-result:exec-abc"
    );
    // Stable across calls — a notification retry reuses, never mints.
    expect(buildFinalEventIdentity("exec-abc")).toBe(
      buildFinalEventIdentity("exec-abc")
    );
  });
});
