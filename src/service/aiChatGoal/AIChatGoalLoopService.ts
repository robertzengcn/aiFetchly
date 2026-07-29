import type {
  AIChatGoalRunView,
  AIChatGoalStatus,
  AIChatGoalView,
  ChatV2GoalStateEvent,
  ChatV2GoalVerificationEvent,
  GoalEvidenceSourceKind,
} from "@/entityTypes/aiChatGoalTypes";
import {
  GoalEvidenceCollector,
  type GoalCommandRunner,
} from "./GoalEvidenceCollector";
import {
  GoalVerificationService,
  computeFailureFingerprint,
  type GoalLlmVerifier,
  type GoalVerificationEvidence,
} from "./GoalVerificationService";

/**
 * Bounded goal/loop controller (design §6).
 *
 * Owns the iteration lifecycle: one bounded maker turn at a time, then collect
 * fresh evidence, run deterministic-first verification, persist, and decide the
 * terminal state. AIChatGoalLoopService is the ONLY component that transitions
 * a goal to complete/blocked/failed/cancelled/needs_user_input. It never runs
 * parallel turns for the same goal.
 *
 * Built against injectable ports so the lifecycle is unit-testable without the
 * AI engine or database; the production wiring injects the real adapters.
 */

export interface MakerTurnResult {
  readonly terminalState:
    | "completed"
    | "failed"
    | "paused_permission"
    | "paused_plan"
    | "paused_question";
}

/** Runs one bounded maker turn via AIChatQueryEngine. */
export interface MakerTurnExecutor {
  execute(input: {
    readonly conversationId: string;
    readonly goal: AIChatGoalView;
    readonly iteration: number;
    readonly signal: AbortSignal;
  }): Promise<MakerTurnResult>;
}

export interface GoalRevisionProvider {
  current(
    goal: AIChatGoalView,
    conversationId: string
  ): Promise<string | undefined>;
}

export interface GoalWorkspaceProvider {
  rootFor(conversationId: string): Promise<string | null>;
}

export interface GoalLoopEventSink {
  emitState(event: ChatV2GoalStateEvent): void;
  emitVerification(event: ChatV2GoalVerificationEvent): void;
}

/** Persistence surface the controller uses (AIChatGoalModule satisfies this). */
export interface GoalLoopPersistence {
  getGoal(goalId: string): Promise<AIChatGoalView | null>;
  createRun(input: {
    readonly goalId: string;
    readonly conversationId: string;
    readonly maxIterations: number;
    readonly maxRuntimeMs: number;
    readonly repeatedFailureThreshold: number;
  }): Promise<AIChatGoalRunView>;
  transitionGoalStatus(
    goalId: string,
    to: AIChatGoalStatus,
    patch?: {
      readonly iterationCount?: number;
      readonly latestVerdict?: string;
      readonly terminalReason?: string;
    }
  ): Promise<AIChatGoalView>;
  endRun(
    runId: string,
    status: AIChatGoalStatus,
    terminalReason?: string,
    cancelled?: boolean
  ): Promise<void>;
  appendEvidence(input: {
    readonly goalId: string;
    readonly runId?: string;
    readonly iteration?: number;
    readonly criterionId?: string;
    readonly sourceKind: GoalEvidenceSourceKind;
    readonly state: "pass" | "fail" | "pending";
    readonly sourceRevision?: string;
    readonly excerpt?: string;
  }): Promise<void>;
}

export interface AIChatGoalLoopServiceDeps {
  readonly persistence: GoalLoopPersistence;
  readonly makerExecutor: MakerTurnExecutor;
  readonly revisionProvider: GoalRevisionProvider;
  readonly workspaceProvider: GoalWorkspaceProvider;
  readonly collector?: GoalEvidenceCollector;
  readonly verifier?: GoalVerificationService;
  readonly commandRunner?: GoalCommandRunner;
  readonly llmVerifier?: GoalLlmVerifier;
  readonly eventSink?: GoalLoopEventSink;
  readonly now?: () => number;
}

export interface GoalLoopStartInput {
  readonly goalId: string;
  readonly conversationId: string;
  readonly maxIterations: number;
  readonly maxRuntimeMs?: number;
  readonly repeatedFailureThreshold?: number;
}

export interface GoalLoopResult {
  readonly runId: string;
  readonly terminalStatus: AIChatGoalStatus;
  readonly terminalReason: string;
  readonly iterations: number;
}

export class AIChatGoalLoopService {
  private readonly activeRuns = new Map<
    string,
    { abort: AbortController; runId: string }
  >();

  constructor(private readonly deps: AIChatGoalLoopServiceDeps) {}

  /**
   * Run the bounded loop. Returns the terminal goal status + reason. Throws if
   * preflight fails (goal missing/not active, or a run is already active).
   */
  async start(input: GoalLoopStartInput): Promise<GoalLoopResult> {
    const { persistence } = this.deps;
    const goal = await persistence.getGoal(input.goalId);
    if (!goal || goal.conversationId !== input.conversationId) {
      throw new Error("Goal not found for this conversation.");
    }
    if (goal.status !== "active") {
      throw new Error("Goal must be active before starting a loop.");
    }
    if (this.activeRuns.has(input.conversationId)) {
      throw new Error("A loop run is already active for this conversation.");
    }

    const threshold = input.repeatedFailureThreshold ?? 3;
    const run = await persistence.createRun({
      goalId: input.goalId,
      conversationId: input.conversationId,
      maxIterations: input.maxIterations,
      maxRuntimeMs: input.maxRuntimeMs ?? 0,
      repeatedFailureThreshold: threshold,
    });
    await persistence.transitionGoalStatus(input.goalId, "running");

    const abort = new AbortController();
    this.activeRuns.set(input.conversationId, { abort, runId: run.runId });

    const workspaceRoot =
      (await this.deps.workspaceProvider.rootFor(input.conversationId)) ?? "";
    const collector = this.deps.collector ?? new GoalEvidenceCollector();
    const verifier = this.deps.verifier ?? new GoalVerificationService();
    const now = this.deps.now ?? Date.now;
    const startedAt = now();
    const failureCounts = new Map<string, number>();

    let terminalStatus: AIChatGoalStatus = "active";
    let terminalReason = "max_iterations_reached";
    let iterations = 0;

    try {
      for (let iteration = 1; iteration <= input.maxIterations; iteration++) {
        iterations = iteration;
        if (abort.signal.aborted) {
          terminalStatus = "cancelled";
          terminalReason = "user_stop";
          break;
        }
        if (
          input.maxRuntimeMs &&
          input.maxRuntimeMs > 0 &&
          now() - startedAt > input.maxRuntimeMs
        ) {
          terminalStatus = "active";
          terminalReason = "max_runtime_reached";
          break;
        }

        const maker = await this.deps.makerExecutor.execute({
          conversationId: input.conversationId,
          goal,
          iteration,
          signal: abort.signal,
        });
        if (abort.signal.aborted) {
          terminalStatus = "cancelled";
          terminalReason = "user_stop";
          break;
        }

        if (maker.terminalState === "failed") {
          terminalStatus = "failed";
          terminalReason = "maker_turn_failed";
          break;
        }
        if (
          maker.terminalState === "paused_permission" ||
          maker.terminalState === "paused_plan" ||
          maker.terminalState === "paused_question"
        ) {
          terminalStatus = "needs_user_input";
          terminalReason = maker.terminalState;
          break;
        }

        // Maker turn completed normally: collect evidence + verify.
        const currentRevision = await this.deps.revisionProvider.current(
          goal,
          input.conversationId
        );
        const evidence: GoalVerificationEvidence[] = [];
        for (const criterion of goal.criteria) {
          if (criterion.verification.kind === "llm") continue;
          const ev = await collector.collect(criterion, {
            workspaceRoot,
            currentRevision,
            commandRunner: this.deps.commandRunner,
          });
          evidence.push(ev);
          await persistence.appendEvidence({
            goalId: input.goalId,
            runId: run.runId,
            iteration,
            criterionId: criterion.criterionId,
            sourceKind: criterion.verification.kind as GoalEvidenceSourceKind,
            state: ev.state,
            sourceRevision: ev.sourceRevision,
            excerpt: ev.reason,
          });
          if (ev.state === "fail") {
            const fp = computeFailureFingerprint(
              criterion,
              ev,
              currentRevision
            );
            failureCounts.set(fp, (failureCounts.get(fp) ?? 0) + 1);
          }
        }

        const verifyResult = await verifier.verify(goal, evidence, {
          currentSourceRevision: currentRevision,
          failureCounts,
          repeatedFailureThreshold: threshold,
          llmVerifier: this.deps.llmVerifier,
        });
        this.deps.eventSink?.emitVerification({
          goalId: input.goalId,
          runId: run.runId,
          conversationId: input.conversationId,
          result: verifyResult,
        });

        if (verifyResult.verdict === "satisfied") {
          terminalStatus = "complete";
          terminalReason = "all_criteria_satisfied";
          break;
        }
        if (verifyResult.verdict === "blocked") {
          terminalStatus = "blocked";
          terminalReason = "repeated_failure_threshold";
          break;
        }
        if (verifyResult.verdict === "needs_user_input") {
          terminalStatus = "needs_user_input";
          terminalReason = "verification_needs_user_input";
          break;
        }
        // not_satisfied -> continue to the next iteration.
      }
    } finally {
      this.activeRuns.delete(input.conversationId);
    }

    await persistence.endRun(
      run.runId,
      terminalStatus,
      terminalReason,
      terminalStatus === "cancelled"
    );
    await persistence.transitionGoalStatus(input.goalId, terminalStatus, {
      iterationCount: iterations,
      terminalReason,
    });
    this.deps.eventSink?.emitState({
      goalId: input.goalId,
      conversationId: input.conversationId,
      status: terminalStatus,
      objective: goal.objective,
      iterationCount: iterations,
      terminalReason,
    });

    return { runId: run.runId, terminalStatus, terminalReason, iterations };
  }

  /** Request cancellation of the active run for a conversation (user Stop). */
  stop(conversationId: string): void {
    this.activeRuns.get(conversationId)?.abort.abort();
  }

  hasActiveRun(conversationId: string): boolean {
    return this.activeRuns.has(conversationId);
  }
}

/** The continuation prompt sent to the maker model each iteration (design §6.2). */
export function buildGoalContinuationPrompt(goal: AIChatGoalView): string {
  const required = goal.criteria.filter((c) => c.required);
  const criteriaSummary =
    required.length > 0
      ? required.map((c) => `- ${c.description}`).join("\n")
      : "(no explicit required criteria yet)";
  return [
    `Active goal: ${goal.objective}`,
    "",
    "Current required criteria:",
    criteriaSummary,
    "",
    "Work on one safe, approved next step. Do not claim the goal is complete merely because a step succeeded. Report blockers, approvals needed, or user input required.",
  ].join("\n");
}
