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
import { deriveCandidateDiagnostics } from "@/service/aiTaskExecution/candidateDiagnostics";

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
   * T05 (FR-08/10/23, AC-06/08/22/27/29): gate a provider dispatch attempt
   * against the execution budget before the actual streamChatCompletion call.
   * The loop forms a stable per-round request ID (`prov:<executionId>:<round>`)
   * so a transport-retried same-round attempt dedups (AlreadyReserved — the
   * reservation holds, dispatch proceeds) instead of double-counting. On
   * `Exhausted` the loop fail-closed throws `RecoverableHistoryError(
   * "MODEL_ATTEMPT_LIMIT")` — the controller's incomplete route owns the
   * finish (D4: provider retry exhaustion → finish(incomplete,
   * MODEL_ATTEMPT_LIMIT)). On `Reserved` the loop calls `persistBudget(
   * {providerAttempts:1})`; if that returns false (lease lost) the loop
   * fail-closed throws the same error. Optional so flag-off callers, tests,
   * and the scheduled sink path (no loop binding) can omit it; when absent
   * the dispatch site skips reservation (byte-identical legacy — the
   * in-memory mirror still tracks via the controller).
   */
  readonly reserveProviderAttempt?: (
    requestId: string
  ) => BudgetReservationResult;
  /**
   * T05 (FR-08/10/23, AC-27): record a tool execution against the execution
   * budget before the actual `deps.executeTool` call. Per D4 this is
   * record-but-no-gate: gating mid-operation (the tool has already claimed
   * resources / produced side effects) would leave tool state in limbo, so
   * the hard cap is enforced at continuation time via `HARD_CAPS` instead.
   * The loop forms a stable ID (`tool:<call.id>`) so a retried same-call
   * execution dedups. `Exhausted` is logged but the call still proceeds
   * (record-but-no-gate); `Reserved` triggers `persistBudget(
   * {toolExecutions:1})` (false → logged, call still proceeds — fail-OPEN
   * for tool exec per D4, since the operation is already in flight).
   * Optional so flag-off callers and tests can omit it; when absent the
   * dispatch site skips recording (byte-identical legacy).
   */
  readonly reserveToolExecution?: (
    toolRequestId: string
  ) => BudgetReservationResult;
  /**
   * T05 (FR-08/10/23, AC-22): reconcile actual token usage after a dispatch
   * against the in-memory budget mirror. Returns true when the request ID
   * was new (the caller should then persist `tokens` to the durable ledger
   * via `persistBudget`); false when it was a dedup replay (the caller skips
   * the persist so the ledger doesn't double-count). The loop calls this
   * with the same `prov:<executionId>:<round>` ID used for the provider
   * reservation. Optional so flag-off callers and tests can omit it; when
   * absent the dispatch site skips reconciliation (byte-identical legacy —
   * the controller's token cap consults zero, which is safe fail-closed).
   */
  readonly reconcileTokens?: (
    requestId: string,
    actualTokens: number
  ) => boolean;
  /**
   * T05 (FR-08/10/23, AC-29): accumulate active runtime (provider stream
   * wall-clock) against the in-memory budget mirror. The loop calls this
   * after each provider stream completes with the per-round delta. Returns
   * the new total `activeRuntimeMs` so the caller can persist the delta to
   * the ledger if desired. Optional so flag-off callers and tests can omit
   * it; when absent the active-runtime cap is not enforced (byte-identical
   * legacy — the controller's runtime consult reads zero).
   */
  readonly addActiveRuntime?: (ms: number) => void;
  /**
   * T05 (FR-08/10/23, AC-06/08/22/27/29): durably persist budget consumption
   * to the lineage ledger at actual dispatch time. The in-memory
   * `TaskRunBudget` is a mirror; the ledger row is authoritative. The engine
   * enrollment seam constructs this closure from the coordinator's binding
   * (`ledgerId` + `leaseGeneration` + `executionId` + the
   * `AiTaskExecutionModule`). Returns false when the lease no longer holds
   * (released, superseded by a Continue successor, or missing); the loop's
   * dispatch sites fail-closed on false (FR-08: refuse to dispatch when
   * persistence fails). Optional so flag-off callers, tests, and the
   * scheduled sink path (which consults at response_end without a loop
   * binding) can omit it; when absent the dispatch sites skip persistence
   * (byte-identical to legacy behavior — the in-memory mirror still tracks
   * consumption for the run).
   */
  readonly ledgerId?: string;
  readonly leaseGeneration?: number;
  readonly persistBudget?: (
    delta: {
      readonly continuations?: number;
      readonly providerAttempts?: number;
      readonly toolExecutions?: number;
      readonly checkerAttempts?: number;
      readonly tokens?: number;
      readonly activeRuntimeMs?: number;
      readonly waitMs?: number;
      readonly noProgressStreak?: number;
    }
  ) => Promise<boolean>;
  /**
   * T16 / NFR-12 / AC-12/32: the completion-policy flag value FROZEN at
   * enrollment time. Downstream handling of an ACCEPTED execution — the
   * loop's consult sites, the engine's finalization gate, and Stop-cancel —
   * consult this frozen value, NOT the live runtime flag. Turning the flag
   * off after enrollment therefore cannot convert accepted unfinished work
   * to unchecked success: the binding still carries `policyAccepted: true`
   * and the consult/finalize/cancel paths run as if the flag were on. The
   * runtime flag controls only NEW enrollment (the engine's submission
   * seam re-checks `isAiTaskCompletionPolicyV1Enabled()` to decide whether
   * to enroll a fresh submission). Optional so flag-off callers and tests
   * that never enroll can omit it; when absent the downstream sites treat
   * the binding as not-accepted (no consult, no finalize, no cancel) —
   * byte-identical to legacy behavior.
   */
  readonly policyAccepted?: boolean;
  /**
   * T02 (FR-02/05/07/20, AC-01-05/17/30/32): which enrollment seam owns the
   * binding's finalization. `"manual"` (default) — the engine's completed-case
   * gate runs `finalizeManualAtCompleteGate` (CAS-retry, reads current
   * version). `"scheduled"` — the scheduled runner's `finalizeScheduledPolicyRun`
   * owns finalization (pass-through, enrollment-snapshot `expectedVersion`,
   * no retry); the engine's manual gate MUST no-op to prevent
   * double-finalization. Optional so manual callers, tests, and flag-off
   * callers can omit it; when absent the engine treats the binding as
   * `"manual"` (byte-identical to legacy behavior).
   */
  readonly executionKind?: "manual" | "scheduled";
  /**
   * B12 (FR-20, NFR-01/07, AC-14/31): the semantic owner frozen at
   * enrollment — "standalone" for ordinary tasks (even with an unrelated
   * active goal present), "goal" only for actually goal-linked work. The
   * loop uses it to select goal-flavored maker prompts exclusively for
   * goal-owned turns (no stacked goal nudges on standalone work). Optional
   * so flag-off callers, tests, and bindings built before this field
   * existed omit it; when absent the loop treats the turn as standalone
   * for prompt selection (legacy goalAutoContinue behavior otherwise
   * unchanged).
   */
  readonly completionOwner?: "standalone" | "goal";
  /**
   * T04 (NFR-02/04, AC-24): the per-consult abort source. The consult closure
   * reads this fresh per consult so the checker dispatch can race the signal +
   * a deadline (a Stop or a hanging provider stall cannot hold the gate, §9
   * line 445). Manual seam: `() => this.activeTurns.get(conversationId)?.
   * abortController.signal` (the per-turn controller). Scheduled seam: the
   * runner's run-scoped controller. Optional so flag-off callers and tests can
   * omit it; when absent the checker dispatch gets no parent signal (only its
   * own deadline timer) — fail-closed at the deadline, not byte-identical to
   * legacy, but the legacy path had no checker dispatch wired at all.
   */
  readonly getAbortSignal?: () => AbortSignal | undefined;
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
  // T21a: derive provenance/streamTerminalSeen/safetyRestriction from the
  // actual finishReason + content. The four in-loop consult sites only
  // consult after a true terminal stop, so `streamTerminalSeen` is defensibly
  // true for recognized terminals — but a `length`/`error`/`null` finishReason
  // or a content_filter refusal now surfaces honestly instead of being
  // stamped "provider terminal, no restriction" regardless of input. The
  // caller's `safetyRestriction` is preserved as a floor (a content scan that
  // flagged a restriction still wins); the helper adds content_filter/refusal
  // detection on top.
  const diagnostics = deriveCandidateDiagnostics({
    finishReason: input.finishReason,
    content: input.content,
  });
  const candidate: TaskEndCandidate = {
    candidateId: buildCandidateId(input),
    executionId: input.binding.executionId,
    content: input.content,
    finishReason: input.finishReason,
    provenance: diagnostics.provenance,
    streamTerminalSeen: diagnostics.streamTerminalSeen,
    boundary: input.boundary,
    pendingPermission: input.pendingPermission,
    pendingQuestion: input.pendingQuestion,
    pendingPlanApproval: input.pendingPlanApproval,
    safetyRestriction: input.safetyRestriction || diagnostics.safetyRestriction,
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
