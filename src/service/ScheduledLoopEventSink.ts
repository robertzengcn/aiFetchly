import type {
  TaskCompletionController,
  DecideContext,
} from "@/service/aiTaskExecution/TaskCompletionController";
import type { TaskEvidenceService } from "@/service/aiTaskExecution/TaskEvidenceService";
import { deriveCandidateDiagnostics } from "@/service/aiTaskExecution/candidateDiagnostics";
import type {
  ObservationReceipt,
  OperationReceipt,
} from "@/service/aiTaskExecution/criteriaAdapters";
import type { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import type {
  TaskCompletionDecision,
  TaskCompletionContract,
  TaskEndCandidate,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";
import type {
  AIChatQueryCompleteEvent,
  AIChatQueryErrorEvent,
  AIChatQueryEvent,
  AIChatQueryEventSink,
} from "@/service/AIChatQueryEvents";
import type { AIChatRecoveryReason } from "@/service/AIChatRecoveryTypes";

/** Terminal outcome the runner derives from the engine event stream. */
export type ScheduledTurnOutcome =
  | {
      readonly kind: "completed";
      readonly assistantMessageId: string;
      readonly content: string;
      readonly model?: string;
      readonly totalTokens?: number;
    }
  | {
      readonly kind: "cancelled";
      readonly assistantMessageId?: string;
      readonly content: string;
    }
  | {
      readonly kind: "failed";
      readonly assistantMessageId?: string;
      /** Raw, human-readable failure text (renderer display + run row). */
      readonly errorMessage: string;
      /**
       * Stable typed reason code (TASK_EXECUTION_REASON_CODES vocabulary)
       * when the failure came from a classified source (a controller
       * decision). Raw transport text stays ONLY in errorMessage so the
       * durable reason-code column and the §17 histogram never see
       * model/provider text.
       */
      readonly reasonCode?: string;
    }
  | {
      readonly kind: "blocked";
      readonly assistantMessageId?: string;
      readonly reason: string;
    }
  // Unit 6 (GAP-S2 #8): policy-driven outcomes. `incomplete` carries the
  // controller's reason code + remaining work; `missing_outcome` is the
  // fail-closed result when the consult errored or the stream died without
  // a terminal event (AC-15/17: never fall back to success).
  | {
      readonly kind: "incomplete";
      readonly assistantMessageId?: string;
      readonly content: string;
      readonly reasonCode: string;
      readonly remainingWork: readonly string[];
    }
  | {
      readonly kind: "missing_outcome";
      readonly assistantMessageId?: string;
      readonly reasonCode: string;
    };

/**
 * Constructor-injected policy binding (Unit 6, GAP-S2 #8, D6/D5). Supplied
 * only by main-process code (the runner) — never renderer input. When
 * present AND the completion-policy flag is on, the sink consults the
 * controller on the `complete` event BEFORE the first-wins guard commits a
 * blind `completed` outcome (FR-05: the decision, not the transport event,
 * decides the outcome).
 */
export interface ScheduledLoopPolicyBinding {
  readonly executionId: string;
  readonly controller: TaskCompletionController;
  readonly budget?: TaskRunBudget;
  readonly contract?: TaskCompletionContract | null;
  readonly route: TaskExecutionRoute;
  readonly expectedVersion: number;
  /**
   * T16 / NFR-12 / AC-12/32: the completion-policy flag value FROZEN at
   * enrollment time (when the runner constructed this binding). The sink's
   * consult and failOutstanding paths check this frozen value, NOT the live
   * runtime flag — turning the flag off after enrollment cannot convert
   * accepted unfinished scheduled work to unchecked success (the blind
   * `completed` mapping at line 131-137 would otherwise run). Optional so
   * flag-off callers and tests can omit it; when absent the sink treats the
   * binding as not-accepted (blind legacy mapping, byte-identical).
   */
  readonly policyAccepted?: boolean;
  /**
   * T02 (FR-05/07, AC-17/30): read the decision the loop's in-loop consult
   * already recorded. With Option A the scheduled runner builds a
   * `LoopTaskExecutionBinding` and the engine's loop consults at
   * round_cap/response_end, recording the decision via `recordDecision`.
   * This closure reads the same slot, so the sink's `complete`-event consult
   * does NOT re-consult the controller (which could disagree — the blind
   * fallback below has no evidence and would overwrite a `verified_complete`
   * with `incomplete`). When the slot is empty (the loop exited without
   * consulting), the sink falls back to its own evidence-backed consult.
   * Optional so flag-off callers, tests, and the legacy Slice 1 path (no
   * loop binding → no slot) can omit it; when absent the sink always
   * fallback-consults (byte-identical to pre-T02 behavior).
   */
  readonly getDecision?: () => TaskCompletionDecision | null;
  /**
   * T02 (FR-02/05): evidence service for the sink's fallback consult. When
   * `getDecision` returns null the sink consults the controller WITH evidence
   * (mirroring the engine's `finalizeManualAtCompleteGate` fallback) so a
   * `verified_complete` decision is real, not a blind guess. Optional so
   * flag-off callers and tests can omit it; when absent the fallback consult
   * has no evidence (byte-identical to pre-T02 behavior).
   */
  readonly evidenceService?: TaskEvidenceService;
  /**
   * T02 (FR-05): evidence context for the fallback consult. Carries the
   * final assistant content + a `loop_consult`-style source tag so the
   * controller's evidence evaluation has the same inputs as the engine's
   * manual-gate fallback. Optional so flag-off callers and tests can omit
   * it; when absent the fallback consult has no evidence context.
   *
   * T03 (FR-03/04/24, AC-32): the context also carries the authoritative
   * providers (observation / operation-receipt / checker dispatch / artifact
   * base dir) and a `resolveExpectedStateVersion` closure that reads the
   * CAS token fresh at consult time (evidence writes bump the version, so a
   * frozen token would mismatch). The sink threads these into the
   * `DecideContext.evidenceContext` it builds for the fallback consult so
   * evidence rows persist before terminal delivery.
   */
  readonly evidenceContext?: {
    readonly content: string;
    readonly source: string;
    readonly sourceRevision: string;
    readonly checkerDispatch?: (prompt: string, signal?: AbortSignal) => Promise<string>;
    readonly observationProvider?: (targetId: string) => Promise<ObservationReceipt | null>;
    readonly operationReceiptProvider?: (targetId: string) => Promise<OperationReceipt | null>;
    readonly artifactBaseDir?: string;
    readonly abortSignal?: AbortSignal;
    readonly resolveExpectedStateVersion?: () => Promise<number | undefined>;
  };
}

/**
 * Event sink for scheduled-loop turns. Captures the terminal result data the
 * runner needs to finalize the run row, and intentionally does NOT forward
 * stream chunks to any renderer (design §13.2). Pause conditions
 * (plan_submitted / ask_user_question / plan_blocked_tool) are recorded so the
 * runner can pause the schedule with a clear reason (FR-16).
 */
export class ScheduledLoopEventSink implements AIChatQueryEventSink {
  private outcome: ScheduledTurnOutcome | null = null;
  private readonly forwarder?: (event: AIChatQueryEvent) => void;
  private readonly policyBinding?: ScheduledLoopPolicyBinding;
  /**
   * T21b (FR-05/06/16, AC-12/30): the classified recovery reason from the
   * most recent `recovery_status` event for this turn. The engine's recovery
   * layer classifies transport failures (network/timeout/rate_limit/overload/
   * server_error/output_limit/context_overflow/media_overflow/model_unavailable
   * are recoverable; auth/quota/cancelled/non_recoverable are permanent). The
   * sink does NOT itself classify — it captures the recovery layer's verdict
   * so the error-event consult can thread it as `DecideContext.recoveryReason`
   * for the controller to map distinctly (auth→AUTH_FAILURE, quota→
   * QUOTA_EXHAUSTED, non_recoverable→NON_RECOVERABLE; recoverable reasons
   * stay a controller-decided incomplete). Absent when no recovery_status fired
   * (the error was unrecoverable from the start, or recovery gave up silently).
   */
  private lastRecoveryReason: AIChatRecoveryReason | null = null;
  /**
   * Resolves when a terminal outcome is captured (or the run is force-failed
   * via {@link failOutstanding}). Stays pending across a permission pause so
   * the runner can await it instead of treating the pause-resolved
   * `submitMessage` as a silent `NO_TERMINAL_EVENT` failure (which would
   * unregister the engine before the user can grant/deny).
   */
  private readonly outcomePromise: Promise<ScheduledTurnOutcome>;
  private resolveOutcome!: (outcome: ScheduledTurnOutcome) => void;

  constructor(
    forwarder?: (event: AIChatQueryEvent) => void,
    policyBinding?: ScheduledLoopPolicyBinding
  ) {
    this.forwarder = forwarder;
    this.policyBinding = policyBinding;
    this.outcomePromise = new Promise<ScheduledTurnOutcome>((resolve) => {
      this.resolveOutcome = resolve;
    });
  }

  emit(event: AIChatQueryEvent): void {
    // Forward raw events (tokens, tool calls) for optional live streaming
    // BEFORE terminal capture so the last token is not lost.
    if (this.forwarder) {
      try {
        this.forwarder(event);
      } catch {
        /* forwarding failures must never affect the run */
      }
    }
    if (this.outcome) return; // terminal already recorded
    switch (event.type) {
      case "complete":
        // Unit 6 (FR-05): when the policy binding is present and was
        // accepted at enrollment (T16: frozen flag value, not the live
        // runtime flag), the controller's decision — not the transport
        // event — decides the outcome. The consult is fire-and-forget:
        // emit() stays sync, and the commit happens when the decision
        // resolves. Flag-off or no binding keeps the blind mapping
        // byte-identical to Slice 1.
        if (this.policyBinding?.policyAccepted) {
          this.consultPolicyOnComplete(event);
          return;
        }
        this.commitOutcome({
          kind: "completed",
          assistantMessageId: event.messageId,
          content: event.fullContent,
          model: event.model,
          totalTokens: event.totalTokens,
        });
        break;
      case "cancelled":
        this.commitOutcome({
          kind: "cancelled",
          assistantMessageId: event.messageId,
          content: event.fullContent,
        });
        break;
      case "error":
        // T21b (FR-05/06/16, AC-12/30, audit line 312): when the policy
        // binding is present and accepted, a transport error is NOT a blind
        // `failed` — the controller must decide. The engine's recovery layer
        // already classified the reason (network/timeout/rate_limit/overload/
        // server_error/output_limit/context_overflow/media_overflow/
        // model_unavailable are RECOVERABLE and stay a controller-decided
        // incomplete; auth/quota/cancelled/non_recoverable are permanent and
        // map to distinct reason codes). Hold the error for that decision
        // instead of first-wins committing `failed` — the controller's
        // verdict wins over the transport failure. Flag-off / no binding
        // keeps the blind `failed` byte-identical to Slice 1.
        if (this.policyBinding?.policyAccepted) {
          this.consultPolicyOnError(event);
          return;
        }
        this.commitOutcome({
          kind: "failed",
          assistantMessageId: event.messageId,
          errorMessage: event.errorMessage,
        });
        break;
      case "plan_submitted":
        this.commitOutcome({
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        });
        break;
      case "ask_user_question":
        this.commitOutcome({
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        });
        break;
      case "plan_blocked_tool":
        this.commitOutcome({
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        });
        break;
      case "recovery_status":
        // T21b (FR-05/06/16, AC-12/30): capture the recovery layer's
        // classified reason so the error-event consult (if the loop
        // ultimately fails) can thread it as `DecideContext.recoveryReason`
        // for distinct mapping. Non-terminal — does not commit an outcome.
        this.lastRecoveryReason = event.reason;
        break;
      default:
        // Non-terminal events (token, tool_call, tool_progress, usage_update,
        // plan_state, retry_connect) are ignored — no renderer to stream to
        // in the scheduled path.
        break;
    }
  }

  /**
   * Consult the completion controller on the `complete` event (FR-05, AC-17).
   *
   * T02 (D3): with Option A the loop's in-loop consult already recorded a
   * decision via `recordDecision`. Read that slot FIRST (no double-consult —
   * the blind fallback below has no evidence and could disagree, overwriting
   * a `verified_complete` with `incomplete`). Only when the slot is empty
   * (the loop exited without consulting) does the sink fall back to its own
   * consult, now WITH evidence so a `verified_complete` is real.
   *
   * Maps the decision onto a ScheduledTurnOutcome:
   *   - verified_complete → kind "completed" (§6.1 mapping)
   *   - incomplete → kind "incomplete" (reasonCode + remainingWork)
   *   - failed / timeout → kind "failed"
   *   - needs_user_input / blocked_by_policy → kind "blocked" (FR-12 pause)
   *   - cancelled → kind "cancelled"
   *   - finish_response → kind "incomplete" RESPONSE_ENDED (the stream ended
   *     without the task's work being verified)
   *   - continue (defensive at response_end — the loop is gone; a
   *     continuation cannot be dispatched from the sink) → kind "incomplete"
   *     NO_PROGRESS
   * On a consult error the sink commits missing_outcome (NEVER success —
   * AC-15/17). Every commit path resolves the outstanding wait exactly once.
   */
  private consultPolicyOnComplete(event: AIChatQueryCompleteEvent): void {
    const binding = this.policyBinding;
    if (!binding) return;
    const assistantMessageId = event.messageId;
    // Fail-closed commit: a broken consult can never become a success
    // (AC-17) and must never throw out of the sync emit() path.
    const commitMissing = (): void => {
      this.commitOutcome({
        kind: "missing_outcome",
        assistantMessageId,
        reasonCode: "MISSING_TASK_OUTCOME",
      });
    };
    const commitFromDecision = (decision: TaskCompletionDecision): void => {
      const outcome = mapDecisionToOutcome(decision, assistantMessageId);
      if (!outcome) {
        commitMissing();
        return;
      }
      this.commitOutcome(outcome);
    };

    // T02 D3: read the slot the loop's in-loop consult populated. If set,
    // honor it — the loop already evaluated evidence; re-consulting here
    // (without evidence in the blind pre-T02 path) could overwrite a real
    // verified_complete with incomplete.
    const slotDecision = binding.getDecision?.() ?? null;
    if (slotDecision) {
      try {
        commitFromDecision(slotDecision);
      } catch {
        commitMissing();
      }
      return;
    }

    // Fallback: the loop exited without consulting (e.g. a flag-off
    // midstream left the binding accepted but the loop never reached a
    // consult site, or the stream died right at response_end before the
    // round_cap consult). Consult WITH evidence now (mirrors the engine's
    // `finalizeManualAtCompleteGate` fallback, lines 3151-3181) so a
    // verified_complete decision is real, not a blind guess.
    try {
      // T21a: derive provenance/streamTerminalSeen/safetyRestriction from the
      // actual finishReason + content — do NOT hardcode "provider terminal,
      // no restriction". The complete event's finishReason is optional/
      // nullable (null/missing → real missing-terminal case → STREAM_INCOMPLETE
      // downstream, not a stamped "provider terminal").
      const finishReason =
        (event as { finishReason?: string | null }).finishReason ?? null;
      const diagnostics = deriveCandidateDiagnostics({
        finishReason,
        content: event.fullContent ?? "",
      });
      const candidate: TaskEndCandidate = {
        candidateId: `cand:${binding.executionId}:response_end`,
        executionId: binding.executionId,
        content: event.fullContent ?? "",
        finishReason,
        provenance: diagnostics.provenance,
        streamTerminalSeen: diagnostics.streamTerminalSeen,
        boundary: "response_end",
        pendingPermission: false,
        pendingQuestion: false,
        pendingPlanApproval: false,
        safetyRestriction: diagnostics.safetyRestriction,
      };
      // T03: thread the authoritative providers + read `expectedStateVersion`
      // fresh at consult time so evidence writes persist (AC-32). The
      // providers are captured from the binding's evidenceContext; the
      // version is resolved via `resolveExpectedStateVersion` (the enroller
      // wires this to `execModule.getExecution`).
      const buildContext = async (): Promise<DecideContext> => {
        const baseContext = binding.evidenceContext;
        if (!baseContext) {
          return {
            route: binding.route,
            budget: binding.budget,
            contract: binding.contract ?? undefined,
            evidenceService: binding.evidenceService,
            evidenceContext: undefined,
          };
        }
        const expectedStateVersion = await baseContext.resolveExpectedStateVersion?.();
        return {
          route: binding.route,
          budget: binding.budget,
          contract: binding.contract ?? undefined,
          evidenceService: binding.evidenceService,
          evidenceContext: {
            content: baseContext.content,
            source: baseContext.source,
            sourceRevision: baseContext.sourceRevision,
            checkerDispatch: baseContext.checkerDispatch,
            observationProvider: baseContext.observationProvider,
            operationReceiptProvider: baseContext.operationReceiptProvider,
            artifactBaseDir: baseContext.artifactBaseDir,
            // T04: thread the run-scoped abort signal into the fallback
            // checker dispatch (Stop / run-cancel → unknown, AC-24).
            abortSignal: baseContext.abortSignal,
            expectedStateVersion,
          },
        };
      };
      void Promise.resolve(buildContext())
        .then((context) =>
          Promise.resolve(binding.controller.decide(candidate, context))
        )
        .then((decision: TaskCompletionDecision) => {
          if (!decision) {
            commitMissing();
            return;
          }
          commitFromDecision(decision);
        })
        .catch(() => commitMissing());
    } catch {
      commitMissing();
    }
  }

  /**
   * Consult the completion controller on the `error` event (T21b, FR-05/06/16,
   * AC-12/30). The audit (line 312) flagged the sink's first-wins blind
   * `failed` commit as separate from a recovery decision — when the policy
   * is accepted, the controller must decide the outcome instead.
   *
   * The candidate is built from transport diagnostics: a transport error
   * means the stream did NOT reach a provider terminal, so
   * `deriveCandidateDiagnostics({ hadTransportError: true })` yields
   * `provenance: "unknown", streamTerminalSeen: false` (a missing-terminal
   * case → STREAM_INCOMPLETE downstream). The captured `recovery_status`
   * reason is threaded as `DecideContext.recoveryReason` so the controller
   * maps auth/quota/non_recoverable to distinct permanent reason codes
   * (AUTH_FAILURE / QUOTA_EXHAUSTED / NON_RECOVERABLE); recoverable reasons
   * (network, timeout, rate_limit, overload, server_error, output_limit,
   * context_overflow, media_overflow, model_unavailable) fall through to a
   * controller-decided incomplete — held for a real decision, never a blind
   * success. On consult error → `missing_outcome` (fail-closed, AC-17).
   */
  private consultPolicyOnError(event: AIChatQueryErrorEvent): void {
    const binding = this.policyBinding;
    if (!binding) return;
    // AIChatQueryErrorEvent.messageId is optional (a turn that died before the
    // assistant message was allocated has no id); mapDecisionToOutcome takes a
    // required string. Coerce to the binding's executionId fallback so the
    // outcome always carries a non-empty identifier.
    const assistantMessageId = event.messageId ?? binding.executionId;
    const commitMissing = (): void => {
      this.commitOutcome({
        kind: "missing_outcome",
        assistantMessageId,
        reasonCode: "MISSING_TASK_OUTCOME",
      });
    };
    // If the loop already recorded a decision (slot-first, T02), honor it —
    // the loop's consult evaluated the failure with full evidence.
    const slotDecision = binding.getDecision?.() ?? null;
    if (slotDecision) {
      const mapped = mapDecisionToOutcome(slotDecision, assistantMessageId);
      if (mapped) {
        this.commitOutcome(mapped);
      } else {
        commitMissing();
      }
      return;
    }
    // Build the transport-error candidate from real diagnostics. The error
    // event carries no finishReason (the stream failed, not ended), so the
    // diagnostics helper sees `hadTransportError: true` → unknown provenance
    // + streamTerminalSeen=false. A content_filter/refusal cannot surface
    // here (no content reached), so safetyRestriction is false. The partial
    // content (if any) is preserved in the candidate for the summary.
    const partialContent = "";
    const diagnostics = deriveCandidateDiagnostics({
      finishReason: null,
      content: partialContent,
      hadTransportError: true,
    });
    const candidate: TaskEndCandidate = {
      candidateId: `cand:${binding.executionId}:transport_error`,
      executionId: binding.executionId,
      content: partialContent,
      finishReason: null,
      provenance: diagnostics.provenance,
      streamTerminalSeen: diagnostics.streamTerminalSeen,
      boundary: "response_end",
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: diagnostics.safetyRestriction,
    };
    const buildContext = async (): Promise<DecideContext> => {
      const baseContext = binding.evidenceContext;
      const expectedStateVersion =
        await baseContext?.resolveExpectedStateVersion?.();
      if (!baseContext) {
        return {
          route: binding.route,
          budget: binding.budget,
          contract: binding.contract ?? undefined,
          evidenceService: binding.evidenceService,
          evidenceContext: undefined,
          // T21b: thread the recovery layer's classified reason so the
          // controller maps permanent vs recoverable distinctly.
          recoveryReason: this.lastRecoveryReason ?? undefined,
        };
      }
      return {
        route: binding.route,
        budget: binding.budget,
        contract: binding.contract ?? undefined,
        evidenceService: binding.evidenceService,
        evidenceContext: {
          content: baseContext.content,
          source: baseContext.source,
          sourceRevision: baseContext.sourceRevision,
          checkerDispatch: baseContext.checkerDispatch,
          observationProvider: baseContext.observationProvider,
          operationReceiptProvider: baseContext.operationReceiptProvider,
          artifactBaseDir: baseContext.artifactBaseDir,
          abortSignal: baseContext.abortSignal,
          expectedStateVersion,
        },
        recoveryReason: this.lastRecoveryReason ?? undefined,
      };
    };
    void Promise.resolve(buildContext())
      .then((context) =>
        Promise.resolve(binding.controller.decide(candidate, context))
      )
      .then((decision: TaskCompletionDecision) => {
        if (!decision) {
          commitMissing();
          return;
        }
        const mapped = mapDecisionToOutcome(decision, assistantMessageId);
        if (!mapped) {
          commitMissing();
          return;
        }
        // T21b: preserve the transport error message on the failed outcome
        // so the renderer can surface why the turn died (the controller's
        // decision maps the OUTCOME kind; the message is the transport's).
        if (mapped.kind === "failed" && event.errorMessage) {
          this.commitOutcome({
            ...mapped,
            errorMessage: event.errorMessage,
          });
          return;
        }
        this.commitOutcome(mapped);
      })
      .catch(() => commitMissing());
  }

  /**
   * Record a terminal outcome and resolve the outstanding wait. Idempotent —
   * the first caller wins, subsequent calls are no-ops (mirrors the
   * `this.outcome` guard in {@link emit}).
   */
  private commitOutcome(outcome: ScheduledTurnOutcome): void {
    if (this.outcome) return;
    this.outcome = outcome;
    this.resolveOutcome(outcome);
  }

  /**
   * Force-resolve the terminal wait with a failure outcome (e.g. when the
   * permission backstop auto-deny could not resume the loop). The runner uses
   * this to unblock {@link waitForTerminalOutcome} without a real terminal
   * event. No-op when a terminal outcome was already captured.
   *
   * Unit 6 (AC-15/18): when the policy binding is present and the flag is on,
   * a stream that died without a terminal event commits missing_outcome with
   * STREAM_INCOMPLETE — never a verified/success outcome.
   */
  failOutstanding(errorMessage: string): void {
    // T16: frozen flag-at-enrollment value — a stream that died without a
    // terminal event commits missing_outcome even if the flag was turned
    // off midstream (NFR-12, AC-12/32).
    if (this.policyBinding?.policyAccepted) {
      this.commitOutcome({
        kind: "missing_outcome",
        reasonCode: "STREAM_INCOMPLETE",
      });
      return;
    }
    this.commitOutcome({ kind: "failed", errorMessage });
  }

  /** The captured terminal outcome, or null if the turn ended without one. */
  getOutcome(): ScheduledTurnOutcome | null {
    return this.outcome;
  }

  /**
   * Resolve when the sink captures a terminal outcome (or
   * {@link failOutstanding} is called). The runner awaits this when
   * `submitMessage` resolved without a terminal outcome because the turn
   * paused for permission — the resumed loop (grant/deny/backstop) later
   * emits the terminal event that resolves this promise.
   */
  waitForTerminalOutcome(): Promise<ScheduledTurnOutcome> {
    return this.outcomePromise;
  }
}

/**
 * Map a TaskCompletionDecision onto a ScheduledTurnOutcome (Unit 6, FR-05/12,
 * §6.1). Shared by the sink's consult path so the mapping stays in one place.
 */
export function mapDecisionToOutcome(
  decision: TaskCompletionDecision,
  assistantMessageId: string
): ScheduledTurnOutcome {
  switch (decision.type) {
    case "finish":
      switch (decision.outcome) {
        case "verified_complete":
          return {
            kind: "completed",
            assistantMessageId,
            content: decision.summary,
          };
        case "incomplete":
          return {
            kind: "incomplete",
            assistantMessageId,
            content: decision.summary,
            reasonCode: decision.reasonCode,
            remainingWork: decision.remainingWork,
          };
        case "needs_user_input":
        case "blocked_by_policy":
          return {
            kind: "blocked",
            assistantMessageId,
            reason: decision.reasonCode,
          };
        case "cancelled":
          return { kind: "cancelled", assistantMessageId, content: decision.summary };
        case "failed":
        case "timeout":
          return {
            kind: "failed",
            assistantMessageId,
            errorMessage: decision.summary,
            // D7: carry the controller's typed reason code so the runner's
            // finalize mapping writes a STABLE code into the durable
            // outcome_reason_code column (varchar(64) + §17 histogram key),
            // not the raw display text. errorMessage stays the transport/
            // summary text for renderer display (T21b).
            reasonCode: decision.reasonCode,
          };
      }
      break;
    case "finish_response":
      return {
        kind: "incomplete",
        assistantMessageId,
        content: "",
        reasonCode: "RESPONSE_ENDED",
        remainingWork: [],
      };
    case "continue":
      // Defensive: at response_end the loop is already gone, so a
      // continuation cannot be dispatched from the sink. Honest outcome is
      // incomplete (NO_PROGRESS), never a success.
      return {
        kind: "incomplete",
        assistantMessageId,
        content: "",
        reasonCode: "NO_PROGRESS",
        remainingWork: decision.unmetCriterionIds,
      };
    case "wait":
      return {
        kind: "blocked",
        assistantMessageId,
        reason: decision.reason,
      };
    case "yield_owner":
      return {
        kind: "incomplete",
        assistantMessageId,
        content: "",
        reasonCode: "NO_PROGRESS",
        remainingWork: [],
      };
  }
}
