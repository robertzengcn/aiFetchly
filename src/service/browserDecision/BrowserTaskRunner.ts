/**
 * BrowserTaskRunner (PRD §6.2–6.6; technical design §6, §11–§12).
 *
 * One outer tool invocation (`browser_execute_task`) runs the full
 * observe → candidates → decide → validate → execute → observe loop without
 * re-entering the main chat loop. Provider proposals only — the desktop owns
 * execution authority (D-01). Intermediate observations stay out of chat
 * history; the final result carries a compact final observation (D-FR-10b).
 */
import { randomUUID } from "node:crypto";
import type {
  BrowserDecisionClient,
  BrowserDecisionInput,
  BrowserDecisionResult,
  BrowserDecisionRouteKind,
  BrowserProposedAction,
} from "@/entityTypes/browserDecisionTypes";
import { decisionInputSchema } from "@/schemas/api/browserDecision";
import { validateDecisionActionStructure } from "@/schemas/api/browserDecision";
import {
  buildTaskBudget,
  limitsForRoute,
  type MutableTaskBudget,
} from "@/service/browserDecision/BrowserTaskLimits";
import {
  buildDecisionCandidates,
  RUNNER_OPERATIONS,
} from "@/service/browserDecision/BrowserCandidateBuilder";
import { getDefaultAgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";

export interface CompletionCriterion {
  readonly kind: "url_contains" | "element_present" | "extract_nonempty" | "text_contains";
  readonly value: string;
}

export interface BrowserTaskInput {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly goal: string;
  readonly constraints?: readonly string[];
  readonly completionCriteria?: readonly CompletionCriterion[];
  readonly budget?: Partial<MutableTaskBudget>;
}

export type BrowserTaskTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "partial"
  | "interrupted";

export interface BrowserTaskResult {
  readonly taskId: string;
  readonly sessionId: string;
  readonly status: BrowserTaskTerminalStatus;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly extracted: readonly unknown[];
  readonly finalObservation: {
    readonly url: string | null;
    readonly title: string | null;
    readonly elements: ReadonlyArray<{ ref: string; role: string; name: string }>;
    readonly visibleText: string;
  } | null;
  readonly counts: {
    readonly leafSteps: number;
    readonly decisionRequests: number;
    readonly recoveryCalls: number;
  };
  readonly userInterventions: ReadonlyArray<{
    readonly reason: string;
    readonly startedAtEpochMs: number;
    readonly durationMs: number | null;
  }>;
}

export interface RunnerDeps {
  /** Authorized execution seam: observe + runActions with risk/approval. */
  readonly observe: (sessionId: string) => Promise<RunnerObservation | null>;
  readonly runActions: (
    sessionId: string,
    program: { actions: RunnerAction[] },
  ) => Promise<RunnerExecutionResult>;
  readonly decisionClient: BrowserDecisionClient;
  readonly route: BrowserDecisionRouteKind;
  readonly signal?: AbortSignal;
  /**
   * T14 (C-FR-02/D-FR-10a): a handoff stop BLOCKS inside the job for the
   * user's dialog action. resolved resumes the loop with a fresh
   * observation; expired/cancelled end the task. User-wait time is
   * excluded from active budgets by the control service. Omit to keep
   * the terminal-stop behavior.
   */
  readonly awaitHandoff?: (
    reason: string,
    /** R05: the runner's actual task id — not the admission ref. */
    taskId: string
  ) => Promise<"resolved" | "expired" | "cancelled">;
  /**
   * T19: durable cursor hooks (best-effort persistence; failures never
   * block execution but ARE logged by the module).
   */
  readonly persistCursor?: (input: {
    phase: string;
    leafSteps: number;
    decisionRequests: number;
    recoveryCalls: number;
  }) => Promise<void>;
  readonly persistActionIntent?: (actionType: string) => Promise<void>;
  readonly persistActionOutcome?: (
    outcome: "confirmed" | "no_effect" | "unknown"
  ) => Promise<void>;
  readonly control?: ReturnType<typeof getDefaultAgentTaskControlService>;
  readonly now?: () => number;
}

export interface RunnerObservation {
  readonly observationId: string;
  readonly pageRevision: number;
  readonly url: string;
  readonly title: string;
  readonly elements: ReadonlyArray<{
    ref: string;
    role: string;
    name: string;
    valueSummary?: string | null;
    disabled?: boolean | null;
  }>;
  readonly visibleText: string;
}

export type RunnerAction =
  | { type: "go_back" }
  | { type: "navigate"; url: string }
  | { type: "extract"; refs: string[] }
  | { type: "click"; ref: string; pageRevision: number; expectedRole: string; expectedName: string }
  | { type: "fill"; ref: string; pageRevision: number; expectedRole: string; expectedName: string; value: string }
  | { type: "select"; ref: string; pageRevision: number; expectedRole: string; expectedName: string; values: string[] }
  | { type: "press_key"; key: string }
  | { type: "scroll"; direction: "up" | "down"; amount: number }
  | { type: "hover"; ref: string; pageRevision: number; expectedRole: string; expectedName: string }
  | { type: "wait_for"; condition: "text"; text: string; timeoutMs: number };

export interface RunnerExecutionResult {
  readonly effect: "known" | "unknown";
  readonly pageRevision: number;
  readonly results: ReadonlyArray<{
    readonly success: boolean;
    readonly errorCode: string | null;
  }>;
  /** Policy stop from the authorized seam (never bypassed, never retried). */
  readonly stopCode?: "approval_required" | "handoff_required";
  /** T18: extracted values (EXTRACT) for completion criteria. */
  readonly extracted?: readonly unknown[];
}



export class BrowserTaskRunner {
  private readonly deps: RunnerDeps;
  private readonly budget: MutableTaskBudget;
  private readonly _taskId = `task_${randomUUID().slice(0, 12)}`;

  /** R03: the runner's task id — the single identity for all persistence. */
  public get taskId(): string {
    return this._taskId;
  }
  private leafSteps = 0;
  private decisionRequests = 0;
  private recoveryCalls = 0;
  private lastFailureKey: string | null = null;
  private consecutiveEquivalentFailures = 0;
  private readonly maxEquivalentFailures: number;
  /** T18: a bounded recovery decision awaiting execution. */
  private pendingRecovery: BrowserDecisionResult | null = null;
  /** T18: chat-route progress check (D-FR-19) — digest every 5 steps. */
  private lastProgressDigest: string | null = null;
  private stepsSinceProgressCheck = 0;

  constructor(
    private readonly input: BrowserTaskInput,
    deps: RunnerDeps
  ) {
    this.deps = deps;
    this.maxEquivalentFailures =
      limitsForRoute(deps.route).consecutiveEquivalentFailures;
    this.budget = buildTaskBudget(deps.route, input.budget);
  }

  public async run(): Promise<BrowserTaskResult> {
    const control = this.deps.control ?? getDefaultAgentTaskControlService();
    control.register(this.taskId, this.input.conversationId);
    const gate = control.getGate(this.taskId);
    const signal = this.deps.signal ?? new AbortController().signal;
    const evidence: string[] = [];
    const extracted: unknown[] = [];
    let observation = await this.deps.observe(this.input.sessionId);

    try {
      while (this.leafSteps < this.budget.leafSteps && this.decisionRequests < this.budget.decisionRequests) {
        if (signal.aborted) {
          return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
        }
        // C-FR-05: safe-point control gate.
        await gate.waitUntilOpen(signal);
        // PRD §8 route budget: active runtime excludes user waits (D-21).
        if (control.activeTimeMs(this.taskId) > this.budget.activeRuntimeMs) {
          return this.terminal("partial", "active_runtime_exhausted", evidence, extracted, observation);
        }
        if (!observation) {
          observation = await this.deps.observe(this.input.sessionId);
          if (!observation) {
            return this.terminal("failed", "observation_unavailable", evidence, extracted, null);
          }
        }

        const candidates = buildDecisionCandidates({ elements: observation.elements });
        const decisionInput = this.buildDecisionInput(observation, candidates);
        let decision: BrowserDecisionResult;
        const generationBeforeDecide = control.getResumeGeneration(this.taskId);
        if (this.pendingRecovery) {
          // T18: consume the bounded recovery decision through the normal
          // validate/execute path (no second execution machinery).
          decision = this.pendingRecovery;
          this.pendingRecovery = null;
          this.decisionRequests++;
        } else
        try {
          // T09: each provider attempt is bounded by an abortable timer
          // capped by the remaining active runtime (PRD §8 request
          // deadline), and cancelled when the task aborts.
          const remainingActiveMs = Math.max(
            0,
            this.budget.activeRuntimeMs - control.activeTimeMs(this.taskId)
          );
          const deadlineMs = Math.min(
            decisionInput.deadline_ms,
            remainingActiveMs > 0 ? remainingActiveMs : decisionInput.deadline_ms
          );
          const attemptController = new AbortController();
          const onOuterAbort = (): void => attemptController.abort();
          signal.addEventListener("abort", onOuterAbort, { once: true });
          const timer = setTimeout(
            () => attemptController.abort(),
            deadlineMs
          );
          try {
            decision = await this.deps.decisionClient.decide(
              decisionInput,
              attemptController.signal
            );
          } finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", onOuterAbort);
          }
          this.decisionRequests++;
        } catch (error) {
          return this.terminal(
            "failed",
            `decision_client_error:${error instanceof Error ? error.message : "unknown"}`,
            evidence,
            extracted,
            observation
          );
        }

        if (decision.status !== "decided") {
          if (decision.status === "llm_required") {
            return this.terminal(
              "partial",
              `escalated:${decision.reason_code}`,
              evidence,
              extracted,
              observation
            );
          }
          return this.terminal(
            "failed",
            `decision_${decision.status}:${decision.reason_code}`,
            evidence,
            extracted,
            observation
          );
        }

        // T08: the decision may have taken a while — re-check pause/stop
        // BEFORE acting on it. Held proposals are discarded on resume
        // (C-FR-06); a fresh decision happens after the gate reopens.
        try {
          await gate.waitUntilOpen(signal);
        } catch {
          return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
        }
        if (signal.aborted) {
          return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
        }
        // R04/C-FR-06: if the gate closed and reopened DURING inference,
        // the user paused and resumed — the held proposal is DISCARDED.
        // The loop re-observes and makes a fresh decision on the next
        // iteration (the gate now being open, control state is running).
        if (
          control.getResumeGeneration(this.taskId) > generationBeforeDecide
        ) {
          evidence.push("decision_discarded_after_resume");
          observation = await this.deps.observe(this.input.sessionId);
          continue;
        }
        const action = decision.action;
        if (action.operation === "DONE") {
          // D-AC-09/R16: verification uses FRESH state. If the fresh
          // observation FAILS, the task is partial/unverified — never
          // completed using the stale pre-action snapshot.
          const freshObservation = await this.deps.observe(this.input.sessionId);
          if (!freshObservation) {
            return this.terminal(
              "partial",
              "done_unverified_observation_unavailable",
              [...evidence, "done:fresh_observation_failed"],
              extracted,
              observation
            );
          }
          observation = freshObservation;
          const verification = this.verifyCompletion(observation, extracted);
          if (verification.verified) {
            return this.terminal("completed", "verified", [...evidence, verification.evidence], extracted, observation);
          }
          // D-AC-09: a DONE without independent verification is not success.
          if (this.recoveryCalls >= this.budget.recoveryCalls) {
            return this.terminal("partial", "verification_failed_budget_exhausted", evidence, extracted, observation);
          }
          this.recoveryCalls++;
          evidence.push("done_unverified:continuing");
          continue;
        }
        if (action.operation === "ESCALATE") {
          return this.terminal("partial", "escalated_by_decision", evidence, extracted, observation);
        }
        if (action.operation === "WAIT") {
          await new Promise((resolve) => setTimeout(resolve, 250));
          observation = await this.deps.observe(this.input.sessionId);
          continue;
        }
        if (
          action.operation === "SCROLL_UP" ||
          action.operation === "SCROLL_DOWN" ||
          action.operation === "GO_BACK" ||
          action.operation === "PRESS_KEY" ||
          action.operation === "NAVIGATE" ||
          action.operation === "EXTRACT"
        ) {
          // T06/T07: untargeted operations take the SAME policy-stop,
          // unknown-effect, and failure accounting as targeted ones.
          // R15/D-AC-04: validate provenance BEFORE dispatch. NAVIGATE
          // must stay same-site (or an observed link); EXTRACT's target
          // must exist in the current observation's candidates.
          if (action.operation === "NAVIGATE" && action.url) {
            const { parseUrlIdentity } = await import(
              "@/service/browserDecision/RegistrableDomain"
            );
            const currentIdentity = parseUrlIdentity(observation.url);
            const targetIdentity = parseUrlIdentity(action.url);
            if (
              !targetIdentity ||
              !currentIdentity ||
              targetIdentity.registrableDomain !==
                currentIdentity.registrableDomain
            ) {
              evidence.push("navigate_not_same_site");
              continue;
            }
          }
          if (action.operation === "EXTRACT" && action.target_id) {
            const extractTarget = candidates.find(
              (c) => c.candidate_id === action.target_id
            );
            if (!extractTarget) {
              evidence.push("extract_ref_not_in_observation");
              continue;
            }
          }
          const programAction: RunnerAction | null =
            action.operation === "SCROLL_UP"
              ? { type: "scroll", direction: "up", amount: 600 }
              : action.operation === "SCROLL_DOWN"
                ? { type: "scroll", direction: "down", amount: 600 }
                : action.operation === "GO_BACK"
                  ? { type: "go_back" }
                  : action.operation === "NAVIGATE"
                    ? action.url
                      ? { type: "navigate", url: action.url }
                      : null
                    : action.operation === "EXTRACT"
                      ? action.target_id
                        ? { type: "extract", refs: [action.target_id] }
                        : null
                      : action.key
                        ? { type: "press_key", key: action.key }
                        : null;
          if (!programAction) {
            evidence.push("key_required");
            continue;
          }
          this.leafSteps++;
          await this.deps.persistActionIntent?.(action.operation);
          const execution = await this.deps.runActions(this.input.sessionId, {
            actions: [programAction],
          });
          await this.deps.persistActionOutcome?.(
            execution.effect === "unknown" ? "unknown" : "confirmed"
          );
          const processed = await this.processExecution(
            action.operation,
            null,
            execution,
            evidence
          );
          if (processed.stop) {
            return this.terminal(
              processed.stop.status,
              processed.stop.reason,
              evidence,
              extracted,
              await this.deps.observe(this.input.sessionId)
            );
          }
          if (action.operation === "EXTRACT" && execution.extracted) {
            // T18: extracted values land in the task result so the
            // extract_nonempty criterion can verify.
            extracted.push(...execution.extracted);
          }
          observation = await this.deps.observe(this.input.sessionId);
          continue;
        }

        const violation = validateDecisionActionStructure(decision, decisionInputSchema.parse(decisionInput));
        if (violation) {
          evidence.push(`invalid_decision:${violation}`);
          if (++this.consecutiveEquivalentFailures >= this.maxEquivalentFailures) {
            const recovered = await this.recoverOnce(
              decisionInput,
              `previous decision was invalid (${violation}); choose a DIFFERENT operation or ESCALATE`,
              signal
            );
            if (recovered) {
              this.consecutiveEquivalentFailures = 0;
              continue;
            }
            return this.terminal("failed", `repeated_invalid_decision:${violation}`, evidence, extracted, observation);
          }
          continue;
        }

        // Targeted operations execute one model-selected leaf action.
        const target = candidates.find((c) => c.candidate_id === action.target_id);
        if (!target) {
          evidence.push("target_not_in_observation");
          this.consecutiveEquivalentFailures++;
          continue;
        }

        const programAction = this.toRunnerAction(action, target, observation);
        if (!programAction) {
          evidence.push(`unsupported_operation:${action.operation}`);
          continue;
        }

        this.leafSteps++;
        await this.deps.persistActionIntent?.(action.operation);
        const execution = await this.deps.runActions(this.input.sessionId, {
          actions: [programAction],
        });
        await this.deps.persistActionOutcome?.(
          execution.effect === "unknown" ? "unknown" : "confirmed"
        );
                const processed = await this.processExecution(
          action.operation,
          { role: target.role, name: target.name },
          execution,
          evidence
        );
        if (processed.stop) {
          // T18: a failures-exhausted stop gets ONE bounded recovery
          // before the terminal lands; policy stops never recover.
          if (processed.stop.reason.startsWith("three_equivalent_failures")) {
            const recovered = await this.recoverOnce(
              decisionInput,
              `three equivalent failures on ${action.operation} ${target.name}: ${processed.stop.reason}`,
              signal
            );
            if (recovered) {
              this.consecutiveEquivalentFailures = 0;
              this.lastFailureKey = null;
              observation = await this.deps.observe(this.input.sessionId);
              continue;
            }
          }
          return this.terminal(
            processed.stop.status,
            processed.stop.reason,
            evidence,
            extracted,
            await this.deps.observe(this.input.sessionId)
          );
        }

        // D-FR-11: fresh observation after the action (already cached by the module).
        observation = await this.deps.observe(this.input.sessionId);
        if (!observation) {
          continue;
        }
        // T18: chat-route progress check every 5 steps.
        const progress = await this.checkProgress(
          observation,
          decisionInput,
          signal
        );
        if (progress === "no_progress") {
          return this.terminal("partial", "no_progress", evidence, extracted, observation);
        }
      }
      return this.terminal(
        "partial",
        "budget_exhausted",
        evidence,
        extracted,
        observation
      );
    } finally {
      if (control.getState(this.taskId) === "running") {
        control.setState(this.taskId, "completed");
      }
    }
  }

  private buildDecisionInput(
    observation: RunnerObservation,
    candidates: ReturnType<typeof buildDecisionCandidates>
  ): BrowserDecisionInput {
    return {
      schema_version: 1,
      request_id: `req_${randomUUID().slice(0, 8)}`,
      task_id: this.taskId,
      step_id: `step_${this.leafSteps}`,
      observation_id: observation.observationId,
      page_revision: observation.pageRevision,
      goal: this.input.goal.slice(0, 2000),
      subgoal: null,
      constraints: [...(this.input.constraints ?? [])].slice(0, 16),
      url: observation.url,
      title: observation.title.slice(0, 512),
      candidates: candidates as BrowserDecisionInput["candidates"],
      recent_actions: [],
      // D-FR-16: every offered operation is executable (T18).
      allowed_operations: RUNNER_OPERATIONS,
      deadline_ms: Math.min(this.budget.requestTimeoutMs, 30_000),
    };
  }

  /**
   * T18: ONE bounded recovery decision (D-FR-22/23). Issues a new
   * decision with the specific failure reason as the subgoal; the main
   * loop consumes it through the normal validate/execute path. Budget:
   * recoveryCalls, never reset, never recursive.
   */
  private async recoverOnce(
    decisionInput: BrowserDecisionInput,
    reason: string,
    signal: AbortSignal
  ): Promise<boolean> {
    if (this.recoveryCalls >= this.budget.recoveryCalls) {
      return false;
    }
    this.recoveryCalls++;
    const recoveryInput: BrowserDecisionInput = {
      ...decisionInput,
      step_id: `${decisionInput.step_id}_recovery${this.recoveryCalls}`,
      subgoal: reason.slice(0, 1000),
      recent_actions: [
        ...decisionInput.recent_actions,
        {
          operation: decisionInput.recent_actions.at(-1)?.operation ?? "CLICK",
          target_descriptor: null,
          outcome: "failed" as const,
          error_code: reason.slice(0, 64),
        },
      ].slice(-6),
    };
    try {
      const result = await this.deps.decisionClient.decide(
        recoveryInput,
        signal
      );
      if (result.status === "decided") {
        this.pendingRecovery = result;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * T18: chat-route progress check (D-FR-19). Every 5 leaf steps the
   * URL + visible-text digest must change; otherwise one bounded
   * recovery is attempted before the task ends no_progress.
   */
  private async checkProgress(
    observation: RunnerObservation,
    decisionInput: BrowserDecisionInput,
    signal: AbortSignal
  ): Promise<"ok" | "no_progress"> {
    this.stepsSinceProgressCheck++;
    if (this.stepsSinceProgressCheck < 5) {
      return "ok";
    }
    this.stepsSinceProgressCheck = 0;
    const digest = `${observation.url}|${observation.visibleText.slice(0, 200)}`;
    if (this.lastProgressDigest !== null && digest === this.lastProgressDigest) {
      const recovered = await this.recoverOnce(
        decisionInput,
        "no progress for 5 steps; the page did not change - try a DIFFERENT approach or ESCALATE",
        signal
      );
      if (recovered) {
        return "ok";
      }
      return "no_progress";
    }
    this.lastProgressDigest = digest;
    return "ok";
  }

  /**
   * T07: ONE post-execution path for every operation - policy stops
   * (approval/handoff) are terminal and never retried, unknown effects
   * stop the task (D-FR-26), and equivalent-failure accounting applies
   * uniformly (D-FR-25).
   */
  private async processExecution(
    operation: string,
    target: { readonly role: string; readonly name: string } | null,
    execution: RunnerExecutionResult,
    evidence: string[]
  ): Promise<{
    stop: { status: "partial" | "failed"; reason: string } | null;
    resumedFromHandoff?: boolean;
  }> {
    const label = target ? `${operation}:${target.name}` : operation;
    if (execution.stopCode === "handoff_required" && this.deps.awaitHandoff) {
      // T14/C-FR-02: block INSIDE the job for the user's dialog action.
      evidence.push(`${label}:handoff_awaited`);
      const resolution = await this.deps.awaitHandoff(
        "challenge_handoff",
        this.taskId
      );
      if (resolution === "resolved") {
        // C-FR-02: after resolution the agent MUST observe before acting.
        return { stop: null, resumedFromHandoff: true };
      }
      return {
        stop: {
          status: "partial",
          reason: resolution === "expired" ? "handoff_expired" : "handoff_cancelled",
        },
      };
    }
    if (execution.stopCode) {
      // D-AC-05: the authorized seam stopped the action. Terminal,
      // honest, and NEVER retried or bypassed.
      evidence.push(`${label}:${execution.stopCode}`);
      return { stop: { status: "partial", reason: execution.stopCode } };
    }
    evidence.push(`${label}:${execution.effect}`);
    // D-FR-26: an unknown effect never triggers a retry; reconcile state.
    if (execution.effect === "unknown") {
      return { stop: { status: "partial", reason: "unknown_execution_effect" } };
    }
    const stepResult = execution.results[execution.results.length - 1];
    if (stepResult && !stepResult.success) {
      const failureKey = `${operation}:${target?.role ?? ""}:${
        target?.name ?? ""
      }:${stepResult.errorCode}`;
      this.consecutiveEquivalentFailures =
        failureKey === this.lastFailureKey
          ? this.consecutiveEquivalentFailures + 1
          : 1;
      this.lastFailureKey = failureKey;
      if (this.consecutiveEquivalentFailures >= this.maxEquivalentFailures) {
        return {
          stop: {
            status: "failed",
            reason: `three_equivalent_failures:${stepResult.errorCode}`,
            // T18: bounded recovery happens before the terminal lands.
          },
        };
      }
    } else {
      this.consecutiveEquivalentFailures = 0;
      this.lastFailureKey = null;
    }
    return { stop: null };
  }

  private toRunnerAction(
    action: BrowserProposedAction,
    target: { role: string; name: string; candidate_id: string },
    observation: RunnerObservation
  ): RunnerAction | null {
    const expected = {
      expectedRole: target.role,
      expectedName: target.name,
    };
    switch (action.operation) {
      case "CLICK":
        return {
          type: "click",
          ref: target.candidate_id,
          pageRevision: observation.pageRevision,
          ...expected,
        };
      case "FILL":
        // D-FR-20 guard: never type an uncontrolled or empty value. The
        // decision's text channel is validated (<=2000 chars) by the
        // adapters; a missing text is an unsupported decision, not a
        // silent empty fill.
        if (!action.text) {
          return null;
        }
        return {
          type: "fill",
          ref: target.candidate_id,
          pageRevision: observation.pageRevision,
          ...expected,
          value: action.text,
        };
      case "SELECT":
        return {
          type: "select",
          ref: target.candidate_id,
          pageRevision: observation.pageRevision,
          ...expected,
          values: action.option_id ? [action.option_id] : [],
        };
      case "HOVER":
        return {
          type: "hover",
          ref: target.candidate_id,
          pageRevision: observation.pageRevision,
          ...expected,
        };
      case "PRESS_KEY":
        return { type: "press_key", key: action.key ?? "Enter" };
      default:
        return null;
    }
  }

  /** D-FR-24/11.4: deterministic completion predicates on fresh state. */
  private verifyCompletion(
    observation: RunnerObservation,
    extracted: readonly unknown[]
  ): { verified: boolean; evidence: string } {
    const criteria = this.input.completionCriteria ?? [];
    if (criteria.length === 0) {
      // No declared criteria: URL/title change vs the task start is weak
      // evidence; report unverified so callers know.
      return { verified: false, evidence: "no_completion_criteria" };
    }
    for (const criterion of criteria) {
      switch (criterion.kind) {
        case "url_contains":
          if (!observation.url.includes(criterion.value)) {
            return { verified: false, evidence: `url_miss:${criterion.value}` };
          }
          break;
        case "text_contains":
          if (!observation.visibleText.includes(criterion.value)) {
            return { verified: false, evidence: `text_miss:${criterion.value}` };
          }
          break;
        case "element_present":
          if (
            !observation.elements.some(
              (element) => element.name.includes(criterion.value) || element.role === criterion.value
            )
          ) {
            return { verified: false, evidence: `element_miss:${criterion.value}` };
          }
          break;
        case "extract_nonempty":
          if (extracted.length === 0) {
            return { verified: false, evidence: "extract_empty" };
          }
          break;
      }
    }
    return { verified: true, evidence: `verified:${criteria.length}_criteria` };
  }

  private terminal(
    status: BrowserTaskTerminalStatus,
    reason: string,
    evidence: readonly string[],
    extracted: readonly unknown[],
    observation: RunnerObservation | null
  ): BrowserTaskResult {
    const control = this.deps.control ?? getDefaultAgentTaskControlService();
    control.setState(
      this.taskId,
      status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
      reason
    );
    return {
      taskId: this.taskId,
      sessionId: this.input.sessionId,
      status,
      reason,
      evidence,
      extracted,
      finalObservation: observation
        ? {
            url: observation.url,
            title: observation.title,
            elements: observation.elements
              .slice(0, 24)
              .map((element) => ({ ref: element.ref, role: element.role, name: element.name })),
            visibleText: observation.visibleText.slice(0, 2_000),
          }
        : null,
      counts: {
        leafSteps: this.leafSteps,
        decisionRequests: this.decisionRequests,
        recoveryCalls: this.recoveryCalls,
      },
      userInterventions: control.get(this.taskId)?.interventions ?? [],
    };
  }
}
