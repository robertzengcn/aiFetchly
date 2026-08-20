/**
 * Process-wide registry for the Chat V2 interval-scheduler lifecycle hooks.
 *
 * Why this exists
 * ---------------
 * Login (`completeDesktopLogin`) and logout (`User.removeToken`) rebuild the
 * shared `SqliteDb` DataSource, which invalidates every cached TypeORM
 * repository held by `BackgroundScheduler`. The scheduler must be refreshed
 * (login) or stopped (logout) in lockstep with that reset, otherwise its 30s
 * interval poll keeps querying a destroyed connection and throws
 * `"The database connection is not open"`.
 *
 * The login/logout modules cannot import `@/background` directly: `background.ts`
 * imports `electron-devtools-installer` and other Electron-only modules at
 * module-evaluation time, which breaks the pure-Node vitest suites that
 * exercise `BackgroundScheduler` and its collaborators. This registry breaks
 * that cycle — `background.ts` registers concrete implementations at boot,
 * and the login/logout flows invoke them through this neutral interface.
 */

export type ChatSchedulerLifecycle = {
  /** Refresh the scheduler against the current USERSDBPATH and (re)start it. */
  refreshAndStart: () => Promise<void>;
  /** Stop the scheduler and clear the singleton reference. */
  stop: () => Promise<void>;
};

let lifecycle: ChatSchedulerLifecycle | null = null;

/**
 * Register the scheduler lifecycle hooks. Called once from `background.ts`
 * after the scheduler is constructed. Passing `null` clears the registration
 * (used by tests).
 */
export function registerChatSchedulerLifecycle(
  hooks: ChatSchedulerLifecycle | null
): void {
  lifecycle = hooks;
}

/**
 * Invoke the registered refresh+start hook. Returns silently when no
 * scheduler is registered (e.g. before boot completes) so callers can treat
 * the scheduler as best-effort.
 */
export async function refreshChatSchedulerForUserPath(): Promise<void> {
  if (!lifecycle) return;
  await lifecycle.refreshAndStart();
}

/**
 * Invoke the registered stop hook. Returns silently when no scheduler is
 * registered so logout is robust even if the scheduler never started.
 */
export async function stopChatScheduler(): Promise<void> {
  if (!lifecycle) return;
  await lifecycle.stop();
}
