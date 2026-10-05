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

export interface DecideContext {
  readonly route: TaskExecutionRoute;
  readonly passedCriterionIds?: readonly string[];
  readonly requiredCriterionIds?: readonly string[];
  readonly unmetCriterionIds?: readonly string[];
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
        // Shadow mode (Slice 1) collects no real evidence — evidenceIds is
        // the identity of TaskEvidence rows (§5.2), NOT the IDs of criteria
        // that passed. Storing criterion IDs here (the previous behavior)
        // would misattribute them as evidence rows and break §8.2
        // reference-membership checks downstream. Emit [] until
        // TaskEvidenceService (Slice 2) records real evidence.
        evidenceIds: [],
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
      // No evidence collected in shadow mode (see verified_complete branch
      // above). Criterion pass/fail is reported via remainingWork + reasonCode.
      evidenceIds: [],
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
