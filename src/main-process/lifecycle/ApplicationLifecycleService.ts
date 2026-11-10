import { randomUUID } from "crypto";
import type {
  ApplicationCloseChoice,
  ApplicationExitReason,
  ApplicationLifecycleState,
  ApplicationLifecycleStateChangedEvent,
  ApplicationShutdownPhase,
} from "@/entityTypes/applicationLifecycleTypes";
import { log } from "@/modules/Logger";

/**
 * ApplicationLifecycleService — the authoritative lifecycle state machine and
 * exit arbitrator (technical design §4).
 *
 * PURE TYPESCRIPT: no Electron imports. Window/tray/dialog interactions are
 * supplied by the caller through listeners; the cleanup body is injected via
 * {@link setCleanupRunner}. This keeps the arbitration logic unit-testable
 * without an Electron harness and lets `background.ts` own the glue.
 *
 * Invariants enforced here (PRD FR-01..FR-05, design §4):
 *  - `requestExit()` flips the state to `quitting` SYNCHRONOUSLY, before its
 *    first await, so spawn gates observed later in the same tick already see
 *    a frozen application.
 *  - Repeated exit requests join the SAME promise (AC-08: one cleanup run).
 *  - No transition back to `visible`/`hidden` once `quitting` is set.
 *  - Terminal intent (`quit` vs `update-restart`) is serialized before
 *    cleanup begins: an ordinary quit arriving later must not overwrite a
 *    pending accepted update restart, and a late update request must not
 *    upgrade a shutdown already committed to ordinary quit.
 *  - At most one close-choice dialog token is live; repeated close actions
 *    reuse it instead of stacking dialogs; exit from any other source
 *    invalidates it and late responses are rejected as stale.
 */

/** What the injected cleanup (ShutdownCoordinator) reports back. */
export interface ApplicationExitResult {
  /** Correlates with the local shutdown report (FR-09). */
  readonly attemptId: string;
  readonly reason: ApplicationExitReason;
  readonly intent: TerminalIntent;
  /**
   * False when the global deadline expired or verification failed — a
   * forced/incomplete shutdown must not be recorded as a clean exit (AC-15).
   */
  readonly clean: boolean;
}

/** How the application finally terminates once cleanup completes. */
export type TerminalIntent = "quit" | "update-restart";

/** Cleanup body injected by the composition root (background.ts). */
export type CleanupRunner = (context: LifecycleCleanupContext) => Promise<{
  clean: boolean;
}>;

export interface LifecycleCleanupContext {
  readonly attemptId: string;
  readonly reason: ApplicationExitReason;
  readonly intent: TerminalIntent;
}

export type LifecycleStateListener = (
  event: ApplicationLifecycleStateChangedEvent
) => void;

/** Typed result of submitting a close choice against a dialog token. */
export type CloseChoiceSubmissionResult =
  | { result: "accepted"; choice: ApplicationCloseChoice }
  | { result: "stale" }
  | { result: "invalid-state" };

/** Typed result of asking for a new close-choice dialog. */
export type BeginCloseChoiceResult =
  | { result: "issued"; token: string }
  | { result: "dialog-open"; token: string }
  | { result: "not-visible" }
  | { result: "quitting" };

/** User-facing phase key per state/phase (renderer i18n, design §10). */
function phaseKeyFor(
  state: ApplicationLifecycleState,
  phase: ApplicationShutdownPhase
): string {
  if (state === "quitting") {
    // Keys mirror the `applicationLifecycle` i18n namespace (stoppingTasks,
    // forceStop, finalize) so the renderer can render them directly.
    if (phase === "force-stop") return "forceStop";
    if (phase === "finalize") return "finalize";
    return "stoppingTasks";
  }
  if (state === "ready-to-exit") return "exiting";
  return "idle";
}

export class ApplicationLifecycleService {
  private state: ApplicationLifecycleState = "visible";
  private phase: ApplicationShutdownPhase = "idle";
  private backgroundAvailable = false;

  private pendingToken: string | null = null;
  private rendererAcknowledged = false;

  private exitPromise: Promise<ApplicationExitResult> | null = null;
  private terminalIntent: TerminalIntent | null = null;
  private attemptId: string | null = null;
  private finalExitAuthorized = false;

  private cleanupRunner: CleanupRunner | null = null;
  private exitCompletionHook: ((result: ApplicationExitResult) => void) | null =
    null;
  private readonly listeners = new Set<LifecycleStateListener>();

  // -------------------------------------------------------------------------
  // Close-choice dialog tokens (FR-01, design §4)
  // -------------------------------------------------------------------------

  /**
   * Open (or reuse) the single close-choice dialog token. Repeated close
   * actions while a dialog is pending return the SAME token (AC-08: repeated
   * × must not stack dialogs).
   */
  beginCloseChoice(activeTaskCount?: number): BeginCloseChoiceResult & {
    activeTaskCount?: number;
  } {
    if (this.state === "quitting" || this.state === "ready-to-exit") {
      return { result: "quitting" };
    }
    if (this.state !== "visible") {
      return { result: "not-visible" };
    }
    if (this.pendingToken !== null) {
      return {
        result: "dialog-open",
        token: this.pendingToken,
        activeTaskCount,
      };
    }
    this.pendingToken = randomUUID();
    this.rendererAcknowledged = false;
    return { result: "issued", token: this.pendingToken, activeTaskCount };
  }

  /** Renderer confirmed it is showing the dialog for this token (design §9). */
  acknowledgeCloseChoice(token: string): boolean {
    if (this.pendingToken === null || token !== this.pendingToken) {
      return false;
    }
    this.rendererAcknowledged = true;
    return true;
  }

  /** Dismissal (Escape / close): consume the token, keep the window open. */
  cancelCloseChoice(token: string): CloseChoiceSubmissionResult {
    return this.submitCloseChoice(token, "cancel");
  }

  /** Is the given token still the live dialog token? */
  isCloseChoiceTokenLive(token: string): boolean {
    return this.pendingToken !== null && token === this.pendingToken;
  }

  hasRendererAcknowledged(): boolean {
    return this.rendererAcknowledged;
  }

  /**
   * Submit the user's close choice. Runs synchronously; `exit` flips the
   * state to `quitting` before returning so subsequent gates observe it.
   */
  submitCloseChoice(
    token: string,
    choice: ApplicationCloseChoice
  ): CloseChoiceSubmissionResult {
    if (this.pendingToken === null || token !== this.pendingToken) {
      return { result: "stale" };
    }
    if (this.state === "quitting" || this.state === "ready-to-exit") {
      // Exit was accepted from another source; the dialog is invalid (§4).
      this.pendingToken = null;
      return { result: "stale" };
    }
    // Consume the token — one response per dialog.
    this.pendingToken = null;
    this.rendererAcknowledged = false;

    if (this.state !== "visible") {
      return { result: "invalid-state" };
    }

    if (choice === "cancel") {
      return { result: "accepted", choice };
    }
    if (choice === "hide") {
      if (!this.backgroundAvailable) {
        // Tray unusable: treat as dismissal — never hide into an inaccessible
        // state (FR-07 "Tray unavailable" row).
        log.warn(
          "[lifecycle] keep-running requested but tray unavailable; keeping window open"
        );
        return { result: "accepted", choice: "cancel" };
      }
      this.setState("hidden");
      return { result: "accepted", choice };
    }
    // choice === "exit"
    this.startExit("close-dialog");
    return { result: "accepted", choice };
  }

  /** Invalidate any pending dialog (e.g. an exit was accepted elsewhere). */
  invalidateCloseChoice(): void {
    this.pendingToken = null;
    this.rendererAcknowledged = false;
  }

  // -------------------------------------------------------------------------
  // Background (tray) mode (FR-02, FR-03)
  // -------------------------------------------------------------------------

  /** TrayController reports whether a usable tray exists right now. */
  setBackgroundAvailable(available: boolean): void {
    this.backgroundAvailable = available;
  }

  isBackgroundAvailable(): boolean {
    return this.backgroundAvailable;
  }

  /** Hide to tray — only from `visible` and only when the tray is ready. */
  hideToTray(): boolean {
    if (this.state !== "visible" || !this.backgroundAvailable) {
      return false;
    }
    this.setState("hidden");
    return true;
  }

  /** Restore from tray / second-instance activation (FR-03, AC-03). */
  restoreFromTray(): boolean {
    if (this.state !== "hidden") {
      return false;
    }
    this.setState("visible");
    return true;
  }

  // -------------------------------------------------------------------------
  // Exit arbitration (FR-04, FR-05, design §4)
  // -------------------------------------------------------------------------

  getState(): ApplicationLifecycleState {
    return this.state;
  }

  getPhase(): ApplicationShutdownPhase {
    return this.phase;
  }

  isQuitting(): boolean {
    return this.state === "quitting" || this.state === "ready-to-exit";
  }

  /** True once cleanup completed and the terminal action may run (§4). */
  isFinalExitAuthorized(): boolean {
    return this.finalExitAuthorized;
  }

  getTerminalIntent(): TerminalIntent | null {
    return this.terminalIntent;
  }

  /** Install the cleanup body (ShutdownCoordinator composition in background.ts). */
  setCleanupRunner(runner: CleanupRunner): void {
    this.cleanupRunner = runner;
  }

  /**
   * Terminal sequence invoked exactly once when cleanup completes — for
   * EVERY exit source, including the close-dialog Exit which enters the
   * state machine directly with no external caller awaiting the exit
   * promise (design §4: after cleanup, arm the final-exit guard and run
   * the terminal action). Hook errors are logged, never thrown.
   */
  setExitCompletionHook(
    hook: ((result: ApplicationExitResult) => void) | null
  ): void {
    this.exitCompletionHook = hook;
  }

  /**
   * Request a normal exit. Sets `quitting` synchronously, then returns the
   * SAME promise for every caller. Ordinary reasons never overwrite an
   * accepted `update-restart` intent, and vice versa (design §4).
   */
  requestExit(reason: ApplicationExitReason): Promise<ApplicationExitResult> {
    const intent: TerminalIntent =
      reason === "update-restart" ? "update-restart" : "quit";
    return this.startExit(reason, intent);
  }

  /** Coerce any reason to its terminal intent for arbitration. */
  private startExit(
    reason: ApplicationExitReason,
    intent: TerminalIntent = "quit"
  ): Promise<ApplicationExitResult> {
    if (this.exitPromise) {
      // First accepted intent wins. Log (not throw) — joiners still await the
      // same outcome (design §4 "Serialize intent selection").
      if (this.terminalIntent !== intent) {
        log.info(
          `[lifecycle] exit intent '${intent}' (${reason}) joins ongoing ` +
            `'${this.terminalIntent}' shutdown; first intent retained`
        );
      }
      return this.exitPromise;
    }

    this.terminalIntent = intent;
    this.attemptId = randomUUID();
    // Synchronous freeze BEFORE the first await (design §4 / FR-05 freeze).
    this.invalidateCloseChoice();
    this.setPhaseInternal("freeze");
    this.setState("quitting");

    const attemptId = this.attemptId;
    const exitPromise = this.runCleanup({
      attemptId,
      reason,
      intent,
    });
    this.exitPromise = exitPromise;
    return exitPromise;
  }

  private async runCleanup(
    context: LifecycleCleanupContext
  ): Promise<ApplicationExitResult> {
    let clean = false;
    if (this.cleanupRunner) {
      try {
        const outcome = await this.cleanupRunner(context);
        clean = outcome.clean;
      } catch (err) {
        log.error(
          "[lifecycle] cleanup runner failed:",
          err instanceof Error ? err.message : String(err)
        );
        clean = false;
      }
    } else {
      // Early startup / single-instance loser: empty participant set is a
      // valid, clean outcome (design §12).
      clean = true;
    }
    const result: ApplicationExitResult = {
      attemptId: context.attemptId,
      reason: context.reason,
      intent: context.intent,
      clean,
    };
    // The completion hook runs the terminal sequence (authorize + quit or
    // update install) for EVERY exit source — including paths that enter
    // the lifecycle directly (close-dialog Exit), which have no external
    // caller awaiting this promise.
    if (this.exitCompletionHook) {
      try {
        this.exitCompletionHook(result);
      } catch (err) {
        log.error(
          "[lifecycle] exit completion hook failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    return result;
  }

  /**
   * Cleanup finished: flip to `ready-to-exit` and arm the final-exit guard.
   * After this, `before-quit` must let the quit pass through (design §4
   * "Electron event wiring").
   */
  authorizeFinalExit(): void {
    if (this.state !== "quitting") {
      return;
    }
    this.finalExitAuthorized = true;
    this.setPhaseInternal("done");
    this.setState("ready-to-exit");
  }

  /** ShutdownCoordinator reports phase progress for renderer updates. */
  setPhase(phase: ApplicationShutdownPhase): void {
    if (this.isQuitting()) {
      this.setPhaseInternal(phase);
    }
  }

  // -------------------------------------------------------------------------
  // Renderer / internal subscriptions
  // -------------------------------------------------------------------------

  addStateListener(listener: LifecycleStateListener): void {
    this.listeners.add(listener);
  }

  removeStateListener(listener: LifecycleStateListener): void {
    this.listeners.delete(listener);
  }

  snapshot(): ApplicationLifecycleStateChangedEvent & {
    backgroundAvailable: boolean;
  } {
    return {
      state: this.state,
      phase: this.phase,
      phaseKey: phaseKeyFor(this.state, this.phase),
      backgroundAvailable: this.backgroundAvailable,
    };
  }

  // -------------------------------------------------------------------------

  private setState(next: ApplicationLifecycleState): void {
    if (this.state === next) return;
    // Guard: no revival once quitting (design §4).
    if (
      (this.state === "quitting" || this.state === "ready-to-exit") &&
      next !== "ready-to-exit"
    ) {
      log.warn(
        `[lifecycle] ignoring illegal transition ${this.state} -> ${next}`
      );
      return;
    }
    if (this.state === "ready-to-exit") {
      return; // terminal
    }
    this.state = next;
    this.emit();
  }

  private setPhaseInternal(phase: ApplicationShutdownPhase): void {
    this.phase = phase;
    this.emit();
  }

  private emit(): void {
    const event = {
      state: this.state,
      phase: this.phase,
      phaseKey: phaseKeyFor(this.state, this.phase),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        log.error(
          "[lifecycle] state listener failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Process-wide singleton (main process only; tests construct fresh instances)
// -----------------------------------------------------------------------------

let singleton: ApplicationLifecycleService | null = null;

export function getApplicationLifecycleService(): ApplicationLifecycleService {
  if (!singleton) {
    singleton = new ApplicationLifecycleService();
  }
  return singleton;
}

/** Test-only: drop the singleton so the next getter creates a fresh machine. */
export function resetApplicationLifecycleServiceForTests(): void {
  singleton = null;
}
