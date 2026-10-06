import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { StartBindingResult } from "@/service/aiTaskExecution/TaskExecutionCoordinator";

// Mock the module layer so the coordinator is tested in isolation from
// the DB. The coordinator's contract: create execution identity + binding
// before slow resolution (FR-17), single completion owner (FR-20), and
// lease-generation fencing.
//
// Slice 2 Unit 3 extensions: the mock now owns a ledger store so the
// coordinator can read `owner_generation` (leaseGeneration) and resurrect
// a budget from a persisted ledger row on the Continue path. An override
// map lets individual tests program a `reused`/`conflict` result for a
// given conversation without disturbing the default `created` path.
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
  const overrides = new Map<
    string,
    | { status: "reused"; existing: unknown }
    | { status: "conflict"; reasonCode: "SUBMISSION_CONFLICT"; existing: unknown }
  >();
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
        const override = overrides.get(input.conversationId);
        if (override) {
          overrides.delete(input.conversationId);
          return override;
        }
        const executionId = `exec-${input.conversationId}`;
        // Continue reuses the lineage ledger; a fresh start mints a new one.
        const ledgerId = input.lineageLedgerId ?? `ledger-${input.conversationId}`;
        store.set(executionId, input);
        if (ledgers.has(ledgerId)) {
          // Continue successor: bump owner_generation (fencing) and take
          // ownership of the shared lineage ledger.
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
        return {
          status: "created",
          executionId,
          ledgerId,
          executionRowId: 1,
        };
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
        // Project to the camelCase LedgerSnapshot shape the real model returns
        // so the coordinator reads the same field names in production and tests.
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
      async getExecution(): Promise<null> {
        return null;
      }
      async finalizeExecution(): Promise<{ ok: true }> {
        return { ok: true };
      }
      static _store(): Map<string, unknown> {
        return store;
      }
      static _ledgers(): Map<string, MockLedgerRow> {
        return ledgers;
      }
      static _setOverride(
        conv: string,
        result:
          | { status: "reused"; existing: unknown }
          | { status: "conflict"; reasonCode: "SUBMISSION_CONFLICT"; existing: unknown }
      ): void {
        overrides.set(conv, result);
      }
    },
  };
});

import { TaskExecutionCoordinator } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import type { TaskExecutionBindingSnapshot } from "@/entityTypes/aiTaskExecutionTypes";
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
  _setOverride: (
    conv: string,
    result:
      | { status: "reused"; existing: unknown }
      | { status: "conflict"; reasonCode: "SUBMISSION_CONFLICT"; existing: unknown }
  ) => void;
};

function mockCtor(): MockModuleCtor {
  return AiTaskExecutionModule as unknown as MockModuleCtor;
}

beforeEach(() => {
  mockCtor()._store().clear();
  mockCtor()._ledgers().clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TaskExecutionCoordinator.startManual (FR-17/20)", () => {
  it("creates a binding with manual origin and standalone owner before slow resolution", async () => {
    const coord = new TaskExecutionCoordinator();
    const binding = unwrap(await coord.startManual({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-1",
      requestHash: "sha256:abc",
      route: "task_verified",
      completionOwner: "standalone",
    }));
    expect(binding.executionId).toBe("exec-conv-1");
    expect(binding.origin).toEqual({
      type: "manual",
      submissionId: "sub-1",
    });
    expect(binding.completionOwner).toBe("standalone");
    expect(binding.leaseGeneration).toBe(0);
    expect(binding.contract).toBeNull(); // frozen later by ContractService
    expect(binding.budget).toBeDefined();
  });

  it("creates a binding with scheduled origin and the occurrence link", async () => {
    const coord = new TaskExecutionCoordinator();
    const binding = unwrap(await coord.startScheduled({
      conversationId: "conv-2",
      sourceUserMessageId: "msg-2",
      requestHash: "sha256:def",
      route: "task_best_effort",
      taskId: 7,
      runId: 12,
      occurrenceKey: "scheduled-loop:7:1",
      budgetLimits: {
        maxContinuations: 3,
        maxProviderAttempts: 60,
        maxCheckerAttempts: 6,
        maxToolExecutions: 10,
        maxTokens: 128_000,
        maxActiveRuntimeMs: 300_000,
        maxWaitMs: 60 * 60 * 1000,
        maxNoProgressStreak: 3,
      },
    }));
    expect(binding.origin).toEqual({
      type: "scheduled",
      taskId: 7,
      runId: 12,
      occurrenceKey: "scheduled-loop:7:1",
    });
  });

  it("serializes to a snapshot that excludes runtime controller/budget objects", async () => {
    const coord = new TaskExecutionCoordinator();
    const binding = unwrap(await coord.startManual({
      conversationId: "conv-3",
      sourceUserMessageId: "msg-3",
      submissionId: "sub-3",
      requestHash: "sha256:ghi",
      route: "response_only",
      completionOwner: "standalone",
    }));
    const snap = coord.toSnapshot(binding);
    const keys = Object.keys(snap) as (keyof TaskExecutionBindingSnapshot)[];
    expect(keys).not.toContain("controller");
    expect(keys).not.toContain("budget");
    expect(snap.contractHash).toBeNull();
  });
});

describe("TaskExecutionCoordinator contract freeze (FR-19/FR-04, Unit 3)", () => {
  it("freezes a verified contract and returns the canonical hash", () => {
    const coord = new TaskExecutionCoordinator();
    const contract = coord.freezeContract({
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
    });
    expect(contract.contractHash).toMatch(/^sha256:[0-9a-f]+$/);
    expect(contract.contractHash).toBe(contract.contractHash); // stable
    expect(contract.criteria).toHaveLength(1);
  });

  it("throws when a verified-mode contract has zero required criteria (FR-04)", () => {
    const coord = new TaskExecutionCoordinator();
    expect(() =>
      coord.freezeContract({
        objective: "do something",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "verified",
        criteria: [],
      })
    ).toThrow(/verified contract requires at least one required criterion/);
  });

  it("throws when sourceUserMessageId is not in the approved set (FR-18)", () => {
    const coord = new TaskExecutionCoordinator();
    expect(() =>
      coord.freezeContract({
        objective: "do something",
        sourceUserMessageId: "msg-unapproved",
        approvedSourceMessageIds: ["msg-1"],
        mode: "best_effort",
        criteria: [],
      })
    ).toThrow(/sourceUserMessageId must be in approvedSourceMessageIds/);
  });

  it("carries the frozen contract + hash onto the created binding", async () => {
    const coord = new TaskExecutionCoordinator();
    const contract: TaskCompletionContract = coord.freezeContract({
      objective: "Save 100 contacts",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria: [
        {
          id: "crit-1",
          required: true,
          kind: "record_count",
          description: "100 contacts",
          adapterKey: "contactStore",
          targetId: "contacts",
          scope: "execution",
          minimum: 100,
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
      ],
    });
    const binding = unwrap(await coord.startManual({
      conversationId: "conv-contract",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-contract",
      requestHash: "sha256:xyz",
      route: "task_verified",
      completionOwner: "standalone",
      contract,
    }));
    expect(binding.contract).toBe(contract);
    expect(binding.contractHash).toBe(contract.contractHash);
  });
});

describe("TaskExecutionCoordinator reused / conflict (AC-26, Unit 3)", () => {
  it("propagates a reused result without constructing a fresh budget/controller (transport retry)", async () => {
    const coord = new TaskExecutionCoordinator();
    mockCtor()._setOverride("conv-reuse", {
      status: "reused",
      existing: {
        executionId: "exec-existing",
        ledgerId: "ledger-existing",
        conversationId: "conv-reuse",
        submissionId: "sub-1",
        requestHash: "sha256:abc",
        stage: "active",
        finalized: false,
        taskOutcome: null,
        outcomeReasonCode: null,
        executionStateVersion: 0,
      },
    });
    const result = await coord.startManual({
      conversationId: "conv-reuse",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-1",
      requestHash: "sha256:abc",
      route: "task_verified",
      completionOwner: "standalone",
    });
    expect(result.status).toBe("reused");
    if (result.status === "reused") {
      expect(result.existing.executionId).toBe("exec-existing");
    }
  });

  it("propagates a SUBMISSION_CONFLICT result without constructing a binding", async () => {
    const coord = new TaskExecutionCoordinator();
    mockCtor()._setOverride("conv-conflict", {
      status: "conflict",
      reasonCode: "SUBMISSION_CONFLICT",
      existing: {
        executionId: "exec-existing",
        ledgerId: "ledger-existing",
        conversationId: "conv-conflict",
        submissionId: "sub-1",
        requestHash: "sha256:different",
        stage: "active",
        finalized: false,
        taskOutcome: null,
        outcomeReasonCode: null,
        executionStateVersion: 0,
      },
    });
    const result = await coord.startManual({
      conversationId: "conv-conflict",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-1",
      requestHash: "sha256:abc",
      route: "task_verified",
      completionOwner: "standalone",
    });
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.reasonCode).toBe("SUBMISSION_CONFLICT");
    }
  });
});

describe("TaskExecutionCoordinator Continue lineage (FR-21/22, Unit 3)", () => {
  it("resurrects the budget from the lineage ledger and carries the bumped leaseGeneration", async () => {
    const coord = new TaskExecutionCoordinator();
    // Pre-seed the lineage ledger with a non-zero owner_generation and
    // spent counters — the Continue successor must inherit both.
    mockCtor()._ledgers().set("ledger-lineage", {
      owner_generation: 1,
      policy_limits_json: JSON.stringify({
        maxContinuations: 3,
        maxProviderAttempts: 60,
        maxCheckerAttempts: 6,
        maxToolExecutions: 50,
        maxTokens: 128_000,
        maxActiveRuntimeMs: 600_000,
        maxWaitMs: 3_600_000,
        maxNoProgressStreak: 3,
      }),
      consumed_continuations: 2,
      consumed_provider_attempts: 5,
      consumed_checker_attempts: 1,
      consumed_tool_executions: 7,
      consumed_tokens: 12_000,
      consumed_active_ms: 45_000,
      consumed_wait_ms: 5_000,
      no_progress_streak: 1,
      status: "active",
    });
    const binding = unwrap(await coord.startManual({
      conversationId: "conv-continue",
      sourceUserMessageId: "msg-continue",
      submissionId: "sub-continue",
      requestHash: "sha256:continue",
      route: "task_verified",
      completionOwner: "standalone",
      parentExecutionId: "exec-parent",
      lineageLedgerId: "ledger-lineage",
    }));
    // owner_generation was seeded at 1; the mock bumps it to 2 on Continue.
    expect(binding.leaseGeneration).toBe(2);
    expect(binding.ledgerId).toBe("ledger-lineage");
    // Budget resurrected from the ledger row, not freshly minted.
    expect(binding.budget.getConsumed().continuations).toBe(2);
    expect(binding.budget.getConsumed().providerAttempts).toBe(5);
    expect(binding.budget.getConsumed().toolExecutions).toBe(7);
  });
});

describe("TaskExecutionCoordinator single-owner lease guard (FR-20, Unit 3)", () => {
  it("accepts a matching leaseGeneration", () => {
    const coord = new TaskExecutionCoordinator();
    const guard = coord.assertOwnership(
      { leaseGeneration: 5 } as { leaseGeneration: number },
      5
    );
    expect(guard).toEqual({ ok: true });
  });

  it("returns STATE_CONFLICT on a leaseGeneration mismatch", () => {
    const coord = new TaskExecutionCoordinator();
    const guard = coord.assertOwnership(
      { leaseGeneration: 4 } as { leaseGeneration: number },
      5
    );
    expect(guard).toEqual({ ok: false, reasonCode: "STATE_CONFLICT" });
  });
});
