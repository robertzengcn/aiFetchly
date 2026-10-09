import { describe, expect, it } from "vitest";
import { TaskEvidenceService } from "@/service/aiTaskExecution/TaskEvidenceService";
import type { EvidenceStore, EvidenceStoreSnapshot } from "@/service/aiTaskExecution/TaskEvidenceService";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";
import {
  buildDefaultRegistry,
  CriteriaAdapterRegistry,
  OperationReceiptAdapter,
} from "@/service/aiTaskExecution/criteriaAdapters";
import type { CriterionEvaluator } from "@/service/aiTaskExecution/criteriaAdapters";
import type {
  TaskCompletionContract,
  TaskEndCandidate,
} from "@/entityTypes/aiTaskExecutionTypes";
import { z } from "zod/v4";
import { taskCompletionContractSchema, taskEndCandidateSchema } from "@/entityTypes/aiTaskExecutionTypes";

function baseCandidate(overrides: Partial<TaskEndCandidate> = {}): TaskEndCandidate {
  return taskEndCandidateSchema.parse({
    candidateId: "cand-1",
    executionId: "exec-1",
    content: "Saved 100 contacts.",
    finishReason: "stop",
    provenance: "provider",
    streamTerminalSeen: true,
    boundary: "response_end",
    pendingPermission: false,
    pendingQuestion: false,
    pendingPlanApproval: false,
    safetyRestriction: false,
    ...overrides,
  });
}

function makeContract(criteria: z.infer<typeof taskCompletionContractSchema>["criteria"]): TaskCompletionContract {
  return taskCompletionContractSchema.parse({
    schemaVersion: 1,
    contractId: "contract-1",
    contractHash: "hash-abc",
    objective: "Save contacts",
    sourceUserMessageId: "msg-1",
    approvedSourceMessageIds: ["msg-1"],
    mode: "verified",
    criteria,
  });
}

function observationCriterion(id: string, targetId: string): z.infer<typeof taskCompletionContractSchema>["criteria"][number] {
  return {
    id,
    required: true,
    kind: "observation",
    description: `observes ${targetId}`,
    adapterKey: "observation",
    targetId,
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
  };
}

function operationCriterion(id: string, targetId: string, requiredState: "accepted" | "completed"): z.infer<typeof taskCompletionContractSchema>["criteria"][number] {
  return {
    id,
    required: true,
    kind: "operation_receipt",
    description: `op ${targetId}`,
    adapterKey: "operation_receipt",
    targetId,
    requiredState,
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
  };
}

function qualitativeCriterion(id: string, description: string): z.infer<typeof taskCompletionContractSchema>["criteria"][number] {
  return {
    id,
    required: true,
    kind: "qualitative",
    description,
    sourceSelectorKeys: ["provider"],
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
  };
}

function artifactCriterion(id: string): z.infer<typeof taskCompletionContractSchema>["criteria"][number] {
  return {
    id,
    required: true,
    kind: "artifact",
    description: "artifact",
    relativePath: "out/report.txt",
    expectation: "exists",
    requiredContentChecks: [],
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
  };
}

function recordCountCriterion(id: string, targetId: string, minimum: number): z.infer<typeof taskCompletionContractSchema>["criteria"][number] {
  return {
    id,
    required: true,
    kind: "record_count",
    description: `count ${targetId}`,
    adapterKey: "record_count",
    targetId,
    scope: "execution",
    minimum,
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
  };
}

function memoryStore(initial?: { stateJson: string | null; version: number; finalized: boolean }): {
  store: EvidenceStore;
  snapshot: EvidenceStoreSnapshot;
  writes: { executionId: string; expectedVersion: number; mergedStateJson: string }[];
} {
  // Internal mutable state — the exported `snapshot` is a fresh read-only
  // view returned from getExecutionState so the EvidenceStore contract
  // (readonly snapshot) is respected.
  const state = initial ?? { stateJson: null, version: 0, finalized: false };
  const writes: { executionId: string; expectedVersion: number; mergedStateJson: string }[] = [];
  const snapshot: EvidenceStoreSnapshot = {
    get stateJson() { return state.stateJson; },
    get version() { return state.version; },
    get finalized() { return state.finalized; },
  };
  const store: EvidenceStore = {
    getExecutionState: async () => snapshot,
    mergeEvidenceCas: async (input) => {
      writes.push(input);
      state.version += 1;
      return true;
    },
  };
  return { store, snapshot, writes };
}

describe("TaskEvidenceService.checkCandidate (Slice 2, FR-05/06/16, AC-12/13)", () => {
  it("observation criterion: substring present in content → pass", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "100 contacts")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts to campaign camp-1." }),
      contract,
      { content: "Saved 100 contacts to campaign camp-1.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    expect(result.unmetCriterionIds).toEqual([]);
    expect(result.evidenceIds).toHaveLength(1);
    expect(result.evidenceIds[0]).toMatch(/^evidence-/);
  });

  it("observation criterion: substring absent → unknown (not fail — stream ended cleanly, but absence is inconclusive until verified)", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "nonexistent phrase")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    // Observation adapter returns "unknown" (not "fail") when the target is
    // absent — the criterion is treated as unmet → incomplete (AC-12).
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("observation criterion: regex: prefix compiles and matches → pass", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "regex:\\d+ contacts")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 42 contacts." }),
      contract,
      { content: "Saved 42 contacts.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
  });

  it("operation_receipt criterion: state meets threshold → pass; below threshold → fail", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([
      operationCriterion("rec-1", "op-send", "accepted"),
      operationCriterion("rec-2", "op-pending", "completed"),
    ]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      {
        content: "",
        source: "provider",
        sourceRevision: "rev-1",
        expectedStateVersion: 0,
        toolCatalogState: {
          "op-send": { state: "accepted" },
          "op-pending": { state: "dispatched" },
        },
      }
    );
    // op-send state "accepted" meets requiredState "accepted" → pass.
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    // op-pending state "dispatched" < requiredState "completed" → fail (not unknown).
    expect(result.unmetCriterionIds).toEqual(["rec-2"]);
  });

  it("operation_receipt criterion: operation absent from catalog → unknown", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([operationCriterion("rec-1", "op-missing", "accepted")]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      {
        content: "",
        source: "provider",
        sourceRevision: "rev-1",
        expectedStateVersion: 0,
        toolCatalogState: {},
      }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("qualitative criterion: checker LLM returns pass/fail/unknown via §8.2 JSON → matching state; budget exhausted → unknown (fail-closed, AC-09/10)", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([
      qualitativeCriterion("rec-1", "response is polite"),
      qualitativeCriterion("rec-2", "response is rude"),
      qualitativeCriterion("rec-3", "response mentions weather"),
    ]);
    let calls = 0;
    const dispatch = async (prompt: string): Promise<string> => {
      calls += 1;
      // T04: the §8.2 JSON contract. The checker cites the admissible evidence
      // id (the criterion id) on pass; fail/unknown carry no citation.
      if (prompt.includes("polite")) {
        return JSON.stringify({
          criteria: [
            {
              criterionId: "rec-1",
              verdict: "pass",
              evidenceIds: ["rec-1"],
              reason: "polite",
            },
          ],
        });
      }
      if (prompt.includes("rude")) {
        return JSON.stringify({
          criteria: [
            {
              criterionId: "rec-2",
              verdict: "fail",
              evidenceIds: [],
              reason: "rude",
            },
          ],
        });
      }
      return JSON.stringify({
        criteria: [
          {
            criterionId: "rec-3",
            verdict: "unknown",
            evidenceIds: [],
            reason: "no weather",
          },
        ],
      });
    };
    // Budget: first two reservations succeed, third exhausted.
    let checkerCalls = 0;
    const reserveChecker = (): BudgetReservationResult => {
      checkerCalls += 1;
      return checkerCalls <= 2 ? BudgetReservationResult.Reserved : BudgetReservationResult.Exhausted;
    };
    const result = await service.checkCandidate(
      baseCandidate({ content: "Hello, I hope you are well." }),
      contract,
      {
        content: "Hello, I hope you are well.",
        source: "provider",
        sourceRevision: "rev-1",
        expectedStateVersion: 0,
        checkerDispatch: dispatch,
        budgetReserveChecker: reserveChecker,
      }
    );
    // rec-1 (polite) pass → pass; rec-2 (rude) fail → fail (unmet);
    // rec-3 (weather) budget exhausted → unknown (unmet, fail-closed).
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    expect(result.unmetCriterionIds).toContain("rec-2");
    expect(result.unmetCriterionIds).toContain("rec-3");
    // rec-3 was never dispatched — only 2 checker calls.
    expect(calls).toBe(2);
  });

  it("qualitative criterion: checker LLM AbortError (user cancel during checking) → unknown, never verified (AC-24)", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([qualitativeCriterion("rec-1", "anything")]);
    const dispatch = async (): Promise<string> => {
      const err = new Error("The user aborted a request");
      err.name = "AbortError";
      throw err;
    };
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      {
        content: "",
        source: "provider",
        sourceRevision: "rev-1",
        expectedStateVersion: 0,
        checkerDispatch: dispatch,
        budgetReserveChecker: () => BudgetReservationResult.Reserved,
      }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("artifact criterion: stubbed to unknown in Slice 2 (fail-closed → unmet → incomplete)", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([artifactCriterion("rec-1")]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      { content: "", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("record_count criterion: provider returns count >= minimum → pass; < minimum → fail; no provider → unknown", async () => {
    const registry = buildDefaultRegistry({
      recordCountProvider: async (targetId: string): Promise<number | null> => {
        if (targetId === "contacts") return 100;
        if (targetId === "leads") return 5;
        return null;
      },
    });
    const { store } = memoryStore();
    // Re-create service with the configured registry (buildDefaultRegistry
    // wires the record_count adapter with the provider).
    const service = new TaskEvidenceService(store, registry);
    const contract = makeContract([
      recordCountCriterion("rec-1", "contacts", 50),
      recordCountCriterion("rec-2", "leads", 20),
      recordCountCriterion("rec-3", "unknown-target", 1),
    ]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      { content: "", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    expect(result.unmetCriterionIds).toContain("rec-2");
    expect(result.unmetCriterionIds).toContain("rec-3");
  });

  it("adapter missing for a keyed criterion → unknown (fail-closed, never a false pass)", async () => {
    // Registry without the observation adapter registered.
    const emptyRegistry = new CriteriaAdapterRegistry();
    emptyRegistry.register("operation_receipt", new OperationReceiptAdapter());
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store, emptyRegistry);
    const contract = makeContract([observationCriterion("rec-1", "100 contacts")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("evaluator that throws → unknown (fail-closed, never a false pass)", async () => {
    // Register an adapter that throws to verify the service's try/catch.
    const registry = new CriteriaAdapterRegistry();
    const throwingEvaluator: CriterionEvaluator = {
      evaluate: async () => {
        throw new Error("adapter crashed");
      },
    };
    registry.register("observation", throwingEvaluator);
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store, registry);
    const contract = makeContract([observationCriterion("rec-1", "100 contacts")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("persists evidence rows via CAS merge into execution_state_json.evidence", async () => {
    const { store, writes } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "100 contacts")]);
    await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 0 }
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].executionId).toBe("exec-1");
    expect(writes[0].expectedVersion).toBe(0);
    const merged = JSON.parse(writes[0].mergedStateJson) as { evidence: unknown[] };
    expect(Array.isArray(merged.evidence)).toBe(true);
    expect(merged.evidence).toHaveLength(1);
    const row = merged.evidence[0] as { criterionId: string; state: string; evidenceId: string };
    expect(row.criterionId).toBe("rec-1");
    expect(row.state).toBe("pass");
    expect(row.evidenceId).toMatch(/^evidence-/);
  });

  it("merges with (never clobbers) existing checkpoint state — preserves prior shadowDecision/contract keys", async () => {
    const prior = {
      shadowDecision: { type: "wait", reason: "permission" },
      contract: { contractId: "contract-1" },
      evidence: [
        {
          evidenceId: "evidence-prior",
          criterionId: "rec-old",
          contractHash: "hash-abc",
          executionId: "exec-1",
          observedAt: "2026-01-01T00:00:00.000Z",
          source: "provider",
          sourceRevision: "rev-0",
          state: "pass",
          referenceIds: ["rec-old"],
          summary: "prior",
        },
      ],
    };
    const { store, writes } = memoryStore({ stateJson: JSON.stringify(prior), version: 2, finalized: false });
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "100 contacts")]);
    await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 2 }
    );
    expect(writes).toHaveLength(1);
    const merged = JSON.parse(writes[0].mergedStateJson) as {
      shadowDecision: unknown;
      contract: unknown;
      evidence: { evidenceId: string }[];
    };
    // Prior keys preserved.
    expect(merged.shadowDecision).toEqual(prior.shadowDecision);
    expect(merged.contract).toEqual(prior.contract);
    // Evidence array appended to, not replaced.
    expect(merged.evidence).toHaveLength(2);
    expect(merged.evidence[0].evidenceId).toBe("evidence-prior");
    expect(merged.evidence[1].evidenceId).toMatch(/^evidence-/);
  });

  it("never persists when expectedStateVersion is undefined (no CAS token — pure in-memory evaluation)", async () => {
    const { store, writes } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "100 contacts")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1" }
    );
    expect(writes).toHaveLength(0);
    // In-memory result is still returned.
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    expect(result.evidenceIds).toHaveLength(1);
  });

  it("never persists when the execution is already finalized (B8.1 mirror — terminal rows are immutable)", async () => {
    const { store, writes } = memoryStore({ stateJson: null, version: 3, finalized: true });
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "100 contacts")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1", expectedStateVersion: 3 }
    );
    expect(writes).toHaveLength(0);
    // In-memory result still returned (the controller can still decide).
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
  });

  it("multiple criteria: mixed pass/fail/unknown across kinds", async () => {
    const registry = buildDefaultRegistry({
      recordCountProvider: async (): Promise<number | null> => 10,
    });
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store, registry);
    const contract = makeContract([
      observationCriterion("rec-1", "100 contacts"),
      operationCriterion("rec-2", "op-send", "completed"),
      recordCountCriterion("rec-3", "contacts", 5),
      qualitativeCriterion("rec-4", "polite"),
      artifactCriterion("rec-5"),
    ]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts." }),
      contract,
      {
        content: "Saved 100 contacts.",
        source: "provider",
        sourceRevision: "rev-1",
        expectedStateVersion: 0,
        toolCatalogState: { "op-send": { state: "completed" } },
        checkerDispatch: async (prompt: string): Promise<string> => {
          // T04: return the §8.2 JSON for the criterion id in the prompt.
          const m = prompt.match(/Criterion \(([^\)]+)\):/);
          const cid = m ? m[1] : "rec-4";
          return JSON.stringify({
            criteria: [
              { criterionId: cid, verdict: "pass", evidenceIds: [cid], reason: "ok" },
            ],
          });
        },
        budgetReserveChecker: () => BudgetReservationResult.Reserved,
      }
    );
    // rec-1 (observation found) → pass; rec-2 (op completed) → pass;
    // rec-3 (count 10 >= 5) → pass; rec-4 (qualitative pass) → pass;
    // rec-5 (artifact stub) → unknown (unmet).
    expect(result.passedCriterionIds).toEqual(["rec-1", "rec-2", "rec-3", "rec-4"]);
    expect(result.unmetCriterionIds).toEqual(["rec-5"]);
    expect(result.evidenceIds).toHaveLength(5);
  });
});

// ----- T03 (FR-03/04/24, AC-03/04/32): authoritative provider-backed evidence -----
//
// The Slice 2 release gate requires evidence to come from task-specific
// Models/Modules or validated read-only filesystem adapters, not maker prose
// or criterion IDs. These tests lock the provider-backed path: a fabricated
// observation probe fails, count 54 fails 100, operation receipts from the
// authoritative store pass, artifact filesystem checks pass/fail honestly,
// and persisted evidence rows survive a reload (every evidence ID resolves).

describe("TaskEvidenceService.checkCandidate — T03 provider-backed evidence (FR-03/04/24, AC-03/04/32)", () => {
  it("observation provider: fabricated 'I will check production later' probe fails (no fresh observation → unknown → unmet)", async () => {
    // The probe that the audit letter calls out: maker prose containing the
    // target word must NOT pass when a provider is wired. The provider is the
    // authority; it returns null (no fresh record) → unknown → unmet.
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "production")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "I will check production later." }),
      contract,
      {
        content: "I will check production later.",
        source: "provider",
        sourceRevision: "slice2-t03",
        expectedStateVersion: 0,
        observationProvider: async () => null,
      }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("observation provider: returns a fresh observation receipt → pass", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "production")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "" }),
      contract,
      {
        content: "",
        source: "provider",
        sourceRevision: "slice2-t03",
        expectedStateVersion: 0,
        observationProvider: async () => ({
          observedAt: "2026-10-05T00:00:00.000Z",
          referenceId: "search-result:42",
        }),
      }
    );
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    expect(result.unmetCriterionIds).toEqual([]);
  });

  it("observation provider throws → unknown (fail-closed, never a false pass)", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([observationCriterion("rec-1", "production")]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "production looks good" }),
      contract,
      {
        content: "production looks good",
        source: "provider",
        sourceRevision: "slice2-t03",
        expectedStateVersion: 0,
        observationProvider: async () => {
          throw new Error("module unavailable");
        },
      }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("record_count provider: 54 < minimum 100 → fail (unmet); 100 >= 100 → pass; null → unknown (unmet)", async () => {
    const registry = buildDefaultRegistry({
      recordCountProvider: async (targetId: string): Promise<number | null> => {
        if (targetId === "fifty-four") return 54;
        if (targetId === "hundred") return 100;
        return null;
      },
    });
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store, registry);
    const contract = makeContract([
      recordCountCriterion("rec-1", "fifty-four", 100),
      recordCountCriterion("rec-2", "hundred", 100),
      recordCountCriterion("rec-3", "unknown-target", 100),
    ]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      { content: "", source: "provider", sourceRevision: "slice2-t03", expectedStateVersion: 0 }
    );
    // rec-1: 54 < 100 → fail (unmet). rec-2: 100 >= 100 → pass.
    // rec-3: provider null → unknown (unmet).
    expect(result.passedCriterionIds).toEqual(["rec-2"]);
    expect(result.unmetCriterionIds).toContain("rec-1");
    expect(result.unmetCriterionIds).toContain("rec-3");
  });

  it("operation_receipt provider: completed meets accepted → pass; pending below completed → fail; absent → unknown", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([
      operationCriterion("rec-1", "op-done", "accepted"),
      operationCriterion("rec-2", "op-stuck", "completed"),
      operationCriterion("rec-3", "op-missing", "accepted"),
    ]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      {
        content: "",
        source: "provider",
        sourceRevision: "slice2-t03",
        expectedStateVersion: 0,
        operationReceiptProvider: async (targetId: string) => {
          if (targetId === "op-done") return { state: "completed" };
          if (targetId === "op-stuck") return { state: "pending" };
          return null;
        },
      }
    );
    // rec-1: completed >= accepted → pass. rec-2: pending < completed → fail.
    // rec-3: absent → unknown. All unmet except rec-1.
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    expect(result.unmetCriterionIds).toContain("rec-2");
    expect(result.unmetCriterionIds).toContain("rec-3");
  });

  it("operation_receipt provider throws → unknown (fail-closed)", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([operationCriterion("rec-1", "op-broken", "accepted")]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      {
        content: "",
        source: "provider",
        sourceRevision: "slice2-t03",
        expectedStateVersion: 0,
        operationReceiptProvider: async () => {
          throw new Error("operation store offline");
        },
      }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("artifact adapter: file exists → pass; missing file → unknown; path traversal → unknown (containment, AC-32/NFR-08)", async () => {
    // Real filesystem check against a temp base dir. The adapter is read-only
    // and canonicalizes the root before the prefix check (the macOS symlink
    // containment bug class).
    const os = await import("node:os");
    const fs = await import("node:fs");
    const pathMod = await import("node:path");
    const tmp = fs.mkdtempSync(pathMod.join(os.tmpdir(), "t03-artifact-"));
    try {
      fs.writeFileSync(pathMod.join(tmp, "report.txt"), "Summary: 100 contacts saved\n");
      const { store } = memoryStore();
      const service = new TaskEvidenceService(store);
      const existsContract = makeContract([
        {
          id: "rec-1",
          required: true,
          kind: "artifact",
          description: "report",
          relativePath: "report.txt",
          expectation: "exists",
          requiredContentChecks: [],
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
      ]);
      const existsResult = await service.checkCandidate(
        baseCandidate(),
        existsContract,
        {
          content: "",
          source: "provider",
          sourceRevision: "slice2-t03",
          expectedStateVersion: 0,
          artifactBaseDir: tmp,
        }
      );
      expect(existsResult.passedCriterionIds).toEqual(["rec-1"]);

      // Missing file → unknown (absent, not fail — it may appear later).
      const missingContract = makeContract([
        {
          id: "rec-2",
          required: true,
          kind: "artifact",
          description: "missing",
          relativePath: "nope.txt",
          expectation: "exists",
          requiredContentChecks: [],
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
      ]);
      const missingResult = await service.checkCandidate(
        baseCandidate(),
        missingContract,
        {
          content: "",
          source: "provider",
          sourceRevision: "slice2-t03",
          expectedStateVersion: 0,
          artifactBaseDir: tmp,
        }
      );
      expect(missingResult.passedCriterionIds).toEqual([]);
      expect(missingResult.unmetCriterionIds).toEqual(["rec-2"]);

      // Path traversal: a relative path that escapes the base dir must NOT
      // read outside it. Canonical containment → unknown (unmet).
      const traversalContract = makeContract([
        {
          id: "rec-3",
          required: true,
          kind: "artifact",
          description: "escape",
          relativePath: "../../../etc/passwd",
          expectation: "exists",
          requiredContentChecks: [],
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
      ]);
      const traversalResult = await service.checkCandidate(
        baseCandidate(),
        traversalContract,
        {
          content: "",
          source: "provider",
          sourceRevision: "slice2-t03",
          expectedStateVersion: 0,
          artifactBaseDir: tmp,
        }
      );
      expect(traversalResult.passedCriterionIds).toEqual([]);
      expect(traversalResult.unmetCriterionIds).toEqual(["rec-3"]);

      // Content check: a substring that IS present → pass; one that is NOT → fail.
      const contentContract = makeContract([
        {
          id: "rec-4",
          required: true,
          kind: "artifact",
          description: "content",
          relativePath: "report.txt",
          expectation: "exists",
          requiredContentChecks: ["100 contacts"],
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
      ]);
      const contentResult = await service.checkCandidate(
        baseCandidate(),
        contentContract,
        {
          content: "",
          source: "provider",
          sourceRevision: "slice2-t03",
          expectedStateVersion: 0,
          artifactBaseDir: tmp,
        }
      );
      expect(contentResult.passedCriterionIds).toEqual(["rec-4"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("artifact adapter: no base dir wired → unknown (fail-closed)", async () => {
    const { store } = memoryStore();
    const service = new TaskEvidenceService(store);
    const contract = makeContract([artifactCriterion("rec-1")]);
    const result = await service.checkCandidate(
      baseCandidate(),
      contract,
      { content: "", source: "provider", sourceRevision: "slice2-t03", expectedStateVersion: 0 }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("AC-32: persisted evidence rows survive a reload — re-reading execution_state_json.evidence resolves every returned evidence ID", async () => {
    // The reload guarantee: after persistEvidence writes rows under the
    // `evidence` key, a fresh read of the state JSON must contain every
    // evidenceId the CheckResult returned. This is the audit/provenance
    // contract — finalization stores IDs, but the rows themselves must be
    // reloadable.
    const state = { stateJson: null as string | null, version: 0, finalized: false };
    const writes: { executionId: string; expectedVersion: number; mergedStateJson: string }[] = [];
    const snapshot: EvidenceStoreSnapshot = {
      get stateJson() { return state.stateJson; },
      get version() { return state.version; },
      get finalized() { return state.finalized; },
    };
    const store: EvidenceStore = {
      getExecutionState: async () => snapshot,
      mergeEvidenceCas: async (input) => {
        writes.push(input);
        // Simulate the model write: the merged JSON becomes the new state,
        // version bumps (the CAS token a fresh consult would read).
        state.stateJson = input.mergedStateJson;
        state.version += 1;
        return true;
      },
    };
    const service = new TaskEvidenceService(store);
    const contract = makeContract([
      observationCriterion("rec-1", "100 contacts"),
      qualitativeCriterion("rec-2", "polite"),
    ]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Saved 100 contacts. Hello, I hope you are well." }),
      contract,
      {
        content: "Saved 100 contacts. Hello, I hope you are well.",
        source: "provider",
        sourceRevision: "slice2-t03",
        expectedStateVersion: 0,
        checkerDispatch: async (prompt: string): Promise<string> => {
          const m = prompt.match(/Criterion \(([^\)]+)\):/);
          const cid = m ? m[1] : "rec-2";
          return JSON.stringify({
            criteria: [
              { criterionId: cid, verdict: "pass", evidenceIds: [cid], reason: "ok" },
            ],
          });
        },
        budgetReserveChecker: () => BudgetReservationResult.Reserved,
      }
    );
    expect(writes).toHaveLength(1);
    // Reload: parse the persisted state JSON and verify every evidenceId the
    // service returned is present in the evidence array.
    const reloaded = JSON.parse(state.stateJson as string) as { evidence: { evidenceId: string }[] };
    expect(Array.isArray(reloaded.evidence)).toBe(true);
    const reloadedIds = new Set(reloaded.evidence.map((row) => row.evidenceId));
    for (const id of result.evidenceIds) {
      expect(reloadedIds.has(id)).toBe(true);
    }
    expect(reloaded.evidence).toHaveLength(result.evidenceIds.length);
  });
});
