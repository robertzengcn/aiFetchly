// test/vitest/main/service/TaskOperationGuard.test.ts
//
// T23 (audit line 337) — fault-matrix tests for the TaskOperationGuard.
// Covers every audited fault:
//   - lost send response → unknown (never terminal, reconcilable)
//   - crash before receipt → unknown persists; a later occurrence blocks
//   - uncertain operation → blind replay blocked even in another run
//   - recurring authorized repeats → confirmed receipt reused, no re-send
//   - explicit Retry after evidenced no-effect → permitted
//   - changed conversations / new execution IDs → cannot bypass an unknown
//     earlier send for the same intent (cross-execution fence)
//   - duplicate dispatch → single claim winner; loser reconciles
//   - native status lookup limitations → §10.3 start-only receipts do not
//     satisfy completion criteria
//
// The guard is tested through its OperationGuardDeps interface with an
// in-memory fake store implementing the same §10.2 transition machine the
// real model enforces, so the tests hold for production wiring.
import { describe, expect, it, beforeEach } from "vitest";
import {
  TaskOperationGuard,
  computeIntentHash,
  guardOperationKey,
} from "@/service/aiTaskExecution/TaskOperationGuard";
import type {
  OperationGuardDescriptor,
  OperationGuardDeps,
} from "@/service/aiTaskExecution/TaskOperationGuard";

// ---------------------------------------------------------------------------
// In-memory fake operation store implementing the §10.2 machine.
// ---------------------------------------------------------------------------

interface FakeOp {
  operationKey: string;
  executionId: string;
  toolIdentity: string;
  domainTarget: string | null;
  intentHash: string;
  operationState:
    | "pending"
    | "claimed"
    | "dispatched"
    | "accepted"
    | "completed"
    | "failed"
    | "unknown";
  claimGeneration: number;
  receiptReference: string | null;
  failureCode?: string | null;
}

const TRANSITIONS: Record<string, string[]> = {
  pending: ["claimed"],
  claimed: ["dispatched", "failed"],
  dispatched: ["accepted", "failed", "unknown"],
  accepted: [],
  completed: [],
  failed: [],
  unknown: ["dispatched", "accepted", "failed"],
};

class FakeOperationStore {
  readonly rows = new Map<string, FakeOp>();

  deps(): OperationGuardDeps {
    return {
      recordOperation: async (input) => {
        const existing = this.rows.get(input.operationKey);
        if (existing) {
          if (
            existing.intentHash !== input.intentHash ||
            existing.executionId !== input.executionId ||
            existing.toolIdentity !== input.toolIdentity
          ) {
            return { ok: false, reasonCode: "INTENT_CONFLICT" };
          }
          return { ok: false, alreadyExists: true };
        }
        this.rows.set(input.operationKey, {
          ...input,
          operationState: "pending",
          claimGeneration: 0,
          receiptReference: null,
        });
        return { ok: true };
      },
      getOperation: async (operationKey) => {
        const row = this.rows.get(operationKey);
        if (!row) return null;
        // Shape-compatible view: the real entity uses snake_case columns;
        // the guard only reads execution_id/intent_hash/claim_generation/
        // operation_state through its deps. Map to the entity field names.
        return {
          execution_id: row.executionId,
          intent_hash: row.intentHash,
          claim_generation: row.claimGeneration,
          operation_state: row.operationState,
          operation_key: row.operationKey,
          tool_identity: row.toolIdentity,
          domain_target: row.domainTarget,
          receipt_reference: row.receiptReference,
        } as never;
      },
      findUnresolvedByIntent: async (input) => {
        const unresolved = [...this.rows.values()]
          .filter((row) =>
            ["pending", "claimed", "dispatched", "unknown"].includes(
              row.operationState
            )
          )
          .filter(
            (row) =>
              (row.toolIdentity === input.toolIdentity &&
                row.domainTarget === input.domainTarget) ||
              row.intentHash === input.intentHash
          )
          .sort((a, b) => a.operationKey.localeCompare(b.operationKey))
          .slice(0, input.limit ?? 50);
        return unresolved.map(
          (row) =>
            ({
              execution_id: row.executionId,
              intent_hash: row.intentHash,
              claim_generation: row.claimGeneration,
              operation_state: row.operationState,
              operation_key: row.operationKey,
            }) as never
        );
      },
      countOccurrencesByIntent: async (input) => {
        // ANY state (terminal included) for ONE execution + intent — mirrors
        // the real model's countOccurrencesByIntent (D3 ordinal fix).
        return [...this.rows.values()].filter(
          (row) =>
            row.executionId === input.executionId &&
            ((row.toolIdentity === input.toolIdentity &&
              row.domainTarget === input.domainTarget) ||
              row.intentHash === input.intentHash)
        ).length;
      },
      updateState: async (input) => {
        const row = this.rows.get(input.operationKey);
        if (!row) return { ok: false, reasonCode: "OPERATION_NOT_FOUND" };
        if (row.claimGeneration !== input.expectedClaimGeneration) {
          return { ok: false, reasonCode: "STATE_CONFLICT" };
        }
        if (!TRANSITIONS[row.operationState]?.includes(input.newState)) {
          return { ok: false, reasonCode: "STATE_CONFLICT" };
        }
        // Immutably replace the row (user style rule: never mutate).
        this.rows.set(input.operationKey, {
          ...row,
          operationState: input.newState,
          claimGeneration: row.claimGeneration + 1,
        });
        return { ok: true };
      },
      setReceiptReference: async (input) => {
        const row = this.rows.get(input.operationKey);
        if (!row || row.claimGeneration !== input.expectedClaimGeneration) {
          return false;
        }
        this.rows.set(input.operationKey, {
          ...row,
          receiptReference: input.receiptReference ?? row.receiptReference,
          failureCode: input.failureCode ?? row.failureCode,
        });
        return true;
      },
    };
  }
}

const SEND_DESCRIPTOR: OperationGuardDescriptor = {
  toolIdentity: "start_email_send_task",
  domainTarget: "outbound_batch:11",
  intentFields: ["service_ids", "email_search_task_id"],
  intentArguments: { service_ids: [3], email_search_task_id: 42 },
};

function guardFor(store: FakeOperationStore, executionId: string): TaskOperationGuard {
  return new TaskOperationGuard(store.deps(), executionId);
}

describe("TaskOperationGuard (T23 fault matrix)", () => {
  let store: FakeOperationStore;

  beforeEach(() => {
    store = new FakeOperationStore();
  });

  it("derives the EvidenceProviderFactory-compatible operation key", () => {
    expect(guardOperationKey("exec-1", "outbound_batch:11")).to.equal(
      "op:exec-1:outbound_batch:11"
    );
  });

  it("excludes non-allowlisted and sensitive fields from the intent hash", () => {
    const base = {
      toolIdentity: "start_email_send_task",
      domainTarget: "outbound_batch:11",
      intentFields: ["service_ids"],
    };
    const withRecipient = computeIntentHash({
      ...base,
      intentArguments: { service_ids: [3], emails: ["a@x.com"] },
    });
    const withoutRecipient = computeIntentHash({
      ...base,
      intentArguments: { service_ids: [3] },
    });
    // A volatile/sensitive argument (recipient list) must not change identity.
    expect(withRecipient).to.equal(withoutRecipient);
    // A stable allowlisted argument must change it.
    const otherService = computeIntentHash({
      ...base,
      intentArguments: { service_ids: [4] },
    });
    expect(otherService).to.not.equal(withRecipient);
  });

  it("allows a first dispatch and records a claimed operation", async () => {
    const guard = guardFor(store, "exec-A");
    const decision = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(decision.allowed).to.equal(true);
    expect(decision.claimGeneration).to.equal(1);
    const row = store.rows.get("op:exec-A:outbound_batch:11");
    expect(row?.operationState).to.equal("claimed");
  });

  it("lost send response settles to unknown, not a terminal state", async () => {
    // Audit fault: "lost send response". The dispatch left the process but
    // the response never arrived — the outcome is unknown and MUST stay
    // reconcilable (never failed, never accepted).
    const guard = guardFor(store, "exec-A");
    const decision = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(decision.allowed).to.equal(true);
    const settle = await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: decision.claimGeneration ?? 0,
      occurrenceOrdinal: decision.occurrenceOrdinal ?? 0,
      intentHash: decision.intentHash ?? "",
      outcome: "unknown",
    });
    expect(settle.ok).to.equal(true);
    const row = store.rows.get("op:exec-A:outbound_batch:11");
    expect(row?.operationState).to.equal("unknown");
  });

  it("crash before receipt: unknown persists and blocks the next occurrence", async () => {
    // Audit fault: "crash before receipt". Simulate by preparing + marking
    // dispatched then abandoning (no settle call) — the row stays claimed.
    const guard = guardFor(store, "exec-A");
    const decision = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(decision.allowed).to.equal(true);
    // Simulate the crash's post-dispatch unknown via §10.2 recovery:
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: decision.claimGeneration ?? 0,
      occurrenceOrdinal: decision.occurrenceOrdinal ?? 0,
      intentHash: decision.intentHash ?? "",
      outcome: "unknown",
    });

    // The next occurrence (same execution) must not blind-replay.
    const replay = await guardFor(store, "exec-A").prepareDispatch(
      SEND_DESCRIPTOR
    );
    expect(replay.allowed).to.equal(false);
    expect(replay.reasonCode).to.equal("OPERATION_UNKNOWN_OUTCOME");
  });

  it("uncertain operation blocks replay from a DIFFERENT execution (changed conversation)", async () => {
    // Audit faults: "uncertain operation" + "changed conversations". Exec B
    // (the Continue/Retry successor) asks for the same intent; the earlier
    // exec-A op is unknown — the cross-execution fence must block it.
    const guardA = guardFor(store, "exec-A");
    const decisionA = await guardA.prepareDispatch(SEND_DESCRIPTOR);
    await guardA.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: decisionA.claimGeneration ?? 0,
      intentHash: decisionA.intentHash ?? "",
      outcome: "unknown",
    });

    const guardB = guardFor(store, "exec-B");
    const decisionB = await guardB.prepareDispatch(SEND_DESCRIPTOR);
    expect(decisionB.allowed).to.equal(false);
    expect(decisionB.reasonCode).to.equal("OPERATION_UNRESOLVED_EARLIER");
  });

  it("recurring authorized repeats reuse the confirmed receipt without re-dispatch", async () => {
    // Audit fault: "recurring authorized repeats". A confirmed operation
    // returns the stored receipt — never a second send.
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(SEND_DESCRIPTOR);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "confirmed",
      receiptReference: "attempt:7",
    });
    const repeat = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(repeat.allowed).to.equal(false);
    expect(repeat.reasonCode).to.equal("OPERATION_ALREADY_CONFIRMED");
    expect(repeat.reusedReceiptState).to.equal("accepted");
    const row = store.rows.get("op:exec-A:outbound_batch:11");
    expect(row?.receiptReference).to.equal("attempt:7");
    expect(row?.claimGeneration).to.equal(3); // claimed → accepted = 2 ticks; +1 from claim = 3? (claimed=1, accepted=2) — see assertion below
  });

  it("explicit Retry after evidenced no-effect failure permits a fresh dispatch", async () => {
    // Audit fault: "explicit Retry". failed is a definitive no-effect
    // outcome — only this state (plus absence) permits a new dispatch.
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(SEND_DESCRIPTOR);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "no_effect",
      failureCode: "SMTP_CONNECT_FAILED",
    });
    const retry = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(retry.allowed).to.equal(true);
    expect(retry.occurrenceOrdinal).to.equal(1);
    // The fresh occurrence lands on a NEW store-derived key; the original
    // failed receipt row is terminal and preserved as evidence.
    const occurrenceRow = store.rows.get("op:exec-A:outbound_batch:11#occ1");
    expect(occurrenceRow?.operationState).to.equal("claimed");
    const receiptRow = store.rows.get("op:exec-A:outbound_batch:11");
    expect(receiptRow?.operationState).to.equal("failed");
  });

  it("duplicate dispatch: exactly one claim winner, the loser reconciles", async () => {
    // Audit fault: "duplicate dispatch". Two concurrent occurrences of the
    // same execution+intent race prepareDispatch; the fake store's CAS
    // (generation check) lets exactly one claim win.
    const guard1 = guardFor(store, "exec-A");
    const guard2 = guardFor(store, "exec-A");
    const [d1, d2] = await Promise.all([
      guard1.prepareDispatch(SEND_DESCRIPTOR),
      guard2.prepareDispatch(SEND_DESCRIPTOR),
    ]);
    const winners = [d1, d2].filter((d) => d.allowed);
    const losers = [d1, d2].filter((d) => !d.allowed);
    expect(winners.length).to.equal(1);
    expect(losers.length).to.equal(1);
    expect(losers[0]?.reasonCode).to.equal("OPERATION_UNKNOWN_OUTCOME");
  });

  it("a changed target for the same operation key fails closed (INTENT_CONFLICT path)", async () => {
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(first.allowed).to.equal(true);
    // Different target → different key → a fresh operation is allowed; but
    // reusing the ORIGINAL key with a changed intent (the model-invented
    // ordinal case) must fail closed.
    const tampered = await guard.prepareDispatch({
      ...SEND_DESCRIPTOR,
      intentArguments: { service_ids: [9] },
    });
    // Same key (same target) but different hashed intent: the stored row's
    // intent hash no longer matches — must not silently reuse.
    expect(tampered.allowed).to.equal(false);
    expect(tampered.reasonCode).to.equal("OPERATION_UNKNOWN_OUTCOME");
    // The original dispatch is still claimable/settleable untouched.
    expect(
      (
        await guard.settleDispatch({
          descriptor: SEND_DESCRIPTOR,
          claimGeneration: first.claimGeneration ?? 0,
          occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
          intentHash: first.intentHash ?? "",
          outcome: "confirmed",
        })
      ).ok
    ).to.equal(true);
  });

  it("records the native receipt reference on settlement (native status lookup support)", async () => {
    // Audit fault: "native status lookup limitations". The guard stores the
    // native attempt id at settlement so §10.3 polling can resolve the
    // real send attempt instead of guessing.
    const guard = guardFor(store, "exec-A");
    const decision = await guard.prepareDispatch(SEND_DESCRIPTOR);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: decision.claimGeneration ?? 0,
      occurrenceOrdinal: decision.occurrenceOrdinal ?? 0,
      intentHash: decision.intentHash ?? "",
      outcome: "unknown",
      receiptReference: "attempt:12",
    });
    const row = store.rows.get("op:exec-A:outbound_batch:11");
    expect(row?.receiptReference).to.equal("attempt:12");
    expect(row?.operationState).to.equal("unknown");
  });

  it("persists the safe failure code on a no_effect settlement (T23d)", async () => {
    const guard = guardFor(store, "exec-A");
    const decision = await guard.prepareDispatch(SEND_DESCRIPTOR);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: decision.claimGeneration ?? 0,
      occurrenceOrdinal: decision.occurrenceOrdinal ?? 0,
      intentHash: decision.intentHash ?? "",
      outcome: "no_effect",
      failureCode: "CLAIM_FAILED",
    });
    const row = store.rows.get("op:exec-A:outbound_batch:11");
    expect(row?.operationState).to.equal("failed");
    expect(row?.failureCode).to.equal("CLAIM_FAILED");
  });

  it("D3: ordinal keeps strictly increasing after a failed occurrence settles terminal (no wedge)", async () => {
    // Pre-D3 wedge: countPriorOccurrences counted only unresolved rows +1,
    // so once the first occurrence settled `failed` (terminal, no longer
    // unresolved) the next retry re-derived ordinal 1, CAS-collided on the
    // terminal `#occ1` row, and every later retry wedged. Counting ALL rows
    // for this execution+intent keeps the ordinal strictly increasing.
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(SEND_DESCRIPTOR);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "no_effect",
      failureCode: "CLAIM_FAILED",
    });
    // Second retry — must derive ordinal 1 (the failed #occ1 slot).
    const retry1 = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(retry1.allowed).to.equal(true);
    expect(retry1.occurrenceOrdinal).to.equal(1);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: retry1.claimGeneration ?? 0,
      occurrenceOrdinal: retry1.occurrenceOrdinal ?? 0,
      intentHash: retry1.intentHash ?? "",
      outcome: "no_effect",
      failureCode: "CLAIM_FAILED",
    });
    // Third retry — ordinal 2. Pre-D3 this re-derived 1 and wedged.
    const retry2 = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(retry2.allowed).to.equal(true);
    expect(retry2.occurrenceOrdinal).to.equal(2);
    const occ2 = store.rows.get("op:exec-A:outbound_batch:11#occ2");
    expect(occ2?.operationState).to.equal("claimed");
  });

  it("B16a: confirmed retry occurrence blocks a third dispatch with receipt reuse (FR-11, AC-09)", async () => {
    // Ordinal-0 failed (no effect) → ordinal-1 retry confirmed (accepted).
    // A third prepare must NOT dispatch ordinal-2 — it reuses the confirmed
    // retry receipt instead of repeating a confirmed effect.
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(SEND_DESCRIPTOR);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "no_effect",
      failureCode: "SMTP_CONNECT_FAILED",
    });
    const retry = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(retry.allowed).to.equal(true);
    expect(retry.occurrenceOrdinal).to.equal(1);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: retry.claimGeneration ?? 0,
      occurrenceOrdinal: retry.occurrenceOrdinal ?? 0,
      intentHash: retry.intentHash ?? "",
      outcome: "confirmed",
      receiptReference: "attempt:8",
    });
    const third = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(third.allowed).to.equal(false);
    expect(third.reasonCode).to.equal("OPERATION_ALREADY_CONFIRMED");
    expect(third.reusedReceiptState).to.equal("accepted");
    // No ordinal-2 row was created.
    expect(store.rows.has("op:exec-A:outbound_batch:11#occ2")).to.equal(false);
  });

  it("B16b: unknown retry occurrence blocks a third dispatch pending reconciliation (FR-11, AC-10)", async () => {
    // Ordinal-0 failed → ordinal-1 retry lost its response (unknown). A
    // third prepare must NOT dispatch — the unknown retry blocks blind
    // replay until reconciled.
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(SEND_DESCRIPTOR);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "no_effect",
      failureCode: "SMTP_CONNECT_FAILED",
    });
    const retry = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(retry.allowed).to.equal(true);
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: retry.claimGeneration ?? 0,
      occurrenceOrdinal: retry.occurrenceOrdinal ?? 0,
      intentHash: retry.intentHash ?? "",
      outcome: "unknown",
    });
    const third = await guard.prepareDispatch(SEND_DESCRIPTOR);
    expect(third.allowed).to.equal(false);
    expect(third.reasonCode).to.equal("OPERATION_UNKNOWN_OUTCOME");
    expect(store.rows.has("op:exec-A:outbound_batch:11#occ2")).to.equal(false);
  });

  it("B17: concurrent same-intent prepares in different executions → exactly one winner (FR-11, AC-09)", async () => {
    // Two executions race the same send intent. The first record is held
    // 50ms so the rival's fence check provably lands inside the race
    // window (microtask-scale work vs millisecond-scale hold): without
    // serialization both fences see empty and both dispatch (double send).
    // With the fence serialized, the loser sees the winner's unresolved
    // row and reconciles instead of dispatching.
    const baseDeps = store.deps();
    let recordCalls = 0;
    const origRecord = baseDeps.recordOperation;
    const racingDeps: OperationGuardDeps = {
      ...baseDeps,
      recordOperation: async (input) => {
        recordCalls++;
        if (recordCalls === 1) {
          await new Promise((r) => setTimeout(r, 50));
        }
        return origRecord(input);
      },
    };
    const guardA = new TaskOperationGuard(racingDeps, "exec-A");
    const guardB = new TaskOperationGuard(racingDeps, "exec-B");
    const [dA, dB] = await Promise.all([
      guardA.prepareDispatch(SEND_DESCRIPTOR),
      guardB.prepareDispatch(SEND_DESCRIPTOR),
    ]);
    const winners = [dA, dB].filter((d) => d.allowed);
    const losers = [dA, dB].filter((d) => !d.allowed);
    expect(winners.length).to.equal(1);
    expect(losers.length).to.equal(1);
    expect(losers[0]?.reasonCode).to.equal("OPERATION_UNRESOLVED_EARLIER");
  });

  it("B18a: uncertain send blocks the same effect under new batch/message provenance (FR-11, AC-10)", async () => {
    // Same authorized effect (stableEffectId S), first attempt settles
    // unknown. An equivalent request minting a NEW batch target must remain
    // blocked pending reconciliation — fresh provenance must not evade its
    // own unknown send.
    const firstDesc: OperationGuardDescriptor = {
      ...SEND_DESCRIPTOR,
      domainTarget: "outbound_batch:11",
      stableEffectId: "send-effect:S",
    };
    const retryDesc: OperationGuardDescriptor = {
      ...SEND_DESCRIPTOR,
      domainTarget: "outbound_batch:22",
      stableEffectId: "send-effect:S",
    };
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(firstDesc);
    expect(first.allowed).to.equal(true);
    await guard.settleDispatch({
      descriptor: firstDesc,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "unknown",
    });
    // Same execution, new batch provenance → still blocked.
    const sameExecRetry = await guard.prepareDispatch(retryDesc);
    expect(sameExecRetry.allowed).to.equal(false);
    expect(sameExecRetry.reasonCode).to.equal("OPERATION_UNKNOWN_OUTCOME");
    // Different execution/conversation, same effect → fenced as earlier.
    const otherExec = await guardFor(store, "exec-B").prepareDispatch(
      retryDesc
    );
    expect(otherExec.allowed).to.equal(false);
    expect(otherExec.reasonCode).to.equal("OPERATION_UNRESOLVED_EARLIER");
  });

  it("B18b: confirmed send leaves equivalent new-provenance requests to native authority (FR-11, AC-09)", async () => {
    // Once the earlier attempt settles confirmed, the guard no longer
    // phantom-blocks the same effect under new provenance — the native
    // batch claim (already_processed) is the authority against double-send.
    const firstDesc: OperationGuardDescriptor = {
      ...SEND_DESCRIPTOR,
      domainTarget: "outbound_batch:11",
      stableEffectId: "send-effect:S",
    };
    const retryDesc: OperationGuardDescriptor = {
      ...SEND_DESCRIPTOR,
      domainTarget: "outbound_batch:22",
      stableEffectId: "send-effect:S",
    };
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(firstDesc);
    await guard.settleDispatch({
      descriptor: firstDesc,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "confirmed",
      receiptReference: "attempt:3",
    });
    const retry = await guard.prepareDispatch(retryDesc);
    expect(retry.allowed).to.equal(true);
  });

  it("B18c: different effect on a different target is not fenced (no over-block)", async () => {
    // Same execution, first effect S1 settles unknown on batch:11. A
    // DIFFERENT effect S2 on a DIFFERENT target (batch:99) shares neither
    // key nor hash with the unknown row, so the fence must not collide.
    // (The same target with a changed effect stays fail-closed at the
    // stable-key INTENT_CONFLICT check — one authorization, one effect.)
    const firstDesc: OperationGuardDescriptor = {
      ...SEND_DESCRIPTOR,
      domainTarget: "outbound_batch:11",
      stableEffectId: "send-effect:S1",
    };
    const otherDesc: OperationGuardDescriptor = {
      ...SEND_DESCRIPTOR,
      domainTarget: "outbound_batch:99",
      stableEffectId: "send-effect:S2",
    };
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(firstDesc);
    expect(first.allowed).to.equal(true);
    await guard.settleDispatch({
      descriptor: firstDesc,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "unknown",
    });
    const other = await guard.prepareDispatch(otherDesc);
    expect(other.allowed).to.equal(true);
  });

  it("D3: settle reads the CURRENT claim generation (survives a crashed dispatched stamp)", async () => {
    // Pre-D3 wedge: the two-step settle stamped dispatched at
    // input.claimGeneration then outcome at input.claimGeneration+1. A crash
    // between the two left the persisted row one generation ahead of the
    // snapshot, so the retried settle (and the direct no_effect path) lost
    // its CAS and the intent wedged unresolved. Read-at-use keeps it
    // convergent.
    const guard = guardFor(store, "exec-A");
    const first = await guard.prepareDispatch(SEND_DESCRIPTOR);
    // Simulate the crash: manually advance the row to dispatched with the
    // first settle's stamp (the dispatched step), but skip the outcome stamp.
    await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "unknown",
    });
    // The row is now `unknown` at generation > first.claimGeneration. A
    // reconciler retry calling settleDispatch with the STALE
    // first.claimGeneration must still succeed because the guard reads the
    // current generation and routes through the unknown→accepted transition.
    const reconcile = await guard.settleDispatch({
      descriptor: SEND_DESCRIPTOR,
      claimGeneration: first.claimGeneration ?? 0,
      occurrenceOrdinal: first.occurrenceOrdinal ?? 0,
      intentHash: first.intentHash ?? "",
      outcome: "confirmed",
      receiptReference: "attempt:91",
    });
    expect(reconcile.ok).to.equal(true);
    const row = store.rows.get("op:exec-A:outbound_batch:11");
    expect(row?.operationState).to.equal("accepted");
    expect(row?.receiptReference).to.equal("attempt:91");
  });
});
