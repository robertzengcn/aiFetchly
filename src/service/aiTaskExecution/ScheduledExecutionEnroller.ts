/**
 * Scheduled enrollment helper (T02, FR-02/05/07/12/20, AC-01-05/17/30/32).
 *
 * Extracts the scheduled-path enrollment seam out of `ScheduledAiMessageRunner`
 * so the same trusted decision boundary as manual runs runs BEFORE the engine
 * dispatches the occurrence:
 *
 *   TaskRequestResolver.classify → TaskCriteriaResolver.compileCriteria →
 *   TaskCompletionContractService.freeze → TaskExecutionCoordinator.startScheduled
 *   → build LoopTaskExecutionBinding (executionKind: "scheduled") +
 *   ScheduledLoopPolicyBinding (with getDecision + evidenceService).
 *
 * Why a helper: the runner is ~1600 lines; the enrollment block grew by ~80
 * lines when T02 added criteria compile + contract freeze + evidence service +
 * loop binding. Extracting keeps the runner focused on run orchestration and
 * makes the enrollment seam unit-testable without mocking the entire runner.
 *
 * The helper mirrors the manual seam at `AIChatQueryEngine.ts:1333-1584`
 * field-for-field, with two scheduled-specific deltas:
 *   - `executionKind: "scheduled"` on the loop binding (D2 — the engine's
 *     manual finalization gate no-ops for scheduled; the runner's
 *     `finalizeScheduledPolicyRun` owns finalization, preventing
 *     double-finalize).
 *   - `getDecision` + `evidenceService` + `evidenceContext` on the policy
 *     binding (D3 — the sink's `complete`-event consult reads the slot the
 *     loop's in-loop consult populated, so it does NOT re-consult blind and
 *     overwrite a real `verified_complete` with `incomplete`).
 *
 * Flag-off: the runner's `isAiTaskCompletionPolicyV1Enabled()` guard skips
 * this helper entirely — the file is never imported at runtime when the flag
 * is off (only imported inside the flag-gated block), so behavior is
 * byte-identical to pre-T02.
 *
 * Slice 2 shadow mode: `task_verified` is unreachable here (no approved-task
 * template signal — T15 wires that). The helper compiles criteria for
 * `task_best_effort` only; `response_only`/`preparation` skip enrollment
 * (the scheduled task message is not actionable).
 */
import type {
  TaskCompletionContract,
  TaskCompletionDecision,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";
import { TaskRequestResolver } from "@/service/aiTaskExecution/TaskRequestResolver";
import { compileCriteria } from "@/service/aiTaskExecution/TaskCriteriaResolver";
import {
  TaskExecutionCoordinator,
  type StartScheduledInput,
} from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import {
  TaskEvidenceService,
  makeModuleBackedStore,
} from "@/service/aiTaskExecution/TaskEvidenceService";
import {
  buildEvidenceService,
  makeNativeSendStatusReader,
} from "@/service/aiTaskExecution/EvidenceProviderFactory";
import { snapshotArtifactBaselines } from "@/service/aiTaskExecution/criteriaAdapters";
import { TaskProgressTracker } from "@/service/aiTaskExecution/TaskProgressTracker";
import type { LoopTaskExecutionBinding } from "@/service/aiTaskExecution/TaskLoopConsult";
import { makeTrackedPersistBudget } from "@/service/aiTaskExecution/TaskLoopConsult";
import type { ScheduledLoopPolicyBinding } from "@/service/ScheduledLoopEventSink";
import type { BudgetLimitsInput } from "@/service/aiTaskExecution/budgetDefaults";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { SearchModule } from "@/modules/SearchModule";
import { contactInfoRepository } from "@/model/ContactInfo.model";
import { hashUserAuthoredText } from "@/service/outboundEmail/OutboundEmailIntentResolver";

/** Input to {@link enrollScheduledExecution}. Mirrors `StartScheduledInput`. */
export interface EnrollScheduledInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly taskMessage: string;
  readonly taskId: number;
  readonly runId: number;
  readonly scheduleId: number;
  readonly occurrence: number;
  readonly occurrenceKey: string;
  readonly idempotencyKey?: string;
  readonly budgetLimits: BudgetLimitsInput;
  /**
   * T04 (NFR-02/04, AC-24): the run-scoped abort signal source. The runner
   * creates its `abortController` BEFORE enrollment and passes
   * `() => abortController.signal` here so the consult closure can thread the
   * signal into the checker dispatch (Stop / run-cancel propagates to the
   * transport; §9 line 445: a hanging request cannot hold the gate).
   */
  readonly getAbortSignal?: () => AbortSignal | undefined;
}

/**
 * The shared decision slot. Both the loop binding's `recordDecision` closure
 * and the policy binding's `getDecision` closure capture the SAME mutable
 * slot, so the sink's consult reads what the loop's in-loop consult recorded
 * (no double-consult — see D3).
 */
interface DecisionSlot {
  get: () => TaskCompletionDecision | null;
  set: (decision: TaskCompletionDecision | null) => void;
}

function createDecisionSlot(): DecisionSlot {
  let recorded: TaskCompletionDecision | null = null;
  return {
    get: () => recorded,
    set: (decision) => {
      recorded = decision;
    },
  };
}

export type EnrollScheduledStatus =
  | "created"
  | "reused"
  | "conflict"
  | "denied"
  | "skipped";

export interface EnrollScheduledResult {
  readonly status: EnrollScheduledStatus;
  /**
   * Present only on `created`. The loop binding to pass into
   * `engine.submitMessage({taskExecutionBinding})` so the engine's loop
   * consults at round_cap/response_end for scheduled turns (same-occurrence
   * continuation, FR-05/07). Carries `executionKind: "scheduled"`.
   */
  readonly loopBinding?: LoopTaskExecutionBinding;
  /**
   * Present only on `created`. The policy binding to pass into the
   * `ScheduledLoopEventSink` constructor. Carries `getDecision` +
   * `evidenceService` + `evidenceContext` so the sink's consult reads the
   * slot first and falls back with evidence (D3).
   */
  readonly policyBinding?: ScheduledLoopPolicyBinding;
  /**
   * Present only on `created`. Snapshot for the runner's
   * `finalizeScheduledPolicyRun` to CAS-finalize the execution row after the
   * turn ends.
   */
  readonly policyExecution?: {
    readonly executionId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  };
  /** Present only on `skipped`. The non-actionable route the resolver returned. */
  readonly skipReason?: "response_only" | "preparation";
}

/**
 * Enroll a scheduled occurrence into the completion policy. Pure
 * orchestration — no side effects beyond the `startScheduled` DB write and
 * the `freezeContract` validation. Returns the bindings the runner wires into
 * the engine + sink, or a `skipped`/`reused`/`conflict`/`denied` status the
 * runner handles as before.
 *
 * Controlled degradation (NFR-12): if `compileCriteria` or `freezeContract`
 * throws, the helper still enrolls with `contract: null` — identity is
 * registered (Stop works), but the null contract means the controller can
 * never verify (no required criteria → never `verified_complete`). This is a
 * controlled non-success, not a silent legacy fallback.
 */
export async function enrollScheduledExecution(
  input: EnrollScheduledInput
): Promise<EnrollScheduledResult> {
  // D5: same upstream decision boundary as manual. The resolver classifies
  // the task message; `response_only`/`preparation` are not actionable and
  // skip enrollment (the run is marked blocked by the caller).
  const route: TaskExecutionRoute = new TaskRequestResolver().classify({
    userMessage: input.taskMessage || "",
    hasApprovedTaskTemplate: false,
  });
  if (route === "response_only" || route === "preparation") {
    return { status: "skipped", skipReason: route };
  }

  // T02 (FR-19): derive real criteria from the task message, then freeze a
  // source-anchored contract before startScheduled dispatches (FR-01). Same
  // structural compiler as the manual seam — no LLM, no authorization
  // broadening. Wrap in try/catch: on failure, fall through with
  // contract=null (controlled degradation, NFR-12).
  const coordinator = new TaskExecutionCoordinator();
  const sourceUserMessageId = input.sourceUserMessageId;
  let contract: TaskCompletionContract | null = null;
  try {
    const compiled = compileCriteria({
      userMessage: input.taskMessage || "",
      sourceUserMessageId,
      route,
      approvedSourceMessageIds: [sourceUserMessageId],
    });
    contract = coordinator.freezeContract({
      objective: input.taskMessage.slice(0, 20000) || "Scheduled task",
      sourceUserMessageId,
      approvedSourceMessageIds: [sourceUserMessageId],
      approvedSourceContents: {
        [sourceUserMessageId]: input.taskMessage || "",
      },
      // task_verified is unreachable in T02 (no approved-task template —
      // T15 wires that). Best-effort is the only actionable route here.
      mode: "best_effort",
      criteria: compiled.criteria,
    });
    if (compiled.ambiguityReason) {
      console.log(
        `[scheduled-enroller] task criteria ambiguous (execution scope unstructured): ${compiled.ambiguityReason}`
      );
    }
  } catch (compileErr) {
    // NFR-12: contract-generation failure must not bypass enrollment. Fall
    // through with contract=null — startScheduled still runs (identity
    // registered, Stop available), but the null contract means the controller
    // can never verify. Controlled non-success, not a silent legacy fallback.
    console.error(
      "[scheduled-enroller] task criteria compilation failed:",
      compileErr
    );
    contract = null;
  }

  const startInput: StartScheduledInput = {
    conversationId: input.conversationId,
    sourceUserMessageId,
    requestHash: hashUserAuthoredText(input.taskMessage || ""),
    route,
    taskId: input.taskId,
    runId: input.runId,
    occurrenceKey: input.occurrenceKey,
    budgetLimits: input.budgetLimits,
    contract,
  };
  const startResult = await coordinator.startScheduled(startInput);

  if (startResult.status !== "created") {
    // `reused` / `conflict` / `denied` — the runner handles these as before
    // (transport retry / conflict / denied). No bindings to build.
    return { status: startResult.status };
  }

  const created = startResult.binding;
  const slot = createDecisionSlot();

  // Evidence service (T03, FR-03/04/24, AC-03/04/32): build the
  // authoritative evidence stack — module-backed store whose
  // `mergeEvidenceCas` calls `AiTaskExecutionModel.
  // applyShadowDecisionCas`, provider-backed observation /
  // operation-receipt / record-count lookups, and a bounded tool-free
  // checker dispatch — via the shared factory (same construction as the
  // manual seam in AIChatQueryEngine). The consult closures read
  // `expectedStateVersion` fresh per consult so evidence writes persist
  // (AC-32). Constructed lazily here (BaseModule TDZ — never at module
  // top level).
  const execModule = new AiTaskExecutionModule();
  const {
    evidenceService,
    checkerDispatch,
    observationProvider,
    operationReceiptProvider,
    artifactBaseDir,
  } = buildEvidenceService({
    executionId: created.executionId,
    execModule,
    operationModule: new AiTaskOperationModule(),
    searchModule: new SearchModule(),
    contactInfoRepository,
    deliveryStatusReader: makeNativeSendStatusReader(),
  });

  // B13c (FR-08/23, AC-08/27/29): tracked durable-spend persister shared by
  // the loop binding (all dispatch sites) and the evidence context's
  // checker-spend hook, so one flush barrier covers every fire-and-forget
  // persist this execution fires.
  const budgetPersists = makeTrackedPersistBudget((delta) =>
    execModule.persistBudgetConsumption({
      ledgerId: created.ledgerId,
      expectedOwnerGeneration: created.leaseGeneration,
      activeExecutionId: created.executionId,
      delta,
    })
  );

  // FR-09 / §7.2 step 7: one tracker per execution, closing over the SAME
  // budget the controller consults, so the streak the tracker increments is
  // the streak the controller's continue-branch gate reads.
  const progressTracker = new TaskProgressTracker({
    budget: created.budget,
    persistBudgetSpending: budgetPersists.persistBudget,
  });

  // B21 (FR-02/03/19): capture pre-action artifact baselines at enrollment —
  // after the contract froze, before the maker dispatches. The adapter
  // compares `changed` expectations against this map; files created by the
  // run itself simply have no baseline and stay honestly unknown.
  const artifactBaselines = await snapshotArtifactBaselines(
    artifactBaseDir ?? undefined,
    created.contract?.criteria ?? []
  );

  // D2: executionKind "scheduled" — the engine's manual finalization gate
  // no-ops for this binding; the runner's finalizeScheduledPolicyRun owns
  // finalization (prevents double-finalize).
  const loopBinding: LoopTaskExecutionBinding = {
    executionId: created.executionId,
    executionKind: "scheduled",
    policyAccepted: true,
    // T04 (NFR-02/04, AC-24): the run-scoped abort signal — the consult
    // closure reads it fresh so the checker dispatch races Stop / run-cancel
    // + a deadline (§9: a hanging request cannot hold the gate).
    getAbortSignal: input.getAbortSignal,
    consult: async (candidate) => {
      // T03: read the CAS token fresh per consult so evidence writes persist
      // (AC-32). A frozen version would mismatch the moment any prior consult
      // bumped the row.
      const exec = await execModule.getExecution(created.executionId);
      const expectedStateVersion = exec?.execution_state_version;
      return created.controller.decide(candidate, {
        route: created.route,
        contract: created.contract ?? undefined,
        evidenceService,
        evidenceContext: {
          content: candidate.content,
          source: "loop_consult",
          sourceRevision: "slice2-t03-scheduled",
          checkerDispatch,
          observationProvider,
          operationReceiptProvider,
          artifactBaseDir: artifactBaseDir ?? undefined,
          artifactBaselines,
          persistBudgetSpending: budgetPersists.persistBudget,
          // T04: thread the run-scoped abort signal into the checker dispatch.
          abortSignal: input.getAbortSignal?.(),
          expectedStateVersion,
        },
        budget: created.budget,
      });
    },
    reserveContinuation: (continuationId) =>
      created.budget.reserveContinuation(continuationId),
    reserveProviderAttempt: (requestId) =>
      created.budget.reserveProviderAttempt(requestId),
    reserveToolExecution: (toolRequestId) =>
      created.budget.reserveToolExecution(toolRequestId),
    reconcileTokens: (requestId, actualTokens) =>
      created.budget.reconcileTokens(requestId, actualTokens),
    addActiveRuntime: (ms) => created.budget.addActiveRuntime(ms),
    addWaitMs: (ms) => created.budget.addWaitMs(ms),
    getRemainingBudgets: () => created.budget.getRemaining(),
    ledgerId: created.ledgerId,
    leaseGeneration: created.leaseGeneration,
    persistBudget: budgetPersists.persistBudget,
    flushPersistedBudget: budgetPersists.flushPersistedBudget,
    recordDecision: (decision) => {
      slot.set(decision);
    },
    recordToolRoundProgress: (observation) => {
      progressTracker.recordToolRound(observation);
    },
    recordAssistantTextProgress: (content) => {
      progressTracker.recordAssistantTextRound(content);
    },
  };

  // D3: the policy binding carries getDecision + evidenceService +
  // evidenceContext so the sink's complete-event consult reads the slot the
  // loop's in-loop consult populated (no double-consult), and falls back with
  // evidence only when the loop exited without consulting.
  //
  // T03: the evidenceContext carries the authoritative providers + a
  // `resolveExpectedStateVersion` closure so the sink's fallback consult
  // reads the CAS token fresh (AC-32). The `expectedVersion` field below
  // is the enrollment snapshot; the runner's finalizeScheduledPolicyRun
  // re-reads the version before finalizing (evidence writes bump it).
  const policyBinding: ScheduledLoopPolicyBinding = {
    executionId: created.executionId,
    controller: created.controller,
    budget: created.budget,
    contract: created.contract,
    route: created.route,
    expectedVersion: created.leaseGeneration,
    policyAccepted: true,
    getDecision: () => slot.get(),
    evidenceService,
    evidenceContext: {
      // The sink's fallback consult stamps the final assistant content; the
      // loop's consult closures supply per-candidate content. The sink
      // builds its own candidate from the `complete` event's fullContent, so
      // this is the fallback provenance tag.
      content: "",
      source: "scheduled_sink_consult",
      sourceRevision: "slice2-t03-scheduled",
      checkerDispatch,
      observationProvider,
      operationReceiptProvider,
      artifactBaseDir: artifactBaseDir ?? undefined,
      artifactBaselines,
      // T04: the run-scoped abort signal — read fresh at consult time so the
      // fallback checker dispatch races Stop / run-cancel + a deadline.
      abortSignal: input.getAbortSignal?.(),
      resolveExpectedStateVersion: async () => {
        try {
          const exec = await execModule.getExecution(created.executionId);
          return exec?.execution_state_version;
        } catch {
          return undefined;
        }
      },
    },
  };

  const policyExecution = {
    executionId: created.executionId,
    // T03: the enrollment snapshot version. The runner's
    // finalizeScheduledPolicyRun re-reads the version before finalizing
    // because evidence writes (loop consult + sink fallback consult) bump
    // execution_state_version during the run. A frozen 0 here would mismatch
    // the moment any consult persisted evidence → STATE_CONFLICT → the
    // scheduled finalization fails (and finalizeScheduled has no CAS retry,
    // unlike finalizeManual).
    expectedVersion: 0,
    idempotencyKey: input.idempotencyKey ?? input.occurrenceKey,
  };

  return {
    status: "created",
    loopBinding,
    policyBinding,
    policyExecution,
  };
}
