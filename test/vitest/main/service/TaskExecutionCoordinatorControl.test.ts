import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { StartBindingResult } from "@/service/aiTaskExecution/TaskExecutionCoordinator";

// Unit 7 (GAP-S2 #10/#11, FR-20..24, AC-23/24/25/27/28) — control-plane
// methods on the coordinator: `cancel`, `continueExecution`, `retryExecution`.
//
// The mock mirrors TaskExecutionCoordinator.test.ts: a store of execution
// rows, a ledger store whose rows the coordinator resurrects budgets from,
// and a finalize log so cancel's CAS finalize can be asserted. `finalizeExecution`
// honors an optional override so tests can drive ALREADY_FINALIZED and
// STATE_CONFLICT paths without a DB.
vi.mock("@/modules/AiTaskExecutionModule", () => {
  const store = new Map<string, unknown>();
  interface MockLedgerRow {
    owner_generation: number;
    policy_limits_json: string;
    consumed_continuations: number;
    consumed_provider_attempts: number;
    consumed_checker_attempts: number;
    consumed_tool_executions: number;
    consumed_tokens: number;
    consumed_active_ms: number;
    consumed_wait_ms: number;
    no_progress_streak: number;
    status: string;
  }
  const ledgers = new Map<string, MockLedgerRow>();
  const finalized: Array<{
    executionId: string;
    outcome: string;
    reasonCode: string;
    expectedVersion: number;
  }> = [];
  type FinalizeOverride =
    | { kind: "already_finalized" }
    | { kind: "conflict"; conflictTimes: number }
    | { kind: "missing" };
  const finalizeOverrides = new Map<string, FinalizeOverride>();
  // Successor executions (Continue/Retry) reuse the parent's conversationId,
  // so ids are minted per call count: first call `exec-<conv>`, successors
  // `exec-<conv>-2`, `-3`, ... — mirroring distinct rows in production.
  const callCounts = new Map<string, number>();
  return {
    AiTaskExecutionModule: class {
      async startExecution(input: {
        conversationId: string;
        lineageLedgerId?: string | null;
        budgetLimits: unknown;
      }): Promise<
        | { status: "created"; executionId: string; ledgerId: string; executionRowId: number }
        | { status: "reused"; existing: unknown }
        | { status: "conflict"; reasonCode: "SUBMISSION_CONFLICT"; existing: unknown }
      > {
        const callCount = (callCounts.get(input.conversationId) ?? 0) + 1;
        callCounts.set(input.conversationId, callCount);
        const executionId =
          callCount === 1
            ? `exec-${input.conversationId}`
            : `exec-${input.conversationId}-${callCount}`;
        // Continue reuses the lineage ledger; a fresh start (Retry) mints a
        // new one — the coordinator decides which by passing lineageLedgerId.
        const ledgerId = input.lineageLedgerId ?? `ledger-${executionId}`;
        store.set(executionId, input);
        if (ledgers.has(ledgerId)) {
          const existing = ledgers.get(ledgerId) as MockLedgerRow;
          ledgers.set(ledgerId, {
            ...existing,
            owner_generation: existing.owner_generation + 1,
          });
        } else {
          ledgers.set(ledgerId, {
            owner_generation: 0,
            policy_limits_json: JSON.stringify(input.budgetLimits),
            consumed_continuations: 0,
            consumed_provider_attempts: 0,
            consumed_checker_attempts: 0,
            consumed_tool_executions: 0,
            consumed_tokens: 0,
            consumed_active_ms: 0,
            consumed_wait_ms: 0,
            no_progress_streak: 0,
            status: "active",
          });
        }
        return { status: "created", executionId, ledgerId, executionRowId: 1 };
      }
      async getExecution(executionId?: string): Promise<unknown> {
        if (!executionId) return null;
        if (finalizeOverrides.get(executionId)?.kind === "missing") return null;
        const input = store.get(executionId);
        if (!input) return null;
        return { executionId, finalized: false, execution_state_version: 0 };
      }
      async finalizeExecution(input: {
        executionId: string;
        expectedVersion: number;
        outcome: string;
        reasonCode: string;
      }): Promise<
        | { ok: true }
        | { ok: true; alreadyFinalized: true }
        | { ok: false; reasonCode: string }
      > {
        finalized.push({
          executionId: input.executionId,
          outcome: input.outcome,
          reasonCode: input.reasonCode,
          expectedVersion: input.expectedVersion,
        });
        const override = finalizeOverrides.get(input.executionId);
        if (override?.kind === "already_finalized") {
          return { ok: true, alreadyFinalized: true };
        }
        if (override?.kind === "conflict" && override.conflictTimes > 0) {
          finalizeOverrides.set(input.executionId, {
            ...override,
            conflictTimes: override.conflictTimes - 1,
          });
          return { ok: false, reasonCode: "STATE_CONFLICT" };
        }
        return { ok: true };
      }
      async getLedgerById(
        ledgerId: string
      ): Promise<{
        ledgerId: string;
        ownerGeneration: number;
        policyLimitsJson: string;
        consumedContinuations: number;
        consumedProviderAttempts: number;
        consumedToolExecutions: number;
        consumedCheckerAttempts: number;
        consumedTokens: number;
        consumedActiveMs: number;
        consumedWaitMs: number;
        noProgressStreak: number;
        status: string;
      } | null> {
        const row = ledgers.get(ledgerId);
        if (!row) return null;
        return {
          ledgerId,
          ownerGeneration: row.owner_generation,
          policyLimitsJson: row.policy_limits_json,
          consumedContinuations: row.consumed_continuations,
          consumedProviderAttempts: row.consumed_provider_attempts,
          consumedToolExecutions: row.consumed_tool_executions,
          consumedCheckerAttempts: row.consumed_checker_attempts,
          consumedTokens: row.consumed_tokens,
          consumedActiveMs: row.consumed_active_ms,
          consumedWaitMs: row.consumed_wait_ms,
          noProgressStreak: row.no_progress_streak,
          status: row.status,
        };
      }
      static _store(): Map<string, unknown> {
        return store;
      }
      static _ledgers(): Map<string, MockLedgerRow> {
        return ledgers;
      }
      static _finalized(): Array<{
        executionId: string;
        outcome: string;
        reasonCode: string;
        expectedVersion: number;
      }> {
        return finalized;
      }
      static _setFinalizeOverride(executionId: string, o: FinalizeOverride): void {
        finalizeOverrides.set(executionId, o);
      }
    },
  };
});

import { TaskExecutionCoordinator } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/TaskRunBudget";
import type { TaskCompletionContract } from "@/entityTypes/aiTaskExecutionTypes";

/** Narrow the discriminated StartBindingResult to the `created` binding. */
function unwrap(result: StartBindingResult) {
  if (result.status !== "created") {
    throw new Error(`expected created, got ${result.status}`);
  }
  return result.binding;
}

type MockModuleCtor = {
  _store: () => Map<string, unknown>;
  _ledgers: () => Map<string, unknown>;
  _finalized: () => Array<{
    executionId: string;
    outcome: string;
    reasonCode: string;
    expectedVersion: number;
  }>;
  _setFinalizeOverride: (executionId: string, o: unknown) => void;
};

function mockCtor(): MockModuleCtor {
  return AiTaskExecutionModule as unknown as MockModuleCtor;
}

function makeContract(): TaskCompletionContract {
  return {
    schemaVersion: 1,
    contractId: "contract-continue",
    contractHash: "sha256:continue",
    objective: "Save 100 qualifying contacts",
    sourceUserMessageId: "msg-1",
    approvedSourceMessageIds: ["msg-1"],
    mode: "verified",
    criteria: [
      {
        id: "crit-1",
        required: true,
        kind: "record_count",
        description: "at least 100 contacts saved",
        adapterKey: "contactStore",
        targetId: "contacts",
        scope: "execution",
        minimum: 100,
        sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
      },
    ],
  };
}

beforeEach(() => {
  mockCtor()._store().clear();
  mockCtor()._ledgers().clear();
  mockCtor()._finalized().length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TaskExecutionCoordinator.cancel (FR-23, AC-23)", () => {
  it("finalizes the execution with outcome cancelled / USER_CANCELLED", async () => {
    const coord = new TaskExecutionCoordinator();
    const binding = unwrap(
      await coord.startManual({
        conversationId: "conv-cancel",
        sourceUserMessageId: "msg-1",
        submissionId: "sub-1",
        requestHash: "sha256:abc",
        route: "task_verified",
        completionOwner: "standalone",
      })
    );
    const result = await coord.cancel(binding.executionId);
    expect(result.ok).toBe(true);
    const entries = mockCtor()._finalized();
    expect(entries).toHaveLength(1);
    expect(entries[0].executionId).toBe("exec-conv-cancel");
    expect(entries[0].outcome).toBe("cancelled");
    expect(entries[0].reasonCode).toBe("USER_CANCELLED");
    expect(entries[0].expectedVersion).toBe(0);
  });

  it("returns ALREADY_FINALIZED as a success no-op (second stop click)", async () => {
    const coord = new TaskExecutionCoordinator();
    const binding = unwrap(
      await coord.startManual({
        conversationId: "conv-cancel-twice",
        sourceUserMessageId: "msg-1",
        submissionId: "sub-1",
        requestHash: "sha256:abc",
        route: "task_verified",
        completionOwner: "standalone",
      })
    );
    mockCtor()._setFinalizeOverride(binding.executionId, {
      kind: "already_finalized",
    });
    const result = await coord.cancel(binding.executionId);
    expect(result.ok).toBe(true);
    expect(result.alreadyFinalized).toBe(true);
  });

  it("surfaces MISSING_TASK_OUTCOME for an unknown execution", async () => {
    const coord = new TaskExecutionCoordinator();
    const result = await coord.cancel("exec-never-created");
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("MISSING_TASK_OUTCOME");
  });
});

describe("TaskExecutionCoordinator.continueExecution (FR-21, AC-27)", () => {
  it("creates a successor sharing the lineage ledger and resurrects the budget", async () => {
    const coord = new TaskExecutionCoordinator();
    const parent = unwrap(
      await coord.startManual({
        conversationId: "conv-parent",
        sourceUserMessageId: "msg-1",
        submissionId: "sub-1",
        requestHash: "sha256:abc",
        route: "task_verified",
        completionOwner: "standalone",
        contract: makeContract(),
      })
    );
    // Spend against the parent so the shared-ledger assertion has something
    // to inherit. Production persists ledger counters at finalization
    // (GAP-S2 #4 closes the runtime sync); the mock's ledger row is seeded
    // directly so the resurrect assertion exercises the ledger, not the
    // in-memory mirror.
    parent.budget.reserveContinuation("cont-1");
    const ledgerRow = mockCtor()._ledgers().get(parent.ledgerId) as {
      consumed_continuations: number;
    } | undefined;
    if (ledgerRow) {
      ledgerRow.consumed_continuations = 1;
    }
    const result = await coord.continueExecution({
      parentExecutionId: parent.executionId,
      lineageLedgerId: parent.ledgerId,
      conversationId: parent.conversationId,
      sourceUserMessageId: parent.sourceUserMessageId,
      submissionId: "sub-continue-1",
      requestHash: "sha256:continue-1",
      route: "task_verified",
      contract: makeContract(),
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    // Same ledger row (shared lineage budget, NOT a fresh one).
    expect(result.binding.ledgerId).toBe(parent.ledgerId);
    // Budget resurrected from the ledger with the parent's spent counters.
    expect(result.binding.budget.getConsumed().continuations).toBe(1);
    // Fenced lease: the successor's owner_generation is bumped past the
    // parent's so a stale parent's finalize CAS loses.
    expect(result.binding.leaseGeneration).toBeGreaterThan(
      parent.leaseGeneration
    );
    expect(result.binding.contract?.contractHash).toBe("sha256:continue");
    // The successor row records its parent (FR-21 lineage).
    const store = mockCtor()._store();
    const row = store.get(result.binding.executionId) as {
      parentExecutionId?: string | null;
    };
    expect(row.parentExecutionId).toBe(parent.executionId);
  });
});

describe("TaskExecutionCoordinator.retryExecution (FR-22, AC-28)", () => {
  it("creates a successor with a NEW ledger and a fresh budget", async () => {
    const coord = new TaskExecutionCoordinator();
    const parent = unwrap(
      await coord.startManual({
        conversationId: "conv-retry-parent",
        sourceUserMessageId: "msg-1",
        submissionId: "sub-1",
        requestHash: "sha256:abc",
        route: "task_verified",
        completionOwner: "standalone",
        contract: makeContract(),
      })
    );
    parent.budget.reserveContinuation("cont-parent");
    const result = await coord.retryExecution({
      parentExecutionId: parent.executionId,
      conversationId: parent.conversationId,
      sourceUserMessageId: parent.sourceUserMessageId,
      submissionId: "sub-retry-1",
      requestHash: "sha256:retry-1",
      route: "task_verified",
      contract: makeContract(),
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    // A distinct ledger row — Retry gets fresh allowance (FR-22).
    expect(result.binding.ledgerId).not.toBe(parent.ledgerId);
    expect(result.binding.budget.getConsumed().continuations).toBe(0);
    // Fresh budget: full continuation allowance from the manual defaults,
    // not the parent's spent balance.
    expect(result.binding.budget.getRemaining().continuations).toBe(
      MANUAL_BUDGET_DEFAULTS.maxContinuations
    );
    // Lineage still records the parent.
    const row = mockCtor()._store().get(result.binding.executionId) as {
      parentExecutionId?: string | null;
    };
    expect(row.parentExecutionId).toBe(parent.executionId);
  });

  it("re-freezes the contract so a changed request mints a new hash", async () => {
    const coord = new TaskExecutionCoordinator();
    const parent = unwrap(
      await coord.startManual({
        conversationId: "conv-retry-hash",
        sourceUserMessageId: "msg-1",
        submissionId: "sub-1",
        requestHash: "sha256:abc",
        route: "task_verified",
        completionOwner: "standalone",
        contract: makeContract(),
      })
    );
    const changed = {
      ...makeContract(),
      objective: "Save 200 qualifying contacts",
      contractHash: "sha256:retry-changed",
    };
    const result = await coord.retryExecution({
      parentExecutionId: parent.executionId,
      conversationId: parent.conversationId,
      sourceUserMessageId: parent.sourceUserMessageId,
      submissionId: "sub-retry-2",
      requestHash: "sha256:retry-2",
      route: "task_verified",
      contract: changed,
    });
    if (result.status !== "created") {
      throw new Error(`expected created, got ${result.status}`);
    }
    expect(result.binding.contractHash).toBe("sha256:retry-changed");
  });
});

describe("TaskExecutionCoordinator cancel finalization resilience (AC-23)", () => {
  it("retries once on STATE_CONFLICT then succeeds against the fresh version", async () => {
    const coord = new TaskExecutionCoordinator();
    const binding = unwrap(
      await coord.startManual({
        conversationId: "conv-cancel-conflict",
        sourceUserMessageId: "msg-1",
        submissionId: "sub-1",
        requestHash: "sha256:abc",
        route: "task_verified",
        completionOwner: "standalone",
      })
    );
    mockCtor()._setFinalizeOverride(binding.executionId, {
      kind: "conflict",
      conflictTimes: 1,
    });
    const result = await coord.cancel(binding.executionId);
    expect(result.ok).toBe(true);
    const entries = mockCtor()._finalized();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[entries.length - 1].outcome).toBe("cancelled");
  });
});
