/**
 * Pure startup-policy resolver (design §7).
 *
 * Normal startup performs several side effects that are undesirable or
 * non-deterministic in Electron E2E tests: registering an OS protocol handler,
 * acquiring the production single-instance lock, initializing the auto-updater,
 * installing Vue DevTools, starting cron schedulers, inspecting orphaned scraper
 * processes, connecting the marketing WebSocket, refreshing auth tokens, starting
 * the dev browser bridge, and scanning the global ~/.aifetchly config tree.
 *
 * This module turns those side effects on/off based on the environment WITHOUT
 * changing production or normal-development behavior. When `AIFETCHLY_E2E=1`,
 * every external side effect is disabled; the BrowserWindow, CSP, preload,
 * IPC registration, Modules/Models, and isolated SQLite initialization all
 * remain active so tests exercise the real renderer->preload->IPC->model path.
 *
 * The resolver is intentionally pure (no `electron` import) so it can be
 * unit-tested exhaustively in Vitest (design §18).
 */

export interface AppStartupPolicy {
  /** Register the custom protocol scheme with the OS / ProtocolRegistry. */
  readonly registerProtocol: boolean;
  /** Acquire the production single-instance lock and listen for second-instance. */
  readonly acquireSingleInstanceLock: boolean;
  /** Initialize the GitHub Releases auto-updater. */
  readonly initializeUpdates: boolean;
  /** Install Vue DevTools in the renderer. */
  readonly installDevTools: boolean;
  /** Start cron schedulers and the interval-based Chat V2 scheduler. */
  readonly startSchedulers: boolean;
  /** Inspect orphaned Yellow Pages / scraper processes from a previous session. */
  readonly inspectOrphanedTasks: boolean;
  /** Connect the marketing WebSocket. */
  readonly connectMarketingWebSocket: boolean;
  /** Start background auth-token auto-refresh. */
  readonly startTokenRefresh: boolean;
  /** Start the dev browser bridge (also self-gated by a dev-only flag). */
  readonly startDevBrowserBridge: boolean;
  /** Scan the global ~/.aifetchly config / plugin / skill tree on boot. */
  readonly scanGlobalExtensions: boolean;
}

/** Production / normal-development policy: every side effect enabled. */
const PRODUCTION_POLICY: AppStartupPolicy = {
  registerProtocol: true,
  acquireSingleInstanceLock: true,
  initializeUpdates: true,
  installDevTools: true,
  startSchedulers: true,
  inspectOrphanedTasks: true,
  connectMarketingWebSocket: true,
  startTokenRefresh: true,
  startDevBrowserBridge: true,
  scanGlobalExtensions: true,
};

/** E2E policy: every external side effect disabled (design §7.2). */
const E2E_POLICY: AppStartupPolicy = {
  registerProtocol: false,
  acquireSingleInstanceLock: false,
  initializeUpdates: false,
  installDevTools: false,
  startSchedulers: false,
  inspectOrphanedTasks: false,
  connectMarketingWebSocket: false,
  startTokenRefresh: false,
  startDevBrowserBridge: false,
  scanGlobalExtensions: false,
};

/**
 * Resolve the startup policy from the environment.
 *
 * E2E mode is enabled ONLY by the exact sentinel `AIFETCHLY_E2E=1`. Packaged
 * production builds never set it, so they always get the production policy.
 */
export function resolveAppStartupPolicy(
  environment: NodeJS.ProcessEnv,
  _isPackaged: boolean
): AppStartupPolicy {
  if (environment.AIFETCHLY_E2E === "1") {
    return E2E_POLICY;
  }
  return PRODUCTION_POLICY;
}
