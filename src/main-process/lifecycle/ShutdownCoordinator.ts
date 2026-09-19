import { log } from "@/modules/Logger";
import type { ApplicationShutdownPhase } from "@/entityTypes/applicationLifecycleTypes";
import type { LifecycleCleanupContext } from "@/main-process/lifecycle/ApplicationLifecycleService";

/**
 * ShutdownCoordinator — ordered shutdown phases under one global deadline
 * (technical design §5, PRD FR-05).
 *
 *  Phase        Target window   Actions
 *  freeze       0–250 ms        block new work (participants' sync freeze())
 *  graceful     ≤ 6 s elapsed   cancel jobs, ask workers/browsers to close
 *  force+verify ≤ 9 s elapsed   terminate remaining owned process trees
 *  finalize     ≤ 10 s elapsed  persist outcomes, close resources, tray off
 *
 * Rules implemented here:
 *  - ONE monotonic deadline; stage windows are caps within it, never added.
 *  - Settled aggregation per stage — one rejecting/timing-out participant
 *    never skips its siblings (AC-04/06, design §5).
 *  - A stage timeout does NOT cancel the underlying promise; adapters see
 *    the shared AbortSignal and must stop on it (design §5).
 *  - The report records phases, participants, forced kills and verification
 *    failures — never command arguments, credentials, or scraped content
 *    (FR-09). Error messages are truncated.
 *  - `clean === false` whenever the deadline expired or verification failed,
 *    so a forced/incomplete shutdown can never be marked clean (AC-15).
 */

/** Sync freeze + async stop/finalize contract for a shutdown participant. */
export interface ShutdownParticipant {
  readonly id: string;
  /** Synchronous: block new work immediately (spawn gate, dispatch freeze). */
  freeze(): void;
  /** Graceful phase: cancel jobs, close workers/browsers, drain results. */
  stop(context: ShutdownContext): Promise<void>;
  /** Finalize phase: persist outcomes, close resources (DB last). */
  finalize(context: ShutdownContext): Promise<void>;
}

/**
 * Injected force-stop step (OwnedProcessRegistry + ProcessTreeTerminator).
 * Returns how many process trees were force-stopped and which could not be
 * verified as exited.
 */
export type ForceStopHook = (
  context: ShutdownContext
) => Promise<{ forcedCount: number; verificationFailures: string[] }>;

/** Context handed to participants; `remainingMs()` shares the one deadline. */
export interface ShutdownContext {
  readonly attemptId: string;
  /** Monotonic milliseconds (clock-injected) of the global deadline. */
  readonly deadlineMonotonicMs: number;
  readonly signal: AbortSignal;
  /** Milliseconds left until the global deadline (never negative). */
  remainingMs(): number;
}

export interface ShutdownPhaseTiming {
  readonly phase: Exclude<ApplicationShutdownPhase, "idle" | "done">;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export type ParticipantOutcomeStatus = "ok" | "error" | "timeout";

export interface ParticipantOutcome {
  readonly id: string;
  readonly stage: "stop" | "finalize";
  readonly status: ParticipantOutcomeStatus;
  readonly errorMessage?: string;
}

/** Privacy-safe shutdown report (FR-09). No args, no credentials, no data. */
export interface ShutdownReport {
  readonly attemptId: string;
  readonly reason: LifecycleCleanupContext["reason"];
  readonly intent: LifecycleCleanupContext["intent"];
  readonly totalDurationMs: number;
  readonly phaseTimings: ShutdownPhaseTiming[];
  readonly participantOutcomes: ParticipantOutcome[];
  readonly forcedTerminationCount: number;
  readonly verificationFailures: string[];
  readonly deadlineExpired: boolean;
  readonly clean: boolean;
}

/** Optional sinks for phase progress and the final report. */
export interface ShutdownCoordinatorPorts {
  /** Lazy so shutdown never instantiates unused services (design §3). */
  readonly participants: () => ShutdownParticipant[];
  /** Optional — the process-termination stage. Skipped when absent. */
  readonly forceStop?: ForceStopHook;
  /** Progress callback (wired to the lifecycle service / renderer). */
  readonly onPhase?: (phase: ApplicationShutdownPhase) => void;
  /** Report consumer (writer persists JSONL into the diagnostics dir). */
  readonly onReport?: (report: ShutdownReport) => void;
}

export interface ShutdownCoordinatorOptions extends ShutdownCoordinatorPorts {
  /** Monotonic clock in milliseconds (Date.now()-based; injectable). */
  readonly now?: () => number;
  /** Global budget. Stage caps below are fractions of it (design §5). */
  readonly totalBudgetMs?: number;
  readonly gracefulElapsedCapMs?: number;
  readonly forceElapsedCapMs?: number;
}

const DEFAULT_TOTAL_BUDGET_MS = 10_000;
/** Design §5 freeze target: the synchronous freeze pass fits in 250 ms. */
const DEFAULT_FREEZE_PHASE_CAP_MS = 250;
const DEFAULT_GRACEFUL_ELAPSED_CAP_MS = 6_000;
const DEFAULT_FORCE_ELAPSED_CAP_MS = 9_000;
const MAX_ERROR_MESSAGE_LENGTH = 200;

function truncateMessage(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

function describeError(err: unknown): string {
  const raw =
    err instanceof Error
      ? // Error.message only — name+message, never stack traces (may embed paths).
        `${err.name}: ${err.message}`
      : String(err);
  // FR-09 privacy: messages can quote filesystem paths (ENOENT etc.).
  // Collapse absolute/posix/win32 path-shaped runs to <path>.
  return truncateMessage(
    raw.replace(
      /(?:[A-Za-z]:)?(?:[\/][\w .@()-]+){2,}/g,
      "<path>"
    )
  );
}

/**
 * Race a stage against its remaining budget. The losing promises keep
 * running (no cancellation here); their adapters must honor the abort
 * signal. Resolves `{ timedOut: true }` when the budget expires first.
 */
async function runWithBudget(
  label: string,
  work: Promise<void>,
  budgetMs: number,
  elapsedMs: () => number
): Promise<{ timedOut: boolean }> {
  if (budgetMs <= 0) {
    log.warn(`[shutdown] ${label}: no budget left, skipping wait`);
    return { timedOut: true };
  }
  let timedOut = false;
  const timer = new Promise<{ timedOut: boolean }>((resolve) => {
    // Watchdog kept referenced so Node/Electron cannot consider the loop
    // idle mid-cleanup (design §5 "Keep the deadline timer referenced").
    const t = setTimeout(() => {
      timedOut = true;
      resolve({ timedOut: true });
    }, Math.max(0, budgetMs));
    if (typeof t.unref === "function") {
      // The watchdog must not keep the app alive on its own during a normal
      // quit — but the pending stage promises do that already.
      t.unref();
    }
  });
  const winner = await Promise.race([
    work.then(() => ({ timedOut: false } as { timedOut: boolean })),
    timer,
  ]);
  if (winner.timedOut) {
    log.warn(
      `[shutdown] ${label}: stage budget expired after ${elapsedMs()}ms`
    );
  }
  return { timedOut: timedOut || winner.timedOut };
}

export class ShutdownCoordinator {
  private readonly now: () => number;
  private readonly participants: () => ShutdownParticipant[];
  private readonly forceStop: ForceStopHook | undefined;
  private readonly onPhase:
    | ((phase: ApplicationShutdownPhase) => void)
    | undefined;
  private readonly onReport: ((report: ShutdownReport) => void) | undefined;
  private readonly totalBudgetMs: number;
  private readonly gracefulElapsedCapMs: number;
  private readonly forceElapsedCapMs: number;

  constructor(options: ShutdownCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.participants = options.participants;
    this.forceStop = options.forceStop;
    this.onPhase = options.onPhase;
    this.onReport = options.onReport;
    this.totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    this.gracefulElapsedCapMs =
      options.gracefulElapsedCapMs ?? DEFAULT_GRACEFUL_ELAPSED_CAP_MS;
    this.forceElapsedCapMs =
      options.forceElapsedCapMs ?? DEFAULT_FORCE_ELAPSED_CAP_MS;
  }

  /**
   * Run the four phases under one global deadline. Always resolves (never
   * throws) — a coordinator crash must not block termination.
   */
  async run(context: LifecycleCleanupContext): Promise<{
    clean: boolean;
    report: ShutdownReport;
  }> {
    const startedAt = this.now();
    const deadline = startedAt + this.totalBudgetMs;
    const controller = new AbortController();
    const ctx: ShutdownContext = {
      attemptId: context.attemptId,
      deadlineMonotonicMs: deadline,
      signal: controller.signal,
      remainingMs: () => Math.max(0, deadline - this.now()),
    };

    const phaseTimings: ShutdownPhaseTiming[] = [];
    const participantOutcomes: ParticipantOutcome[] = [];
    let forcedCount = 0;
    let verificationFailures: string[] = [];
    let deadlineExpired = false;

    let participants: ShutdownParticipant[] = [];
    try {
      participants = this.participants();
    } catch (err) {
      log.error(
        "[shutdown] participant provider failed:",
        err instanceof Error ? err.message : String(err)
      );
    }

    const elapsed = (): number => this.now() - startedAt;

    // ---- Phase 1: freeze (synchronous, ≤250 ms by design) ----------------
    this.onPhase?.("freeze");
    const freezeStart = this.now();
    for (const participant of participants) {
      try {
        participant.freeze();
      } catch (err) {
        participantOutcomes.push({
          id: participant.id,
          stage: "stop",
          status: "error",
          errorMessage: describeError(err),
        });
      }
    }
    phaseTimings.push({
      phase: "freeze",
      durationMs: this.now() - freezeStart,
      timedOut: this.now() - freezeStart > DEFAULT_FREEZE_PHASE_CAP_MS,
    });

    // ---- Phase 2: graceful stop and drain (≤6 s elapsed) ------------------
    this.onPhase?.("graceful-stop");
    const gracefulStart = this.now();
    const gracefulBudget = Math.min(
      this.gracefulElapsedCapMs - elapsed(),
      this.totalBudgetMs - elapsed()
    );
    const stopStage = this.runStage(participants, "stop", ctx);
    const gracefulResult = await runWithBudget(
      "graceful-stop",
      stopStage.promise,
      Math.max(0, gracefulBudget),
      elapsed
    );
    participantOutcomes.push(...stopStage.collect(gracefulResult.timedOut));
    phaseTimings.push({
      phase: "graceful-stop",
      durationMs: this.now() - gracefulStart,
      timedOut: gracefulResult.timedOut,
    });
    if (gracefulResult.timedOut) deadlineExpired = true;

    // ---- Phase 3: force stop and verify (≤9 s elapsed) --------------------
    this.onPhase?.("force-stop");
    const forceStart = this.now();
    if (this.forceStop) {
      const forceBudget = Math.min(
        this.forceElapsedCapMs - elapsed(),
        this.totalBudgetMs - elapsed()
      );
      try {
        const forcePromise = Promise.resolve(this.forceStop(ctx)).then(
          (result) => {
            forcedCount = result.forcedCount;
            verificationFailures = result.verificationFailures;
          }
        );
        const forceResult = await runWithBudget(
          "force-stop",
          forcePromise,
          Math.max(0, forceBudget),
          elapsed
        );
        if (forceResult.timedOut) deadlineExpired = true;
      } catch (err) {
        log.error(
          "[shutdown] force-stop failed:",
          err instanceof Error ? err.message : String(err)
        );
        verificationFailures = ["force-stop hook failed"];
      }
    }
    phaseTimings.push({
      phase: "force-stop",
      durationMs: this.now() - forceStart,
      timedOut: elapsed() > this.forceElapsedCapMs,
    });

    // ---- Phase 4: finalize (≤10 s total) ----------------------------------
    this.onPhase?.("finalize");
    const finalizeStart = this.now();
    const finalizeBudget = this.totalBudgetMs - elapsed();
    const finalizeStage = this.runStage(participants, "finalize", ctx);
    const finalizeResult = await runWithBudget(
      "finalize",
      finalizeStage.promise,
      Math.max(0, finalizeBudget),
      elapsed
    );
    participantOutcomes.push(...finalizeStage.collect(finalizeResult.timedOut));
    if (finalizeResult.timedOut) deadlineExpired = true;
    phaseTimings.push({
      phase: "finalize",
      durationMs: this.now() - finalizeStart,
      timedOut: finalizeResult.timedOut,
    });

    controller.abort();

    const clean =
      !deadlineExpired &&
      verificationFailures.length === 0 &&
      participantOutcomes.every((o) => o.status === "ok");

    const report: ShutdownReport = {
      attemptId: context.attemptId,
      reason: context.reason,
      intent: context.intent,
      totalDurationMs: elapsed(),
      phaseTimings,
      participantOutcomes,
      forcedTerminationCount: forcedCount,
      verificationFailures,
      deadlineExpired,
      clean,
    };
    this.onReport?.(report);
    if (!clean) {
      log.warn(
        `[shutdown] attempt ${context.attemptId} finished UNCLEAN ` +
          `(deadlineExpired=${deadlineExpired}, forced=${forcedCount}, ` +
          `verificationFailures=${verificationFailures.length})`
      );
    } else {
      log.info(
        `[shutdown] attempt ${context.attemptId} clean exit in ${elapsed()}ms`
      );
    }
    return { clean, report };
  }

  /**
   * Run one stage for every participant concurrently with settled
   * aggregation: each participant's outcome is captured independently
   * (design §5), so one rejection cannot skip its siblings.
   *
   * Outcomes are recorded synchronously into a mutable record at settlement
   * time (the `.then` below runs before the `Promise.all` continuation by
   * microtask registration order), so `collect` can classify every
   * participant without another await — including participants still
   * running when the stage budget expired ("timeout").
   */
  private runStage(
    participants: ShutdownParticipant[],
    stage: "stop" | "finalize",
    ctx: ShutdownContext
  ): {
    promise: Promise<void>;
    collect: (timedOut: boolean) => ParticipantOutcome[];
  } {
    const records = new Map<
      string,
      { status: ParticipantOutcomeStatus | "pending"; errorMessage?: string }
    >();
    const work: Promise<void>[] = [];
    for (const participant of participants) {
      const record: {
        status: ParticipantOutcomeStatus | "pending";
        errorMessage?: string;
      } = { status: "pending" };
      records.set(participant.id, record);
      const outcome = (async (): Promise<void> => {
        try {
          if (stage === "stop") {
            await participant.stop(ctx);
          } else {
            await participant.finalize(ctx);
          }
        } catch (err) {
          record.errorMessage = describeError(err);
          log.warn(
            `[shutdown] participant '${participant.id}' ${stage} error:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      })();
      outcome.then(() => {
        if (record.status === "pending") {
          record.status = record.errorMessage === undefined ? "ok" : "error";
        }
      });
      work.push(outcome);
    }
    return {
      promise: Promise.all(work).then(() => undefined),
      collect: (timedOut: boolean): ParticipantOutcome[] => {
        const results: ParticipantOutcome[] = [];
        for (const [id, record] of records) {
          const status: ParticipantOutcomeStatus =
            record.status === "pending"
              ? timedOut
                ? "timeout"
                : "ok"
              : record.status;
          results.push({
            id,
            stage,
            status,
            ...(status === "error" && record.errorMessage !== undefined
              ? { errorMessage: record.errorMessage }
              : {}),
          });
        }
        return results;
      },
    };
  }
}
