import type {
  ManagedBrowserErrorCode,
  ManagedBrowserSessionState,
} from "@/entityTypes/managedBrowserTypes";

/**
 * Managed-browser runtime state machine (technical design §9).
 *
 * The WORKER owns this machine; the MAIN process remains authoritative for
 * renderer-visible state (it layers approval + worker-lifecycle knowledge on
 * top). Pure module — no Puppeteer/Electron imports.
 *
 * State guards (design §9):
 *  - observe allowed in ready/running/awaiting_approval/handoff;
 *  - actions only in ready/running (AI control paused elsewhere);
 *  - during login/challenge/handoff, actions/scripts are rejected with
 *    `user_has_control` or `challenge_in_progress`;
 *  - stop is valid and idempotent in every state.
 */

/** Commands the worker runtime can be asked to execute. */
export type ManagedBrowserCommandType =
  | "START_SESSION"
  | "OBSERVE"
  | "RUN_ACTIONS"
  | "CAPTURE_SCREENSHOT"
  | "BEGIN_HANDOFF"
  | "RESUME_HANDOFF"
  | "VERIFY_MANUAL_LOGIN"
  | "CANCEL_REQUEST"
  | "STOP_SESSION";

export type CommandGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorCode: ManagedBrowserErrorCode };

const OBSERVE_STATES: ReadonlySet<ManagedBrowserSessionState> = new Set([
  "ready",
  "running",
  "awaiting_approval",
  "handoff",
]);

const ACTION_STATES: ReadonlySet<ManagedBrowserSessionState> = new Set([
  "ready",
  "running",
]);

const USER_CONTROL_STATES: ReadonlySet<ManagedBrowserSessionState> = new Set([
  "login_required",
  "user_login_in_progress",
  "verifying_manual_login",
  "handoff",
]);

const CHALLENGE_STATES: ReadonlySet<ManagedBrowserSessionState> = new Set([
  "challenge_detected",
  "challenge_resolving",
]);

/**
 * Guard a command against the current state (FR-RUNTIME-004 fail-closed).
 * START_SESSION is only valid pre-session (the worker starts in `starting`).
 */
export function assertCommandAllowed(
  state: ManagedBrowserSessionState,
  command: ManagedBrowserCommandType
): CommandGuardResult {
  switch (command) {
    case "STOP_SESSION":
    case "CANCEL_REQUEST":
      return { ok: true };
    case "START_SESSION":
      return state === "starting"
        ? { ok: true }
        : { ok: false, errorCode: "action_not_allowed" };
    case "OBSERVE":
    case "CAPTURE_SCREENSHOT":
      // Screenshots are additionally disabled at the executor level while a
      // credential/OTP field is focused (design §18.1); state-level they
      // follow observe rules.
      return OBSERVE_STATES.has(state)
        ? { ok: true }
        : { ok: false, errorCode: "action_not_allowed" };
    case "RUN_ACTIONS":
      if (USER_CONTROL_STATES.has(state)) {
        return { ok: false, errorCode: "user_has_control" };
      }
      if (CHALLENGE_STATES.has(state)) {
        return { ok: false, errorCode: "challenge_in_progress" };
      }
      return ACTION_STATES.has(state)
        ? { ok: true }
        : { ok: false, errorCode: "action_not_allowed" };
    case "BEGIN_HANDOFF":
      return ACTION_STATES.has(state) || OBSERVE_STATES.has(state)
        ? { ok: true }
        : { ok: false, errorCode: "action_not_allowed" };
    case "RESUME_HANDOFF":
      return state === "handoff"
        ? { ok: true }
        : { ok: false, errorCode: "action_not_allowed" };
    case "VERIFY_MANUAL_LOGIN":
      return state === "user_login_in_progress"
        ? { ok: true }
        : { ok: false, errorCode: "action_not_allowed" };
    default:
      return { ok: false, errorCode: "action_not_allowed" };
  }
}

/** Live (non-terminal) states — may transition to stopping/failed. */
const LIVE_STATES: ReadonlySet<ManagedBrowserSessionState> = new Set([
  "starting",
  "validating_fingerprint",
  "applying_session",
  "verifying_login",
  "login_required",
  "user_login_in_progress",
  "verifying_manual_login",
  "ready",
  "running",
  "awaiting_approval",
  "challenge_detected",
  "challenge_resolving",
  "handoff",
]);

/** Explicit edges from the §9 diagram (beyond the generic stop/fail rules). */
const EXPLICIT_EDGES_ENTRIES: ReadonlyArray<
  readonly [ManagedBrowserSessionState, ReadonlySet<ManagedBrowserSessionState>]
> = [
  ["starting", new Set(["validating_fingerprint"])],
  ["validating_fingerprint", new Set(["applying_session"])],
  ["applying_session", new Set(["verifying_login"])],
  ["verifying_login", new Set(["ready", "login_required", "handoff"])],
  ["login_required", new Set(["user_login_in_progress"])],
  [
    "user_login_in_progress",
    new Set(["verifying_manual_login", "user_login_in_progress"]),
  ],
  ["verifying_manual_login", new Set(["ready", "user_login_in_progress"])],
  [
    "ready",
    new Set(["running", "awaiting_approval", "challenge_detected", "handoff"]),
  ],
  [
    "running",
    new Set(["ready", "awaiting_approval", "challenge_detected", "handoff"]),
  ],
  [
    "awaiting_approval",
    new Set(["running", "ready", "challenge_detected", "handoff"]),
  ],
  [
    "challenge_detected",
    new Set(["challenge_resolving", "handoff", "verifying_login", "ready"]),
  ],
  ["challenge_resolving", new Set(["verifying_login", "ready", "handoff"])],
  ["handoff", new Set(["verifying_login", "ready"])],
  ["failed", new Set(["stopping"])],
];

const EXPLICIT_EDGES: ReadonlyMap<
  ManagedBrowserSessionState,
  ReadonlySet<ManagedBrowserSessionState>
> = new Map(EXPLICIT_EDGES_ENTRIES);

export type TransitionCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "invalid_transition" | "terminal_state";
    };

export function isTransitionAllowed(
  from: ManagedBrowserSessionState,
  to: ManagedBrowserSessionState
): TransitionCheck {
  if (from === "stopped") {
    return { ok: false, reason: "terminal_state" };
  }
  if (from === to) {
    return { ok: true };
  }
  // Generic terminal rules from any live state.
  if (LIVE_STATES.has(from) && (to === "stopping" || to === "failed")) {
    return { ok: true };
  }
  if (from === "stopping" && to === "stopped") {
    return { ok: true };
  }
  const edges = EXPLICIT_EDGES.get(from);
  if (edges && edges.has(to)) {
    return { ok: true };
  }
  return { ok: false, reason: "invalid_transition" };
}

export interface RuntimeTransitionEvent {
  readonly from: ManagedBrowserSessionState;
  readonly to: ManagedBrowserSessionState;
  readonly reasonCode: string | null;
  readonly at: number;
}

/**
 * Stateful runtime core. The worker wraps this with Puppeteer side effects;
 * every mutation flows through `transition` so invalid moves fail closed.
 */
export class ManagedBrowserRuntime {
  private state: ManagedBrowserSessionState;
  private revision = 0;
  private readonly onChange:
    | ((event: RuntimeTransitionEvent) => void)
    | undefined;

  constructor(
    initialState: ManagedBrowserSessionState = "starting",
    onChange?: (event: RuntimeTransitionEvent) => void
  ) {
    this.state = initialState;
    this.onChange = onChange;
  }

  public getState(): ManagedBrowserSessionState {
    return this.state;
  }

  /**
   * Attempt a transition. Returns false (and keeps the current state) when
   * the move is invalid — callers translate that into a typed error.
   */
  public transition(
    to: ManagedBrowserSessionState,
    reasonCode: string | null = null
  ): boolean {
    const check = isTransitionAllowed(this.state, to);
    if (!check.ok) {
      return false;
    }
    const from = this.state;
    this.state = to;
    this.onChange?.({ from, to, reasonCode, at: Date.now() });
    return true;
  }

  /** Monotonic page revision (design §14.2). Starts at 1 on first bump. */
  public get pageRevision(): number {
    return this.revision;
  }

  public bumpRevision(): number {
    this.revision += 1;
    return this.revision;
  }
}
