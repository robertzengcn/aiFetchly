/**
 * BrowserTaskRunner (PRD §6.2–6.6; technical design §6, §11–§12).
 *
 * One outer tool invocation (`browser_execute_task`) runs the full
 * observe → candidates → decide → validate → execute → observe loop without
 * re-entering the main chat loop. Provider proposals only — the desktop owns
 * execution authority (D-01). Intermediate observations stay out of chat
 * history; the final result carries a compact final observation (D-FR-10b).
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  BrowserDecisionClient,
  BrowserDecisionInput,
  BrowserDecisionResult,
  BrowserDecisionRouteKind,
  BrowserDecisionOperation,
  BrowserRecentAction,
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
import { fieldIsForbiddenToFill } from "@/service/browserDecision/FieldValueService";
import { registrableDomainOf } from "@/service/browserDecision/RegistrableDomain";

export interface CompletionCriterion {
  readonly kind: "url_contains" | "element_present" | "extract_nonempty" | "text_contains";
  readonly value: string;
}

export interface BrowserTaskInput {
  readonly sessionId: string;
  readonly conversationId: string;
  /**
   * W06/M-FR-08: the ROOT (parent) conversation for sub-agent-owned
   * tasks — user-visible waits (credential card) publish on it while
   * ownership keeps using conversationId.
   */
  readonly rootConversationId?: string;
  readonly goal: string;
  readonly constraints?: readonly string[];
  readonly completionCriteria?: readonly CompletionCriterion[];
  readonly budget?: Partial<MutableTaskBudget>;
  /**
   * R04/M-FR-07: ADOPTABLE control id — when the caller already owns a
   * control record for this task (the batch row id / the child agent
   * task id), the runner uses THAT id instead of minting a nested one.
   * ONE authoritative owner/control mapping across outer agent and
   * nested runner: pause/take-control/stop on the row id gate THIS
   * runner directly, and the paired IPC resolver ambiguity disappears.
   * Must be a bounded opaque id (1-64 chars); invalid values fall back
   * to the generated id.
   */
  readonly taskId?: string;
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
    /** F06: a schema-valid ManagedBrowserHandoffReason. */
    reason: import("@/entityTypes/managedBrowserTypes").ManagedBrowserHandoffReason,
    /** R05: the runner's actual task id — not the admission ref. */
    taskId: string
  ) => Promise<"resolved" | "expired" | "cancelled">;
  /**
   * A-FR-14/N02: when the runner hits a login wall, the credential
   * service fills saved credentials (or opens the user card) — the model
   * NEVER types a password. Absent in bare test fakes.
   */
  readonly signIn?: (input: {
    readonly sessionId: string;
    readonly conversationId: string;
    readonly signal: AbortSignal;
  }) => Promise<{
    readonly status: string;
    readonly reasonCode?: string;
  }>;
  /**
   * N02/D-FR-05: ONE bounded planning call before the loop. A planner
   * failure is its own terminal reason (planner_failed); absent in bare
   * test fakes (no planner, no failure).
   */
  readonly plan?: (input: {
    readonly goal: string;
    readonly constraints: readonly string[];
    readonly completionCriteria: readonly CompletionCriterion[];
    readonly url: string;
    readonly title: string;
    readonly signal: AbortSignal;
  }) => Promise<
    | null
    | {
        readonly completionCriteria: readonly CompletionCriterion[];
        readonly bindings: ReadonlyArray<{
          readonly field: string;
          readonly value: string;
        }>;
        readonly firstSubgoal: string | null;
      }
  >;
  /**
   * R01/D-FR-24: the OPTIONAL provider verifier — one bounded call per
   * task (verifierCallsHard), consulted only when the deterministic
   * criteria MISS and the recovery budget is exhausted. The verifier
   * answers whether the GOAL is met given the fresh observation; a null
   * verdict (transport failure, unclear answer) keeps the partial. The
   * call is separately counted in the persisted cursor.
   */
  readonly verifyWithProvider?: (input: {
    readonly goal: string;
    readonly url: string;
    readonly title: string;
    readonly visibleText: string;
    readonly extracted: readonly unknown[];
    readonly signal: AbortSignal;
  }) => Promise<{ verified: boolean; reason: string } | null>;
  /**
   * N02/D-FR-20/21: resolve FILL text from trusted plan bindings /
   * bounded helper; null when nothing trustworthy applies.
   */
  readonly resolveFieldText?: (input: {
    readonly fieldName: string;
    readonly goal: string;
  }) => Promise<string | null>;
  /** D-FR-21: unknown effect on a field invalidates cached helper values. */
  readonly invalidateFieldCache?: (fieldName: string) => void;
  /**
   * T19: durable cursor hooks (best-effort persistence; failures never
   * block execution but ARE logged by the module).
   */
  readonly persistCursor?: (input: {
    phase: string;
    leafSteps: number;
    decisionRequests: number;
    recoveryCalls: number;
    /** R01/D-FR-24: the optional provider verifier's bounded call count. */
    verifierCalls?: number;
    activeTimeMs?: number;
  }) => Promise<void>;
  readonly persistActionIntent?: (actionType: string) => Promise<void>;
  readonly persistActionOutcome?: (
    outcome: "confirmed" | "no_effect" | "unknown"
  ) => Promise<void>;
  /**
   * R13/D-FR-15a: pin/unpin the EXACT observation while model inference
   * is pending — a concurrent reobservation must not evict the refs the
   * in-flight decision is about to consume. Best-effort; absent in bare
   * test fakes.
   */
  readonly pinObservation?: (
    sessionId: string,
    observationId: string | null,
    pinned: boolean
  ) => Promise<void>;
  /**
   * R01/D-FR-01: live provider-config epoch getter. The decision is
   * admitted under one configuration; the runner rechecks the epoch at
   * every MUTATION BOUNDARY (after journaling/field resolution, before
   * dispatch, and before an approval re-dispatch) so a provider change
   * mid-task can never execute a decision admitted under the old one.
   * Absent in bare test fakes (no recheck).
   */
  readonly providerEpoch?: () => string | null;
  /**
   * F06/D-AC-05: blocks INSIDE the job for the user's approve/deny
   * decision on the pending approval. User-wait time is excluded from
   * active budgets by the control service. Omit to keep the terminal
   * approval_required behavior.
   */
  readonly awaitApproval?: (input: {
    taskId: string;
  }) => Promise<"approved" | "denied" | "expired">;
  readonly control?: ReturnType<typeof getDefaultAgentTaskControlService>;
  readonly now?: () => number;
}

export interface RunnerObservation {
  readonly observationId: string;
  readonly pageRevision: number;
  readonly url: string;
  readonly title: string;
  /**
   * R01/C-FR-07: the session's authenticated flag at observation time —
   * the resume recheck records a signed-out page (the runner never types
   * credentials; SIGN_IN routes to the credential service).
   */
  readonly authenticated?: boolean | null;
  readonly elements: ReadonlyArray<{
    ref: string;
    role: string;
    name: string;
    valueSummary?: string | null;
    disabled?: boolean | null;
    /** F14: observed SELECT options (positional ids + real values). */
    readonly option_ids?: readonly string[] | null;
    readonly option_values?: readonly string[] | null;
    /** N09/D-FR-16: observed LINK origin — NAVIGATE provenance. */
    readonly hrefOrigin?: string | null;
    /** B04: observed link FULL normalized URL — per-URL NAVIGATE provenance. */
    readonly href_full?: string | null;
  }>;
  readonly visibleText: string;
}

/** R05: hostname extraction that never throws on malformed URLs. */
function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export type RunnerAction =
  | { type: "go_back" }
  | { type: "navigate"; url: string }
  | { type: "extract"; refs: string[] }
  | { type: "click"; ref: string; pageRevision: number; expectedRole: string; expectedName: string }
  | { type: "fill"; ref: string; pageRevision: number; expectedRole: string; expectedName: string; value: string }
  | { type: "select"; ref: string; pageRevision: number; expectedRole: string; expectedName: string; values: string[]; expected_values?: string[] }
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
  private readonly _taskId: string;

  /** R03: the runner's task id — the single identity for all persistence. */
  public get taskId(): string {
    return this._taskId;
  }
  private leafSteps = 0;
  private decisionRequests = 0;
  /** N01/D-AC-08: summed provider-reported token usage (chat route). */
  private tokenUsage = 0;
  private recoveryCalls = 0;
  /** R01/D-FR-24: the optional provider verifier's own bounded counter. */
  private verifierCalls = 0;
  /**
   * R02/D-FR-04: the ADMITTED route's operations — queried from the
   * decision client's capabilities at admission (null = client without a
   * capabilities list, all runner operations offered).
   */
  private admittedOperations: readonly string[] | null = null;
  /**
   * R01/D-FR-16: three-state capability data — "unknown" (legacy client
   * or probe failure: the wide fallback offer stands), "admitted" (the
   * route reported its operations; an EMPTY list is explicit and means
   * NOTHING is offered), never conflated with unknown.
   */
  private capabilitiesState: "unknown" | "admitted" = "unknown";
  /** R01: the advertised shortlist bound (wire cap 120, default 16). */
  private advertisedMaxCandidates: number | null = null;
  /** R01: the provider epoch the PENDING recovery decision was admitted under. */
  private pendingRecoveryEpoch: string | null = null;
  /** A02/D-FR-19: the advertised deadline ceiling (null = no list). */
  private advertisedDeadlineMs: number | null = null;
  private lastFailureKey: string | null = null;
  private consecutiveEquivalentFailures = 0;
  private readonly maxEquivalentFailures: number;
  /** T18: a bounded recovery decision awaiting execution. */
  private pendingRecovery: BrowserDecisionResult | null = null;
  /** A06/C-FR-06: the resume generation when the recovery was produced. */
  private pendingRecoveryGeneration: number | null = null;
  /** B16: the URL the task started on (documented DONE fallback). */
  private startUrl: string | null = null;
  /** A-FR-14: bounded credential-service attempts per task. */
  private signInAttempts = 0;
  /** N02/D-FR-05: the plan established once at admission. */
  private plan: {
    readonly completionCriteria: readonly CompletionCriterion[];
    readonly bindings: ReadonlyArray<{
      readonly field: string;
      readonly value: string;
    }>;
    readonly firstSubgoal: string | null;
  } | null = null;
  /** N02/D-FR-05: whether the planner already ran (one call per task). */
  private plannerRan = false;
  /** N02/E14/D-FR-25: REAL recent-action ring buffer for decision input. */
  private recentActions: Array<{
    operation: BrowserDecisionOperation;
    target_descriptor: string | null;
    outcome: "executed" | "failed" | "effect_unknown";
    error_code: string | null;
  }> = [];
  /** B16/D-AC-09: the verification miss carried into the next decision. */
  private pendingSubgoal: string | null = null;
  /** T18: chat-route progress check (D-FR-19) — digest every 5 steps. */
  private lastProgressDigest: string | null = null;
  private stepsSinceProgressCheck = 0;

  constructor(
    private input: BrowserTaskInput,
    deps: RunnerDeps
  ) {
    this.deps = deps;
    this.maxEquivalentFailures =
      limitsForRoute(deps.route).consecutiveEquivalentFailures;
    this.budget = buildTaskBudget(deps.route, input.budget);
    // R04/M-FR-07: adopt the caller's control id when one was provided
    // (bounded opaque id); otherwise mint the nested id as before.
    this._taskId =
      typeof input.taskId === "string" &&
      input.taskId.length >= 1 &&
      input.taskId.length <= 64
        ? input.taskId
        : `task_${randomUUID().slice(0, 12)}`;
  }

  public async run(): Promise<BrowserTaskResult> {
    // R01/design §6.3 (ACCEPTED SUBSTITUTE, documented): the design's
    // state machine (`reconciling` / `verifying` / `awaiting_approval`
    // micro-states) is implemented as ONE bounded while-loop with
    // explicit safe points instead of separate states. Every transition
    // the design assigns to those states happens at a checkpoint here:
    // reconciling → the recovery table + pendingSubgoal re-decision;
    // verifying → the fresh-observation verifyCompletion block (and the
    // optional bounded provider verifier, D-FR-24); awaiting_approval →
    // the F06 in-job approval wait and awaitHandoff. Unknown effect still
    // terminates (never an unbounded reconcile). This is the accepted
    // substitute — do not "fix" it into a state machine without a reason.
    const control = this.deps.control ?? getDefaultAgentTaskControlService();
    control.register(this.taskId, this.input.conversationId);
    // R02/D-FR-04: the admitted route's operation capabilities are
    // queried ONCE at admission — the offered candidate operations are
    // intersected with them (a client without a capabilities list offers
    // everything).
    try {
      const capabilities = await this.deps.decisionClient.getCapabilities(
        this.deps.signal ?? new AbortController().signal
      );
      // R01/D-FR-16: the three states are distinguished by the
      // ADVERTISED flag — advertised=true with an operations array is
      // authoritative (an EMPTY list explicitly offers nothing);
      // advertised=false (probe failure / unsupported route) and absent
      // data both stay legacy-unknown (wide fallback), never conflated
      // with an explicit empty.
      if (
        capabilities.advertised === true &&
        capabilities.operationsReported === true &&
        Array.isArray(capabilities.operations)
      ) {
        this.admittedOperations = capabilities.operations;
        this.capabilitiesState = "admitted";
      } else {
        this.capabilitiesState = "unknown";
      }
      if (
        typeof capabilities.deadlineHardMs === "number" &&
        capabilities.deadlineHardMs > 0
      ) {
        // A02: the advertised ceiling bounds the per-request deadline.
        this.advertisedDeadlineMs = capabilities.deadlineHardMs;
      }
      if (
        typeof capabilities.maxCandidates === "number" &&
        capabilities.maxCandidates > 0
      ) {
        this.advertisedMaxCandidates = Math.min(
          capabilities.maxCandidates,
          120
        );
      }
    } catch {
      // Capabilities unavailable — legacy-unknown: all runner operations
      // offered (wide fallback), NEVER conflated with an explicit empty.
      this.admittedOperations = null;
      this.capabilitiesState = "unknown";
    }
    const gate = control.getGate(this.taskId);
    const signal = this.deps.signal ?? new AbortController().signal;
    const evidence: string[] = [];
    const extracted: unknown[] = [];
    // F07: the initial observe happens INSIDE the try — a throw must
    // reach the catch below and finalize the task, never leave it
    // running. The loop's null-check performs the fetch.
    let observation: RunnerObservation | null = null;
    // T19/F07: persist the RUNNING cursor phase at loop start.
    try {
      await this.deps.persistCursor?.({
        phase: "running",
        leafSteps: this.leafSteps,
        decisionRequests: this.decisionRequests,
        recoveryCalls: this.recoveryCalls,
      });
    } catch {
      /* best-effort persistence never blocks execution */
    }

    try {
      // N02/D-FR-05: ONE bounded planning call before the loop. A planner
      // failure is its OWN terminal reason — never silently retried, and
      // never a reason to run the loop without criteria.
      if (!this.plannerRan && this.deps.plan) {
        this.plannerRan = true;
        const firstObservation =
          observation ?? (await this.deps.observe(this.input.sessionId));
        const plan = firstObservation
          ? await this.deps.plan({
              goal: this.input.goal,
              constraints: this.input.constraints ?? [],
              completionCriteria: this.input.completionCriteria ?? [],
              url: firstObservation.url,
              title: firstObservation.title,
              signal,
            })
          : null;
        if (signal.aborted) {
          return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
        }
        if (plan === null) {
          return this.terminal("failed", "planner_failed", evidence, extracted, firstObservation);
        }
        this.plan = plan;
        if (plan.firstSubgoal) {
          this.pendingSubgoal = plan.firstSubgoal;
        }
        if (plan.completionCriteria.length > 0) {
          // D-FR-05: refined criteria are MERGED with the caller's.
          this.input = {
            ...this.input,
            completionCriteria: [
              ...(this.input.completionCriteria ?? []),
              ...plan.completionCriteria,
            ],
          };
        }
        evidence.push("planner:ok");
      }
      while (this.leafSteps < this.budget.leafSteps && this.decisionRequests < this.budget.decisionRequests) {
        if (signal.aborted) {
          return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
        }
        // C-FR-05: safe-point control gate.
        const generationBeforeGate = control.getResumeGeneration(this.taskId);
        await gate.waitUntilOpen(signal);
        // C-FR-07: a resume means the user controlled the browser — the
        // next decision must OBSERVE BEFORE ACTING (note rides the
        // decision input; page revision advanced so old refs are stale).
        const resumedDuringGate =
          control.getResumeGeneration(this.taskId) > generationBeforeGate;
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

        const candidates = buildDecisionCandidates({
          elements: observation.elements,
          // R01: the advertised shortlist bound (wire-capped at admission).
          maxCandidates: this.advertisedMaxCandidates ?? undefined,
          taskTerms: taskTermsOf(this.input),
        });
        // B13/C-FR-07: instructions the user typed when resuming the task
        // are folded into THIS decision (consume-once) — consumed BEFORE
        // the decision input is built so the subgoal actually rides it.
        // N02/D-FR-05: the planner's firstSubgoal set before the loop
        // rides the FIRST decision (resume instructions override it).
        const resumeInstructions =
          control.consumeResumeInstructions?.(this.taskId) ?? null;
        if (resumeInstructions) {
          this.pendingSubgoal = `the user controlled the browser; observe before acting. the user resumed the task with these instructions: ${resumeInstructions}`;
          evidence.push("resume_with_instructions", "resume_note_user_controlled");
        } else if (resumedDuringGate) {
          // C-FR-07: resume without instructions still carries the note.
          this.pendingSubgoal =
            "the user controlled the browser; observe before acting.";
          evidence.push("resume_note_user_controlled");
        }
        // C-FR-07: recheck the session's SITE identity after user control —
        // the fresh observation's registrable domain must still match the
        // task's start site. A drift is RECORDED in evidence and rides the
        // decision note (the model must re-orient before acting); the task
        // is never cancelled for it — the user may have navigated
        // deliberately, and the worker's navigation gate still holds.
        if (
          (resumedDuringGate || resumeInstructions) &&
          this.startUrl !== null
        ) {
          const { parseUrlIdentityWithOptions } = await import(
            "@/service/browserDecision/RegistrableDomain"
          );
          const startIdentity = parseUrlIdentityWithOptions(this.startUrl, {});
          const nowIdentity = parseUrlIdentityWithOptions(observation.url, {});
          if (
            startIdentity &&
            nowIdentity &&
            startIdentity.registrableDomain !== nowIdentity.registrableDomain
          ) {
            evidence.push(
              `resume_identity_site_drifted:${nowIdentity.registrableDomain}`
            );
            const driftNote =
              "site identity drifted after the user's takeover — re-orient on the current page before acting";
            this.pendingSubgoal = this.pendingSubgoal
              ? `${this.pendingSubgoal} ${driftNote}`
              : driftNote;
          }
          // R01: the AUTHORITATIVE allowed-sites check — the site registry
          // (BrowserSite) must still recognize the live page (or match the
          // start site's domain). An unregistered, unrelated domain is
          // recorded and rides the decision note.
          if (
            startIdentity &&
            nowIdentity &&
            startIdentity.registrableDomain === nowIdentity.registrableDomain
          ) {
            const { getDefaultBrowserSiteModule } = await import(
              "@/modules/BrowserSiteModule"
            );
            const siteMatch = await getDefaultBrowserSiteModule()
              .matchByUrl(observation.url)
              .catch(() => null);
            if (!siteMatch) {
              evidence.push("resume_identity_site_unregistered");
            }
          }
          // R01: the account identity recheck — a signed-out fresh page
          // (authenticated === false on the same origin) is recorded and
          // rides the decision note so the model re-authenticates before
          // acting (the runner never types credentials; SIGN_IN routes to
          // the credential service).
          if (typeof observation.authenticated === "boolean" && !observation.authenticated) {
            evidence.push("resume_identity_signed_out");
            const authNote =
              "the session appears SIGNED OUT after the user's takeover — re-verify the login state (SIGN_IN) before acting";
            this.pendingSubgoal = this.pendingSubgoal
              ? `${this.pendingSubgoal} ${authNote}`
              : authNote;
          }
        }
        const decisionInput = this.buildDecisionInput(observation, candidates);
        this.pendingSubgoal = null;
        if (this.startUrl === null) {
          this.startUrl = observation.url;
        }
        let decision: BrowserDecisionResult;
        const generationBeforeDecide = control.getResumeGeneration(this.taskId);
        // R01/D-FR-01: the provider epoch the consumed decision was
        // admitted under — rechecked at the mutation boundary.
        let epochAtDecide: string | null = null;
        let decisionFromRecovery = false;
        if (this.pendingRecovery) {
          // T18 + A06/C-FR-06: consume the bounded recovery decision ONLY
          // if no Pause→Resume happened since it was produced — a stale
          // proposal is discarded and the loop re-observes.
          const staleRecovery =
            this.pendingRecoveryGeneration !== null &&
            control.getResumeGeneration(this.taskId) >
              this.pendingRecoveryGeneration;
          if (staleRecovery) {
            evidence.push("recovery_discarded_after_resume");
            this.pendingRecovery = null;
            this.pendingRecoveryGeneration = null;
            this.pendingRecoveryEpoch = null;
            observation = await this.deps.observe(this.input.sessionId);
            if (!observation) {
              return this.terminal("failed", "observation_unavailable", evidence, extracted, null);
            }
            continue;
          }
          decision = this.pendingRecovery;
          this.pendingRecovery = null;
          this.pendingRecoveryGeneration = null;
          // R01: the recovery proposal was admitted under the epoch
          // captured before ITS inference.
          epochAtDecide = this.pendingRecoveryEpoch;
          this.pendingRecoveryEpoch = null;
          this.decisionRequests++;
          decisionFromRecovery = true;
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
          // R01/D-AC-08: the FULL decision input is validated against
          // the wire schema BEFORE transport — a malformed input is an
          // honest terminal, never a partially-serialized request.
          const inputCheck = decisionInputSchema.safeParse(decisionInput);
          if (!inputCheck.success) {
            return this.terminal(
              "failed",
              "decision_input_invalid",
              evidence,
              extracted,
              observation
            );
          }
          // R01/D-FR-01: the epoch this decision is admitted under —
          // rechecked at the mutation boundary before dispatch.
          epochAtDecide = this.deps.providerEpoch?.() ?? null;
          // R13/D-FR-15a: pin THIS observation through inference — a
          // concurrent reobservation must not evict the refs the pending
          // decision is about to consume. The same ID is released when
          // the decide settles (result, deadline or transport error).
          const inferenceObservationId = observation.observationId;
          try {
            await this.deps.pinObservation?.(
              this.input.sessionId,
              inferenceObservationId,
              true
            );
          } catch {
            // best-effort: a failed pin must not block the decision
          }
          try {
            decision = await this.deps.decisionClient.decide(
              decisionInput,
              attemptController.signal
            );
          } finally {
            try {
              await this.deps.pinObservation?.(
                this.input.sessionId,
                inferenceObservationId,
                false
              );
            } catch {
              // best-effort release
            }
            clearTimeout(timer);
            signal.removeEventListener("abort", onOuterAbort);
          }
          this.decisionRequests++;
          if (decision.status === "decided" && decision.usage_total_tokens) {
            this.tokenUsage += decision.usage_total_tokens;
          }
          // F05: a decision that returns after its request deadline (or
          // task abort) is stale — it must never become an executable
          // action. The runner checks the OUTER signal elsewhere; the
          // attempt deadline needs its own check here.
          if (signal.aborted) {
            return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
          }
          if (attemptController.signal.aborted) {
            return this.terminal("failed", "decision_deadline_exceeded", evidence, extracted, observation);
          }
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
          // G01/D-FR-19: llm_required is the wire form of ESCALATE — it
          // routes through the SAME bounded recovery table (one recovery
          // decision; the recovery-sourced outcome still terminates)
          // instead of an immediate terminal.
          if (decision.status === "llm_required") {
            if (
              !decisionFromRecovery &&
              this.recoveryCalls < this.budget.recoveryCalls
            ) {
              const freshLlmObservation = await this.deps.observe(
                this.input.sessionId
              );
              if (freshLlmObservation) {
                const recovered = await this.recoverOnce(
                  this.buildDecisionInput(
                    freshLlmObservation,
                    buildDecisionCandidates({
                      elements: freshLlmObservation.elements,
                      // R01: the advertised shortlist bound (wire-capped at admission).
                      maxCandidates: this.advertisedMaxCandidates ?? undefined,
                    })
                  ),
                  `the model answered llm_required (${decision.reason_code}); pick a concrete allowed operation that advances the goal`,
                  signal,
                  { operation: "WAIT", error_code: "llm_required" }
                );
                if (recovered) {
                  observation = freshLlmObservation;
                  evidence.push(`llm_required:routed_to_recovery`);
                  continue;
                }
              }
            }
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
        } catch (gateError) {
          // V04/D-FR-09/C-FR-08: exact terminal-reason mapping — pause
          // expiry (interrupted) and failed states are NOT user
          // cancellations and must not be labelled task_cancelled.
          if (signal.aborted) {
            return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
          }
          const gateMessage =
            gateError instanceof Error ? gateError.message : "unknown";
          if (gateMessage === "task_interrupted") {
            return this.terminal("partial", "task_interrupted", evidence, extracted, observation);
          }
          if (gateMessage === "task_failed") {
            return this.terminal("failed", "task_failed", evidence, extracted, observation);
          }
          // W02: a task refined to the partial terminal state rejects its
          // waiters with task_partial — not a user cancellation either.
          if (gateMessage === "task_partial") {
            return this.terminal("partial", "task_partial", evidence, extracted, observation);
          }
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
        // F05: active runtime is re-checked AFTER inference — an
        // over-budget result must not act.
        if (control.activeTimeMs(this.taskId) > this.budget.activeRuntimeMs) {
          return this.terminal("partial", "active_runtime_exhausted", evidence, extracted, observation);
        }
        const action = decision.action;
        // A02/D-FR-04: EVERY decided operation is validated against the
        // offered list BEFORE branching — an unsupported operation (e.g. a
        // SCROLL from a capabilities subset that never offered it) is an
        // invalid decision routed through the violation handling, never a
        // worker dispatch. DONE/ESCALATE/SIGN_IN are always allowed
        // (terminal/control-plane operations).
        const terminalOrControlOp = ["DONE", "ESCALATE", "SIGN_IN"].includes(
          action.operation
        );
        // R01/D-FR-16: the admitted capabilities list is AUTHORITATIVE —
        // including when it is explicitly EMPTY (nothing may dispatch).
        // The wide legacy fallback (unknown state) keeps the old
        // includes() behavior.
        if (
          !terminalOrControlOp &&
          this.capabilitiesState === "admitted" &&
          !decisionInput.allowed_operations.includes(action.operation)
        ) {
          evidence.push(`unsupported_operation:${action.operation}`);
          if (
            ++this.consecutiveEquivalentFailures >= this.maxEquivalentFailures
          ) {
            return this.terminal(
              "partial",
              `unsupported_operation:${action.operation}`,
              evidence,
              extracted,
              observation
            );
          }
          this.pendingSubgoal = `the operation ${action.operation} is NOT offered by the current provider route — choose from the allowed list or ESCALATE`;
          continue;
        }
        if (action.operation === "DONE") {
          // D-AC-09/R16: verification uses FRESH state. If the fresh
          // observation FAILS, the task is partial/unverified — never
          // completed using the stale pre-action snapshot.
          const freshObservation = await this.deps.observe(this.input.sessionId);
          // F05: Stop during the fresh observation must not be
          // overwritten by completed when the observation resolves.
          if (signal.aborted) {
            return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
          }
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
          // R05/C-FR-06: a Pause→Resume DURING the DONE reobservation
          // discards held work — a verification gathered across the
          // resume never completes the task.
          if (
            control.getResumeGeneration(this.taskId) > generationBeforeDecide
          ) {
            evidence.push("done_reobservation_discarded_after_resume");
            continue;
          }
          // N09/C-FR-05/06: a task left in a USER WAIT (paused or
          // waiting_for_user — no intervening Resume) or over active
          // budget cannot complete on a verification that landed
          // mid-pause; the completion is gated like every other boundary.
          const verificationState = control.getState(this.taskId);
          if (
            verificationState === "paused" ||
            verificationState === "waiting_for_user"
          ) {
            return this.terminal("partial", "verification_landed_while_paused", [...evidence, "done:paused_at_verify"], extracted, observation);
          }
          if (control.activeTimeMs(this.taskId) > this.budget.activeRuntimeMs) {
            return this.terminal("partial", "active_runtime_exhausted", evidence, extracted, observation);
          }
          const verification = this.verifyCompletion(observation, extracted);
          if (verification.verified) {
            return this.terminal("completed", "verified", [...evidence, verification.evidence], extracted, observation);
          }
          // D-AC-09/B16: a DONE without independent verification is not
          // success. The verification MISS goes into the next decision
          // input (pendingSubgoal) so the model can close the gap.
          if (this.recoveryCalls >= this.budget.recoveryCalls) {
            // B05/D-FR-24: the OPTIONAL provider verifier answers SEMANTIC
            // completion ONLY — a FAILED EXPLICIT deterministic criterion
            // (URL/element/text/extract) is unverified, full stop; the
            // verifier is consulted only when the task declared NO
            // explicit criteria (nothing deterministic to fail).
            const hasExplicitCriteria =
              (this.input.completionCriteria ?? []).length > 0;
            if (
              !hasExplicitCriteria &&
              this.deps.verifyWithProvider &&
              this.verifierCalls < limitsForRoute(this.deps.route).verifierCallsHard
            ) {
              this.verifierCalls++;
              // B05: the verifier call carries an ENFORCED desktop
              // deadline capped by the REMAINING active runtime — the
              // 8s body field alone never bounded the desktop call.
              const remainingActiveMs = Math.max(
                1,
                this.budget.activeRuntimeMs - control.activeTimeMs(this.taskId)
              );
              const verifierController = new AbortController();
              const onVerifierAbort = (): void => verifierController.abort();
              signal.addEventListener("abort", onVerifierAbort, { once: true });
              const verifierTimer = setTimeout(
                () => verifierController.abort(),
                Math.min(8_000, remainingActiveMs)
              );
              let verdict: { verified: boolean; reason: string } | null = null;
              try {
                verdict = await this.deps.verifyWithProvider({
                  goal: this.input.goal,
                  url: observation.url,
                  title: observation.title,
                  visibleText: observation.visibleText.slice(0, 2_000),
                  extracted,
                  signal: verifierController.signal,
                });
              } finally {
                clearTimeout(verifierTimer);
                signal.removeEventListener("abort", onVerifierAbort);
              }
              if (signal.aborted) {
                return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
              }
              // R05: a verdict that resolved after its OWN enforced
              // deadline is discarded — the callback may have ignored the
              // abort, and a late verdict never completes.
              if (verifierController.signal.aborted) {
                verdict = null;
                evidence.push("verifier_deadline_exceeded");
              }
              // B05/C-FR-06: a Pause+Resume DURING verification invalidates
              // the evidence — held work is discarded on resume, so a
              // verdict gathered across the resume never completes.
              const generationAfterVerifier = control.getResumeGeneration(this.taskId);
              if (generationAfterVerifier > generationBeforeDecide) {
                evidence.push("verifier_discarded_after_resume");
                continue;
              }
              // N09/C-FR-05: a verdict from a callback that IGNORED its
              // abort can still resolve — the wait state and active
              // budget gate the completion here too.
              const verifierState = control.getState(this.taskId);
              if (
                verifierState === "paused" ||
                verifierState === "waiting_for_user" ||
                control.activeTimeMs(this.taskId) > this.budget.activeRuntimeMs
              ) {
                return this.terminal(
                  "partial",
                  "verification_landed_while_paused",
                  [...evidence, "verifier_used:1", "done:paused_at_verify"],
                  extracted,
                  observation
                );
              }
              if (verdict !== null && verdict.verified) {
                return this.terminal(
                  "completed",
                  "verified_by_provider_verifier",
                  [...evidence, `verifier:${verdict.reason}`, "verifier_used:1"],
                  extracted,
                  observation
                );
              }
              return this.terminal(
                "partial",
                "verification_failed_budget_exhausted",
                [
                  ...evidence,
                  ...(verdict !== null ? [`verifier:${verdict.reason}`] : []),
                  "verifier_used:1",
                ],
                extracted,
                observation
              );
            }
            return this.terminal("partial", "verification_failed_budget_exhausted", evidence, extracted, observation);
          }
          this.recoveryCalls++;
          this.pendingSubgoal = `previous DONE was NOT verified (check failed: ${verification.evidence}). Continue working toward the goal; DONE only when the criteria hold.`;
          evidence.push("done_unverified:continuing");
          continue;
        }
        if (action.operation === "SIGN_IN") {
          // A-FR-14/N02: the login wall routes to the credential service
          // — never a typed password. Bounded: at most 2 attempts; the
          // result re-observes so the next decision sees the wall state.
          if (!this.deps.signIn) {
            evidence.push("sign_in_unavailable");
            continue;
          }
          if (this.signInAttempts >= 2) {
            evidence.push("sign_in_budget_exhausted");
            continue;
          }
          this.signInAttempts++;
          evidence.push(`sign_in:attempt_${this.signInAttempts}`);
          const signInResult = await this.deps.signIn({
            sessionId: this.input.sessionId,
            // W06/M-FR-08: the credential card is published on the ROOT
            // conversation — the hidden agent conversation is never shown.
            conversationId:
              this.input.rootConversationId ?? this.input.conversationId,
            signal,
          });
          if (signal.aborted) {
            return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
          }
          if (signInResult.status === "handoff_required" && this.deps.awaitHandoff) {
            // V02/D-FR-10a/C-FR-02: the credential card's cancel/handoff
            // opens the dialog — the runner BLOCKS in-job like an action
            // handoff, preserving task identity and budgets, and resumes
            // with a fresh observation when the user resolves.
            evidence.push("sign_in:handoff_awaited");
            const resolution = await this.deps.awaitHandoff(
              "login_required",
              this.taskId
            );
            if (resolution === "resolved") {
              observation = await this.deps.observe(this.input.sessionId);
              continue;
            }
            return this.terminal(
              "partial",
              resolution === "expired" ? "handoff_expired" : "handoff_cancelled",
              evidence,
              extracted,
              observation
            );
          }
          if (signInResult.status === "handoff_required") {
            // No awaitHandoff wired (bare fakes): the dialog is open and
            // the runner must not decide against that page.
            return this.terminal("partial", "sign_in_handoff", evidence, extracted, observation);
          }
          observation = await this.deps.observe(this.input.sessionId);
          continue;
        }
        if (action.operation === "ESCALATE") {
          // B16/D-FR-22 (design 11.3): ESCALATE is NOT an immediate
          // terminal — it routes through the bounded recovery table: one
          // recovery decision with the escalation as the subgoal. Only an
          // exhausted recovery budget lands the escalation terminal. An
          // ESCALATE that CAME FROM recovery is already the recovery
          // outcome — routing it back would only burn budget.
          if (!decisionFromRecovery && this.recoveryCalls < this.budget.recoveryCalls) {
            const freshEscalationObservation = await this.deps.observe(
              this.input.sessionId
            );
            if (freshEscalationObservation) {
              const freshEscalationCandidates = buildDecisionCandidates({
                elements: freshEscalationObservation.elements,
                // R01: the advertised shortlist bound (wire-capped at admission).
                maxCandidates: this.advertisedMaxCandidates ?? undefined,
              });
              const recovered = await this.recoverOnce(
                this.buildDecisionInput(
                  freshEscalationObservation,
                  freshEscalationCandidates
                ),
                "the decision ESCALATED; pick a concrete allowed operation that advances the goal, or repeat ESCALATE only if the task is truly stuck",
                signal,
                {
                  operation: "ESCALATE",
                  error_code: "escalated_by_decision",
                } as {
                  operation: BrowserDecisionOperation;
                  error_code: string;
                  target_descriptor: string | null;
                }
              );
              if (recovered) {
                observation = freshEscalationObservation;
                evidence.push("escalate:routed_to_recovery");
                continue;
              }
            }
          }
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
            const { parseUrlIdentityWithOptions } = await import(
              "@/service/browserDecision/RegistrableDomain"
            );
            // X1: HTTPS-only identity for NAVIGATE — an https→http
            // downgrade (or a loopback/private-name target) yields no
            // target identity and is rejected.
            const currentIdentity = parseUrlIdentityWithOptions(
              observation.url,
              {}
            );
            const targetIdentity = parseUrlIdentityWithOptions(
              action.url,
              { httpsOnly: true }
            );
            if (
              !targetIdentity ||
              !currentIdentity ||
              targetIdentity.registrableDomain !==
                currentIdentity.registrableDomain
            ) {
              evidence.push("navigate_not_same_site");
              continue;
            }
            // N09/D-FR-16 + B04: provenance is per-URL. The same-site
            // registrable-domain check above still applies; additionally
            // the FULL normalized target (origin+path+query+fragment)
            // must be an OBSERVED link — or the page the observation was
            // taken on. An origin match alone never authorizes other
            // paths on that origin.
            let targetKey: string | null = null;
            try {
              targetKey = urlKeyOf(new URL(action.url));
            } catch {
              targetKey = null;
            }
            const currentPageKey = (() => {
              try {
                return urlKeyOf(new URL(observation.url));
              } catch {
                return null;
              }
            })();
            const urlObserved =
              (targetKey !== null && targetKey === currentPageKey) ||
              observation.elements.some((el) => {
                if (el.href_full == null || targetKey === null) {
                  return false;
                }
                try {
                  return urlKeyOf(new URL(el.href_full)) === targetKey;
                } catch {
                  return false;
                }
              });
            if (!urlObserved) {
              evidence.push("navigate_unobserved_url");
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
          try {
            await this.deps.persistActionIntent?.(action.operation);
          } catch (error) {
            // P0/D-FR-09: no durable intent — NO dispatch. The task
            // fails before any browser input with the storage reason.
            return this.terminal(
              "failed",
              `intent_persistence_failed:${error instanceof Error ? error.message : "unknown"}`,
              evidence,
              extracted,
              observation
            );
          }
          // F05: stop during the journal write must prevent dispatch;
          // a resume across the same await discards the held action.
          if (signal.aborted) {
            return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
          }
          if (control.getResumeGeneration(this.taskId) > generationBeforeDecide) {
            evidence.push("action_discarded_after_resume");
            observation = await this.deps.observe(this.input.sessionId);
            continue;
          }
          // R01/D-FR-01: MUTATION BOUNDARY (untargeted) — same epoch
          // recheck after journaling and before dispatch.
          if (this.providerEpochMoved(epochAtDecide)) {
            evidence.push("provider_changed_before_dispatch");
            continue;
          }
          let execution: RunnerExecutionResult;
          try {
            execution = await this.deps.runActions(this.input.sessionId, {
              actions: [programAction],
            });
          } catch (stepError) {
            // R13: same classification as the targeted path — a worker
            // throw MID-STEP leaves the page state unknown; the outcome
            // is journaled unknown and nothing runs on top of it.
            const detail =
              stepError instanceof Error ? stepError.message : "unknown";
            await this.deps.persistActionOutcome?.("unknown").catch(
              () => undefined
            );
            return this.terminal(
              "partial",
              "unknown_execution_effect",
              [
                ...evidence,
                `${action.operation}:worker_error:${detail.slice(0, 64)}`,
              ],
              extracted,
              observation
            );
          }
          await this.deps.persistActionOutcome?.(this.stepOutcomeOf(execution));
          // E14/D-FR-25: record the executed (untargeted) step.
          {
            const step = execution.results[execution.results.length - 1];
            this.recentActions.push({
              operation: action.operation,
              // R12: untargeted steps carry SEMANTIC context in the
              // record (the recovery lastAction and the equivalent-
              // failure accounting read it) instead of a null blob.
              target_descriptor:
                action.operation === "NAVIGATE" && action.url
                  ? `navigate ${action.url.slice(0, 120)}`
                  : action.operation === "EXTRACT" && action.target_id
                    ? `extract ${action.target_id}`
                    : action.operation === "PRESS_KEY" && action.key
                      ? `key ${action.key}`
                      : action.operation === "SCROLL_UP"
                        ? "scroll up 600"
                        : action.operation === "SCROLL_DOWN"
                          ? "scroll down 600"
                          : action.operation === "GO_BACK"
                            ? "go back"
                            : action.operation,
              outcome:
                execution.effect === "unknown"
                  ? "effect_unknown"
                  : step && !step.success
                    ? "failed"
                    : "executed",
              error_code: step?.errorCode ?? null,
            });
            this.recentActions = this.recentActions.slice(-6);
          }
          const processed = await this.processExecution(
            action.operation,
            null,
            execution,
            evidence,
            async () => {
              // R13: re-dispatch journals like the initial dispatch —
              // intent before, outcome after; the approval wait never
              // skips the step's durable record.
              try {
                await this.deps.persistActionIntent?.(action.operation);
              } catch {
                await this.deps.persistActionOutcome?.("unknown").catch(
                  () => undefined
                );
                return {
                  effect: "unknown" as const,
                  pageRevision: execution.pageRevision,
                  results: [],
                };
              }
              // R01/D-FR-01: the approval wait is asynchronous
              // preparation — the epoch is rechecked before the
              // re-dispatch; a changed provider is a KNOWN no-effect
              // step failure (nothing was dispatched).
              if (this.providerEpochMoved(epochAtDecide)) {
                return {
                  effect: "known" as const,
                  pageRevision: execution.pageRevision,
                  results: [
                    {
                      success: false,
                      errorCode: "provider_changed_before_dispatch",
                    },
                  ],
                };
              }
              const retryExecution = await this.deps.runActions(
                this.input.sessionId,
                { actions: [programAction] }
              );
              await this.deps.persistActionOutcome?.(
                this.stepOutcomeOf(retryExecution)
              );
              return retryExecution;
            }
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
          // F15: untargeted actions participate in progress accounting —
          // 5 untargeted steps that change nothing are still no progress.
          if (observation) {
            const untargetedProgress = await this.checkProgress(
              observation,
              decisionInput,
              signal,
              extracted
            );
            if (untargetedProgress.status === "no_progress") {
              return this.terminal("partial", "no_progress", evidence, extracted, untargetedProgress.observation);
            }
            // R12: adopt the ONE BOUND snapshot the recovery decided
            // against.
            observation = untargetedProgress.observation;
          }
          continue;
        }

        const violation = validateDecisionActionStructure(decision, decisionInputSchema.parse(decisionInput));
        if (violation) {
          evidence.push(`invalid_decision:${violation}`);
          if (++this.consecutiveEquivalentFailures >= this.maxEquivalentFailures) {
            // B17/D-FR-25: recovery decides against the state it will
            // execute on — re-observe and rebuild the candidates/input
            // FIRST; the stale decision input never reaches the model.
            const freshRecoveryObservation = await this.deps.observe(
              this.input.sessionId
            );
            if (freshRecoveryObservation) {
              const freshRecoveryInput = this.buildDecisionInput(
                freshRecoveryObservation,
                buildDecisionCandidates({
                  elements: freshRecoveryObservation.elements,
                  // R01: the advertised shortlist bound (wire-capped at admission).
                  maxCandidates: this.advertisedMaxCandidates ?? undefined,
                })
              );
              const recovered = await this.recoverOnce(
                freshRecoveryInput,
                `previous decision was invalid (${violation}); choose a DIFFERENT operation or ESCALATE`,
                signal,
                {
                  operation: action.operation,
                  error_code: violation,
                  target_descriptor: null,
                }
              );
              if (recovered) {
                this.consecutiveEquivalentFailures = 0;
                observation = freshRecoveryObservation;
                continue;
              }
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

        let programAction = this.toRunnerAction(action, target, observation);
        if (!programAction) {
          evidence.push(`unsupported_operation:${action.operation}`);
          continue;
        }
        // E05/D-FR-20: a field whose NAME is secret-shaped (password,
        // OTP, card, security code) is NEVER filled with the model's
        // text — the step ends as a known no-effect refusal and the
        // model must re-decide (SIGN_IN / ESCALATE). The credential
        // service owns those fields.
        if (
          programAction.type === "fill" &&
          fieldIsForbiddenToFill(target.name)
        ) {
          evidence.push(`fill_refused:secret_field:${target.role}`);
          continue;
        }
        // N02/D-FR-20/21: FILL text resolution — trusted plan bindings
        // first (unambiguous), then the bounded helper. The model's own
        // text applies only when neither produced a trustworthy value.
        if (programAction.type === "fill" && this.deps.resolveFieldText) {
          const resolved = await this.deps.resolveFieldText({
            fieldName: target.name,
            goal: this.input.goal,
          });
          if (resolved !== null && resolved !== programAction.value) {
            programAction = { ...programAction, value: resolved };
          }
        }

        this.leafSteps++;
        try {
          await this.deps.persistActionIntent?.(action.operation);
        } catch (error) {
          // P0/D-FR-09: no durable intent — NO dispatch. The task fails
          // before any browser input with the storage reason.
          return this.terminal(
            "failed",
            `intent_persistence_failed:${error instanceof Error ? error.message : "unknown"}`,
            evidence,
            extracted,
            observation
          );
        }
        // F05: stop during the journal write must prevent dispatch;
        // a resume across the same await discards the held action.
        if (signal.aborted) {
          return this.terminal("cancelled", "task_cancelled", evidence, extracted, observation);
        }
        if (control.getResumeGeneration(this.taskId) > generationBeforeDecide) {
          evidence.push("action_discarded_after_resume");
          observation = await this.deps.observe(this.input.sessionId);
          continue;
        }
        // R01/D-FR-01: MUTATION BOUNDARY — journaling and field
        // resolution are asynchronous preparation; the provider epoch is
        // rechecked HERE so a changed configuration can never execute a
        // decision admitted under the old one. The step is discarded and
        // the loop re-decides under the new epoch.
        if (this.providerEpochMoved(epochAtDecide)) {
          evidence.push("provider_changed_before_dispatch");
          continue;
        }
        let execution: RunnerExecutionResult;
        try {
          execution = await this.deps.runActions(this.input.sessionId, {
            actions: [programAction],
          });
        } catch (stepError) {
          // N08/D-AC-07: a worker throw MID-STEP means the input MAY
          // already have been dispatched — the page state is unknown.
          // Classify as an unknown effect (partial) so nothing runs on
          // top of it; never a generic runner_error that claims a clean
          // failure.
          const detail =
            stepError instanceof Error ? stepError.message : "unknown";
          await this.deps.persistActionOutcome?.("unknown").catch(
            () => undefined
          );
          return this.terminal(
            "partial",
            "unknown_execution_effect",
            [...evidence, `${action.operation}:worker_error:${detail.slice(0, 64)}`],
            extracted,
            observation
          );
        }
        await this.deps.persistActionOutcome?.(this.stepOutcomeOf(execution));
        // E14/D-FR-25: record the executed step for the decision history.
        {
          const step = execution.results[execution.results.length - 1];
          this.recentActions.push({
            operation: action.operation,
            target_descriptor: `${target.role} "${target.name}"`,
            outcome: execution.effect === "unknown" ? "effect_unknown" : step && !step.success ? "failed" : "executed",
            error_code: step?.errorCode ?? null,
          });
          this.recentActions = this.recentActions.slice(-6);
        }
                const processed = await this.processExecution(
          action.operation,
          { role: target.role, name: target.name },
          execution,
          evidence,
          async () => {
            // R13: re-dispatch journals like the initial dispatch —
            // intent before, outcome after; the approval wait never
            // skips the step's durable record.
            try {
              await this.deps.persistActionIntent?.(action.operation);
            } catch {
              await this.deps.persistActionOutcome?.("unknown").catch(
                () => undefined
              );
              return {
                effect: "unknown" as const,
                pageRevision: execution.pageRevision,
                results: [],
              };
            }
            // R01/D-FR-01: the approval wait is asynchronous
            // preparation — the epoch is rechecked before the
            // re-dispatch; a changed provider is a KNOWN no-effect
            // step failure (nothing was dispatched).
            if (this.providerEpochMoved(epochAtDecide)) {
              return {
                effect: "known" as const,
                pageRevision: execution.pageRevision,
                results: [
                  {
                    success: false,
                    errorCode: "provider_changed_before_dispatch",
                  },
                ],
              };
            }
            const retryExecution = await this.deps.runActions(
              this.input.sessionId,
              { actions: [programAction] }
            );
            await this.deps.persistActionOutcome?.(
              this.stepOutcomeOf(retryExecution)
            );
            return retryExecution;
          }
        );
        if (execution.effect === "unknown" && action.operation === "FILL") {
          // D-FR-21: an unknown effect on the field invalidates cached
          // helper values — automatic replay is no longer safe.
          this.deps.invalidateFieldCache?.(target.name);
        }
        if (processed.stop) {
          // T18: a failures-exhausted stop gets ONE bounded recovery
          // before the terminal lands; policy stops never recover.
          if (processed.stop.reason.startsWith("three_equivalent_failures")) {
            // B17/D-FR-25: recovery sees the FRESH state — observe before
            // the recovery decision, not only after it.
            const freshRecoveryObservation = await this.deps.observe(
              this.input.sessionId
            );
            if (freshRecoveryObservation) {
              const freshRecoveryInput = this.buildDecisionInput(
                freshRecoveryObservation,
                buildDecisionCandidates({
                  elements: freshRecoveryObservation.elements,
                  // R01: the advertised shortlist bound (wire-capped at admission).
                  maxCandidates: this.advertisedMaxCandidates ?? undefined,
                })
              );
              const recovered = await this.recoverOnce(
                freshRecoveryInput,
                `three equivalent failures on ${action.operation} ${target.name}: ${processed.stop.reason}`,
                signal,
                {
                  operation: action.operation,
                  error_code: processed.stop.reason.slice(0, 64),
                  target_descriptor: `${target.role} "${target.name}"`,
                }
              );
              if (recovered) {
                this.consecutiveEquivalentFailures = 0;
                this.lastFailureKey = null;
                observation = freshRecoveryObservation;
                continue;
              }
            } else {
              observation = await this.deps.observe(this.input.sessionId);
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
          signal,
          extracted
        );
        if (progress.status === "no_progress") {
          return this.terminal("partial", "no_progress", evidence, extracted, progress.observation);
        }
        // R12: adopt the ONE BOUND snapshot the recovery decided against.
        observation = progress.observation;
      }
      return this.terminal(
        "partial",
        "budget_exhausted",
        evidence,
        extracted,
        observation
      );
    } catch (error) {
      // N03: control-gate errors are TYPED by their exact reason —
      // AgentTaskControlService throws task_not_found and task_<state>
      // (task_interrupted, task_failed, ...). Only a real cancellation
      // maps to cancelled; interrupted maps to partial/interrupted;
      // everything else stays failed with the originating reason.
      const gateMessage =
        error instanceof Error ? error.message : "unknown";
      if (gateMessage === "task_cancelled") {
        return this.terminal(
          "cancelled",
          "task_cancelled",
          evidence,
          extracted,
          observation
        );
      }
      if (gateMessage === "task_interrupted") {
        return this.terminal(
          "partial",
          "task_interrupted",
          evidence,
          extracted,
          observation
        );
      }
      // F07: an execution exception is a FAILED terminal — never a
      // completed overwrite from the finally below.
      return this.terminal(
        "failed",
        gateMessage.startsWith("task_")
          ? gateMessage
          : `runner_error:${gateMessage}`,
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

  /**
   * F07: the journal outcome reflects what actually happened — a known
   * failed step or a policy stop did NOT take effect; only a known
   * success is confirmed; unknown stays unknown.
   */
  /**
   * R01/D-FR-01: has the provider configuration moved away from the
   * epoch the current decision was admitted under? A null snapshot
   * means no live getter (bare fakes) — no recheck.
   */
  private providerEpochMoved(epochAtDecide: string | null): boolean {
    if (epochAtDecide === null) {
      return false;
    }
    return this.deps.providerEpoch?.() !== epochAtDecide;
  }

  private stepOutcomeOf(
    execution: RunnerExecutionResult
  ): "confirmed" | "no_effect" | "unknown" {
    if (execution.effect === "unknown") {
      return "unknown";
    }
    if (execution.stopCode) {
      return "no_effect";
    }
    if (execution.results[0]?.success === false) {
      return "no_effect";
    }
    return "confirmed";
  }

  private buildDecisionInput(
    observation: RunnerObservation,
    candidates: ReturnType<typeof buildDecisionCandidates>
  ): BrowserDecisionInput {
    // D-FR-14: the shortlist arrives priority-ordered (focused/dialog);
    // buildDecisionCandidates applies the task-lexical ranking against
    // the goal/constraints when called from the loop head — this method
    // receives the already-ranked list, so no further ranking here.
    return {
      schema_version: 1,
      request_id: `req_${randomUUID().slice(0, 8)}`,
      task_id: this.taskId,
      step_id: `step_${this.leafSteps}`,
      observation_id: observation.observationId,
      page_revision: observation.pageRevision,
      goal: this.input.goal.slice(0, 2000),
      // B16/D-AC-09: a failed completion check puts its MISS into the
      // next decision input so the model knows what was still missing.
      // R01: the wire bound (1000) is enforced HERE — resume
      // instructions folded into the subgoal could exceed it and the
      // transport would reject the whole input.
      subgoal: this.pendingSubgoal
        ? this.pendingSubgoal.slice(0, 1000)
        : null,
      constraints: [...(this.input.constraints ?? [])].slice(0, 16),
      // P1/D-FR-24: the model sees the completion criteria (DONE is
      // then an informed decision; verification stays independent).
      // R01: the wire cap is 8 — merged planner/caller criteria are
      // truncated to the bound instead of rejecting the input.
      completion_criteria: (this.input.completionCriteria ?? [])
        .slice(0, 8)
        .map((criterion) => `${criterion.kind}:${criterion.value}`),
      url: observation.url,
      title: observation.title.slice(0, 512),
      candidates: candidates as BrowserDecisionInput["candidates"],
      // E14/D-FR-25: the REAL executed-step history (bounded) — never an
      // empty list or a fabricated entry.
      recent_actions: this.recentActions.slice(-6),
      // D-FR-16/R02/R01: every offered operation is executable (T18)
      // AND supported by the admitted route. Three states: unknown →
      // the wide legacy fallback; admitted → the intersection (an
      // EXPLICIT empty stays empty — nothing is offered); never mixed.
      allowed_operations:
        this.capabilitiesState === "admitted" && this.admittedOperations
          ? RUNNER_OPERATIONS.filter((operation) =>
              (this.admittedOperations as readonly string[]).includes(operation)
            )
          : RUNNER_OPERATIONS,
      // A02: the advertised ceiling caps the deadline (never exceeding the
      // route budget).
      deadline_ms: Math.min(
        this.budget.requestTimeoutMs,
        30_000,
        this.advertisedDeadlineMs ?? Number.POSITIVE_INFINITY
      ),
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
    signal: AbortSignal,
    // B17/D-FR-25: the REAL last action (operation + error class +
    // descriptor) — never a fabricated entry.
    lastAction?: {
      readonly operation: BrowserDecisionOperation;
      readonly error_code: string;
      readonly target_descriptor?: string | null;
    }
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
          operation: lastAction?.operation ?? "WAIT",
          target_descriptor: lastAction?.target_descriptor ?? null,
          outcome: "failed" as const,
          error_code: (lastAction?.error_code ?? reason).slice(0, 64),
        } as BrowserRecentAction,
      ].slice(-6),
    };
    try {
      // F15: recovery uses the SAME bounded request machinery as the main
      // path — its own abortable timer capped by the decision deadline and
      // the remaining active runtime; a late response is discarded, never
      // executed (the outer signal alone is not a deadline).
      const control =
        this.deps.control ?? getDefaultAgentTaskControlService();
      const remainingActiveMs = Math.max(
        0,
        this.budget.activeRuntimeMs - control.activeTimeMs(this.taskId)
      );
      const deadlineMs = Math.max(
        0,
        Math.min(recoveryInput.deadline_ms, remainingActiveMs)
      );
      if (deadlineMs === 0) {
        return false;
      }
      const attemptController = new AbortController();
      const onOuterAbort = (): void => attemptController.abort();
      signal.addEventListener("abort", onOuterAbort, { once: true });
      const timer = setTimeout(() => attemptController.abort(), deadlineMs);
      // R01/D-AC-08: the recovery input is validated against the wire
      // schema BEFORE transport too.
      const recoveryInputCheck = decisionInputSchema.safeParse(recoveryInput);
      if (!recoveryInputCheck.success) {
        return false;
      }
      let result: BrowserDecisionResult;
      // R05/C-FR-06: capture the resume generation BEFORE inference — a
      // Pause→Resume DURING the decide bumps the generation, and the
      // proposal must carry the PRE-inference generation so the
      // consumption stale check discards it (a post-await read would
      // make the stale reply appear current).
      const generationBeforeRecovery = control.getResumeGeneration(this.taskId);
      const epochBeforeRecovery = this.deps.providerEpoch?.() ?? null;
      // R13/D-FR-15a: recovery inference is pinned like the main decide
      // — the same observation ID rides the recovery input.
      const recoveryObservationId = recoveryInput.observation_id;
      try {
        await this.deps.pinObservation?.(
          this.input.sessionId,
          recoveryObservationId,
          true
        );
      } catch {
        // best-effort
      }
      try {
        result = await this.deps.decisionClient.decide(
          recoveryInput,
          attemptController.signal
        );
      } finally {
        try {
          await this.deps.pinObservation?.(
            this.input.sessionId,
            recoveryObservationId,
            false
          );
        } catch {
          // best-effort release
        }
        clearTimeout(timer);
        signal.removeEventListener("abort", onOuterAbort);
      }
      if (
        result.status === "decided" &&
        !attemptController.signal.aborted &&
        !signal.aborted
      ) {
        // A06/C-FR-06/R05: the proposal carries the resume generation it
        // was produced UNDER (captured before inference) — a Pause→Resume
        // before OR DURING inference discards it.
        this.pendingRecovery = result;
        this.pendingRecoveryGeneration = generationBeforeRecovery;
        this.pendingRecoveryEpoch = epochBeforeRecovery;
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
    signal: AbortSignal,
    extracted: readonly unknown[]
  ): Promise<{ status: "ok" | "no_progress"; observation: RunnerObservation }> {
    this.stepsSinceProgressCheck++;
    if (this.stepsSinceProgressCheck < 5) {
      return { status: "ok", observation };
    }
    this.stepsSinceProgressCheck = 0;
    // F15 + A14/D-FR-22: the digest uses STABLE SEMANTIC identity —
    // volatile element refs (fresh per observation) are EXCLUDED (ten
    // identical pages with fresh refs all counted as progress before),
    // the visible-text window is wider (600), and form values ride
    // without refs. R12: EXTRACTED RESULTS also count — an extraction
    // that produced new data with a static page IS progress — and an
    // already-true criterion no longer suppresses detection (a model
    // that keeps acting on a satisfied criterion with a static page is
    // precisely a stall).
    const formSignature = observation.elements
      .slice(0, 60)
      .map((el) => `${el.role}:${el.name}:${el.valueSummary ?? ""}`)
      .join("|");
    const extractionDigest =
      extracted.length > 0
        ? createHash("sha256")
            .update(JSON.stringify(extracted.slice(-3)))
            .digest("hex")
            .slice(0, 16)
        : "";
    const criterionProgress = this.verifyCompletion(observation, []).verified;
    const digest = `${observation.url}|${observation.visibleText.slice(0, 600)}|${formSignature}|${extractionDigest}`;
    if (this.lastProgressDigest !== null && digest === this.lastProgressDigest) {
      // E14/D-FR-22/R12: recovery decides against the observation it
      // will execute on — re-observe FIRST and return that ONE BOUND
      // snapshot so the outer loop adopts exactly the state the
      // recovery decision was made against (its element ids must be
      // resolvable). When the reobservation FAILS, the recovery runs
      // against the still-bound previous input/observation pair —
      // consistent, never a mixed snapshot.
      const freshNoProgressObservation = await this.deps.observe(
        this.input.sessionId
      );
      const recoveryContext = freshNoProgressObservation
        ? this.buildDecisionInput(
            freshNoProgressObservation,
            buildDecisionCandidates({
              elements: freshNoProgressObservation.elements,
              // R01: the advertised shortlist bound (wire-capped at admission).
              maxCandidates: this.advertisedMaxCandidates ?? undefined,
            })
          )
        : decisionInput;
      const recovered = await this.recoverOnce(
        recoveryContext,
        criterionProgress
          ? "no page change for 5 steps; the completion criterion is already satisfied - choose DONE if the goal is met, or try a DIFFERENT approach"
          : "no progress for 5 steps; the page did not change - try a DIFFERENT approach or ESCALATE",
        signal,
        {
          operation:
            this.recentActions.at(-1)?.operation ?? "WAIT",
          error_code: "no_progress",
          target_descriptor:
            this.recentActions.at(-1)?.target_descriptor ?? null,
        }
      );
      const boundObservation = freshNoProgressObservation ?? observation;
      if (recovered) {
        return { status: "ok", observation: boundObservation };
      }
      return { status: "no_progress", observation: boundObservation };
    }
    this.lastProgressDigest = digest;
    return { status: "ok", observation };
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
    evidence: string[],
    /** F06: re-dispatches the SAME pending step after an approval. */
    redispatch?: () => Promise<RunnerExecutionResult>,
    approvalDepth = 0
  ): Promise<{
    stop: { status: "partial" | "failed"; reason: string } | null;
    resumedFromHandoff?: boolean;
  }> {
    const label = target ? `${operation}:${target.name}` : operation;
    if (execution.stopCode === "handoff_required" && this.deps.awaitHandoff) {
      // T14/C-FR-02: block INSIDE the job for the user's dialog action.
      evidence.push(`${label}:handoff_awaited`);
      const resolution = await this.deps.awaitHandoff(
        "challenge_unresolved",
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
    if (execution.stopCode === "approval_required" && this.deps.awaitApproval) {
      // F06/D-AC-05: the pending step is preserved IN-JOB — block for
      // the user's decision, then re-dispatch the SAME action (the
      // recorded approval binds to the exact semantic digest; a page
      // change during the wait forces a fresh approval). Depth-capped.
      evidence.push(`${label}:approval_awaited`);
      const resolution = await this.deps.awaitApproval({
        taskId: this.taskId,
      });
      if (resolution === "approved" && redispatch && approvalDepth < 3) {
        evidence.push(`${label}:approval_granted`);
        const retryExecution = await redispatch();
        return await this.processExecution(
          operation,
          target,
          retryExecution,
          evidence,
          redispatch,
          approvalDepth + 1
        );
      }
      if (resolution === "denied" || resolution === "expired") {
        evidence.push(
          `${label}:approval_${resolution === "denied" ? "denied" : "expired"}`
        );
        return {
          stop: {
            status: "partial",
            reason:
              resolution === "denied" ? "approval_denied" : "approval_expired",
          },
        };
      }
      // approved without a redispatch path: fall through to the
      // terminal below (defensive; executeTask always provides one).
      evidence.push(`${label}:approval_required`);
      return { stop: { status: "partial", reason: "approval_required" } };
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
      case "SELECT": {
        if (!action.option_id) {
          return null;
        }
        // P1/D-FR-17: the decided option id is POSITIONAL (o_N) into the
        // observed option list. The TOKEN is dispatched and the worker
        // resolves it against the LIVE element's options — exact native
        // identity, never a truncated display value (long values and
        // duplicate labels stay distinguishable).
        const element = observation.elements.find(
          (el) => el.ref === target.candidate_id
        );
        if (!element?.option_ids?.includes(action.option_id)) {
          return null; // unsupported: the option is not in the observed list
        }
        // N09: bind the token to the OBSERVED value — the worker
        // verifies the live option value still matches before selecting
        // (options reordered/changed after the observation fail the
        // step instead of silently choosing another option).
        // A03: the token's NUMBER is the ORIGINAL option index in the
        // live element (el.options[N]) — the outbound values array is
        // COMPACTED (oversized/credential-bearing options omitted), so
        // the binding must look up the token's id IN the id list, not
        // parse a position into the compacted array.
        const idPosition = element.option_ids
          ? element.option_ids.indexOf(action.option_id)
          : -1;
        const expectedValue = idPosition >= 0 ? element.option_values?.[idPosition] : undefined;
        // R02: a trusted option identity REQUIRES the observed value —
        // dispatching without the expectation would let a changed or
        // misaligned option list select a different option silently
        // (the worker's staleness check has nothing to compare against).
        // Misaligned/legacy data refuses the step; the model re-decides.
        if (expectedValue === undefined) {
          return null;
        }
        return {
          type: "select",
          ref: target.candidate_id,
          pageRevision: observation.pageRevision,
          ...expected,
          values: [action.option_id],
          expected_values: [expectedValue],
        };
      }
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
      // B16/D-AC-09 documented fallback: with NO declared criteria, DONE
      // is verified deterministically by a URL change vs the task start
      // (evidence: verified_by_url_change_fallback). An unchanged page
      // stays unverified — a DONE on the landing page never completes.
      if (this.startUrl !== null && observation.url !== this.startUrl) {
        // R05: the fallback must not accept an UNRELATED change — the
        // new URL stays on the task's start registrable domain
        // (navigation to another site is not progress on this task).
        const startDomain = registrableDomainOf(
          safeHostname(this.startUrl)
        );
        const currentDomain = registrableDomainOf(
          safeHostname(observation.url)
        );
        if (
          startDomain !== null &&
          currentDomain !== null &&
          startDomain === currentDomain
        ) {
          return { verified: true, evidence: "verified_by_url_change_fallback" };
        }
        return { verified: false, evidence: "url_change_off_site" };
      }
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
    // W02/D-FR-09/C-FR-11/12: the control record carries the REAL terminal
    // status — partial and interrupted are their own states (the returned
    // tool result and the record must agree), never rewritten failed.
    control.setState(this.taskId, status, reason);
    // T19/F07: the TERMINAL cursor carries the real counters and the
    // frozen active time. Best-effort: persistence never blocks the
    // result.
    if (this.deps.persistCursor) {
      void this.deps
        .persistCursor({
          phase: status,
          leafSteps: this.leafSteps,
          decisionRequests: this.decisionRequests,
          recoveryCalls: this.recoveryCalls,
          // R01/D-FR-24: the verifier's own bounded counter rides the
          // cursor for full per-task accounting.
          verifierCalls: this.verifierCalls,
          activeTimeMs: control.activeTimeMs(this.taskId),
        })
        .catch(() => undefined);
    }
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

/**
 * B04: canonical comparison key for NAVIGATE provenance — origin,
 * path, query, and fragment. Default ports and empty fragments are
 * normalized by the URL constructor itself.
 */
/**
 * D-FR-14: task-lexical terms for candidate ranking — significant words
 * from the goal, subgoal, and constraints (length >= 3, bounded 12).
 */
function taskTermsOf(input: BrowserTaskInput): readonly string[] {
  const words = `${input.goal} ${(input.constraints ?? []).join(" ")}`
    .toLowerCase()
    .split(/[^a-z0-9À-￿]+/)
    .filter((w) => w.length >= 3);
  return [...new Set(words)].slice(0, 12);
}

function urlKeyOf(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}${url.hash}`;
}
