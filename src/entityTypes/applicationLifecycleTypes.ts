/**
 * Application Exit & System Tray — shared data contract.
 *
 * Mirrors `docs/prd/application-exit-and-system-tray-prd.md` (FR-01..FR-09)
 * and `docs/prd/application-exit-and-system-tray-technical-design.md` §4/§10.
 *
 * Used by the main-process lifecycle service, the IPC handler, the preload
 * bridge, and the renderer close-choice dialog. Enums are declared as
 * `as const` tuples so the Zod schemas in
 * `src/schemas/ipc/applicationLifecycle.ts` can reuse them and callers get
 * narrowed union types for free.
 *
 * This file is main-process safe (pure data — no Electron / Vue imports) so
 * it can be imported from worker code and tests without side effects.
 */

/**
 * Authoritative lifecycle state (design §4).
 *
 * - `visible`   — normal windowed operation.
 * - `hidden`    — window hidden, tray owns restore, work continues (FR-02).
 * - `quitting`  — exit accepted; cleanup running; no state may return to
 *                 visible/hidden after this point.
 * - `readyToExit` — cleanup finished (or deadline expired); the final-exit
 *                 guard is set and the terminal action may run.
 */
export const APPLICATION_LIFECYCLE_STATES = [
  "visible",
  "hidden",
  "quitting",
  "ready-to-exit",
] as const;
export type ApplicationLifecycleState =
  (typeof APPLICATION_LIFECYCLE_STATES)[number];

/**
 * The user's answer to the close-choice dialog (FR-01) or its native
 * fallback. `cancel` covers Escape / dismissing the dialog — the window
 * stays open and work is untouched.
 */
export const APPLICATION_CLOSE_CHOICES = ["hide", "exit", "cancel"] as const;
export type ApplicationCloseChoice =
  (typeof APPLICATION_CLOSE_CHOICES)[number];

/**
 * Why an exit was requested (design §6). Used for the local shutdown report
 * and for terminal-intent arbitration (`update-restart` must not be
 * overwritten by an ordinary `quit` arriving later, and vice versa).
 */
export const APPLICATION_EXIT_REASONS = [
  "close-dialog",
  "tray",
  "application-menu",
  "programmatic",
  "update-restart",
  "os-session-end",
  "development-signal",
] as const;
export type ApplicationExitReason =
  (typeof APPLICATION_EXIT_REASONS)[number];

/**
 * User-facing phase reported to the renderer while quitting (FR-04): the
 * shell disables new task actions and shows progress text.
 */
export const APPLICATION_SHUTDOWN_PHASES = [
  "idle",
  "freeze",
  "graceful-stop",
  "force-stop",
  "finalize",
  "done",
] as const;
export type ApplicationShutdownPhase =
  (typeof APPLICATION_SHUTDOWN_PHASES)[number];

/**
 * Main → renderer request for a close choice (design §10). `token` is an
 * opaque single-use string: the renderer must echo it back in
 * `SubmitCloseChoice`, and the main process rejects stale tokens.
 */
export interface ApplicationCloseChoiceRequest {
  readonly token: string;
  /** Whether background (tray) mode is currently available. */
  readonly backgroundAvailable: boolean;
  /** Trustworthy active-task count, when known (FR-01). Omitted otherwise. */
  readonly activeTaskCount?: number;
}

/** Renderer → main acknowledgement that the choice dialog is visible. */
export interface ApplicationCloseChoiceAck {
  readonly token: string;
}

/** Renderer → main submission of the user's close choice. */
export interface ApplicationCloseChoiceSubmission {
  readonly token: string;
  readonly choice: ApplicationCloseChoice;
}

/**
 * Main → renderer lifecycle broadcast. `phaseKey` is a translation key
 * suffix (e.g. `exiting`, `stoppingTasks`) for user-facing status text.
 */
export interface ApplicationLifecycleStateChangedEvent {
  readonly state: ApplicationLifecycleState;
  readonly phase: ApplicationShutdownPhase;
  /** i18n key suffix under `applicationLifecycle` for the current phase. */
  readonly phaseKey: string;
}

/** Result of the get-lifecycle-state IPC call. */
export interface ApplicationLifecycleStateSnapshot {
  readonly state: ApplicationLifecycleState;
  readonly phase: ApplicationShutdownPhase;
  /** False when tray creation failed or the desktop has no usable tray. */
  readonly backgroundAvailable: boolean;
}
