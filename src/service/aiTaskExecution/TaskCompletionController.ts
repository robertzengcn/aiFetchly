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
 *   6. Preparation route → finish(incomplete, PREPARATION_REQUIRED).
 *   7. Evaluate admissible evidence (T07): local deterministic adapters +
 *      the separately-budgeted qualitative checker. All required criteria
 *      pass → verified_complete — regardless of maker-budget state, so a
 *      clean terminal on the final allowed attempt verifies (FR-06/08,
 *      AC-03/08).
 *   8. Maker-budget exhaustion (continuation/provider) gates NEW dispatch
 *      only — applied AFTER evidence so already-collected evidence can
 *      still verify. Exhausted + unfinished → finish(incomplete,
 *      CONTINUATION_LIMIT / MODEL_ATTEMPT_LIMIT).
 *   9. LIVE (budget injected): feasible unmet work → continue with a
 *      targeted §7.3 prompt (§7.2 step 10).
 *  10. Otherwise: finish(incomplete) (shadow: no continuation).
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
import { FALLBACK_DESCRIPTION_PREFIX } from "@/service/aiTaskExecution/TaskCriteriaResolver";
import type { AIChatRecoveryReason } from "@/service/AIChatRecoveryTypes";

/**
 * B01 (FR-04/17/19/22): whether a frozen best-effort contract is trusted
 * and complete enough to establish verified completion. All checks run in
 * the main process against the frozen contract (never renderer claims):
 * - mode is best_effort (the verified route verifies through its own
 *   branch; a mode mismatch fails closed),
 * - at least one required criterion (zero-criteria requests stay
 *   unverified — there is nothing evidencing the work),
 * - every required criterion carries at least one source anchor whose
 *   messageId is approved and whose offsets are well-formed
 *   (start < end), so coverage is traceable to real request content,
 * - no required qualitative criterion is an ambiguity fallback (the
 *   compiler prefixes fallbacks with FALLBACK_DESCRIPTION_PREFIX; structured
 *   deliverables use "Deliverable:" and also carry empty selector keys,
 *   so the description prefix — not the selector list — is the fallback
 *   marker. Passing a fallback proves nothing about the request — AC-21).
 */
export function isTrustedCompleteContract(
  contract: TaskCompletionContract | null | undefined
): boolean {
  if (!contract || contract.mode !== "best_effort") return false;
  const required = contract.criteria.filter((criterion) => criterion.required);
  if (required.length === 0) return false;
  if (contract.approvedSourceMessageIds.length === 0) return false;
  const approved = new Set(contract.approvedSourceMessageIds);
  for (const criterion of required) {
    const anchored = criterion.sourceRefs.some(
      (ref) =>
        approved.has(ref.messageId) && ref.startOffset < ref.endOffset
    );
    if (!anchored) return false;
    if (criterion.kind === "qualitative") {
      if (criterion.description.startsWith(FALLBACK_DESCRIPTION_PREFIX)) {
        return false;
      }
    }
  }
  return true;
}

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
   * B12 (FR-20, NFR-01/07, AC-14/31): the semantic owner of this decision.
   * Standalone turns verify through this controller; goal-owned turns end
   * with an internal iteration yield — the goal loop (not the standalone
   * controller) owns goal verification, so goal work never stacks
   * standalone nudges or a standalone goal completion onto goal iteration.
   * Optional so legacy/test callers without ownership stay standalone.
   */
  readonly owner?: "standalone" | "goal";
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
  /**
   * T21b: classified recovery reason from the engine's failed path, when the
   * consult follows a transport error or a non-recoverable failure. The
   * controller maps non-retryable reasons (auth/quota/non_recoverable) to
   * distinct permanent-error reason codes; recoverable reasons stay a
   * controller-decided incomplete (held for decision, never blind-failed).
   * Absent on clean-terminal consults.
   */
  readonly recoveryReason?: AIChatRecoveryReason;
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
    // T21b: the controller independently maps finishReason content_filter to
    // blocked_by_policy — it does NOT rely solely on the manually supplied
    // `candidate.safetyRestriction` boolean (a unit test's hand-set boolean
    // is not proof of actual stream provenance, audit T21 evidence). The
    // consult sites derive safetyRestriction from real diagnostics via
    // `deriveCandidateDiagnostics`; this gate is the defense-in-depth so a
    // candidate stamped safetyRestriction=false but carrying a real
    // content_filter finishReason still blocks.
    if (candidate.safetyRestriction || candidate.finishReason === "content_filter") {
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
        remainingWork: [...(context.unmetCriterionIds ?? [])],
      };
    }

    // B12 (FR-20, NFR-01/07, AC-14/31): goal-owned turns end with an
    // internal iteration yield — the goal loop exclusively owns goal
    // verification and recovery. The standalone controller contributes no
    // nudges, no verification, and no goal completion for goal work (no
    // stacked loops). Safety/waits above still win: they describe this
    // turn's stream, not the work routing.
    if (context.owner === "goal") {
      return {
        type: "yield_owner",
        owner: "goal",
        result: "maker_iteration_ended",
      };
    }

    // T07 / §7.2 step 6: evaluate admissible local/already-collected evidence
    // BEFORE the maker-budget exhaustion gates. A spent continuation or
    // provider allowance means no further maker dispatch is possible, but
    // local bounded deterministic evidence (observation/operation_receipt/
    // record_count) and the separately-budgeted qualitative checker can
    // still establish genuine completion on the final allowed attempt — so
    // a clean terminal with all required criteria passed verifies regardless
    // of maker-budget state (FR-06/08, AC-03/08). The qualitative checker
    // has its OWN reservation (`budgetReserveChecker` → `reserveCheckerAttempt`,
    // per-run + per-candidate caps), so checker work is gated independently
    // and never depends on the maker budget.
    //
    // Slice 1 callers (shadow mode, flag off) supply passedCriterionIds
    // directly and get evidenceIds:[] — the Slice 1 placeholder behavior,
    // preserved.
    const evidence = await this.maybeEvaluateEvidence(candidate, context);

    const required = evidence?.requiredCriterionIds ?? context.requiredCriterionIds ?? [];
    const passedSet = new Set(evidence?.passedCriterionIds ?? context.passedCriterionIds ?? []);
    const allRequiredPass =
      required.length > 0 && required.every((id) => passedSet.has(id));
    // Derive the unmet list once so every incomplete path reports the SAME
    // remaining work (T07: the budget-exhaustion path now mirrors the
    // fallthrough path's unmet derivation, not a caller-supplied list that
    // might be absent).
    const unmet = required.filter((id) => !passedSet.has(id));

    // §7.2 step 6: all required criteria pass → verified_complete.
    // AC-12: synthetic/unknown/missing-terminal provenance can never verify.
    const canVerify =
      allRequiredPass &&
      candidate.provenance !== "synthetic" &&
      candidate.provenance !== "unknown" &&
      candidate.streamTerminalSeen;

    // B01 (FR-04/17/19/22): ordinary manual tasks (no approved plan or
    // template) freeze a derived best-effort contract. When that contract is
    // trusted-complete — required criteria present, every one anchored to
    // approved source content, no ambiguity fallback — and real evaluated
    // evidence passes every required criterion, the outcome is
    // verified_complete (the normal Completed behavior). Zero-criteria,
    // unanchored, or fallback contracts stay unverified, as does any
    // caller-supplied ID path with no real evaluation (evidence undefined).
    // A best-effort request lacking a usable complete contract must stay
    // unverified — never relabel all best-effort work successful.
    const isPromotableBestEffort =
      context.route === "task_best_effort" &&
      evidence !== undefined &&
      isTrustedCompleteContract(context.contract);

    if (canVerify && (context.route === "task_verified" || isPromotableBestEffort)) {
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

    // D4 (FR-08/09): maker-budget exhaustion gates only NEW maker dispatch,
    // NOT already-collected evidence (T07 above). Now that the candidate has
    // not verified, a spent continuation/provider allowance means no further
    // dispatch is possible, so the honest outcome is incomplete with the
    // matching reason code — never a continue the budget cannot fund.
    const budget = context.budget;
    if (budget) {
      if (budget.isContinuationBudgetExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "CONTINUATION_LIMIT",
          evidenceIds: [...(evidence?.evidenceIds ?? [])],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...unmet],
        };
      }
      if (budget.isProviderBudgetExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "MODEL_ATTEMPT_LIMIT",
          evidenceIds: [...(evidence?.evidenceIds ?? [])],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...unmet],
        };
      }
      // B13c (FR-08/10/23, AC-06/08/22/27/29): the dispatch-time barrier in
      // the loop refuses new work on these floors; the consult maps a turn
      // that ends naturally past them to the same honest codes (instead of
      // generic NO_PROGRESS), preserving reason-code continuity between the
      // gate throws and natural loop ends.
      if (budget.isToolBudgetExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "TOOL_LIMIT",
          evidenceIds: [...(evidence?.evidenceIds ?? [])],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...unmet],
        };
      }
      if (budget.isTokenBudgetExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "TOKEN_LIMIT",
          evidenceIds: [...(evidence?.evidenceIds ?? [])],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...unmet],
        };
      }
      if (budget.isActiveRuntimeExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "ACTIVE_RUNTIME_LIMIT",
          evidenceIds: [...(evidence?.evidenceIds ?? [])],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...unmet],
        };
      }
      if (budget.isWaitBudgetExhausted()) {
        return {
          type: "finish",
          outcome: "incomplete",
          reasonCode: "WAIT_LIMIT",
          evidenceIds: [...(evidence?.evidenceIds ?? [])],
          summary: this.boundedSummary(candidate.content),
          remainingWork: [...unmet],
        };
      }
    }

    // Shadow mode (Slice 1): unfinished/unverifiable task candidates return
    // finish(incomplete). Live continuation dispatch is Slice 2.
    // `unmet` was derived above (before the budget gates) so every incomplete
    // path — budget exhaustion, fallthrough, and the live continue guard —
    // reports the SAME remaining work.

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

    const reasonCode = this.incompleteReasonCode(candidate, budget, context.recoveryReason);
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
    const persistSpending = evidenceContext?.persistBudgetSpending;
    const gatedContext = budget
      ? {
          ...evidenceContext,
          budgetReserveChecker: (): BudgetReservationResult => {
            budget.beginCheckerCandidate(candidate.candidateId);
            checkerSeq += 1;
            const reserved = budget.reserveCheckerAttempt(
              `chk:${candidate.candidateId}:${checkerSeq}`
            );
            if (reserved === BudgetReservationResult.Reserved) {
              // B13c (FR-08/23, AC-08): persist checker spend at dispatch so
              // pause/resume/Continue resurrects it from the ledger.
              // Fire-and-forget (the checker dispatch itself is already
              // underway; the flush barrier awaits in-flight persists before
              // owner release). Warn-only failure, mirroring the token path.
              persistSpending?.({ checkerAttempts: 1 }).then(
                (ok) => {
                  if (!ok) {
                    console.warn(
                      `[ai-chat-v2] checker spend persistence failed (lease released or superseded) for chk:${candidate.candidateId}:${checkerSeq}`
                    );
                  }
                },
                (err) => {
                  console.warn(
                    `[ai-chat-v2] checker spend persistence error for chk:${candidate.candidateId}:${checkerSeq}:`,
                    err
                  );
                }
              );
            }
            return reserved;
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
    budget?: TaskRunBudget,
    recoveryReason?: AIChatRecoveryReason
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
    // T21b: distinct finishReason/recovery mapping (FR-05/06/16, AC-12/30).
    // The candidate reached a provider terminal at response_end (no cap), so
    // the reason is now distinguishable by WHAT the provider/recovery layer
    // reported. Precedence: permanent recovery reason > finishReason >
    // fallthrough. These MUST follow the provenance/boundary/streak branches
    // above so a synthetic stream or a budget cap still wins.
    if (recoveryReason === "auth") {
      return "AUTH_FAILURE";
    }
    if (recoveryReason === "quota") {
      return "QUOTA_EXHAUSTED";
    }
    if (recoveryReason === "non_recoverable") {
      return "NON_RECOVERABLE";
    }
    // `length` = output truncation (the model hit max output tokens before
    // completing its answer). Distinct from CONTINUATION_LIMIT (a budget cap)
    // and from NO_PROGRESS (the model finished cleanly but did no work).
    if (candidate.finishReason === "length") {
      return "OUTPUT_TRUNCATED";
    }
    // `error` = the provider reported a transient server-side failure. The
    // loop throws on `finish_reason=error` + empty content (handled upstream),
    // but a non-empty error response falls through to consult — map it
    // distinctly from truncation and generic no-progress.
    if (candidate.finishReason === "error") {
      return "PROVIDER_ERROR";
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
