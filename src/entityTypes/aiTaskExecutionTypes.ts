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

// ----- §6.1 Finalization checkpoint (T20, FR-03/09/10/24) -----

/**
 * Bounded schema for the finalization checkpoint merged into
 * `execution_state_json` at finalize time (T20). The finalizer must MERGE
 * these fields into the EXISTING state object — never replace it — so
 * evidence rows (key `evidence`), shadow decisions (key `shadowDecision`),
 * and any other per-run state accumulated during the run survive
 * finalization (FR-03/24: baselines and source evidence are retained
 * terminal/Continue).
 *
 * `finalization` is the merged-in key. Its schema is intentionally narrow:
 * only the caller-supplied finalization facts (outcome, reason, evidence/
 * remaining-work summaries, linked result message, timestamp). Unknown extra
 * keys on a persisted object are stripped by `.parse()` on read; the merge in
 * the model preserves them in the written form regardless.
 */
export const taskFinalizationCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: taskOutcomeSchema,
  reasonCode: z.string().min(1).max(120),
  evidenceIds: z.array(z.string().min(1).max(200)),
  remainingWork: z.array(z.string().min(1).max(400)),
  assistantResultMessageId: z.string().min(1).max(200).nullable(),
  finalizedAt: z.string().min(1).max(60),
});
export type TaskFinalizationCheckpoint = z.infer<
  typeof taskFinalizationCheckpointSchema
>;

/**
 * Merge the caller's finalization facts under the `finalization` key with
 * defensive truncation so a hostile/oversized input can never write an
 * unbounded checkpoint (T20 bounded schema). Pure function — used by both
 * `finalizeExecution` and `finalizeScheduledExecution` so manual and
 * scheduled paths share one merge/validate implementation.
 */
export function buildFinalizationCheckpointFields(input: {
  readonly outcome: TaskOutcome;
  readonly reasonCode: string;
  readonly evidenceIds: readonly string[];
  readonly remainingWork: readonly string[];
  readonly assistantResultMessageId?: string | null;
  readonly finalizedAt: string;
}): TaskFinalizationCheckpoint {
  const safeReasonCode = input.reasonCode.slice(0, 120);
  return {
    schemaVersion: 1,
    outcome: taskOutcomeSchema.parse(input.outcome),
    reasonCode: safeReasonCode.length > 0 ? safeReasonCode : "UNKNOWN",
    evidenceIds: input.evidenceIds
      .filter((id) => id.length > 0)
      .map((id) => id.slice(0, 200)),
    remainingWork: input.remainingWork
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.slice(0, 400)),
    assistantResultMessageId: input.assistantResultMessageId
      ? input.assistantResultMessageId.slice(0, 200)
      : null,
    finalizedAt: input.finalizedAt.slice(0, 60),
  };
}

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
    // §9.4 occurrence key. Capped at 160 to match the AiTaskExecution.entity.ts
    // occurrence_key column (length: 160); a 200-char key would pass Zod but
    // fail the SQLite INSERT. See entity column for the authoritative bound.
    occurrenceKey: z.string().min(1).max(160),
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

/**
 * Renderer-facing task execution state pushed via the `task_execution_state`
 * stream chunk (PRD FR-13: show checking-completion and continuing-work
 * states). Mirrors `ChatV2GoalStateEvent`: all fields readonly, main-process
 * authoritative, renderer display only. `executionId` lets the renderer wire
 * Continue/Retry to the parent execution (PRD FR-14).
 */
export interface ChatV2TaskExecutionStateEvent {
  readonly executionId: string;
  readonly conversationId: string;
  readonly status: AiTaskExecutionStatus;
  /** Terminal reason code (TASK_EXECUTION_REASON_CODES) when status is terminal. */
  readonly reasonCode?: string;
  /** Honest outcome (TaskOutcome) when finalized. */
  readonly outcome?: TaskOutcome;
  /** Human-readable remaining work / blocker summary (PRD FR-13). */
  readonly remainingWork?: string;
}

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
  "AUTH_FAILURE",
  "QUOTA_EXHAUSTED",
  "NON_RECOVERABLE",
  "PROVIDER_ERROR",
  "REMOTE_AI_ERROR",
  "RUN_INTERRUPTED",
  "BLOCKED_BY_POLICY",
  "STREAM_INCOMPLETE",
  "OUTPUT_TRUNCATED",
  "PERSISTENCE_FAILED",
  "STATE_CONFLICT",
  "MISSING_TASK_OUTCOME",
  "SUBMISSION_CONFLICT",
  "ALREADY_FINALIZED",
  "OPERATION_NOT_FOUND",
  "INTENT_CONFLICT",
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

// Provenance (FR-16): the four provenance values are defined inline on
// `taskEndCandidateSchema.provenance` (z.enum) above. There is no separate
// exported const — a duplicate `TASK_END_PROVENANCE` array existed only to
// shadow the schema enum and was never imported anywhere. Read provenance
// from the schema (the single source of truth) or via z.infer on
// `taskEndCandidateSchema`.
