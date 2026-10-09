// test/vitest/main/service/EvidenceProviderFactory.test.ts
//
// T03 (FR-03/04/24, AC-03/04/32) — unit tests for the shared evidence provider
// factory both production seams (manual + scheduled) call. The factory builds
// a module-backed TaskEvidenceService whose `mergeEvidenceCas` calls
// `AiTaskExecutionModule.mergeExecutionStateEvidence` (the atomic CAS), plus
// authoritative provider-backed record-count / observation / operation-receipt
// lookups and a bounded tool-free checker dispatch.
//
// What these tests lock (the approved plan File 9):
//   - 54/100 contacts: recordCountProvider("camp-1", "cumulative") returns 54
//     → record_count { minimum: 100 } unmet.
//   - 100/100 contacts: returns 100 → pass.
//   - Operation receipt: operationReceiptProvider("send-email") returns
//     { state: "completed" } → pass for required "accepted".
//   - Checker dispatch: checkerDispatch(prompt) calls openAIChatCompletion
//     with max_tokens: 16 → returns "PASS" → qualitative pass.
//   - Evidence persistence: factory-built service + expectedStateVersion from
//     the mocked execution row → mergeEvidenceCas called with merged evidence.
//   - AI-enable gate: ensureAIEnabled throws → openAIChatCompletion rejects →
//     checker returns unknown (fail-closed via the catch in criteriaAdapters).
//
// Mocks: AiTaskExecutionModule (getExecution + mergeExecutionStateEvidence),
// AiTaskOperationModule (getOperation), SearchModule (countSearchResult),
// ContactInfoRepository (getStatistics), AiChatApi (openAIChatCompletion).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildEvidenceService, deriveOperationKey } from "@/service/aiTaskExecution/EvidenceProviderFactory";
import { TaskEvidenceService } from "@/service/aiTaskExecution/TaskEvidenceService";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";
import { z } from "zod/v4";
import {
  taskCompletionContractSchema,
  taskEndCandidateSchema,
} from "@/entityTypes/aiTaskExecutionTypes";
import type {
  TaskCompletionContract,
  TaskEndCandidate,
} from "@/entityTypes/aiTaskExecutionTypes";

// vi.mock factories are hoisted above top-level vars, so declare mock fns
// inside vi.hoisted() to make them visible to the factories (BaseModule TDZ
// crash class — never reference a top-level let inside a factory).
const {
  getExecutionMock,
  mergeEvidenceCasMock,
  getOperationMock,
  countSearchResultMock,
  getStatisticsMock,
  openAIChatCompletionMock,
} = vi.hoisted(() => ({
  getExecutionMock: vi.fn(),
  mergeEvidenceCasMock: vi.fn(),
  getOperationMock: vi.fn(),
  countSearchResultMock: vi.fn(),
  getStatisticsMock: vi.fn(),
  openAIChatCompletionMock: vi.fn(),
}));

vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: vi.fn().mockImplementation(function () {
    return {
      getExecution: getExecutionMock,
      mergeExecutionStateEvidence: mergeEvidenceCasMock,
      persistBudgetConsumption: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@/modules/AiTaskOperationModule", () => ({
  AiTaskOperationModule: vi.fn().mockImplementation(function () {
    return { getOperation: getOperationMock };
  }),
}));

vi.mock("@/modules/SearchModule", () => ({
  SearchModule: vi.fn().mockImplementation(function () {
    return { countSearchResult: countSearchResultMock };
  }),
}));

vi.mock("@/model/ContactInfo.model", () => ({
  contactInfoRepository: {
    getStatistics: getStatisticsMock,
  },
  ContactInfoRepository: vi.fn(),
}));

vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(function () {
    return { openAIChatCompletion: openAIChatCompletionMock };
  }),
  openAIContentToString: (content: unknown): string => {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part: { text?: string; type?: string }) =>
          part && typeof part === "object" && part.type === "text" ? part.text ?? "" : ""
        )
        .join("\n");
    }
    return String(content);
  },
}));

// Token mock: the modules extend BaseModule, which reads USERSDBPATH via
// Token at construction. Return a temp path so it never touches a real DB.
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn().mockReturnValue("/tmp/test-factory-db") };
  }),
}));

function baseCandidate(overrides: Partial<TaskEndCandidate> = {}): TaskEndCandidate {
  return taskEndCandidateSchema.parse({
    candidateId: "cand-factory-1",
    executionId: "exec-factory-1",
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

function makeContract(
  criteria: z.infer<typeof taskCompletionContractSchema>["criteria"]
): TaskCompletionContract {
  return taskCompletionContractSchema.parse({
    schemaVersion: 1,
    contractId: "contract-factory-1",
    contractHash: "hash-factory",
    objective: "Save contacts",
    sourceUserMessageId: "msg-factory-1",
    approvedSourceMessageIds: ["msg-factory-1"],
    mode: "best_effort",
    criteria,
  });
}

const EXEC_VERSION = 7;

beforeEach(() => {
  vi.clearAllMocks();
  // The execution row the factory scopes its providers to. createdAt is
  // null (AuditableEntity column — null is fine for the freshness bound in
  // unit tests); schedule_id 1 carries the task linkage.
  getExecutionMock.mockResolvedValue({
    executionId: "exec-factory-1",
    execution_state_json: null,
    execution_state_version: EXEC_VERSION,
    finalized: false,
    schedule_id: 1,
    createdAt: null,
  });
  mergeEvidenceCasMock.mockResolvedValue(true);
  getStatisticsMock.mockResolvedValue({
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    analyzing: 0,
  });
  countSearchResultMock.mockResolvedValue(0);
  getOperationMock.mockResolvedValue(null);
  openAIChatCompletionMock.mockResolvedValue({
    choices: [{ message: { content: "UNKNOWN" } }],
  });
});

describe("buildEvidenceService — T03 factory wiring (FR-03/04/24, AC-03/04/32)", () => {
  it("recordCountProvider: cumulative scope returns ContactInfo.getStatistics().total (54 → unmet 100; 100 → pass)", async () => {
    getStatisticsMock.mockResolvedValue({
      total: 54,
      completed: 54,
      failed: 0,
      pending: 0,
      analyzing: 0,
    });
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    const service = providers.evidenceService as TaskEvidenceService;
    const contract = makeContract([
      {
        id: "rec-1",
        required: true,
        kind: "record_count",
        description: "save 100 contacts",
        adapterKey: "record_count",
        targetId: "camp-1",
        scope: "cumulative",
        minimum: 100,
        sourceRefs: [{ messageId: "msg-factory-1", startOffset: 0, endOffset: 10 }],
      },
    ]);
    const result = await service.checkCandidate(baseCandidate(), contract, {
      content: "",
      source: "factory-test",
      sourceRevision: "slice2-t03",
      expectedStateVersion: EXEC_VERSION,
    });
    // 54 < 100 → fail (unmet).
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
    expect(getStatisticsMock).toHaveBeenCalled();

    // 100/100 → pass.
    getStatisticsMock.mockResolvedValueOnce({
      total: 100,
      completed: 100,
      failed: 0,
      pending: 0,
      analyzing: 0,
    });
    const result2 = await service.checkCandidate(baseCandidate(), contract, {
      content: "",
      source: "factory-test",
      sourceRevision: "slice2-t03",
      expectedStateVersion: EXEC_VERSION,
    });
    expect(result2.passedCriterionIds).toEqual(["rec-1"]);
  });

  it("operationReceiptProvider: completed operation meets accepted threshold → pass; absent → unknown", async () => {
    // The provider derives the key as op:<executionId>:<targetId>.
    getOperationMock.mockImplementation(async (key: string) => {
      if (key === deriveOperationKey("exec-factory-1", "send-email")) {
        return { operation_state: "completed" };
      }
      return null;
    });
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    const service = providers.evidenceService as TaskEvidenceService;
    const contract = makeContract([
      {
        id: "rec-1",
        required: true,
        kind: "operation_receipt",
        description: "send the email",
        adapterKey: "operation_receipt",
        targetId: "send-email",
        requiredState: "accepted",
        sourceRefs: [{ messageId: "msg-factory-1", startOffset: 0, endOffset: 10 }],
      },
    ]);
    const result = await service.checkCandidate(baseCandidate(), contract, {
      content: "",
      source: "factory-test",
      sourceRevision: "slice2-t03",
      expectedStateVersion: EXEC_VERSION,
      operationReceiptProvider: providers.operationReceiptProvider,
    });
    // completed >= accepted → pass.
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
    expect(getOperationMock).toHaveBeenCalledWith(
      deriveOperationKey("exec-factory-1", "send-email")
    );

    // Absent → unknown (unmet).
    getOperationMock.mockResolvedValueOnce(null);
    const result2 = await service.checkCandidate(baseCandidate(), contract, {
      content: "",
      source: "factory-test",
      sourceRevision: "slice2-t03",
      expectedStateVersion: EXEC_VERSION,
      operationReceiptProvider: providers.operationReceiptProvider,
    });
    expect(result2.passedCriterionIds).toEqual([]);
    expect(result2.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("checkerDispatch: calls openAIChatCompletion with max_tokens 256 temperature 0; §8.2 JSON → qualitative pass (T04)", async () => {
    // T04: the §8.2 JSON contract needs more room than a one-word verdict;
    // CHECKER_MAX_TOKENS is 256 (a single criterion result: verdict + evidence
    // ids + a short reason). The mock returns the JSON the parser accepts.
    openAIChatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        criteria: [
          { criterionId: "rec-1", verdict: "pass", evidenceIds: ["rec-1"], reason: "polite" },
        ],
      }) } }],
    });
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    // The dispatch is a closure the factory returns; call it directly.
    const verdict = await providers.checkerDispatch("Is this polite?");
    expect(verdict).toBe(JSON.stringify({
      criteria: [
        { criterionId: "rec-1", verdict: "pass", evidenceIds: ["rec-1"], reason: "polite" },
      ],
    }));
    expect(openAIChatCompletionMock).toHaveBeenCalledTimes(1);
    const call = openAIChatCompletionMock.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
      max_tokens: number;
      temperature: number;
    };
    expect(call.max_tokens).toBe(256);
    expect(call.temperature).toBe(0);
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toBe("Is this polite?");

    // End-to-end through the service: qualitative criterion with the factory
    // dispatch + a Reserved budget → pass.
    const service = providers.evidenceService as TaskEvidenceService;
    const contract = makeContract([
      {
        id: "rec-1",
        required: true,
        kind: "qualitative",
        description: "response is polite",
        sourceSelectorKeys: ["provider"],
        sourceRefs: [{ messageId: "msg-factory-1", startOffset: 0, endOffset: 10 }],
      },
    ]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Hello, I hope you are well." }),
      contract,
      {
        content: "Hello, I hope you are well.",
        source: "factory-test",
        sourceRevision: "slice2-t04",
        expectedStateVersion: EXEC_VERSION,
        checkerDispatch: providers.checkerDispatch,
        budgetReserveChecker: () => BudgetReservationResult.Reserved,
      }
    );
    expect(result.passedCriterionIds).toEqual(["rec-1"]);
  });

  it("checkerDispatch: forwards the per-dispatch abort signal to openAIChatCompletion (T04, NFR-02/04, AC-24)", async () => {
    // T04: the QualitativeEvaluator creates a per-dispatch AbortController and
    // passes its signal to checkerDispatch(prompt, signal); the factory closure
    // must forward that signal to openAIChatCompletion so a Stop or deadline
    // aborts the in-flight fetch (catching an eventual AbortError does not
    // itself abort the request — the signal must reach the transport).
    openAIChatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        criteria: [
          { criterionId: "rec-1", verdict: "pass", evidenceIds: ["rec-1"], reason: "ok" },
        ],
      }) } }],
    });
    const providers = buildEvidenceService({
      executionId: "exec-factory-signal",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    const controller = new AbortController();
    await providers.checkerDispatch("verify", controller.signal);
    expect(openAIChatCompletionMock).toHaveBeenCalledTimes(1);
    const optionsArg = openAIChatCompletionMock.mock.calls[0][1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(optionsArg).toBeDefined();
    expect(optionsArg?.signal).toBe(controller.signal);
  });

  it("checkerDispatch: AI-enable gate off → openAIChatCompletion rejects → dispatch returns the rejected promise (QualitativeEvaluator catches → unknown)", async () => {
    // The AI-enable-first mandate: openAIChatCompletion calls ensureAIEnabled
    // internally; when AI is disabled it throws. The factory's dispatch does
    // NOT swallow that — it surfaces the rejection so the QualitativeEvaluator
    // catch block records unknown (fail-closed, never a false pass).
    const aiDisabledError = new Error("AI feature is not enabled for this user");
    openAIChatCompletionMock.mockRejectedValue(aiDisabledError);
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    // Direct call: the rejection surfaces (the caller — QualitativeEvaluator —
    // is responsible for the try/catch that turns it into unknown).
    await expect(providers.checkerDispatch("check")).rejects.toThrow(
      "AI feature is not enabled for this user"
    );

    // Through the service: the QualitativeEvaluator catches → unknown → unmet.
    const service = providers.evidenceService as TaskEvidenceService;
    const contract = makeContract([
      {
        id: "rec-1",
        required: true,
        kind: "qualitative",
        description: "response is polite",
        sourceSelectorKeys: ["provider"],
        sourceRefs: [{ messageId: "msg-factory-1", startOffset: 0, endOffset: 10 }],
      },
    ]);
    const result = await service.checkCandidate(
      baseCandidate({ content: "Hello." }),
      contract,
      {
        content: "Hello.",
        source: "factory-test",
        sourceRevision: "slice2-t03",
        expectedStateVersion: EXEC_VERSION,
        checkerDispatch: providers.checkerDispatch,
        budgetReserveChecker: () => BudgetReservationResult.Reserved,
      }
    );
    expect(result.passedCriterionIds).toEqual([]);
    expect(result.unmetCriterionIds).toEqual(["rec-1"]);
  });

  it("AC-32: evidence persists via mergeExecutionStateEvidence with the merged evidence array + expectedStateVersion from the execution row", async () => {
    getStatisticsMock.mockResolvedValue({
      total: 100,
      completed: 100,
      failed: 0,
      pending: 0,
      analyzing: 0,
    });
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    const service = providers.evidenceService as TaskEvidenceService;
    const contract = makeContract([
      {
        id: "rec-1",
        required: true,
        kind: "record_count",
        description: "save 100 contacts",
        adapterKey: "record_count",
        targetId: "camp-1",
        scope: "cumulative",
        minimum: 100,
        sourceRefs: [{ messageId: "msg-factory-1", startOffset: 0, endOffset: 10 }],
      },
    ]);
    const result = await service.checkCandidate(baseCandidate(), contract, {
      content: "",
      source: "factory-test",
      sourceRevision: "slice2-t03",
      // The expectedStateVersion the consult closure would read from the row.
      expectedStateVersion: EXEC_VERSION,
    });

    // The factory-built store's mergeEvidenceCas is the module method — verify
    // it was called with the right executionId + the version from the row +
    // a JSON payload whose `evidence` array contains the criterion's row.
    expect(mergeEvidenceCasMock).toHaveBeenCalledTimes(1);
    const mergedInput = mergeEvidenceCasMock.mock.calls[0][0] as {
      executionId: string;
      expectedVersion: number;
      mergedStateJson: string;
    };
    expect(mergedInput.executionId).toBe("exec-factory-1");
    expect(mergedInput.expectedVersion).toBe(EXEC_VERSION);
    const merged = JSON.parse(mergedInput.mergedStateJson) as {
      evidence: { criterionId: string; state: string; evidenceId: string }[];
    };
    expect(Array.isArray(merged.evidence)).toBe(true);
    expect(merged.evidence).toHaveLength(result.evidenceIds.length);
    const row = merged.evidence[0];
    expect(row.criterionId).toBe("rec-1");
    expect(row.state).toBe("pass");
    expect(result.evidenceIds).toContain(row.evidenceId);
  });

  it("observationProvider: task-scoped fresh SearchResult count > 0 → returns a fresh observation receipt", async () => {
    // schedule_id 1 → taskId 1. countSearchResult returns 2 (> 0) → the
    // provider returns a fresh observation receipt for the task.
    countSearchResultMock.mockResolvedValue(2);
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    const receipt = await providers.observationProvider("production");
    expect(receipt).not.toBeNull();
    expect(receipt!.referenceId).toBe("search-result:1");
    expect(typeof receipt!.observedAt).toBe("string");
    expect(countSearchResultMock).toHaveBeenCalledWith(1);
  });

  it("observationProvider: zero fresh rows → null (no observation, fail-closed)", async () => {
    countSearchResultMock.mockResolvedValue(0);
    getStatisticsMock.mockResolvedValue({
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      analyzing: 0,
    });
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    const receipt = await providers.observationProvider("production");
    expect(receipt).toBeNull();
  });

  it("getExecution throws → observationProvider fail-closed (returns null, never throws)", async () => {
    getExecutionMock.mockRejectedValue(new Error("DB offline"));
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    // The scope read fails inside observationProvider. The provider must catch
    // and return null (fail-closed) — never throw out of the consult closure,
    // which would kill the controller's whole evidence evaluation.
    const receipt = await providers.observationProvider("production");
    expect(receipt).toBeNull();
  });

  it("artifactBaseDir: resolves to a string in the main process (Electron app.getPath) — null when Electron is absent", async () => {
    // The factory resolves artifactBaseDir lazily via require("electron").
    // In the test process Electron is not present → null (fail-closed).
    const providers = buildEvidenceService({
      executionId: "exec-factory-1",
      execModule: new (await import("@/modules/AiTaskExecutionModule")).AiTaskExecutionModule(),
      operationModule: new (await import("@/modules/AiTaskOperationModule")).AiTaskOperationModule(),
      searchModule: new (await import("@/modules/SearchModule")).SearchModule(),
      contactInfoRepository: (await import("@/model/ContactInfo.model")).contactInfoRepository,
    });
    // In vitest (no Electron) the lazy require throws → null.
    expect(providers.artifactBaseDir).toBeNull();
  });
});
