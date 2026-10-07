/**
 * Completion controller (technical-design §7, FR-05/06/07/16).
 *
 * Slice 1 shipped SHADOW EVALUATION: `decide()` classifies a response-end
 * candidate, records provenance, and returns a `TaskCompletionDecision`
 * without dispatching. Slice 2 (Unit 4) adds the LIVE continuation branch
 * (§7.2 step 10): when a live budget is present and the candidate has
 * feasible unmet work, `decide()` returns `continue` with the §7.3 targeted
 * prompt. Shadow mode (no budget injected) is preserved byte-identical:
 * unfinished task candidates still return `finish(incomplete)`.
 *
 * Decision precedence (§7.2) is implemented in order:
 *   1. Validate ownership/route (caller's responsibility).
 *   2. User cancellation wins — handled by the caller before calling decide.
 *   3. Safety restrictions / policy blocks → blocked_by_policy (no bypass).
 *   4. Pending permission/question/approval → wait.
 *   5. Response-only → finish_response.
 *   6. Task: all required criteria pass → verified_complete; else
 *      6a. LIVE (budget injected): feasible unmet work → continue with a
 *          targeted §7.3 prompt (§7.2 step 10).
 *      6b. Otherwise: finish(incomplete) (shadow: no continuation).
 *
 * Provenance (FR-16): the candidate's `provenance` and `boundary` fields
 * are preserved on the decision's reason code; synthetic/unknown/missing-
 * terminal candidates can never become verified_complete (AC-12).
 */
import type {
  TaskCompletionContract,
  TaskCompletionDecision,
  TaskEndCandidate,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";
import type {
  EvidenceChecker,
  EvidenceContext,
} from "@/service/aiTaskExecution/TaskEvidenceService";
import type { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";
import { buildContinuationPrompt } from "@/service/aiTaskExecution/TaskLoopConsult";

export interface DecideContext {
  readonly route: TaskExecutionRoute;
  readonly passedCriterionIds?: readonly string[];
  readonly requiredCriterionIds?: readonly string[];
  readonly unmetCriterionIds?: readonly string[];
  /**
   * Slice 2 evidence injection. When the caller supplies an evidence
   * service + contract + context, the controller calls `checkCandidate`
   * itself and populates `evidenceIds` on the decision from real
   * {@link TaskEvidence} rows. When absent (Slice 1 shadow mode, or flag
   * off), the controller falls back to caller-supplied
   * `passedCriterionIds`/`unmetCriterionIds` and emits `evidenceIds: []`
   * (the Slice 1 placeholder behavior, preserved for shadow-mode tests).
   */
  readonly evidenceService?: EvidenceChecker;
  readonly contract?: TaskCompletionContract;
  readonly evidenceContext?: EvidenceContext;
  /**
   * Slice 2 live budget (D4/FR-08/09). When supplied, the controller
   * consults the accessors before deciding: continuation allowance
   * exhausted → finish(incomplete, CONTINUATION_LIMIT); provider attempts
   * exhausted → finish(incomplete, MODEL_ATTEMPT_LIMIT); checker allowance
   * exhausted → qualitative evidence is skipped downstream (the evidence
   * service receives a budget-gated reserve function). Undefined in Slice 1
   * shadow mode — no budget consult, byte-identical behavior.
   */
  readonly budget?: TaskRunBudget;
}

export class TaskCompletionController {
  // Slice 1 shadow-mode controller holds no mutable state. The previous
  // `ControllerDeps`/`executionId` field was never read inside this class
  // (F16) — the coordinator already has the executionId on its binding —
  // so the constructor takes no args. Slice 2 may add continuation
  // dispatch state here; do not re-add a dead field in the meantime.

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

    // D4 (FR-08/09): live budget consult precedes criteria evaluation. A
    // spent allowance means no further dispatch is possible, so the honest
    // outcome is incomplete with the matching reason code — never a
    // continue the budget cannot fund, and never a verified_complete the
    // evidence check could not fund either (checker budget exhaustion skips
    // qualitative evidence downstream via the gated reserve function).
    const budget = context.budget;
    if (budget) {
      if (budget.isContinuationBudgetExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "CONTINUATION_LIMIT",
          evidenceIds: [],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...(context.unmetCriterionIds ?? [])],
        };
      }
      if (budget.isProviderBudgetExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "MODEL_ATTEMPT_LIMIT",
          evidenceIds: [],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...(context.unmetCriterionIds ?? [])],
        };
      }
    }

    // Preparation route cannot finish executable work (FR-21).
    if (context.route === "preparation") {
      return {
        type: "finish",
        outcome: "incomplete",
        reasonCode: "PREPARATION_REQUIRED",
        evidenceIds: [],
        summary: this.boundedSummary(candidate.content),
        remainingWork: [...(context.unmetCriterionIds ?? [])],
      };
    }

    // Task route (task_verified or task_best_effort): evaluate criteria.
    // Slice 2: when the caller injects the evidence service, consult it here
    // to obtain real {@link TaskEvidence} rows (criteria evaluated against
    // assistant content / tool catalog / checker LLM). The result drives the
    // verified_complete / incomplete outcome + the evidenceIds list. Slice 1
    // callers (shadow mode, flag off) supply passedCriterionIds directly and
    // get evidenceIds:[] — the Slice 1 placeholder behavior, preserved.
    const evidence = await this.maybeEvaluateEvidence(candidate, context);

    const required = evidence?.requiredCriterionIds ?? context.requiredCriterionIds ?? [];
    const passedSet = new Set(evidence?.passedCriterionIds ?? context.passedCriterionIds ?? []);
    const allRequiredPass =
      required.length > 0 && required.every((id) => passedSet.has(id));

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
        // Real evidence row identities from TaskEvidenceService (Slice 2),
        // or [] when no evidence service was injected (Slice 1 shadow mode).
        evidenceIds: [...(evidence?.evidenceIds ?? [])],
        summary: this.boundedSummary(candidate.content),
        remainingWork: [],
      };
    }

    // Shadow mode (Slice 1): unfinished/unverifiable task candidates return
    // finish(incomplete). Live continuation dispatch is Slice 2.
    const unmet = required.filter((id) => !passedSet.has(id));

    // §7.2 step 10 (Slice 2 Unit 4, FR-07): LIVE continuation branch. When a
    // live budget is injected, unmet work is feasible (real provider stream,
    // true terminal, boundary not a hard budget cap), and the lineage
    // continuation allowance can still fund a dispatch, return `continue`
    // with the §7.3 targeted prompt. Guards:
    // - `budget` presence is the live-mode signal — shadow callers (flag
    //   off, no budget) fall through to finish(incomplete), byte-identical
    //   to Slice 1.
    // - `unmet.length > 0` — a best-effort candidate whose criteria all pass
    //   is done by design (FR-04: it can never verify); continuing it would
    //   loop forever. Only candidates with actual remaining work continue.
    // - `streamTerminalSeen` — the stream truly ended; a truncated stream
    //   surfaces STREAM_INCOMPLETE via recovery, not a continuation.
    // - `boundary !== "budget_cap"` — a budget-cap stop means the runtime
    //   hard caps were already the limiting factor; the honest outcome is
    //   incomplete, not another dispatch.
    // - `isContinuationBudgetExhausted` — reserve-level gate; the loop also
    //   re-checks `reserveContinuation` on the returned ID (dedup/atomicity).
    // - `isNoProgressStreakExhausted` — FR-09/§7.2 step 9 (GAP-S2 #2): a
    //   stalled run (same normalized tool request + unchanged result for
    //   maxNoProgressStreak consecutive rounds, per TaskProgressTracker)
    //   must end incomplete WITHIN the limits, not burn the whole
    //   continuation allowance and finish CONTINUATION_LIMIT. Falls through
    //   to `incompleteReasonCode`, which returns NO_PROGRESS for a
    //   terminal-seen provider candidate at a non-cap boundary. A CHANGED
    //   error resets the streak (FR-09) without replenishing the allowance —
    //   the tracker never calls any reserve* method.
    if (
      budget &&
      unmet.length > 0 &&
      candidate.streamTerminalSeen &&
      candidate.boundary !== "budget_cap" &&
      candidate.provenance === "provider" &&
      !budget.isContinuationBudgetExhausted() &&
      !budget.isNoProgressStreakExhausted()
    ) {
      return {
        type: "continue",
        continuationId: `cont:${candidate.candidateId}`,
        prompt: this.continuationPrompt(candidate, context, unmet, budget),
        unmetCriterionIds: [...unmet],
      };
    }

    const reasonCode = this.incompleteReasonCode(candidate, budget);
    return {
      type: "finish",
      outcome: "incomplete",
      reasonCode,
      // Real evidence row identities from TaskEvidenceService (Slice 2),
      // or [] when no evidence service was injected (Slice 1 shadow mode).
      evidenceIds: [...(evidence?.evidenceIds ?? [])],
      summary: this.boundedSummary(candidate.content),
      remainingWork: unmet,
    };
  }

  /**
   * Call the evidence service when the caller injected one + a contract +
   * context. Returns the pass/unmet/evidence-id triple, plus the
   * required-criterion list derived from the contract (so the controller
   * does not need a separate `requiredCriterionIds` from the caller when
   * the service is wired). Returns undefined when no service is present
   * (Slice 1 shadow mode / flag off) — the caller-supplied criterion IDs
   * are used instead.
   */
  private async maybeEvaluateEvidence(
    candidate: TaskEndCandidate,
    context: DecideContext
  ): Promise<
    | {
        readonly passedCriterionIds: readonly string[];
        readonly unmetCriterionIds: readonly string[];
        readonly evidenceIds: readonly string[];
        readonly requiredCriterionIds: readonly string[];
      }
    | undefined
  > {
    const service = context.evidenceService;
    const contract = context.contract;
    const evidenceContext = context.evidenceContext;
    if (!service || !contract || !evidenceContext) return undefined;

    // Per-check sequence — each reserve call mints a unique request ID so
    // the dedup set never collapses two distinct qualitative checks.
    let checkerSeq = 0;

    // D4 (FR-09): start this candidate's checker window and gate the
    // checker dispatch through the budget's per-run + per-candidate
    // reservation. Each call to the returned reserve function is ONE
    // checker dispatch, so it mints a unique request ID (dedup must not
    // collapse two distinct qualitative checks into one budget unit). When
    // the budget is exhausted, the qualitative evaluator receives Exhausted
    // and records "unknown" (fail-closed) instead of dispatching.
    const budget = context.budget;
    const gatedContext = budget
      ? {
          ...evidenceContext,
          budgetReserveChecker: (): BudgetReservationResult => {
            budget.beginCheckerCandidate(candidate.candidateId);
            checkerSeq += 1;
            return budget.reserveCheckerAttempt(
              `chk:${candidate.candidateId}:${checkerSeq}`
            );
          },
        }
      : evidenceContext;

    const result = await service.checkCandidate(candidate, contract, gatedContext);
    const requiredCriterionIds = contract.criteria
      .filter((criterion) => criterion.required)
      .map((criterion) => criterion.id);
    return {
      passedCriterionIds: result.passedCriterionIds,
      unmetCriterionIds: result.unmetCriterionIds,
      evidenceIds: result.evidenceIds,
      requiredCriterionIds,
    };
  }

  /**
   * Build the §7.3 targeted continuation prompt for the live continue
   * branch. Objective falls back to a neutral phrase when no contract is
   * present (best-effort route with caller-supplied criteria); verified
   * progress is the bounded summary of the candidate content; remaining
   * limits come from the live budget's remaining allowance — trusted
   * runtime state, never model-reported.
   */
  private continuationPrompt(
    candidate: TaskEndCandidate,
    context: DecideContext,
    unmet: readonly string[],
    budget: TaskRunBudget
  ): string {
    const remaining = budget.getRemaining();
    return buildContinuationPrompt({
      objective: context.contract?.objective ?? "the approved task execution",
      verifiedProgress: this.boundedSummary(candidate.content),
      unmetCriteria: unmet,
      // No failure summary is available to the controller (recovery-state
      // details live in the loop); keep the line absent rather than inventing.
      failures: "",
      remainingLimits: `continuations: ${remaining.continuations}, providerAttempts: ${remaining.providerAttempts}, checkerAttempts: ${remaining.checkerAttempts}, tokens: ${remaining.tokens}`,
    });
  }

  private incompleteReasonCode(
    candidate: TaskEndCandidate,
    budget?: TaskRunBudget
  ): string {
    // FR-16 provenance-aware reason codes. Precedence: a synthetic/missing-
    // terminal candidate wins over the boundary signal — the stream never
    // truly ended, so CONTINUATION_LIMIT would mislabel it. Reordering these
    // silently changes reason-code distribution downstream.
    if (candidate.provenance === "synthetic" || !candidate.streamTerminalSeen) {
      return "STREAM_INCOMPLETE";
    }
    // FR-09/§7.2 step 9 (GAP-S2 #2): a stalled run — terminal seen, provider
    // provenance, no-progress streak at its bound — ends WITHIN the limits as
    // NO_PROGRESS, not as the boundary-derived CONTINUATION_LIMIT. This must
    // precede the boundary check below so a stalled round_cap/response_end
    // candidate is not mislabeled. The streak is only meaningful with a live
    // budget; shadow callers (no budget) fall through to the boundary code,
    // preserving Slice 1 byte-identity (their streak stays 0).
    if (budget && budget.isNoProgressStreakExhausted()) {
      return "NO_PROGRESS";
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
