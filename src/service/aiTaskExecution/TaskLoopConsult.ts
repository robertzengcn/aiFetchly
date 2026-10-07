/**
 * Loop-side completion-consult seam (technical-design §7, Slice 2 Unit 4).
 *
 * The chat loop's four terminal-stop sites (round-cap, empty-stop-after-tools,
 * goal-text-stop, loop-exit) each form a {@link TaskEndCandidate} from loop
 * state and consult the completion controller before deciding whether to nudge
 * the model onward or break. This module encapsulates the per-site logic so
 * the loop edits stay surgical (a flag+binding guard + one helper call each)
 * and the candidate-formation + decision→outcome mapping is unit-testable in
 * isolation from the streaming pipeline.
 *
 * The {@link LoopTaskExecutionBinding} is MAIN-PROCESS STATE constructed by
 * the engine's enrollment seam from the coordinator's binding — never
 * deserialized from renderer JSON. It carries closures (not the runtime
 * controller/budget objects themselves) so the loop never imports the
 * controller or budget types directly, avoiding a circular module edge.
 */
import { createHash } from "crypto";
import type {
  TaskCompletionDecision,
  TaskEndCandidate,
} from "@/entityTypes/aiTaskExecutionTypes";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";
import type { ToolRoundObservation } from "@/service/aiTaskExecution/TaskProgressTracker";

/**
 * Runtime binding the loop needs to consult the controller and reserve a
 * continuation. Built by `AIChatQueryEngine.submitMessage` (enrollment seam)
 * from the coordinator's `TaskExecutionBinding`; carried through loopInput
 * and the three resume paths so budget persists across pause/resume.
 *
 * `consult` is a closure capturing the controller + route + contract + budget
 * + evidence service/context — the loop never touches those runtime objects
 * directly. `reserveContinuation` is a closure capturing the budget so the
 * loop never imports `TaskRunBudget` either.
 */
export interface LoopTaskExecutionBinding {
  readonly executionId: string;
  readonly consult: (
    candidate: TaskEndCandidate
  ) => Promise<TaskCompletionDecision>;
  readonly reserveContinuation: (
    continuationId: string
  ) => BudgetReservationResult;
  /**
   * Records the controller's decision for this turn so the engine's
   * finalization gate (Slice 2 Unit 5) can tell "the loop already
   * consulted" apart from "no consult ran" and only fall back to its
   * own consult on the latter. The engine supplies this closure; it
   * captures a decision slot the engine reads after the loop returns.
   * Optional so tests and flag-off callers can omit it.
   */
  readonly recordDecision?: (decision: TaskCompletionDecision) => void;
  /**
   * FR-09 / §7.2 step 7 (GAP-S2 #2): observe one committed tool round so
   * the tracker can maintain the budget's no-progress streak. The engine
   * supplies this closure; it captures a `TaskProgressTracker` built from
   * the coordinator's budget. The loop calls it once per committed round
   * (after the permission-prompt early return). Optional so tests, flag-off
   * callers, and the scheduled sink path (which consults at response_end
   * without a loop binding) can omit it; when absent the streak stays 0
   * and the controller's streak gate is a no-op (byte-identical legacy).
   */
  readonly recordToolRoundProgress?: (
    observation: ToolRoundObservation
  ) => void;
  /**
   * FR-09 / T20b: observe one assistant text round at the goalTextStop
   * site (a consult with no committed tool round — text-only work). The
   * engine supplies this closure; it captures the same
   * `TaskProgressTracker` as `recordToolRoundProgress`. Repeated
   * identical text counts as no-progress; changed text resets the
   * streak. Optional so tests, flag-off callers, and sites that always
   * carry tool rounds can omit it.
   */
  readonly recordAssistantTextProgress?: (content: string) => void;
}

/**
 * Outcome of consulting the controller at a loop terminal-stop site.
 *
 * - `continue`: the controller authorized a continuation AND the budget
 *   reserved it. The loop emits the §7.3 continuation nudge and re-enters.
 * - `break`: the controller finished (verified/incomplete/blocked/
 *   finish_response/yield_owner), returned `wait`, OR the budget overrode a
 *   `continue` (continuation allowance exhausted). The loop records the
 *   decision and breaks. `reason` is a stable machine code for telemetry.
 */
export type ConsultOutcome =
  | { readonly type: "continue"; readonly prompt: string }
  | { readonly type: "break"; readonly reason: string };

/**
 * Inputs to {@link consultLoopEndCandidate}. The caller (the loop site) forms
 * these from loop state at the moment of the terminal stop:
 * - `content` = `recoveryState.recoveredContentPrefix + accumulator.state.fullContent`
 * - `finishReason` = the OpenAI finish reason (or null for a round-cap mid-stream)
 * - `pendingPermission`/`pendingQuestion`/`pendingPlanApproval` = loop state
 *   (false at the four Slice-2 consult sites; pending states route through
 *   the existing pause/resume flow, not through consult)
 * - `safetyRestriction` = content-scan result (false until a scanner is wired)
 * - `boundary` = which site is consulting
 */
export interface ConsultLoopEndCandidateInput {
  readonly binding: LoopTaskExecutionBinding;
  readonly boundary: "round_cap" | "response_end";
  readonly content: string;
  readonly finishReason: string | null;
  readonly pendingPermission: boolean;
  readonly pendingQuestion: boolean;
  readonly pendingPlanApproval: boolean;
  readonly safetyRestriction: boolean;
}

/**
 * T06a: Build a stable, per-candidate identity. Two consults form the SAME
 * candidate when their IMMUTABLE observation is identical — same execution,
 * same boundary, same bounded content, same finish reason, same pending
 * flags and safety-restriction state. Replay of the same response (a
 * transport retry re-entering the same consult) hashes to the same ID and
 * is therefore retained; a genuinely different response (different content)
 * hashes to a different ID and gets its own continuation allowance.
 *
 * The candidateId is NOT a reservation ID — the controller derives the
 * reservation continuationId from it (`cont:${candidateId}`), and the
 * budget's dedup keyspace is shared across the four `reserve*` methods.
 * The candidateId also scopes the per-candidate checker window via
 * `beginCheckerCandidate`.
 *
 * Content is bounded to 2 KiB before hashing (matching the controller's
 * `boundedSummary`) so a runaway assistant stream cannot grow the ID string
 * unboundedly, and well-known generated-noise keys in the candidate content
 * do NOT feed the hash — the engine's constant evidence revision is not a
 * source revision (FR-09; T20b RESULT_NOISE_KEYS principle).
 *
 * Regression per audit (FR-08/23; AC-05/08/29): "distinct responses consume
 * three continuations; fourth cannot dispatch. Replay of one candidate
 * dispatches once." Same-content replay → same ID → `reserveContinuation`
 * returns AlreadyReserved → the loop does NOT re-dispatch (T06b).
 */
function buildCandidateId(input: ConsultLoopEndCandidateInput): string {
  const MAX_CONTENT_HASH = 2000;
  const boundedContent = input.content.slice(0, MAX_CONTENT_HASH);
  const canonical = JSON.stringify({
    executionId: input.binding.executionId,
    boundary: input.boundary,
    content: boundedContent,
    finishReason: input.finishReason ?? "",
    pendingPermission: input.pendingPermission,
    pendingQuestion: input.pendingQuestion,
    pendingPlanApproval: input.pendingPlanApproval,
    safetyRestriction: input.safetyRestriction,
  });
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return `cand:${input.binding.executionId}:${input.boundary}:${hash}`;
}

/**
 * Form a {@link TaskEndCandidate} from loop state, consult the controller,
 * and map the decision to a {@link ConsultOutcome}.
 *
 * Candidate formation (§5.2, AC-04/05/06):
 * - `candidateId` (T06a): stable-shaped per (executionId, boundary, immutable
 *   observation). See {@link buildCandidateId}.
 * - `provenance`: "provider" — the loop saw a real provider stream.
 * - `streamTerminalSeen`: true — the loop only consults after the stream
 *   reached a terminal stop (finish_reason=stop, or a round cap with a
 *   committed tool round). Missing-terminal candidates (stream truncated by
 *   an error) never reach consult; they surface through recovery instead.
 * - `boundary`: the caller's site.
 * - pending flags + safetyRestriction: from loop state.
 *
 * Decision→outcome mapping (§7.2, AC-07/08):
 * - `continue` + `reserveContinuation` Reserved → continue outcome with the
 *   decision's prompt.
 * - `continue` + `reserveContinuation` AlreadyReserved → break
 *   (CANDIDATE_REPLAYED). T06b: the same continuation ID was already
 *   reserved (a replay of the same candidate, transport retry, or a
 *   re-consult at the same boundary with identical immutable state).
 *   Re-dispatching would double-count work the budget already funded, so
 *   the honest outcome is to break — never a second dispatch of the same
 *   continuation. This is distinct from `Exhausted` (no budget) and from
 *   `Reserved` (fresh dispatch).
 * - `continue` + `reserveContinuation` Exhausted → break (CONTINUATION_LIMIT).
 *   The budget overrides the controller's authorization: a `Exhausted` result
 *   means the lineage cap is spent, so the honest outcome is incomplete with
 *   CONTINUATION_LIMIT — never a continuation the budget cannot fund.
 * - `finish`/`finish_response`/`yield_owner`/`wait` → break with a stable
 *   reason code (the finish reasonCode, or a mapped constant for the others).
 */
export async function consultLoopEndCandidate(
  input: ConsultLoopEndCandidateInput
): Promise<ConsultOutcome> {
  const candidate: TaskEndCandidate = {
    candidateId: buildCandidateId(input),
    executionId: input.binding.executionId,
    content: input.content,
    finishReason: input.finishReason,
    provenance: "provider",
    streamTerminalSeen: true,
    boundary: input.boundary,
    pendingPermission: input.pendingPermission,
    pendingQuestion: input.pendingQuestion,
    pendingPlanApproval: input.pendingPlanApproval,
    safetyRestriction: input.safetyRestriction,
  };

  const decision = await input.binding.consult(candidate);
  input.binding.recordDecision?.(decision);
  return mapDecisionToOutcome(decision, input.binding);
}

function mapDecisionToOutcome(
  decision: TaskCompletionDecision,
  binding: LoopTaskExecutionBinding
): ConsultOutcome {
  if (decision.type === "continue") {
    // Budget gate: the controller authorized a continuation, but the
    // lineage budget has the final say. Three reservation results map to
    // three distinct honest outcomes (T06b):
    // - Reserved: fresh dispatch — proceed with the continuation prompt.
    // - AlreadyReserved: this exact continuation ID was already reserved
    //   (a replay of the same candidate, transport retry, or a re-consult
    //   at the same boundary with identical immutable state). Re-dispatching
    //   would double-count work the budget already funded, so BREAK with
    //   CANDIDATE_REPLAYED — never a second dispatch of the same
    //   continuation. AC-08/29.
    // - Exhausted: the lineage continuation allowance is spent — surface
    //   CONTINUATION_LIMIT rather than dispatching an unfunded continuation.
    const reservation = binding.reserveContinuation(decision.continuationId);
    if (reservation === BudgetReservationResult.AlreadyReserved) {
      return { type: "break", reason: "CANDIDATE_REPLAYED" };
    }
    if (reservation === BudgetReservationResult.Exhausted) {
      return { type: "break", reason: "CONTINUATION_LIMIT" };
    }
    return { type: "continue", prompt: decision.prompt };
  }
  if (decision.type === "wait") {
    return { type: "break", reason: `WAIT_${decision.reason.toUpperCase()}` };
  }
  if (decision.type === "finish_response") {
    return { type: "break", reason: "RESPONSE_ENDED" };
  }
  if (decision.type === "yield_owner") {
    return { type: "break", reason: "MAKER_ITERATION_ENDED" };
  }
  // decision.type === "finish" — verified_complete, incomplete,
  // blocked_by_policy, etc. Surface the controller's reasonCode.
  return { type: "break", reason: decision.reasonCode };
}

/**
 * Build the §7.3 continuation prompt template. The controller emits this on
 * a live `continue` decision; the loop pushes it as the next user message
 * (NOT a saved user request — it is a system-authored nudge).
 *
 * Template (§7.3):
 *   Continue the same approved task execution.
 *   Objective: <unchanged objective>
 *   Verified progress: <authoritative bounded summary>
 *   Unmet criteria: <missing conditions>
 *   Failures or restrictions: <safe summary>   (only when non-empty)
 *   Remaining limits: <trusted runtime limits>
 *   Perform an allowed next step or explain the blocker requiring input.
 *   Do not repeat operations with receipts.
 *   Do not claim completion without required evidence.
 *   Do not save continuation as another user request.
 */
export function buildContinuationPrompt(params: {
  objective: string;
  verifiedProgress: string;
  unmetCriteria: readonly string[];
  failures: string;
  remainingLimits: string;
}): string {
  const lines: string[] = [
    "Continue the same approved task execution.",
    `Objective: ${params.objective}`,
    `Verified progress: ${params.verifiedProgress}`,
  ];
  if (params.unmetCriteria.length > 0) {
    lines.push(`Unmet criteria: ${params.unmetCriteria.join(", ")}`);
  } else {
    lines.push("Unmet criteria: none");
  }
  if (params.failures.trim().length > 0) {
    lines.push(`Failures or restrictions: ${params.failures}`);
  }
  lines.push(`Remaining limits: ${params.remainingLimits}`);
  lines.push(
    "Perform an allowed next step or explain the blocker requiring input."
  );
  lines.push("Do not repeat operations with receipts.");
  lines.push("Do not claim completion without required evidence.");
  lines.push("Do not save continuation as another user request.");
  return lines.join("\n");
}
