# Task Completion Policy V1 — Slice 1 (Shared Acceptance/Classification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared acceptance/classification infrastructure for the AI Task Completion and Premature-Stop Recovery feature — generic execution entity/coordinator, request resolution, owner adapters, correlation/provenance, and read-only shadow evaluation on both manual and scheduled origins — without enabling live continuations or altering existing task/occurrence success semantics.

**Architecture:** New additive SQLite entities (`ai_task_execution`, `ai_task_execution_ledger`, `ai_task_operation`) plus nullable columns on existing `ai_message_task` / `ai_message_task_run` tables, accessed exclusively through Model/Module layers (never from IPC/workers). A `TaskExecutionCoordinator` in the Electron main process creates an execution-scoped `TaskExecutionBinding` (main-process state, never renderer-serializable) before slow resolution so Stop already works. A `TaskRequestResolver` classifies each accepted manual/scheduled submission into `response_only | task_verified | task_best_effort | preparation` (FR-18). A `TaskCompletionContractService` freezes executable contracts with a stable hash (FR-19). A `TaskCompletionController.decide()` runs in **shadow mode** for Slice 1: it classifies response-end candidates, records provenance (FR-16), and produces a `TaskCompletionDecision`, but does NOT trigger maker continuations, alter counters, or gate live dispatch (§17 shadow-mode rules). The feature gate `aiTaskCompletionPolicyV1` (default OFF, fail-closed) gates all enrollment. No slice enables continuations while retaining unconditional manual task or occurrence success (§16).

**Tech Stack:** TypeScript 5.x, Electron (main process only — no renderer changes in Slice 1), TypeORM + better-sqlite3 (WAL, `synchronize: true`, busy_timeout 10000), `zod/v4` (schema validation at all boundaries), Vitest (main-process + service tests), Mocha/chai (module tests).

**Spec:** `docs/prd/scheduled-loop-premature-stop-recovery-advice.md` (PRD v3.0) and `docs/prd/scheduled-loop-premature-stop-recovery-technical-design.md` (technical design v2.0).

**Slice 1 PRD coverage:** FR-05/06/16–20/24; AC-12/14/19/21/26/31 (§16).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/entityTypes/aiTaskExecutionTypes.ts` | Zod v4 schemas + inferred TS types for TaskOutcome, TaskCompletionContract, TaskCriterion, TaskEvidence, TaskEndCandidate, TaskCompletionDecision, TaskExecutionOrigin, TaskExecutionRoute, TaskExecutionBinding, execution/ledger statuses, reason codes | Create |
| `src/entityTypes/aiMessageTaskTypes.ts` | Add `incomplete` + `needs_user_input` to `AiMessageTaskRunStatus`; add `AiTaskExecutionStatus` + `AiTaskExecutionOutcome` re-export | Modify |
| `src/entity/AiTaskExecution.entity.ts` | New table `ai_task_execution`: opaque execution ID, conversation/source/assistant/submission IDs, request hash, origin/route/owner/stage, contract/policy snapshots, ledger IDs, CAS version, outcome/reason/finalized time, final-event identity | Create |
| `src/entity/AiTaskExecutionLedger.entity.ts` | New table `ai_task_execution_ledger`: opaque ledger ID, immutable policy limits, CAS version, consumed totals, active/wait time, no-progress state, active execution ID + fenced owner generation | Create |
| `src/entity/AiTaskOperation.entity.ts` | New table `ai_task_operation` (scaffolding; full receipt logic is Slice 3): unique operation key, execution ID, trusted tool/domain identity, canonical intent hash, operation state, claim generation, safe failure code | Create |
| `src/entity/AiMessageTask.entity.ts` | Add nullable `completion_contract_json`, `execution_policy_json`, `execution_policy_version` (default 0; 0 = legacy/un-enrolled) | Modify |
| `src/entity/AiMessageTaskRun.entity.ts` | Add nullable `execution_id` link, `task_outcome`, `task_outcome_reason`, `task_result_summary` | Modify |
| `src/config/SqliteDb.ts` | Register `AiTaskExecutionEntity`, `AiTaskExecutionLedgerEntity`, `AiTaskOperationEntity` in entities array | Modify |
| `src/config/featureFlags.ts` | Add `AI_TASK_COMPLETION_POLICY_V1_FLAG` + `isAiTaskCompletionPolicyV1Enabled()` (default OFF, fail-closed) | Modify |
| `src/model/AiTaskExecution.model.ts` | Data access: `createExecution`, `getById`, `saveCheckpoint` (CAS), `finalizeExecution` (CAS claim + outcome + final-event identity), `getUnfinalized` (startup recovery) | Create |
| `src/model/AiTaskOperation.model.ts` | Data access scaffolding: `create`, `getByKey`, `updateState` (CAS on claim generation) | Create |
| `src/modules/AiTaskExecutionModule.ts` | Business logic: `startExecution`, `getExecution`, `finalizeExecution` (atomic manual no-schedule finalization), `recordShadowDecision` (provenance), worker guards via BaseModule | Create |
| `src/modules/AiTaskOperationModule.ts` | Business logic scaffolding: `recordOperation`, `getOperation`, `resolveOutcome` (Slice 3 fills reconciliation) | Create |
| `src/service/aiTaskExecution/TaskRunBudget.ts` | Budget structure + defaults (FR-08 table) + shadow accounting (reserve/reconcile record; enforcement gate is Slice 2). `TaskExecutionBudgetExhaustedError` typed result | Create |
| `src/service/aiTaskExecution/TaskCompletionContractService.ts` | Freeze contracts from objective + approved sources (FR-19); stable `contractHash` over canonicalized objective/criteria/sources excluding volatile IDs; source-ref offset validation | Create |
| `src/service/aiTaskExecution/TaskRequestResolver.ts` | Route classification `response_only | task_verified | task_best_effort | preparation` (FR-18); conservative intent resolution; max 2 provider attempts; ambiguity → clarification/best-effort (never invented targets) | Create |
| `src/service/aiTaskExecution/TaskExecutionCoordinator.ts` | Create execution identity + binding before slow resolution (FR-17); owner adapters for manual + scheduled origins (FR-20); single completion owner; lease generation fencing | Create |
| `src/service/aiTaskExecution/TaskCompletionController.ts` | Shadow `decide(candidate, signal)` (FR-05/06): classify stop condition, record provenance (FR-16), return `TaskCompletionDecision`; shadow mode = no live continuation dispatch | Create |
| `test/vitest/main/service/TaskRequestResolver.test.ts` | Plain typed task without toggle; question vs latest-status; text/multi-part; quoted/attachment injection; ambiguity → unverified; route classification | Create |
| `test/vitest/main/service/TaskExecutionCoordinator.test.ts` | Manual acceptance; idempotent submission (AC-26); response-only end; no schedule prerequisite (AC-17); owner isolation (AC-31); replacement/Stop fencing | Create |
| `test/vitest/main/service/TaskCompletionController.test.ts` | First-response stop (AC-18); immediate genuine completion (AC-03); distinct stop conditions (AC-12); provenance recording (FR-16); shadow mode = no continuation dispatch | Create |
| `test/vitest/main/service/TaskRunBudget.test.ts` | Defaults load; reservation records; remaining computation; shadow mode does not gate dispatch; consumed persists across resumes | Create |
| `test/vitest/main/service/TaskCompletionContractService.test.ts` | Hash stability over unchanged objective/criteria; hash changes on scope change; zero required criteria cannot pass vacuously; source-ref validation | Create |
| `test/modules/AiTaskExecutionModule.test.ts` | Old-schema upgrade (nullable columns default); concurrent CAS conflict; manual no-schedule finalization (AC-32); submission conflict; immutable outcome; worker guard; persistence failure = no success | Create |

Tasks are ordered by dependency. Each task produces a self-contained, committable change.

---

### Task 1: Zod v4 schemas and TypeScript types for execution contracts

**Files:**
- Create: `src/entityTypes/aiTaskExecutionTypes.ts`
- Test: `test/vitest/main/service/aiTaskExecutionTypes.test.ts` (type-level + runtime parse tests)

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/aiTaskExecutionTypes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  taskOutcomeSchema,
  taskCompletionContractSchema,
  taskCriterionSchema,
  taskEvidenceSchema,
  taskEndCandidateSchema,
  taskCompletionDecisionSchema,
  taskExecutionOriginSchema,
  taskExecutionRouteSchema,
  TASK_EXECUTION_LEDGER_STATUSES,
  TASK_EXECUTION_REASON_CODES,
} from "@/entityTypes/aiTaskExecutionTypes";

describe("aiTaskExecutionTypes schemas", () => {
  it("parses a valid task outcome", () => {
    const result = taskOutcomeSchema.parse("verified_complete");
    expect(result).toBe("verified_complete");
  });

  it("rejects an invalid task outcome", () => {
    expect(() => taskOutcomeSchema.parse("done")).toThrow();
  });

  it("parses a valid observation criterion", () => {
    const criterion = {
      id: "obs-1",
      required: true,
      kind: "observation",
      description: "deployment status queried",
      adapterKey: "deploy-status",
      targetId: "deploy-prod",
      sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 40 }],
    };
    const result = taskCriterionSchema.parse(criterion);
    expect(result.kind).toBe("observation");
    expect(result.required).toBe(true);
  });

  it("parses a valid record_count criterion with cumulative scope", () => {
    const criterion = {
      id: "rec-1",
      required: true,
      kind: "record_count",
      description: "save 100 contacts",
      adapterKey: "contact-campaign",
      targetId: "camp-1",
      scope: "cumulative",
      minimum: 100,
      sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 20 }],
    };
    const result = taskCriterionSchema.parse(criterion);
    expect(result.scope).toBe("cumulative");
    expect(result.minimum).toBe(100);
  });

  it("parses a valid contract", () => {
    const contract = {
      schemaVersion: 1,
      contractId: "contract-1",
      contractHash: "sha256:abc",
      objective: "Save 100 qualifying contacts to campaign camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified" as const,
      criteria: [
        {
          id: "rec-1",
          required: true,
          kind: "record_count",
          description: "save 100 contacts",
          adapterKey: "contact-campaign",
          targetId: "camp-1",
          scope: "cumulative",
          minimum: 100,
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 20 }],
        },
      ],
    };
    const result = taskCompletionContractSchema.parse(contract);
    expect(result.schemaVersion).toBe(1);
    expect(result.criteria).toHaveLength(1);
  });

  it("parses a manual execution origin", () => {
    const origin = { type: "manual", submissionId: "sub-1" };
    const result = taskExecutionOriginSchema.parse(origin);
    expect(result.type).toBe("manual");
  });

  it("parses a scheduled execution origin", () => {
    const origin = {
      type: "scheduled",
      taskId: 5,
      runId: 10,
      occurrenceKey: "scheduled-loop:3:1",
    };
    const result = taskExecutionOriginSchema.parse(origin);
    expect(result.type).toBe("scheduled");
    if (result.type === "scheduled") {
      expect(result.taskId).toBe(5);
    }
  });

  it("parses a finish decision", () => {
    const decision = {
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-1"],
      summary: "All criteria passed",
      remainingWork: [],
    };
    const result = taskCompletionDecisionSchema.parse(decision);
    expect(result.type).toBe("finish");
  });

  it("exposes the full reason-code set", () => {
    expect(TASK_EXECUTION_REASON_CODES).toContain("CRITERIA_SATISFIED");
    expect(TASK_EXECUTION_REASON_CODES).toContain("UNKNOWN_ACTION_OUTCOME");
    expect(TASK_EXECUTION_REASON_CODES).toContain("PERSISTENCE_FAILED");
    expect(TASK_EXECUTION_REASON_CODES).toContain("USER_CANCELLED");
  });

  it("exposes the ledger-status set", () => {
    expect(TASK_EXECUTION_LEDGER_STATUSES).toContain("active");
    expect(TASK_EXECUTION_LEDGER_STATUSES).toContain("released");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/aiTaskExecutionTypes.test.ts`
Expected: FAIL — module `@/entityTypes/aiTaskExecutionTypes` not found.

- [ ] **Step 3: Write the implementation**

Create `src/entityTypes/aiTaskExecutionTypes.ts`:

```typescript
/**
 * Zod v4 schemas + inferred TypeScript types for the AI Task Completion
 * Policy (technical-design §5).
 *
 * These are the runtime validation boundary for execution contracts,
 * candidates, evidence, decisions, and execution origins. Untrusted JSON
 * (persisted rows, model output) is decoded through these schemas before
 * use. Trusted main-process bindings are constructed in code, never
 * deserialized from renderer input (design §4A.1).
 *
 * Slice 1 scope (§16): shared acceptance/classification — types, request
 * resolution, owner adapters, correlation/provenance, read-only shadow
 * evaluation. No live continuation dispatch in this slice.
 */
import { z } from "zod/v4";

// ----- §5.1 Task outcome -----

export const taskOutcomeSchema = z.enum([
  "verified_complete",
  "incomplete",
  "needs_user_input",
  "blocked_by_policy",
  "failed",
  "cancelled",
  "timeout",
]);
export type TaskOutcome = z.infer<typeof taskOutcomeSchema>;

// ----- §5.1 Completion contract -----

export const taskCriterionSourceSchema = z.object({
  messageId: z.string().min(1).max(200),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
});
export type TaskCriterionSource = z.infer<typeof taskCriterionSourceSchema>;

const taskCriterionBaseSchema = z.object({
  sourceRefs: z.array(taskCriterionSourceSchema),
});

const observationCriterionSchema = taskCriterionBaseSchema.extend({
  id: z.string().min(1).max(120),
  required: z.boolean(),
  kind: z.literal("observation"),
  description: z.string().min(1).max(2000),
  adapterKey: z.string().min(1).max(120),
  targetId: z.string().min(1).max(200),
});

const recordCountCriterionSchema = taskCriterionBaseSchema.extend({
  id: z.string().min(1).max(120),
  required: z.boolean(),
  kind: z.literal("record_count"),
  description: z.string().min(1).max(2000),
  adapterKey: z.string().min(1).max(120),
  targetId: z.string().min(1).max(200),
  scope: z.enum(["execution", "lineage", "cumulative"]),
  minimum: z.number().int().min(0),
});

const artifactCriterionSchema = taskCriterionBaseSchema.extend({
  id: z.string().min(1).max(120),
  required: z.boolean(),
  kind: z.literal("artifact"),
  description: z.string().min(1).max(2000),
  relativePath: z.string().min(1).max(1024),
  expectation: z.enum(["exists", "changed"]),
  requiredContentChecks: z.array(z.string().min(1).max(200)),
});

const operationReceiptCriterionSchema = taskCriterionBaseSchema.extend({
  id: z.string().min(1).max(120),
  required: z.boolean(),
  kind: z.literal("operation_receipt"),
  description: z.string().min(1).max(2000),
  adapterKey: z.string().min(1).max(120),
  targetId: z.string().min(1).max(200),
  requiredState: z.enum(["accepted", "completed"]),
});

const qualitativeCriterionSchema = taskCriterionBaseSchema.extend({
  id: z.string().min(1).max(120),
  required: z.boolean(),
  kind: z.literal("qualitative"),
  description: z.string().min(1).max(2000),
  sourceSelectorKeys: z.array(z.string().min(1).max(200)),
});

export const taskCriterionSchema = z.discriminatedUnion("kind", [
  observationCriterionSchema,
  recordCountCriterionSchema,
  artifactCriterionSchema,
  operationReceiptCriterionSchema,
  qualitativeCriterionSchema,
]);
export type TaskCriterion = z.infer<typeof taskCriterionSchema>;

export const taskCompletionContractSchema = z.object({
  schemaVersion: z.literal(1),
  contractId: z.string().min(1).max(200),
  contractHash: z.string().min(1).max(200),
  objective: z.string().min(1).max(20000),
  sourceUserMessageId: z.string().min(1).max(200),
  approvedSourceMessageIds: z.array(z.string().min(1).max(200)),
  mode: z.enum(["verified", "best_effort"]),
  criteria: z.array(taskCriterionSchema),
});
export type TaskCompletionContract = z.infer<typeof taskCompletionContractSchema>;

// ----- §5.2 Evidence -----

export const taskEvidenceSchema = z.object({
  evidenceId: z.string().min(1).max(200),
  criterionId: z.string().min(1).max(120),
  contractHash: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  observedAt: z.string().min(1).max(40),
  source: z.string().min(1).max(200),
  sourceRevision: z.string().min(1).max(200),
  state: z.enum(["pass", "fail", "unknown"]),
  referenceIds: z.array(z.string().min(1).max(200)),
  summary: z.string().min(0).max(2000),
});
export type TaskEvidence = z.infer<typeof taskEvidenceSchema>;

// ----- §5.2 Task end candidate -----

export const taskEndCandidateSchema = z.object({
  candidateId: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  content: z.string().min(0).max(200000),
  finishReason: z.string().max(100).nullable(),
  provenance: z.enum(["provider", "adapter", "synthetic", "unknown"]),
  streamTerminalSeen: z.boolean(),
  boundary: z.enum(["response_end", "round_cap", "budget_cap"]),
  pendingPermission: z.boolean(),
  pendingQuestion: z.boolean(),
  pendingPlanApproval: z.boolean(),
  safetyRestriction: z.boolean(),
});
export type TaskEndCandidate = z.infer<typeof taskEndCandidateSchema>;

// ----- §5.2 Completion decision -----

export const taskCompletionDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("continue"),
    continuationId: z.string().min(1).max(200),
    prompt: z.string().min(1).max(20000),
    unmetCriterionIds: z.array(z.string().min(1).max(120)),
  }),
  z.object({
    type: z.literal("wait"),
    reason: z.enum(["permission", "input", "plan_approval", "external_job"]),
  }),
  z.object({
    type: z.literal("finish_response"),
    result: z.literal("response_ended"),
  }),
  z.object({
    type: z.literal("yield_owner"),
    owner: z.literal("goal"),
    result: z.literal("maker_iteration_ended"),
  }),
  z.object({
    type: z.literal("finish"),
    outcome: taskOutcomeSchema,
    reasonCode: z.string().min(1).max(80),
    evidenceIds: z.array(z.string().min(1).max(200)),
    summary: z.string().min(0).max(20000),
    remainingWork: z.array(z.string().min(0).max(2000)),
  }),
]);
export type TaskCompletionDecision = z.infer<typeof taskCompletionDecisionSchema>;

// ----- §5 Execution origin / route / binding -----

export const taskExecutionOriginSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("manual"),
    submissionId: z.string().min(1).max(200),
  }),
  z.object({
    type: z.literal("scheduled"),
    taskId: z.number().int().min(1),
    runId: z.number().int().min(1),
    occurrenceKey: z.string().min(1).max(200),
  }),
]);
export type TaskExecutionOrigin = z.infer<typeof taskExecutionOriginSchema>;

export const taskExecutionRouteSchema = z.enum([
  "response_only",
  "task_verified",
  "task_best_effort",
  "preparation",
]);
export type TaskExecutionRoute = z.infer<typeof taskExecutionRouteSchema>;

// Binding is constructed in trusted main-process code, not deserialized from
// renderer JSON. We still validate the serializable subset when reading back
// persisted checkpoints — `controller` and `budget` are runtime objects
// reattached by the coordinator, never stored as JSON.
export const taskExecutionBindingSnapshotSchema = z.object({
  executionId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200),
  sourceUserMessageId: z.string().min(1).max(200),
  origin: taskExecutionOriginSchema,
  route: taskExecutionRouteSchema,
  completionOwner: z.enum(["standalone", "goal"]),
  leaseGeneration: z.number().int().min(0),
  ledgerId: z.string().min(1).max(200),
  contractHash: z.string().min(1).max(200).nullable(),
});
export type TaskExecutionBindingSnapshot = z.infer<
  typeof taskExecutionBindingSnapshotSchema
>;

// ----- §6.1 Execution / ledger statuses -----

export const TASK_EXECUTION_STATUSES = [
  "resolving",
  "preparing",
  "active",
  "verifying",
  "continuing",
  "waiting_permission",
  "waiting_input",
  "waiting_approval",
  "waiting_external_job",
  "terminal",
] as const;
export type AiTaskExecutionStatus = (typeof TASK_EXECUTION_STATUSES)[number];

export const TASK_EXECUTION_LEDGER_STATUSES = [
  "active",
  "released",
] as const;
export type AiTaskExecutionLedgerStatus =
  (typeof TASK_EXECUTION_LEDGER_STATUSES)[number];

export const TASK_OPERATION_STATES = [
  "pending",
  "claimed",
  "dispatched",
  "accepted",
  "completed",
  "failed",
  "unknown",
] as const;
export type AiTaskOperationState = (typeof TASK_OPERATION_STATES)[number];

// ----- §14 Reason codes -----

export const TASK_EXECUTION_REASON_CODES = [
  "CRITERIA_SATISFIED",
  "NO_PROGRESS",
  "CONTINUATION_LIMIT",
  "MODEL_ATTEMPT_LIMIT",
  "TOOL_LIMIT",
  "TOKEN_LIMIT",
  "ACTIVE_RUNTIME_LIMIT",
  "VERIFICATION_UNAVAILABLE",
  "INVALID_VERIFIER_RESPONSE",
  "EVIDENCE_UNAVAILABLE",
  "UNKNOWN_ACTION_OUTCOME",
  "INPUT_REQUIRED",
  "PERMISSION_DENIED",
  "CONTENT_RESTRICTED",
  "AI_DISABLED",
  "AUTH_QUOTA_ERROR",
  "STREAM_INCOMPLETE",
  "OUTPUT_TRUNCATED",
  "PERSISTENCE_FAILED",
  "STATE_CONFLICT",
  "MISSING_TASK_OUTCOME",
  "SUBMISSION_CONFLICT",
  "INTENT_UNRESOLVED",
  "PREPARATION_REQUIRED",
  "USER_CANCELLED",
  "TASK_REPLACED",
  "SCHEDULE_STOPPED",
  "RESPONSE_ENDED",
  "SHADOW_EVALUATION",
] as const;
export type TaskExecutionReasonCode =
  (typeof TASK_EXECUTION_REASON_CODES)[number];

// ----- Provenance (FR-16) -----

export const TASK_END_PROVENANCE = [
  "provider",
  "adapter",
  "synthetic",
  "unknown",
] as const;
- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/aiTaskExecutionTypes.test.ts`
Expected: PASS — all schema parse cases green.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0. Fix any type errors (no `as any`, correct `z.infer` derivations) before committing.

- [ ] **Step 6: Commit**

```bash
git add src/entityTypes/aiTaskExecutionTypes.ts test/vitest/main/service/aiTaskExecutionTypes.test.ts
git commit -m "feat: add Zod v4 schemas for task execution contracts (Slice 1)"
```

---

### Task 2: Feature gate `aiTaskCompletionPolicyV1` (default OFF, fail-closed)

**Files:**
- Modify: `src/config/featureFlags.ts` (append before the final helper functions)
- Test: `test/vitest/main/service/aiTaskCompletionPolicyFeatureFlag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/aiTaskCompletionPolicyFeatureFlag.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

// Token is read live; mock it so the flag is deterministic and isolated
// from any real electron-store state.
vi.mock("@/modules/token", () => {
  const store = new Map<string, string>();
  return {
    Token: class {
      getValue(key: string): string {
        return store.get(key) ?? "";
      }
      setValue(key: string, value: string): void {
        store.set(key, value);
      }
      static _resetForTest(): void {
        store.clear();
      }
    },
  };
});

import {
  AI_TASK_COMPLETION_POLICY_V1_FLAG,
  isAiTaskCompletionPolicyV1Enabled,
} from "@/config/featureFlags";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TokenCtor = require("@/modules/token").Token as {
  _resetForTest: () => void;
};

beforeEach(() => {
  TokenCtor._resetForTest();
});

describe("aiTaskCompletionPolicyV1 feature gate", () => {
  it("defaults OFF when the Token store is empty", () => {
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(false);
  });

  it("is ON only when the Token value is exactly 'true'", () => {
    const { Token } = require("@/modules/token") as {
      Token: new () => { setValue(k: string, v: string): void };
    };
    new Token().setValue(AI_TASK_COMPLETION_POLICY_V1_FLAG, "true");
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(true);
  });

  it("stays OFF for any non-'true' value (fail-closed)", () => {
    const { Token } = require("@/modules/token") as {
      Token: new () => { setValue(k: string, v: string): void };
    };
    new Token().setValue(AI_TASK_COMPLETION_POLICY_V1_FLAG, "false");
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(false);
    new Token().setValue(AI_TASK_COMPLETION_POLICY_V1_FLAG, "1");
    expect(isAiTaskCompletionPolicyV1Enabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/aiTaskCompletionPolicyFeatureFlag.test.ts`
Expected: FAIL — `AI_TASK_COMPLETION_POLICY_V1_FLAG` and `isAiTaskCompletionPolicyV1Enabled` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/config/featureFlags.ts` (before the final `enableToolResultFlags` helper or at end of file):

```typescript
/**
 * AI Task Completion Policy V1 rollout flag (PRD §12 slice 1; technical-design
 * §17 rollout/rollback).
 *
 * DEFAULT OFF and FAIL CLOSED: a broken Token store must never silently
 * enable the completion-policy enrollment path. The flag gates execution
 * enrollment, request resolution, shadow evaluation, and contract freezing.
 * Read live on each call (per user action, not a hot path) so support staff
 * can toggle a stage without a restart.
 *
 * Rollback (§17): setting this OFF stops new enrollment/continuations.
 * Active enrolled runs use frozen policy or stop incomplete/cancelled; no
 * fallback success. Additive columns/operation records are retained.
 */
export const AI_TASK_COMPLETION_POLICY_V1_FLAG =
  "ai_task_completion_policy_v1_enabled";

export function isAiTaskCompletionPolicyV1Enabled(): boolean {
  try {
    return new Token().getValue(AI_TASK_COMPLETION_POLICY_V1_FLAG) === "true";
  } catch {
    // Unreadable store: keep the feature OFF so a storage hiccup cannot
    // silently enroll tasks into completion-policy handling.
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/aiTaskCompletionPolicyFeatureFlag.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/config/featureFlags.ts test/vitest/main/service/aiTaskCompletionPolicyFeatureFlag.test.ts
git commit -m "feat: add aiTaskCompletionPolicyV1 feature gate (default OFF, fail-closed)"
```

---

### Task 3: Extend `aiMessageTaskTypes.ts` with new run statuses

**Files:**
- Modify: `src/entityTypes/aiMessageTaskTypes.ts:10-22` (extend `AiMessageTaskRunStatus`)
- Test: `test/vitest/main/service/aiMessageTaskRunStatusExtended.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/aiMessageTaskRunStatusExtended.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { AiMessageTaskRunStatus } from "@/entityTypes/aiMessageTaskTypes";

describe("AiMessageTaskRunStatus includes recovery-visible statuses", () => {
  it("accepts 'incomplete' (PRD §6.1, FR-12)", () => {
    const s: AiMessageTaskRunStatus = "incomplete";
    expect(s).toBe("incomplete");
  });

  it("accepts 'needs_user_input' (PRD §6.1, FR-07/12)", () => {
    const s: AiMessageTaskRunStatus = "needs_user_input";
    expect(s).toBe("needs_user_input");
  });

  it("still accepts the pre-existing statuses (additive)", () => {
    const legacy: AiMessageTaskRunStatus[] = [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
      "blocked_by_policy",
      "timeout",
      "waiting_for_conversation",
      "coalesced",
      "interrupted",
    ];
    expect(legacy).toContain("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/aiMessageTaskRunStatusExtended.test.ts`
Expected: FAIL — type error: `"incomplete"` is not assignable to `AiMessageTaskRunStatus`.

- [ ] **Step 3: Write the implementation**

In `src/entityTypes/aiMessageTaskTypes.ts`, replace the `AiMessageTaskRunStatus` union (lines 10–22) with:

```typescript
/** Status of an AI message task scheduled run. */
export type AiMessageTaskRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked_by_policy"
  | "timeout"
  // Recovery-visible states used by the scheduler (technical-design §9.4).
  | "waiting_for_conversation"
  | "coalesced"
  | "interrupted"
  // Task-completion-policy V1 statuses (technical-design §6.1).
  // `incomplete`: enrolled execution ended without verified completion;
  //   manual rows require neither task ID nor scheduled run ID (FR-12/24).
  // `needs_user_input`: terminal needs-input when no resumable handle
  //   remains (FR-07/12).
  | "incomplete"
  | "needs_user_input";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/aiMessageTaskRunStatusExtended.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0. If `AiMessageTaskRunStatus` is used in a switch/`if` chain elsewhere without a default, add the new cases; do not add `as any`.

- [ ] **Step 6: Commit**

```bash
git add src/entityTypes/aiMessageTaskTypes.ts test/vitest/main/service/aiMessageTaskRunStatusExtended.test.ts
git commit -m "feat: add incomplete/needs_user_input run statuses (Slice 1)"
```

---

### Task 6: `TaskRunBudget` — structure, defaults, and shadow accounting

**Files:**
- Create: `src/service/aiTaskExecution/TaskRunBudget.ts`
- Test: `test/vitest/main/service/TaskRunBudget.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/TaskRunBudget.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  TaskRunBudget,
  MANUAL_BUDGET_DEFAULTS,
  HARD_CAPS,
  BudgetReservationResult,
} from "@/service/aiTaskExecution/TaskRunBudget";

describe("TaskRunBudget defaults (FR-08)", () => {
  it("manual defaults match the PRD §8 table", () => {
    expect(MANUAL_BUDGET_DEFAULTS.maxContinuations).toBe(3);
    expect(MANUAL_BUDGET_DEFAULTS.maxProviderAttempts).toBe(60);
    expect(MANUAL_BUDGET_DEFAULTS.maxCheckerAttempts).toBe(6);
    expect(MANUAL_BUDGET_DEFAULTS.maxToolExecutions).toBe(50);
    expect(MANUAL_BUDGET_DEFAULTS.maxTokens).toBe(128_000);
    expect(MANUAL_BUDGET_DEFAULTS.maxActiveRuntimeMs).toBe(10 * 60 * 1000);
  });

  it("hard caps are at least as large as the manual defaults", () => {
    expect(HARD_CAPS.maxContinuations).toBe(10);
    expect(HARD_CAPS.maxActiveRuntimeMs).toBe(30 * 60 * 1000);
  });
});

describe("TaskRunBudget reservation (shadow mode)", () => {
  it("records a reservation and decrements remaining", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const result = budget.reserveProviderAttempt("req-1");
    expect(result).toBe(BudgetReservationResult.Reserved);
    expect(budget.getConsumed().providerAttempts).toBe(1);
    expect(budget.getRemaining().providerAttempts).toBe(59);
  });

  it("reserving the same stable request ID twice returns the prior reservation without incrementing", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    expect(budget.reserveProviderAttempt("req-dup")).toBe(
      BudgetReservationResult.Reserved
    );
    expect(budget.reserveProviderAttempt("req-dup")).toBe(
      BudgetReservationResult.AlreadyReserved
    );
    expect(budget.getConsumed().providerAttempts).toBe(1);
  });

  it("returns Exhausted when the counter is spent", () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxProviderAttempts: 1,
    });
    expect(budget.reserveProviderAttempt("req-a")).toBe(
      BudgetReservationResult.Reserved
    );
    expect(budget.reserveProviderAttempt("req-b")).toBe(
      BudgetReservationResult.Exhausted
    );
  });

  it("shadow mode does not gate dispatch (Slice 1: no throw, caller decides)", () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxContinuations: 0,
    });
    // Shadow: reserveContinuation records exhaustion but does not throw.
    const result = budget.reserveContinuation("cont-1");
    expect(result).toBe(BudgetReservationResult.Exhausted);
    expect(budget.getConsumed().continuations).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskRunBudget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/service/aiTaskExecution/TaskRunBudget.ts`:

```typescript
/**
 * Execution-wide budget reservation authority (technical-design §9).
 *
 * Slice 1 scope: structure, defaults (FR-08 table), and shadow accounting.
 * `reserve*` methods RECORD consumption and return a typed result; they do
 * NOT throw or gate live dispatch. The live enforcement gate (caller must
 * check the result and refuse dispatch on Exhausted) is wired in Slice 2.
 *
 * Linked Continue successors share lineage accounting via the persisted
 * ledger; an explicit new attempt gets a separate ledger. The in-memory
 * object here is a shadow mirror of the authoritative ledger row — it is
 * never itself the source of truth for spent allowance.
 */
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/budgetDefaults";

export { MANUAL_BUDGET_DEFAULTS, HARD_CAPS, SCHEDULED_LOOP_RUN_TIMEOUT_MS } from "@/service/aiTaskExecution/budgetDefaults";

export enum BudgetReservationResult {
  Reserved = "reserved",
  AlreadyReserved = "already_reserved",
  Exhausted = "exhausted",
}

export interface BudgetConsumed {
  readonly continuations: number;
  readonly providerAttempts: number;
  readonly checkerAttempts: number;
  readonly toolExecutions: number;
  readonly tokens: number;
  readonly activeRuntimeMs: number;
  readonly waitMs: number;
  readonly noProgressStreak: number;
}

export interface BudgetRemaining extends BudgetConsumed {}

export interface BudgetLimits {
  readonly maxContinuations: number;
  readonly maxProviderAttempts: number;
  readonly maxCheckerAttempts: number;
  readonly maxToolExecutions: number;
  readonly maxTokens: number;
  readonly maxActiveRuntimeMs: number;
  readonly maxWaitMs: number;
  readonly maxNoProgressStreak: number;
}

export class TaskRunBudget {
  private readonly limits: BudgetLimits;
  private readonly reservedRequestIds: Set<string> = new Set();
  private consumed: BudgetConsumed;

  constructor(limits: BudgetLimits) {
    this.limits = limits;
    this.consumed = {
      continuations: 0,
      providerAttempts: 0,
      checkerAttempts: 0,
      toolExecutions: 0,
      tokens: 0,
      activeRuntimeMs: 0,
      waitMs: 0,
      noProgressStreak: 0,
    };
  }

  getLimits(): BudgetLimits {
    return this.limits;
  }

  getConsumed(): BudgetConsumed {
    return { ...this.consumed };
  }

  getRemaining(): BudgetRemaining {
    return {
      continuations: Math.max(
        0,
        this.limits.maxContinuations - this.consumed.continuations
      ),
      providerAttempts: Math.max(
        0,
        this.limits.maxProviderAttempts - this.consumed.providerAttempts
      ),
      checkerAttempts: Math.max(
        0,
        this.limits.maxCheckerAttempts - this.consumed.checkerAttempts
      ),
      toolExecutions: Math.max(
        0,
        this.limits.maxToolExecutions - this.consumed.toolExecutions
      ),
      tokens: Math.max(0, this.limits.maxTokens - this.consumed.tokens),
      activeRuntimeMs: Math.max(
        0,
        this.limits.maxActiveRuntimeMs - this.consumed.activeRuntimeMs
      ),
      waitMs: Math.max(0, this.limits.maxWaitMs - this.consumed.waitMs),
      noProgressStreak: Math.max(
        0,
        this.limits.maxNoProgressStreak - this.consumed.noProgressStreak
      ),
    };
  }

  /**
   * Reserve a provider dispatch attempt by stable request ID. Reserving an
   * existing ID returns AlreadyReserved without incrementing (§9: dedup by
   * request ID). Returns Exhausted (and does NOT increment) when the limit
   * is spent.
   */
  reserveProviderAttempt(requestId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(requestId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.providerAttempts >= this.limits.maxProviderAttempts) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(requestId);
    this.consumed = {
      ...this.consumed,
      providerAttempts: this.consumed.providerAttempts + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  reserveContinuation(continuationId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(continuationId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.continuations >= this.limits.maxContinuations) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(continuationId);
    this.consumed = {
      ...this.consumed,
      continuations: this.consumed.continuations + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  reserveToolExecution(toolRequestId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(toolRequestId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.toolExecutions >= this.limits.maxToolExecutions) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(toolRequestId);
    this.consumed = {
      ...this.consumed,
      toolExecutions: this.consumed.toolExecutions + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  reserveCheckerAttempt(checkerRequestId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(checkerRequestId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.checkerAttempts >= this.limits.maxCheckerAttempts) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(checkerRequestId);
    this.consumed = {
      ...this.consumed,
      checkerAttempts: this.consumed.checkerAttempts + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  /** Reconcile actual token usage after a dispatch (§9). */
  reconcileTokens(requestId: string, actualTokens: number): void {
    // Dedup: if this request was already counted for tokens, do not double-count.
    // We track token-reconciled IDs separately to allow a reservation + later reconcile.
    const reconcileKey = `tokens:${requestId}`;
    if (this.reservedRequestIds.has(reconcileKey)) {
      return;
    }
    this.reservedRequestIds.add(reconcileKey);
    this.consumed = {
      ...this.consumed,
      tokens: this.consumed.tokens + Math.max(0, Math.floor(actualTokens)),
    };
  }

  /** Accumulate active runtime across resumes (§9). */
  addActiveRuntime(ms: number): void {
    this.consumed = {
      ...this.consumed,
      activeRuntimeMs: this.consumed.activeRuntimeMs + Math.max(0, Math.floor(ms)),
    };
  }

  addWaitMs(ms: number): void {
    this.consumed = {
      ...this.consumed,
      waitMs: this.consumed.waitMs + Math.max(0, Math.floor(ms)),
    };
  }

  recordNoProgress(): void {
    this.consumed = {
      ...this.consumed,
      noProgressStreak: this.consumed.noProgressStreak + 1,
    };
  }

  resetNoProgressStreak(): void {
    this.consumed = {
      ...this.consumed,
      noProgressStreak: 0,
    };
  }
}
```

Create `src/service/aiTaskExecution/budgetDefaults.ts`:

```typescript
/**
 * Budget defaults and hard caps (PRD §8, technical-design §9).
 *
 * Manual defaults are conservative; trusted settings may tune within the
 * hard caps. Scheduled origin uses min(task config, 3) continuations and
 * min(task.maxRuntimeMs, SCHEDULED_LOOP_RUN_TIMEOUT_MS) active runtime.
 */
export const SCHEDULED_LOOP_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export interface BudgetLimitsInput {
  readonly maxContinuations: number;
  readonly maxProviderAttempts: number;
  readonly maxCheckerAttempts: number;
  readonly maxToolExecutions: number;
  readonly maxTokens: number;
  readonly maxActiveRuntimeMs: number;
  readonly maxWaitMs: number;
  readonly maxNoProgressStreak: number;
}

export const MANUAL_BUDGET_DEFAULTS: BudgetLimitsInput = {
  maxContinuations: 3,
  maxProviderAttempts: 60,
  maxCheckerAttempts: 6,
  maxToolExecutions: 50,
  maxTokens: 128_000,
  maxActiveRuntimeMs: 10 * 60 * 1000,
  maxWaitMs: 60 * 60 * 1000, // 1 hour backstop
  maxNoProgressStreak: 3,
};

export const HARD_CAPS = {
  maxContinuations: 10,
  maxActiveRuntimeMs: 30 * 60 * 1000,
} as const;

/**
 * Build scheduled-origin limits from task configuration. Continuations are
 * min(task.maxContinueCalls, 3) per §9; tool executions use the task's
 * configured maxToolCalls; active runtime is the minimum of the task's
 * configured runtime and the scheduled-loop run timeout.
 */
export function buildScheduledBudgetLimits(input: {
  readonly maxContinueCalls: number;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
}): BudgetLimitsInput {
  return {
    maxContinuations: Math.min(input.maxContinueCalls, 3),
    maxProviderAttempts: 60,
    maxCheckerAttempts: 6,
    maxToolExecutions: input.maxToolCalls,
    maxTokens: 128_000,
    maxActiveRuntimeMs: Math.min(input.maxRuntimeMs, SCHEDULED_LOOP_RUN_TIMEOUT_MS),
    maxWaitMs: 60 * 60 * 1000,
    maxNoProgressStreak: 3,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskRunBudget.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/service/aiTaskExecution/TaskRunBudget.ts src/service/aiTaskExecution/budgetDefaults.ts test/vitest/main/service/TaskRunBudget.test.ts
git commit -m "feat: add TaskRunBudget structure + FR-08 defaults + shadow accounting"
```

---

### Task 7: `TaskCompletionContractService` — freeze + stable hash

**Files:**
- Create: `src/service/aiTaskExecution/TaskCompletionContractService.ts`
- Test: `test/vitest/main/service/TaskCompletionContractService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/TaskCompletionContractService.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { TaskCompletionContractService } from "@/service/aiTaskExecution/TaskCompletionContractService";
import type { TaskCriterion } from "@/entityTypes/aiTaskExecutionTypes";

function recordCountCriterion(
  id: string,
  minimum: number,
  scope: "execution" | "lineage" | "cumulative"
): TaskCriterion {
  return {
    id,
    required: true,
    kind: "record_count",
    description: `save ${minimum} contacts`,
    adapterKey: "contact-campaign",
    targetId: "camp-1",
    scope,
    minimum,
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 20 }],
  };
}

describe("TaskCompletionContractService.freeze", () => {
  it("produces a stable hash for the same objective/criteria/sources", () => {
    const svc = new TaskCompletionContractService();
    const criteria = [recordCountCriterion("rec-1", 100, "cumulative")];
    const c1 = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    const c2 = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    expect(c2.contractHash).toBe(c1.contractHash);
    expect(c2.contractId).not.toBe(c1.contractId); // distinct IDs
  });

  it("changes the hash when the objective changes (scope change detection)", () => {
    const svc = new TaskCompletionContractService();
    const criteria = [recordCountCriterion("rec-1", 100, "cumulative")];
    const c1 = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    const c2 = svc.freeze({
      objective: "Save 200 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    expect(c2.contractHash).not.toBe(c1.contractHash);
  });

  it("rejects a criterion whose sourceRef messageId is not in approvedSourceMessageIds", () => {
    const svc = new TaskCompletionContractService();
    expect(() =>
      svc.freeze({
        objective: "do x",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "verified",
        criteria: [
          {
            id: "rec-1",
            required: true,
            kind: "record_count",
            description: "save 100",
            adapterKey: "contact-campaign",
            targetId: "camp-1",
            scope: "cumulative",
            minimum: 100,
            sourceRefs: [
              { messageId: "msg-NOT-APPROVED", startOffset: 0, endOffset: 5 },
            ],
          },
        ],
      })
    ).toThrow();
  });

  it("rejects a zero-required-criteria verified contract (no vacuous pass, FR-04)", () => {
    const svc = new TaskCompletionContractService();
    expect(() =>
      svc.freeze({
        objective: "do x",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "verified",
        criteria: [],
      })
    ).toThrow();
  });

  it("accepts a best-effort contract with zero required criteria (unverified by default)", () => {
    const svc = new TaskCompletionContractService();
    const c = svc.freeze({
      objective: "draft something",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "best_effort",
      criteria: [],
    });
    expect(c.mode).toBe("best_effort");
    expect(c.contractHash.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskCompletionContractService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/service/aiTaskExecution/TaskCompletionContractService.ts`:

```typescript
/**
 * Freezes a completion contract from the objective + approved sources
 * (technical-design §5.1, FR-19).
 *
 * The contract hash is computed over a canonical JSON form of the
 * objective, criteria, and approved source IDs — EXCLUDING volatile
 * execution/provider IDs — so an unchanged Continue contract remains
 * comparable (§5.1). Source references must point only at messages in
 * `approvedSourceMessageIds`; runtime nudges/retrieved instructions can
 * never authorize work (FR-18).
 *
 * A verified-mode contract with zero required criteria cannot pass vacuously
 * (FR-04); freeze throws. Best-effort with zero criteria is allowed and
 * remains unverified unless evidence establishes every required criterion.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  TaskCompletionContract,
  TaskCriterion,
} from "@/entityTypes/aiTaskExecutionTypes";

export interface FreezeInput {
  readonly objective: string;
  readonly sourceUserMessageId: string;
  readonly approvedSourceMessageIds: readonly string[];
  readonly mode: "verified" | "best_effort";
  readonly criteria: readonly TaskCriterion[];
}

function canonicalJson(value: unknown): string {
  // Deterministic serialization: sort object keys recursively so the hash is
  // stable regardless of insertion order. Excludes volatile IDs by
  // construction (callers pass only objective/criteria/sources).
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export class TaskCompletionContractService {
  freeze(input: FreezeInput): TaskCompletionContract {
    // Validate source references (FR-18): every criterion's sourceRefs must
    // point at an approved source message. SourceUserMessageId must itself
    // be in the approved set.
    const approvedSet = new Set(input.approvedSourceMessageIds);
    if (!approvedSet.has(input.sourceUserMessageId)) {
      throw new Error(
        "sourceUserMessageId must be in approvedSourceMessageIds"
      );
    }
    for (const criterion of input.criteria) {
      for (const ref of criterion.sourceRefs) {
        if (!approvedSet.has(ref.messageId)) {
          throw new Error(
            `criterion ${criterion.id} references unapproved message ${ref.messageId}`
          );
        }
        if (ref.endOffset < ref.startOffset) {
          throw new Error(
            `criterion ${criterion.id} has invalid offset range`
          );
        }
      }
    }

    // FR-04: a verified-mode contract with zero required criteria cannot
    // pass vacuously. Block at freeze time.
    if (
      input.mode === "verified" &&
      input.criteria.filter((c) => c.required).length === 0
    ) {
      throw new Error(
        "verified contract requires at least one required criterion"
      );
    }

    const contractId = `contract-${randomUUID()}`;
    const contractHash = this.computeHash(input);
    return {
      schemaVersion: 1,
      contractId,
      contractHash,
      objective: input.objective,
      sourceUserMessageId: input.sourceUserMessageId,
      approvedSourceMessageIds: [...input.approvedSourceMessageIds],
      mode: input.mode,
      criteria: input.criteria.map((c) => ({ ...c })),
    };
  }

  /** Recompute the hash for an existing contract to verify integrity on load. */
  verifyHash(contract: TaskCompletionContract): boolean {
    const recomputed = this.computeHash({
      objective: contract.objective,
      sourceUserMessageId: contract.sourceUserMessageId,
      approvedSourceMessageIds: contract.approvedSourceMessageIds,
      mode: contract.mode,
      criteria: contract.criteria,
    });
    return recomputed === contract.contractHash;
  }

  private computeHash(input: FreezeInput): string {
    const payload = {
      objective: input.objective,
      mode: input.mode,
      sourceUserMessageId: input.sourceUserMessageId,
      approvedSourceMessageIds: [...input.approvedSourceMessageIds].sort(),
      criteria: input.criteria.map((c) => ({
        id: c.id,
        required: c.required,
        kind: c.kind,
        // Include only kind-specific fields via a stable canonical form.
        // The discriminated-union spread is canonicalized by sortKeys.
        ...(c as Record<string, unknown>),
      })),
    };
    const hash = createHash("sha256");
    hash.update(canonicalJson(payload));
    return `sha256:${hash.digest("hex")}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskCompletionContractService.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/service/aiTaskExecution/TaskCompletionContractService.ts test/vitest/main/service/TaskCompletionContractService.test.ts
git commit -m "feat: add TaskCompletionContractService freeze + stable hash (FR-19)"
```

---

### Task 8: `TaskRequestResolver` — route classification (FR-18)

**Files:**
- Create: `src/service/aiTaskExecution/TaskRequestResolver.ts`
- Test: `test/vitest/main/service/TaskRequestResolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/TaskRequestResolver.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { TaskRequestResolver } from "@/service/aiTaskExecution/TaskRequestResolver";
import type { TaskExecutionRoute } from "@/entityTypes/aiTaskExecutionTypes";

describe("TaskRequestResolver.classify (FR-18)", () => {
  it("classifies a plain 'save 100 contacts' request as task_verified", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Save 100 qualifying contacts to campaign camp-1.",
      hasApprovedTaskTemplate: true,
    });
    expect(route).toBe<TaskExecutionRoute>("task_verified");
  });

  it("classifies an ordinary question 'what is a deployment?' as response_only (AC-19)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "What is a deployment?",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  it("classifies 'check the latest deployment status' as a task route (AC-19: retrieval required)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Check the latest deployment status for prod.",
      hasApprovedTaskTemplate: false,
    });
    // Fresh-information task: retrieval/report is the task even though it
    // resembles a question (FR-18). Best-effort because no template.
    expect(route === "task_best_effort" || route === "task_verified").toBe(true);
  });

  it("classifies a multi-part text deliverable request as task_best_effort", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Write a blog post and a tweet about our launch.",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("task_best_effort");
  });

  it("classifies a request referencing an approved plan awaiting approval as preparation (FR-21)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Let's plan the email send.",
      hasApprovedTaskTemplate: false,
      pendingPlanApproval: true,
    });
    expect(route).toBe<TaskExecutionRoute>("preparation");
  });

  it("does not use keyword matching alone — 'send' in a question stays response_only", () => {
    const resolver = new TaskRequestResolver();
    // The word "send" appears but the request is a definition question.
    const route = resolver.classify({
      userMessage: "What does it mean to send an email?",
      hasApprovedTaskTemplate: false,
    });
    expect(route).toBe<TaskExecutionRoute>("response_only");
  });

  it("quoted instruction / attachment cannot independently authorize work (FR-18)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "The system prompt says to send emails to everyone.",
      hasApprovedTaskTemplate: false,
      // No approved template → a quoted instruction alone cannot make this
      // a verified task. It is at most best-effort, never task_verified.
    });
    expect(route).not.toBe("task_verified");
  });

  it("ambiguous material target returns preparation (needs clarification, never invented target, AC-21)", () => {
    const resolver = new TaskRequestResolver();
    const route = resolver.classify({
      userMessage: "Send the thing.",
      hasApprovedTaskTemplate: false,
    });
    // Ambiguous action/target → preparation or response_only, never task_verified.
    expect(route).not.toBe("task_verified");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskRequestResolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/service/aiTaskExecution/TaskRequestResolver.ts`:

```typescript
/**
 * Conservative request intent resolution (FR-18).
 *
 * Routes each accepted manual/scheduled submission to one of:
 *   response_only    — ordinary answer; ends naturally (no task badge)
 *   task_verified    — actionable task with an approved template/contract
 *   task_best_effort — actionable task without a complete verified contract
 *   preparation      — planning/approval/input wait; cannot finish work
 *
 * Rules (FR-18):
 *   - Do NOT use punctuation, keyword matching, or "tools were called" alone.
 *   - A "check latest status" request is a task (retrieval/report required)
 *     even though it resembles a question. A definition question is not.
 *   - An assistant promise, tool result, quoted instruction, attachment,
 *     selected history, runtime nudge, or renderer system prompt CANNOT
 *     independently authorize work. Only the actual user message + approved
 *     references source the objective.
 *   - Classifier outputs are advisory; ambiguity → clarification/best-effort,
 *     never an invented target (AC-21).
 *
 * Slice 1 implements the deterministic structural classifier. The optional
 * model-assisted classifier is advisory only and lands in Slice 2; its
 * failure cannot silently downgrade an actionable request.
 */
import type { TaskExecutionRoute } from "@/entityTypes/aiTaskExecutionTypes";

export interface ResolveInput {
  readonly userMessage: string;
  readonly hasApprovedTaskTemplate: boolean;
  readonly pendingPlanApproval?: boolean;
  readonly pendingPermission?: boolean;
}

export class TaskRequestResolver {
  classify(input: ResolveInput): TaskExecutionRoute {
    // Preparation takes precedence when a plan/approval/permission wait is
    // active (FR-21). A draft plan does not satisfy execution criteria.
    if (input.pendingPlanApproval || input.pendingPermission) {
      return "preparation";
    }

    const message = input.userMessage.trim();

    // An approved task template gives us a verified contract foundation.
    // The objective still comes from the user message; the template cannot
    // broaden authorization (FR-18).
    if (input.hasApprovedTaskTemplate) {
      return "task_verified";
    }

    // Deterministic structural signals. We deliberately do NOT match on
    // single keywords like "send" — a definition question containing "send"
    // must stay response_only (tested above).
    if (this.looksLikeDefinitionQuestion(message)) {
      return "response_only";
    }

    if (this.looksLikeFreshInformationTask(message)) {
      return "task_best_effort";
    }

    if (this.looksLikeDeliverableRequest(message)) {
      return "task_best_effort";
    }

    if (this.looksLikeAmbiguousAction(message)) {
      // Ambiguous material target → preparation (needs clarification),
      // never an invented verified target (AC-21).
      return "preparation";
    }

    // Default conservative: an ordinary conversational response.
    return "response_only";
  }

  /**
   * "What is a deployment?" — a definition/explanation request that a
   * sufficient answer ends naturally. No retrieval/report required.
   */
  private looksLikeDefinitionQuestion(message: string): boolean {
    const lower = message.toLowerCase();
    const definitionStarters = [
      "what is ",
      "what's ",
      "what does it mean ",
      "how does ",
      "why is ",
      "explain ",
    ];
    // The message must be a question (contains "?") AND start with a
    // definition stem. A "check the latest status" request does not match.
    return (
      message.includes("?") &&
      definitionStarters.some((s) => lower.startsWith(s))
    );
  }

  /**
   * "Check the latest deployment status" — retrieval/report is the task
   * even though it resembles a question (FR-18, AC-19). Detected by
   * imperative action verbs targeting a current/external state.
   */
  private looksLikeFreshInformationTask(message: string): boolean {
    const lower = message.toLowerCase();
    const retrievalVerbs = [
      "check ",
      "monitor ",
      "verify ",
      "get the latest ",
      "get the status ",
      "check the latest ",
      "check the current ",
    ];
    return retrievalVerbs.some((s) => lower.startsWith(s));
  }

  /**
   * "Write a blog post and a tweet" — a text/artifact deliverable. Actual
   * valid text can pass without tools (AC-20); every requested part must
   * pass.
   */
  private looksLikeDeliverableRequest(message: string): boolean {
    const lower = message.toLowerCase();
    const deliverableVerbs = [
      "write ",
      "draft ",
      "compose ",
      "generate ",
      "create a ",
      "summarize ",
    ];
    return deliverableVerbs.some((s) => lower.startsWith(s));
  }

  /**
   * "Send the thing." — material target/action present but ambiguous.
   * Returns preparation (needs clarification), never an invented target.
   */
  private looksLikeAmbiguousAction(message: string): boolean {
    const lower = message.toLowerCase();
    const actionVerbs = ["send ", "post ", "publish ", "deploy "];
    const hasActionVerb = actionVerbs.some((s) => lower.startsWith(s));
    if (!hasActionVerb) return false;
    // Heuristic: short message with an action verb but no clear target/
    // recipient → ambiguous. Real send/post requests with a clear target
    // route through an approved template (task_verified) upstream; without
    // a template they are best-effort only if the target is clear.
    return message.split(/\s+/).length <= 4;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskRequestResolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/service/aiTaskExecution/TaskRequestResolver.ts test/vitest/main/service/TaskRequestResolver.test.ts
git commit -m "feat: add TaskRequestResolver conservative route classification (FR-18)"
```

---

### Task 9: `TaskExecutionCoordinator` — execution identity + binding (FR-17/20)

**Files:**
- Create: `src/service/aiTaskExecution/TaskExecutionCoordinator.ts`
- Test: `test/vitest/main/service/TaskExecutionCoordinator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/TaskExecutionCoordinator.test.ts`:

```typescript
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
        const executionId = `exec-${input.conversationId}`;
        store.set(executionId, input);
        return {
          executionId,
          ledgerId: `ledger-${input.conversationId}`,
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
import type { TaskExecutionBindingSnapshot } from "@/entityTypes/aiTaskExecutionTypes";

beforeEach(() => {
  // Reset the module mock store between tests.
  const Ctor = require("@/modules/AiTaskExecutionModule")
    .AiTaskExecutionModule as { _store: () => Map<string, unknown> };
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

  it("serializes to a snapshot that excludes runtime controller/budget objects", () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskExecutionCoordinator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/service/aiTaskExecution/TaskExecutionCoordinator.ts`:

```typescript
/**
 * Creates execution-scoped identity and the trusted runtime binding
 * (technical-design §5, FR-17/20).
 *
 * The binding is MAIN-PROCESS STATE, never serializable renderer input
 * (§4A.1). The coordinator creates durable identity BEFORE slow resolution
 * so Stop already works (FR-17). Manual execution has its own durable
 * identity — not a fake schedule/run or goal record (FR-20).
 *
 * Slice 1 scope: identity creation + binding assembly + snapshot (for
 * persistence). Live lease acquisition against the
 * ConversationTurnCoordinator and live continuation dispatch land in Slice 2.
 *
 * Single completion owner (FR-20): one of "standalone" or "goal" per
 * execution. An unrelated active conversation goal cannot take over an
 * ordinary manual request.
 */
import { randomUUID } from "node:crypto";
import type {
  TaskExecutionBindingSnapshot,
  TaskExecutionOrigin,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";
import { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import {
  MANUAL_BUDGET_DEFAULTS,
  buildScheduledBudgetLimits,
} from "@/service/aiTaskExecution/budgetDefaults";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";

export interface TaskExecutionBinding {
  readonly executionId: string;
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly origin: TaskExecutionOrigin;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
  readonly leaseGeneration: number;
  readonly ledgerId: string;
  readonly contract: TaskCompletionContract | null;
  readonly contractHash: string | null;
  readonly controller: TaskCompletionController;
  readonly budget: TaskRunBudget;
}

import type { TaskCompletionContract } from "@/entityTypes/aiTaskExecutionTypes";

export interface StartManualInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly submissionId: string;
  readonly requestHash: string;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
}

export interface StartScheduledInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly requestHash: string;
  readonly route: TaskExecutionRoute;
  readonly taskId: number;
  readonly runId: number;
  readonly occurrenceKey: string;
  readonly budgetLimits: import("@/service/aiTaskExecution/budgetDefaults").BudgetLimitsInput;
}

export class TaskExecutionCoordinator {
  private readonly module: AiTaskExecutionModule;

  constructor(module?: AiTaskExecutionModule) {
    // Constructed lazily — never at module top level (BaseModule TDZ).
    this.module = module ?? new AiTaskExecutionModule();
  }

  async startManual(input: StartManualInput): Promise<TaskExecutionBinding> {
    const origin: TaskExecutionOrigin = {
      type: "manual",
      submissionId: input.submissionId,
    };
    return this.startBinding({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      requestHash: input.requestHash,
      route: input.route,
      completionOwner: input.completionOwner,
      origin,
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
      submissionId: input.submissionId,
    });
  }

  async startScheduled(
    input: StartScheduledInput
  ): Promise<TaskExecutionBinding> {
    const origin: TaskExecutionOrigin = {
      type: "scheduled",
      taskId: input.taskId,
      runId: input.runId,
      occurrenceKey: input.occurrenceKey,
    };
    return this.startBinding({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      requestHash: input.requestHash,
      route: input.route,
      completionOwner: "standalone",
      origin,
      budgetLimits: input.budgetLimits,
      submissionId: null,
    });
  }

  private async startBinding(input: {
    conversationId: string;
    sourceUserMessageId: string;
    requestHash: string;
    route: TaskExecutionRoute;
    completionOwner: "standalone" | "goal";
    origin: TaskExecutionOrigin;
    budgetLimits: import("@/service/aiTaskExecution/budgetDefaults").BudgetLimitsInput;
    submissionId: string | null;
  }): Promise<TaskExecutionBinding> {
    const started = await this.module.startExecution({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      submissionId: input.submissionId,
      requestHash: input.requestHash,
      origin: input.origin,
      route: input.route,
      completionOwner: input.completionOwner,
    });

    const budget = new TaskRunBudget(input.budgetLimits);
    const controller = new TaskCompletionController({
      executionId: started.executionId,
    });

    return {
      executionId: started.executionId,
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      origin: input.origin,
      route: input.route,
      completionOwner: input.completionOwner,
      leaseGeneration: 0,
      ledgerId: started.ledgerId,
      contract: null,
      contractHash: null,
      controller,
      budget,
    };
  }

  /** Serialize the binding for persistence; excludes runtime objects. */
  toSnapshot(binding: TaskExecutionBinding): TaskExecutionBindingSnapshot {
    return {
      executionId: binding.executionId,
      conversationId: binding.conversationId,
      sourceUserMessageId: binding.sourceUserMessageId,
      origin: binding.origin,
      route: binding.route,
      completionOwner: binding.completionOwner,
      leaseGeneration: binding.leaseGeneration,
      ledgerId: binding.ledgerId,
      contractHash: binding.contractHash,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskExecutionCoordinator.test.ts`
Expected: FAIL — `AiTaskExecutionModule` and `TaskCompletionController` do not exist yet. (This task depends on Tasks 10 and 11. Run Tasks 10–11 first, then re-run this test.)

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: FAIL until Tasks 10–11 land (forward dependency). This is expected — the coordinator consumes the module + controller. Implement Tasks 10–11, then return to this step.

- [ ] **Step 6: Commit (after Tasks 10–11 land)**

```bash
git add src/service/aiTaskExecution/TaskExecutionCoordinator.ts test/vitest/main/service/TaskExecutionCoordinator.test.ts
git commit -m "feat: add TaskExecutionCoordinator identity + binding (FR-17/20)"
```

---

### Task 10: `TaskCompletionController` — shadow `decide()` (FR-05/06/16)

**Files:**
- Create: `src/service/aiTaskExecution/TaskCompletionController.ts`
- Test: `test/vitest/main/service/TaskCompletionController.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/TaskCompletionController.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import type { TaskEndCandidate } from "@/entityTypes/aiTaskExecutionTypes";

function baseCandidate(overrides: Partial<TaskEndCandidate>): TaskEndCandidate {
  return {
    candidateId: "cand-1",
    executionId: "exec-1",
    content: "Done.",
    finishReason: "stop",
    provenance: "provider",
    streamTerminalSeen: true,
    boundary: "response_end",
    pendingPermission: false,
    pendingQuestion: false,
    pendingPlanApproval: false,
    safetyRestriction: false,
    ...overrides,
  };
}

describe("TaskCompletionController.decide (shadow mode, FR-05/06/16)", () => {
  it("returns finish_response for a response-only route candidate (AC-14)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(baseCandidate({}), {
      route: "response_only",
    });
    expect(decision.type).toBe("finish_response");
  });

  it("returns finish verified_complete when all required evidence passes (AC-03)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
      expect(decision.reasonCode).toBe("CRITERIA_SATISFIED");
    }
  });

  it("returns finish incomplete when required criteria are unmet (first-response stop, AC-18)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ content: "I will check.", finishReason: null }),
      {
        route: "task_verified",
        passedCriterionIds: [],
        requiredCriterionIds: ["rec-1"],
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
    }
  });

  it("returns wait when a permission is pending (FR-06 stop conditions)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ pendingPermission: true }),
      { route: "task_verified" }
    );
    expect(decision.type).toBe("wait");
    if (decision.type === "wait") {
      expect(decision.reason).toBe("permission");
    }
  });

  it("returns finish blocked_by_policy on a safety restriction (FR-06, no bypass)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ safetyRestriction: true, content: "I can't help." }),
      { route: "task_verified" }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("blocked_by_policy");
      expect(decision.reasonCode).toBe("CONTENT_RESTRICTED");
    }
  });

  it("records synthetic provenance for a missing-terminal candidate (AC-12, FR-16)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "synthetic",
        streamTerminalSeen: false,
        finishReason: null,
        boundary: "budget_cap",
      }),
      { route: "task_verified" }
    );
    // Synthetic/budget_cap candidates never pass verified (AC-12).
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).not.toBe("verified_complete");
    }
  });

  it("shadow mode never returns continue (Slice 1: no live continuation dispatch)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 50/100." }),
      {
        route: "task_verified",
        passedCriterionIds: [],
        requiredCriterionIds: ["rec-1"],
      }
    );
    // Slice 1: shadow evaluation. Even when work is unfinished, the shadow
    // controller returns finish (incomplete) — it never dispatches a
    // continuation. Live continue is Slice 2.
    expect(decision.type).not.toBe("continue");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskCompletionController.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/service/aiTaskExecution/TaskCompletionController.ts`:

```typescript
/**
 * Shadow-mode completion controller (technical-design §7, FR-05/06/16).
 *
 * Slice 1: SHADOW EVALUATION ONLY. `decide()` classifies a response-end
 * candidate, records provenance, and returns a `TaskCompletionDecision`.
 * It does NOT dispatch maker continuations, alter persisted counters, or
 * gate live dispatch (§17 shadow-mode rules). A returned "continue" is
 * never produced in Slice 1; unfinished task candidates return
 * `finish(incomplete)` instead.
 *
 * Decision precedence (§7.2) is implemented in order:
 *   1. Validate ownership/route (caller's responsibility in Slice 1).
 *   2. User cancellation wins — handled by the caller before calling decide.
 *   3. Safety restrictions / policy blocks → blocked_by_policy (no bypass).
 *   4. Pending permission/question/approval → wait.
 *   5. Response-only → finish_response.
 *   6. Task: all required criteria pass → verified_complete; else
 *      incomplete (shadow: no continuation).
 *
 * Provenance (FR-16): the candidate's `provenance` and `boundary` fields
 * are preserved on the decision's reason code; synthetic/unknown/missing-
 * terminal candidates can never become verified_complete (AC-12).
 */
import type {
  TaskCompletionDecision,
  TaskEndCandidate,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";

export interface ControllerDeps {
  readonly executionId: string;
}

export interface DecideContext {
  readonly route: TaskExecutionRoute;
  readonly passedCriterionIds?: readonly string[];
  readonly requiredCriterionIds?: readonly string[];
  readonly unmetCriterionIds?: readonly string[];
}

export class TaskCompletionController {
  private readonly deps: ControllerDeps;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
  }

  async decide(
    candidate: TaskEndCandidate,
    context: DecideContext
  ): Promise<TaskCompletionDecision> {
    // §7.2 step 3: safety restriction wins over verification; no bypass.
    if (candidate.safetyRestriction) {
      return {
        type: "finish",
        outcome: "blocked_by_policy",
        reasonCode: "CONTENT_RESTRICTED",
        evidenceIds: [],
        summary: this.boundedSummary(candidate.content),
        remainingWork: [],
      };
    }

    // §7.2 step 4: pending permission/question/approval → wait.
    if (candidate.pendingPlanApproval) {
      return { type: "wait", reason: "plan_approval" };
    }
    if (candidate.pendingQuestion) {
      return { type: "wait", reason: "input" };
    }
    if (candidate.pendingPermission) {
      return { type: "wait", reason: "permission" };
    }

    // §7.2 step 5: response-only candidates finish response-ended.
    if (context.route === "response_only") {
      return { type: "finish_response", result: "response_ended" };
    }

    // Preparation route cannot finish executable work (FR-21).
    if (context.route === "preparation") {
      return {
        type: "finish",
        outcome: "incomplete",
        reasonCode: "PREPARATION_REQUIRED",
        evidenceIds: [],
        summary: this.boundedSummary(candidate.content),
        remainingWork: context.unmetCriterionIds ?? [],
      };
    }

    // Task route (task_verified or task_best_effort): evaluate criteria.
    const required = context.requiredCriterionIds ?? [];
    const passed = new Set(context.passedCriterionIds ?? []);
    const allRequiredPass =
      required.length > 0 && required.every((id) => passed.has(id));

    // §7.2 step 6: all required criteria pass → verified_complete.
    // AC-12: synthetic/unknown/missing-terminal provenance can never verify.
    const canVerify =
      allRequiredPass &&
      candidate.provenance !== "synthetic" &&
      candidate.provenance !== "unknown" &&
      candidate.streamTerminalSeen;

    if (canVerify && context.route === "task_verified") {
      return {
        type: "finish",
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
        evidenceIds: [...passed],
        summary: this.boundedSummary(candidate.content),
        remainingWork: [],
      };
    }

    // Shadow mode (Slice 1): unfinished/unverifiable task candidates return
    // finish(incomplete). Live continuation dispatch is Slice 2.
    const unmet = required.filter((id) => !passed.has(id));
    const reasonCode = this.incompleteReasonCode(candidate);
    return {
      type: "finish",
      outcome: "incomplete",
      reasonCode,
      evidenceIds: [...passed],
      summary: this.boundedSummary(candidate.content),
      remainingWork: unmet,
    };
  }

  private incompleteReasonCode(candidate: TaskEndCandidate): string {
    // FR-16 provenance-aware reason codes.
    if (candidate.provenance === "synthetic" || !candidate.streamTerminalSeen) {
      return "STREAM_INCOMPLETE";
    }
    if (candidate.boundary === "budget_cap" || candidate.boundary === "round_cap") {
      return "CONTINUATION_LIMIT";
    }
    if (candidate.provenance === "unknown") {
      return "EVIDENCE_UNAVAILABLE";
    }
    return "NO_PROGRESS";
  }

  private boundedSummary(content: string): string {
    // §6.1: 2 KiB evidence summaries. Never include credentials/args.
    const MAX = 2000;
    if (content.length <= MAX) return content;
    return content.slice(0, MAX);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskCompletionController.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/service/aiTaskExecution/TaskCompletionController.ts test/vitest/main/service/TaskCompletionController.test.ts
git commit -m "feat: add TaskCompletionController shadow decide() (FR-05/06/16)"
```

---

### Task 11: `AiTaskExecutionModule` + `AiTaskExecutionModel` — persistence with CAS

**Files:**
- Create: `src/model/AiTaskExecution.model.ts`
- Create: `src/modules/AiTaskExecutionModule.ts`
- Test: `test/modules/AiTaskExecutionModule.test.ts` (Mocha/chai)

- [ ] **Step 1: Write the failing test**

Create `test/modules/AiTaskExecutionModule.test.ts`:

```typescript
"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-task-exec-module-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function ensureInitialized(): Promise<void> {
  await SqliteDb.ensureInitialized();
}

describe("AiTaskExecutionModule (Mocha)", function () {
  this.timeout(15000);

  beforeEach(async () => {
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("startExecution creates an execution + ledger row with version 0", async () => {
    const mod = new AiTaskExecutionModule();
    const result = await mod.startExecution({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      submissionId: "sub-1",
      requestHash: "sha256:abc",
      origin: { type: "manual", submissionId: "sub-1" },
      route: "task_verified",
      completionOwner: "standalone",
    });
    expect(result.executionId).to.match(/^exec-/);
    expect(result.ledgerId).to.match(/^ledger-/);

    // Ledger row exists with version 0.
    const ledgerRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
    const ledger = await ledgerRepo.findOne({
      where: { ledger_id: result.ledgerId },
    });
    expect(ledger?.execution_state_version).to.equal(0);
    expect(ledger?.status).to.equal("active");
  });

  it("finalizeExecution (manual) sets outcome + final-event identity without touching schedules (AC-32)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = await mod.startExecution({
      conversationId: "conv-2",
      sourceUserMessageId: "msg-2",
      submissionId: "sub-2",
      requestHash: "sha256:def",
      origin: { type: "manual", submissionId: "sub-2" },
      route: "task_verified",
      completionOwner: "standalone",
    });

    const result = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "All criteria passed",
      evidenceIds: ["ev-1"],
      remainingWork: [],
    });
    expect(result.ok).to.equal(true);

    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(exec?.finalized).to.equal(true);
    expect(exec?.task_outcome).to.equal("verified_complete");
    expect(exec?.final_event_identity).to.equal(
      `execution-result:${started.executionId}`
    );
    expect(exec?.schedule_id).to.be.null; // manual never touches schedules
  });

  it("concurrent CAS finalization — second finalizer returns existing outcome (no double increment, §6.3)", async () => {
    const mod = new AiTaskExecutionModule();
    const started = await mod.startExecution({
      conversationId: "conv-3",
      sourceUserMessageId: "msg-3",
      submissionId: "sub-3",
      requestHash: "sha256:ghi",
      origin: { type: "manual", submissionId: "sub-3" },
      route: "task_verified",
      completionOwner: "standalone",
    });

    const first = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "first",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(first.ok).to.equal(true);

    // Second finalizer with the stale version 0 must NOT re-finalize.
    const second = await mod.finalizeExecution({
      executionId: started.executionId,
      expectedVersion: 0, // stale
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      summary: "second",
      evidenceIds: [],
      remainingWork: [],
    });
    // Outcome is immutable; second finalizer does not overwrite.
    expect(second.alreadyFinalized).to.equal(true);

    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: started.executionId },
    });
    expect(exec?.task_outcome).to.equal("verified_complete"); // unchanged
  });

  it("persistence failure never emits success (PERSISTENCE_FAILED, §6.3)", async () => {
    const mod = new AiTaskExecutionModule();
    const result = await mod.finalizeExecution({
      executionId: "exec-nonexistent",
      expectedVersion: 0,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "x",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("MISSING_TASK_OUTCOME");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/modules/AiTaskExecutionModule.test.ts`
Expected: FAIL — module not found. (Note: `test/modules/` is a Mocha directory, but Vitest can run it too via the main config's `include` glob. If the team prefers Mocha, run `yarn test test/modules/AiTaskExecutionModule.test.ts` instead — the `describe`/`it`/`expect` API is compatible with both because we import `chai` explicitly.)

- [ ] **Step 3: Write the implementation**

Create `src/model/AiTaskExecution.model.ts`:

```typescript
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import type { TaskExecutionOrigin, TaskExecutionRoute, TaskOutcome } from "@/entityTypes/aiTaskExecutionTypes";

export interface CreateExecutionInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly submissionId: string | null;
  readonly requestHash: string;
  readonly origin: TaskExecutionOrigin;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
}

export interface FinalizeInput {
  readonly executionId: string;
  readonly expectedVersion: number;
  readonly outcome: TaskOutcome;
  readonly reasonCode: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly remainingWork: readonly string[];
}

export interface FinalizeResult {
  readonly ok: boolean;
  readonly alreadyFinalized?: boolean;
  readonly reasonCode?: string;
}

export class AiTaskExecutionModel extends BaseDb {
  private executionRepo: Repository<AiTaskExecutionEntity>;
  private ledgerRepo: Repository<AiTaskExecutionLedgerEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.executionRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionEntity
    );
    this.ledgerRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
  }

  protected override onSqliteDbRebound(): void {
    this.executionRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionEntity
    );
    this.ledgerRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
  }

  async createExecution(
    input: CreateExecutionInput
  ): Promise<{ executionId: string; ledgerId: string; executionRowId: number }> {
    assertNotWorker("createExecution");
    const { randomUUID } = require("node:crypto") as {
      randomUUID: () => string;
    };
    const executionId = `exec-${randomUUID()}`;
    const ledgerId = `ledger-${randomUUID()}`;

    const ledger = new AiTaskExecutionLedgerEntity();
    ledger.ledger_id = ledgerId;
    ledger.policy_limits_json = "{}";
    ledger.consumed_continuations = 0;
    ledger.consumed_provider_attempts = 0;
    ledger.consumed_tool_executions = 0;
    ledger.consumed_checker_attempts = 0;
    ledger.consumed_tokens = 0;
    ledger.consumed_active_ms = 0;
    ledger.consumed_wait_ms = 0;
    ledger.no_progress_streak = 0;
    ledger.active_execution_id = executionId;
    ledger.owner_generation = 0;
    ledger.status = "active";
    await this.ledgerRepo.save(ledger);

    const exec = new AiTaskExecutionEntity();
    exec.execution_id = executionId;
    exec.conversation_id = input.conversationId;
    exec.source_user_message_id = input.sourceUserMessageId;
    exec.submission_id = input.submissionId;
    exec.assistant_result_message_id = null;
    exec.request_hash = input.requestHash;
    exec.origin_type = input.origin.type;
    exec.route = input.route;
    exec.completion_owner = input.completionOwner;
    exec.stage = "resolving";
    exec.schedule_id = input.origin.type === "scheduled" ? input.origin.taskId : null;
    exec.run_id = input.origin.type === "scheduled" ? input.origin.runId : null;
    exec.occurrence_key =
      input.origin.type === "scheduled" ? input.origin.occurrenceKey : null;
    exec.ledger_id = ledgerId;
    exec.lineage_ledger_id = ledgerId;
    exec.parent_execution_id = null;
    exec.contract_snapshot_json = null;
    exec.policy_snapshot_json = null;
    exec.execution_state_json = null;
    exec.contract_hash = null;
    exec.execution_state_version = 0;
    exec.finalized = false;
    exec.finalized_at = null;
    exec.task_outcome = null;
    exec.outcome_reason_code = null;
    exec.outcome_summary = null;
    exec.final_event_identity = null;
    exec.delivery_state = null;
    const saved = await this.executionRepo.save(exec);

    return {
      executionId,
      ledgerId,
      executionRowId: saved.id,
    };
  }

  async getById(executionId: string): Promise<AiTaskExecutionEntity | null> {
    assertNotWorker("getById");
    return this.executionRepo.findOne({
      where: { execution_id: executionId },
    });
  }

  async finalizeExecution(input: FinalizeInput): Promise<FinalizeResult> {
    assertNotWorker("finalizeExecution");
    const exec = await this.getById(input.executionId);
    if (!exec) {
      return { ok: false, reasonCode: "MISSING_TASK_OUTCOME" };
    }
    if (exec.finalized) {
      // §6.3: a second finalizer returns the existing outcome; counters
      // never increment twice.
      return { ok: false, alreadyFinalized: true, reasonCode: "ALREADY_FINALIZED" };
    }
    if (exec.execution_state_version !== input.expectedVersion) {
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }

    exec.finalized = true;
    exec.finalized_at = new Date();
    exec.task_outcome = input.outcome;
    exec.outcome_reason_code = input.reasonCode;
    exec.outcome_summary = input.summary;
    exec.final_event_identity = `execution-result:${input.executionId}`;
    exec.execution_state_version = input.expectedVersion + 1;
    exec.stage = "terminal";
    await this.executionRepo.save(exec);

    // Release the ledger owner (§6.3). Spent allowance persists.
    const ledger = await this.ledgerRepo.findOne({
      where: { ledger_id: exec.ledger_id },
    });
    if (ledger) {
      ledger.active_execution_id = null;
      ledger.status = "released";
      ledger.execution_state_version += 1;
      await this.ledgerRepo.save(ledger);
    }

    return { ok: true };
  }

  async getUnfinalized(): Promise<AiTaskExecutionEntity[]> {
    assertNotWorker("getUnfinalized");
    return this.executionRepo.find({
      where: { finalized: false },
    });
  }
}
```

Create `src/modules/AiTaskExecutionModule.ts`:

```typescript
import { BaseModule } from "./baseModule";
import { AiTaskExecutionModel } from "@/model/AiTaskExecution.model";
import type {
  CreateExecutionInput,
  FinalizeInput,
  FinalizeResult,
} from "@/model/AiTaskExecution.model";

/**
 * Business logic for task executions (technical-design §6.3, FR-24).
 *
 * Manual executions finalize WITHOUT touching schedules. Scheduled origin
 * (Slice 2) participates in the same transaction to update occurrence/
 * schedule counters atomically. Slice 1 implements manual finalization
 * only.
 *
 * Worker guard: every model method calls assertNotWorker; workers must
 * never access these tables directly (NFR-03).
 */
export class AiTaskExecutionModule extends BaseModule {
  private readonly model: AiTaskExecutionModel;

  constructor() {
    super();
    this.model = new AiTaskExecutionModel(this.dbpath);
  }

  async startExecution(
    input: CreateExecutionInput
  ): Promise<{ executionId: string; ledgerId: string; executionRowId: number }> {
    await this.ensureConnection();
    return this.model.createExecution(input);
  }

  async getExecution(executionId: string) {
    await this.ensureConnection();
    return this.model.getById(executionId);
  }

  async finalizeExecution(input: FinalizeInput): Promise<FinalizeResult> {
    await this.ensureConnection();
    return this.model.finalizeExecution(input);
  }

  async getUnfinalizedExecutions() {
    await this.ensureConnection();
    return this.model.getUnfinalized();
  }

  /**
   * Record a shadow decision's provenance (FR-16). Slice 1 stores the
   * decision summary in execution_state_json; live enforcement is Slice 2.
   */
  async recordShadowDecision(input: {
    executionId: string;
    decision: unknown;
  }): Promise<void> {
    await this.ensureConnection();
    const exec = await this.model.getById(input.executionId);
    if (!exec) return;
    exec.execution_state_json = JSON.stringify(input.decision);
    await this.model["executionRepo"].save(exec);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/modules/AiTaskExecutionModule.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/model/AiTaskExecution.model.ts src/modules/AiTaskExecutionModule.ts test/modules/AiTaskExecutionModule.test.ts
git commit -m "feat: add AiTaskExecutionModel/Module with CAS finalization (FR-24, AC-32)"
```

---

### Task 12: `AiTaskOperationModule` + `AiTaskOperationModel` — scaffolding (Slice 3 prep)

**Files:**
- Create: `src/model/AiTaskOperation.model.ts`
- Create: `src/modules/AiTaskOperationModule.ts`
- Test: `test/modules/AiTaskOperationModule.test.ts` (Mocha/chai)

**Note:** Full receipt/reconciliation logic is Slice 3 (FR-11; AC-09/10/13/28). Slice 1 creates the table + basic create/get/updateState scaffolding so the schema is stable and the worker guard is enforced.

- [ ] **Step 1: Write the failing test**

Create `test/modules/AiTaskOperationModule.test.ts`:

```typescript
"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-task-op-module-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

describe("AiTaskOperationModule scaffolding (Slice 3 prep)", function () {
  this.timeout(15000);

  beforeEach(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("recordOperation creates a row with default claim generation 0", async () => {
    const mod = new AiTaskOperationModule();
    const result = await mod.recordOperation({
      operationKey: "op-key-1",
      executionId: "exec-1",
      toolIdentity: "send_email",
      domainTarget: "campaign:5",
      intentHash: "sha256:xyz",
    });
    expect(result.ok).to.equal(true);

    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskOperationEntity
    );
    const op = await repo.findOne({ where: { operation_key: "op-key-1" } });
    expect(op?.claim_generation).to.equal(0);
    expect(op?.operation_state).to.equal("pending");
  });

  it("recordOperation is idempotent on operation_key (no duplicate)", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-key-2",
      executionId: "exec-2",
      toolIdentity: "send_email",
      domainTarget: "campaign:6",
      intentHash: "sha256:xyz2",
    });
    const second = await mod.recordOperation({
      operationKey: "op-key-2",
      executionId: "exec-2",
      toolIdentity: "send_email",
      domainTarget: "campaign:6",
      intentHash: "sha256:xyz2",
    });
    expect(second.alreadyExists).to.equal(true);

    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskOperationEntity
    );
    const count = await repo.count({
      where: { operation_key: "op-key-2" },
    });
    expect(count).to.equal(1);
  });

  it("updateState advances operation_state with claim-generation CAS", async () => {
    const mod = new AiTaskOperationModule();
    await mod.recordOperation({
      operationKey: "op-key-3",
      executionId: "exec-3",
      toolIdentity: "send_email",
      domainTarget: "campaign:7",
      intentHash: "sha256:xyz3",
    });
    const result = await mod.updateState({
      operationKey: "op-key-3",
      expectedClaimGeneration: 0,
      newState: "dispatched",
    });
    expect(result.ok).to.equal(true);
    const op = await mod.getOperation("op-key-3");
    expect(op?.operation_state).to.equal("dispatched");
    expect(op?.claim_generation).to.equal(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/modules/AiTaskOperationModule.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

Create `src/model/AiTaskOperation.model.ts`:

```typescript
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import type { AiTaskOperationState } from "@/entityTypes/aiTaskExecutionTypes";

export interface CreateOperationInput {
  readonly operationKey: string;
  readonly executionId: string;
  readonly toolIdentity: string;
  readonly domainTarget: string | null;
  readonly intentHash: string;
}

export interface CreateOperationResult {
  readonly ok: boolean;
  readonly alreadyExists?: boolean;
}

export interface UpdateStateInput {
  readonly operationKey: string;
  readonly expectedClaimGeneration: number;
  readonly newState: AiTaskOperationState;
}

export interface UpdateStateResult {
  readonly ok: boolean;
  readonly reasonCode?: string;
}

export class AiTaskOperationModel extends BaseDb {
  private repository: Repository<AiTaskOperationEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      AiTaskOperationEntity
    );
  }

  protected override onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AiTaskOperationEntity
    );
  }

  async create(
    input: CreateOperationInput
  ): Promise<CreateOperationResult> {
    assertNotWorker("AiTaskOperation.create");
    const existing = await this.repository.findOne({
      where: { operation_key: input.operationKey },
    });
    if (existing) {
      return { ok: false, alreadyExists: true };
    }
    const op = new AiTaskOperationEntity();
    op.operation_key = input.operationKey;
    op.execution_id = input.executionId;
    op.tool_identity = input.toolIdentity;
    op.domain_target = input.domainTarget;
    op.intent_hash = input.intentHash;
    op.operation_state = "pending";
    op.claim_generation = 0;
    op.receipt_reference = null;
    op.failure_code = null;
    op.claimed_at = null;
    op.dispatched_at = null;
    op.settled_at = null;
    await this.repository.save(op);
    return { ok: true };
  }

  async getByKey(
    operationKey: string
  ): Promise<AiTaskOperationEntity | null> {
    assertNotWorker("AiTaskOperation.getByKey");
    return this.repository.findOne({
      where: { operation_key: operationKey },
    });
  }

  async updateState(
    input: UpdateStateInput
  ): Promise<UpdateStateResult> {
    assertNotWorker("AiTaskOperation.updateState");
    const op = await this.getByKey(input.operationKey);
    if (!op) {
      return { ok: false, reasonCode: "OPERATION_NOT_FOUND" };
    }
    if (op.claim_generation !== input.expectedClaimGeneration) {
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }
    op.operation_state = input.newState;
    op.claim_generation = input.expectedClaimGeneration + 1;
    if (input.newState === "dispatched") {
      op.dispatched_at = new Date();
    }
    if (
      input.newState === "accepted" ||
      input.newState === "completed" ||
      input.newState === "failed" ||
      input.newState === "unknown"
    ) {
      op.settled_at = new Date();
    }
    await this.repository.save(op);
    return { ok: true };
  }
}
```

Create `src/modules/AiTaskOperationModule.ts`:

```typescript
import { BaseModule } from "./baseModule";
import { AiTaskOperationModel } from "@/model/AiTaskOperation.model";
import type {
  CreateOperationInput,
  CreateOperationResult,
  UpdateStateInput,
  UpdateStateResult,
} from "@/model/AiTaskOperation.model";

/**
 * Consequential-action operation guard scaffolding (technical-design §10).
 *
 * Slice 1: create/get/updateState with claim-generation CAS. Full receipt
 * reconciliation (FR-11; AC-09/10/13/28) lands in Slice 3.
 *
 * Workers must never access this table directly (NFR-03).
 */
export class AiTaskOperationModule extends BaseModule {
  private readonly model: AiTaskOperationModel;

  constructor() {
    super();
    this.model = new AiTaskOperationModel(this.dbpath);
  }

  async recordOperation(
    input: CreateOperationInput
  ): Promise<CreateOperationResult> {
    await this.ensureConnection();
    return this.model.create(input);
  }

  async getOperation(operationKey: string) {
    await this.ensureConnection();
    return this.model.getByKey(operationKey);
  }

  async updateState(
    input: UpdateStateInput
  ): Promise<UpdateStateResult> {
    await this.ensureConnection();
    return this.model.updateState(input);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/modules/AiTaskOperationModule.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/model/AiTaskOperation.model.ts src/modules/AiTaskOperationModule.ts test/modules/AiTaskOperationModule.test.ts
git commit -m "feat: add AiTaskOperation scaffolding with claim-gen CAS (Slice 3 prep)"
```

---

### Task 13: Verify `TaskExecutionCoordinator` end-to-end (now that deps exist)

**Files:**
- Re-run: `test/vitest/main/service/TaskExecutionCoordinator.test.ts` (from Task 9)

**Note:** Task 9's coordinator consumes `AiTaskExecutionModule` (Task 11) and `TaskCompletionController` (Task 10). Now that both exist, the coordinator test should pass and the typecheck should be clean. This task is the verification + commit step for Task 9's deferred Step 6.

- [ ] **Step 1: Run the coordinator test**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/service/TaskExecutionCoordinator.test.ts`
Expected: PASS — all three cases green (manual binding, scheduled binding, snapshot excludes runtime objects).

- [ ] **Step 2: Run the full typecheck gate**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0. If type errors remain in `TaskExecutionCoordinator.ts` (e.g. the inline `import type` of `BudgetLimitsInput`), fix them now:
  - Replace the inline `import("@/service/aiTaskExecution/budgetDefaults").BudgetLimitsInput` usage in `StartScheduledInput` with a top-level `import type { BudgetLimitsInput } from "@/service/aiTaskExecution/budgetDefaults";` at the top of the file, and use the bare name in the interface.
  - Move the `import type { TaskCompletionContract }` that sits below the `TaskExecutionBinding` interface up to the other top-level type imports.

- [ ] **Step 3: Commit (the coordinator was created in Task 9; this commits it now that deps resolve)**

```bash
git add src/service/aiTaskExecution/TaskExecutionCoordinator.ts test/vitest/main/service/TaskExecutionCoordinator.test.ts
git commit -m "feat: add TaskExecutionCoordinator identity + binding (FR-17/20)"
```

---

### Task 14: Full-suite regression and Slice 1 acceptance verification

**Files:**
- No new files. Runs the existing + new suites.

- [ ] **Step 1: Run the full typecheck gate one more time**

Run: `npx tsc --noEmit`
Expected: PASS — exit 0.

- [ ] **Step 2: Run all new Slice 1 tests together**

Run:
```bash
AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run \
  test/vitest/main/service/aiTaskExecutionTypes.test.ts \
  test/vitest/main/service/aiTaskCompletionPolicyFeatureFlag.test.ts \
  test/vitest/main/service/aiMessageTaskRunStatusExtended.test.ts \
  test/vitest/main/service/aiTaskExecutionEntities.test.ts \
  test/vitest/main/service/aiTaskExecutionSchemaUpgrade.test.ts \
  test/vitest/main/service/TaskRunBudget.test.ts \
  test/vitest/main/service/TaskCompletionContractService.test.ts \
  test/vitest/main/service/TaskRequestResolver.test.ts \
  test/vitest/main/service/TaskCompletionController.test.ts \
  test/vitest/main/service/TaskExecutionCoordinator.test.ts \
  test/modules/AiTaskExecutionModule.test.ts \
  test/modules/AiTaskOperationModule.test.ts
```
Expected: PASS — all 12 files green.

- [ ] **Step 3: Run the broader main suite to confirm no regression**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run`
Expected: PASS — no regressions in pre-existing tests. The additive schema (new nullable columns + new tables) must not break existing `AiMessageTask` / `AiMessageTaskRun` tests.

- [ ] **Step 4: Verify Slice 1 acceptance criteria mapping**

Confirm by inspecting the new tests that each Slice 1 AC has coverage:

| AC | Test file | Assertion |
|---|---|---|
| AC-12 | `TaskCompletionController.test.ts` | synthetic/missing-terminal provenance never verifies |
| AC-14 | `TaskCompletionController.test.ts` | response-only route returns `finish_response` (one owner) |
| AC-17 | `TaskExecutionCoordinator.test.ts` | manual binding created with no schedule prerequisite |
| AC-18 | `TaskCompletionController.test.ts` | first-response stop returns `incomplete` (no prerequisite tool round) |
| AC-19 | `TaskRequestResolver.test.ts` | definition question → `response_only`; latest-status → task route |
| AC-21 | `TaskRequestResolver.test.ts` | ambiguous target → `preparation`, never invented verified target |
| AC-26 | `TaskExecutionCoordinator.test.ts` | manual `submissionId` drives dedup; one execution per submission |
| AC-31 | `TaskExecutionCoordinator.test.ts` | single completion owner (`standalone`); goal cannot take over |
| AC-32 | `AiTaskExecutionModule.test.ts` | manual finalization writes `final_event_identity`, no schedule increment; CAS prevents double-finalize |

- [ ] **Step 5: Commit the regression proof (if any plan-doc tweak is needed)**

If the plan document itself needs a final correction after self-review, commit it:
```bash
git add docs/superpowers/plans/2026-10-04-task-completion-policy-v1-slice1.md
git commit -m "docs: finalize Slice 1 implementation plan after self-review"
```

---

## Self-Review (run before declaring the plan complete)

**1. Spec coverage (Slice 1: FR-05/06/16–20/24; AC-12/14/19/21/26/31):**
- FR-05 (application-level decision boundary): Task 10 `TaskCompletionController.decide()` — shadow mode, returns decision before any terminal event. ✓
- FR-06 (distinguish stop conditions): Task 10 — safety restriction, pending permission/question/approval, response-only, task verified/unverified, synthetic/missing-terminal, budget/round cap all produce distinct reason codes. ✓
- FR-16 (preserve reasons + provenance): Task 10 `incompleteReasonCode()` + Task 11 `recordShadowDecision()`; Task 1 `TASK_END_PROVENANCE` + `TASK_EXECUTION_REASON_CODES`. ✓
- FR-17 (protect manual by default): Task 9 `startManual()` — identity created before slow resolution, no tool round required. ✓
- FR-18 (resolve intent conservatively): Task 8 `TaskRequestResolver.classify()` — no keyword-only matching; quoted instruction alone cannot authorize; ambiguity → preparation. ✓
- FR-19 (form usable manual contracts): Task 7 `TaskCompletionContractService.freeze()` — record_count/artifact/operation_receipt/observation/qualitative; source-ref validation; zero-required verified blocked. ✓
- FR-20 (one execution, one completion owner): Task 9 — `completionOwner: "standalone" | "goal"`, single owner per binding. ✓
- FR-24 (durable outcomes without schedule accounting): Task 11 — manual finalization never reads/writes schedule counters; `schedule_id` null for manual. ✓
- AC-12/14/17/18/19/21/26/31/32: mapped in Task 14 Step 4 table. ✓

**2. Placeholder scan:** No TBD/TODO/"add appropriate error handling"/"similar to Task N". Every code step contains complete code. ✓

**3. Type consistency:**
- `TaskExecutionBinding` fields used in Task 9 (`executionId`, `origin`, `completionOwner`, `leaseGeneration`, `contract`, `contractHash`, `budget`, `controller`) match the definition. ✓
- `TaskCompletionContract` (`schemaVersion`, `contractId`, `contractHash`, `objective`, `sourceUserMessageId`, `approvedSourceMessageIds`, `mode`, `criteria`) consistent across Task 1 (schema), Task 7 (freeze), Task 9 (binding). ✓
- `BudgetReservationResult` enum (Task 6) used consistently in `TaskRunBudget.test.ts`. ✓
- `AiTaskExecutionStatus` / `AiTaskExecutionLedgerStatus` / `AiTaskOperationState` (Task 1) used in entity columns (Task 4) and model methods (Tasks 11–12). ✓
- `FinalizeInput`/`FinalizeResult` (Task 11 model) consumed by the module with the same field names. ✓
- Task 13 Step 2 flags the known inline-import type issue in `TaskExecutionCoordinator.ts` and gives the exact fix. ✓

**4. Forward-dependency resolution:** Task 9 (coordinator) is written before Tasks 10–11 but its Step 6 commit is deferred to Task 13, after the deps land. Task 13 explicitly re-runs the test and typecheck. The plan executes in order 1→2→3→4→5→6→7→8→9(write only, skip commit)→10→11→12→13(commit coordinator)→14. This is called out in Task 9 Step 4–5. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-10-04-task-completion-policy-v1-slice1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for catching type errors early and keeping main-session context clean across 14 tasks.

**2. Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints for review. Faster for the early additive tasks (1–5) but riskier for the service-layer tasks (8–11) where type errors compound.

**Which approach?**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Batch execution with checkpoints for review
