import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// Mock the module layer so the coordinator is tested in isolation from
// the DB. The coordinator's contract: create execution identity + binding
// before slow resolution (FR-17), single completion owner (FR-20), and
// lease-generation fencing.
vi.mock("@/modules/AiTaskExecutionModule", () => {
  const store = new Map<string, unknown>();
  return {
    AiTaskExecutionModule: class {
      async startExecution(input: unknown): Promise<{
        executionId: string;
        ledgerId: string;
        executionRowId: number;
      }> {
        const executionId = `exec-${(input as { conversationId: string }).conversationId}`;
        store.set(executionId, input);
        return {
          executionId,
          ledgerId: `ledger-${(input as { conversationId: string }).conversationId}`,
          executionRowId: 1,
        };
      }
      async getExecution(_id: string): Promise<null> {
        return null;
      }
      async finalizeExecution(): Promise<{ ok: true }> {
        return { ok: true };
      }
      static _store(): Map<string, unknown> {
        return store;
      }
    },
  };
});

import { TaskExecutionCoordinator } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import type { TaskExecutionBindingSnapshot } from "@/entityTypes/aiTaskExecutionTypes";

beforeEach(() => {
  // Reset the module mock store between tests. vi.mock is hoisted above
  // imports, so the ESM-imported AiTaskExecutionModule IS the mock.
  const Ctor = AiTaskExecutionModule as unknown as {
    _store: () => Map<string, unknown>;
  };
  Ctor._store().clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TaskExecutionCoordinator.startManual (FR-17/20)", () => {
  it("creates a binding with manual origin and standalone owner before slow resolution", async () => {
    const coord = new TaskExecutionCoordinator();
    const binding = await coord.startManual({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-1",
      requestHash: "sha256:abc",
      route: "task_verified",
      completionOwner: "standalone",
    });
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
    const binding = await coord.startScheduled({
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
    });
    expect(binding.origin).toEqual({
      type: "scheduled",
      taskId: 7,
      runId: 12,
      occurrenceKey: "scheduled-loop:7:1",
    });
  });

  it("serializes to a snapshot that excludes runtime controller/budget objects", async () => {
    const coord = new TaskExecutionCoordinator();
    return coord
      .startManual({
        conversationId: "conv-3",
        sourceUserMessageId: "msg-3",
        submissionId: "sub-3",
        requestHash: "sha256:ghi",
        route: "response_only",
        completionOwner: "standalone",
      })
      .then((binding) => {
        const snap = coord.toSnapshot(binding);
        const keys = Object.keys(snap) as (keyof TaskExecutionBindingSnapshot)[];
        expect(keys).not.toContain("controller");
        expect(keys).not.toContain("budget");
        expect(snap.contractHash).toBeNull();
      });
  });
});
