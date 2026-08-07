import { log } from "@/modules/Logger";
import {
  computeUpdateSupport,
  mapAutoUpdaterEvent,
  type UpdateStatusSnapshot,
  type UpdateStatusState,
  type UpdateUnsupportedReason,
} from "./UpdateStatus";

/** Minimum cooldown between completed manual checks (PRD FR-4.4). */
const MANUAL_CHECK_COOLDOWN_MS = 60_000;

/** Bounded error code; never reflects raw exception text (PRD NFR-4). */
const ERROR_CODE_UPDATE_CHECK_FAILED = "UPDATE_CHECK_FAILED";

/** States representing an in-flight check — a second manual check is rejected. */
const ACTIVE_STATES: ReadonlySet<UpdateStatusState> = new Set([
  "checking",
  "downloading",
]);

/** Terminal outcomes of a check — subject to the cooldown window. */
const TERMINAL_STATES: ReadonlySet<UpdateStatusState> = new Set([
  "up-to-date",
  "ready-to-restart",
  "error",
]);

/**
 * Structural view of the Electron `autoUpdater` methods the service needs.
 * Kept minimal so tests can supply a fake without loading Electron.
 */
export interface AutoUpdaterLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown> | void;
  quitAndInstall(): void;
}

/**
 * Injectable dependencies. The production singleton supplies real Electron;
 * tests supply fakes. This keeps the class testable without an Electron runtime.
 */
export interface ManualUpdateServiceDeps {
  readonly isPackaged: () => boolean;
  readonly platform: () => string;
  readonly isWindowsStore: () => boolean;
  readonly getAppVersion: () => string;
  readonly getAutoUpdater: () => AutoUpdaterLike;
  /** Injectable clock (scripts/tests cannot use Date.now directly). */
  readonly now: () => number;
  /**
   * Manual-check watchdog. If a manual check stays in `checking` longer than
   * this without a terminal event, it is forced to `error` so the UI cannot
   * hang forever on a stuck network. 0 disables (tests). Production: 60_000.
   */
  readonly watchdogMs: number;
}

/** Best-effort extraction of an available version from autoUpdater event args. */
function extractAvailableVersion(args: readonly unknown[]): string | undefined {
  for (const arg of args) {
    if (typeof arg === "object" && arg !== null && "version" in arg) {
      const version = (arg as { version?: unknown }).version;
      if (typeof version === "string" && version.length > 0) {
        return version;
      }
    }
  }
  return undefined;
}

/**
 * ManualUpdateService — the About-page-facing manual check + status layer.
 *
 * The update FEED (update-electron-app, GitHub Releases) is owned by
 * `initializeAppUpdates()` in `AppUpdateService.ts`. This service does NOT
 * configure the feed; it only observes `autoUpdater` events (so status reflects
 * both manual and periodic checks), exposes manual check / status /
 * quit-and-install for the About page, and applies channel gating so
 * unsupported builds report `unsupported` without touching autoUpdater.
 *
 * Side-effect-free with respect to Electron: all Electron access flows through
 * the injected deps.
 */
export class ManualUpdateService {
  private state: UpdateStatusState;
  private unsupportedReason?: UpdateUnsupportedReason;
  private availableVersion?: string;
  private lastCheckedAt?: number;
  private errorCode?: string;
  private subscribed = false;
  private sink: ((snapshot: UpdateStatusSnapshot) => void) | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ManualUpdateServiceDeps) {
    const support = computeUpdateSupport({
      isPackaged: deps.isPackaged(),
      platform: deps.platform(),
      isWindowsStore: deps.isWindowsStore(),
    });
    if (support.supported) {
      this.state = "idle";
    } else {
      this.state = "unsupported";
      this.unsupportedReason = support.reason;
    }
  }

  /**
   * Subscribe to autoUpdater events so periodic checks (driven by the feed in
   * AppUpdateService) are reflected in status, not just manual checks. Idempotent
   * and a no-op on unsupported channels. Safe to call at startup.
   */
  start(): void {
    this.ensureEventSubscribers();
  }

  /** Immutable snapshot of the current update status. */
  getStatus(): UpdateStatusSnapshot {
    const snapshot: {
      state: UpdateStatusState;
      currentVersion: string;
      unsupportedReason?: UpdateUnsupportedReason;
      availableVersion?: string;
      lastCheckedAt?: number;
      errorCode?: string;
    } = {
      state: this.state,
      currentVersion: this.deps.getAppVersion(),
    };
    if (this.unsupportedReason !== undefined) {
      snapshot.unsupportedReason = this.unsupportedReason;
    }
    if (this.availableVersion !== undefined) {
      snapshot.availableVersion = this.availableVersion;
    }
    if (this.lastCheckedAt !== undefined) {
      snapshot.lastCheckedAt = this.lastCheckedAt;
    }
    if (this.errorCode !== undefined) {
      snapshot.errorCode = this.errorCode;
    }
    return snapshot;
  }

  /**
   * Trigger a manual update check. Guards against unsupported channels,
   * concurrent checks, and cooldown spam (PRD FR-4.4, NFR-2).
   */
  async checkForUpdatesNow(): Promise<UpdateStatusSnapshot> {
    if (this.state === "unsupported") {
      return this.getStatus();
    }
    if (ACTIVE_STATES.has(this.state)) {
      return this.getStatus();
    }
    if (
      TERMINAL_STATES.has(this.state) &&
      this.lastCheckedAt !== undefined &&
      this.deps.now() - this.lastCheckedAt < MANUAL_CHECK_COOLDOWN_MS
    ) {
      return this.getStatus();
    }

    // Defensive: ensure autoUpdater events are captured even if start() was not
    // called. No-op once subscribed.
    this.ensureEventSubscribers();

    this.errorCode = undefined;
    this.availableVersion = undefined;
    this.state = "checking";
    this.emitSnapshot();
    this.armCheckWatchdog();

    try {
      await this.deps.getAutoUpdater().checkForUpdates();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error(`[auto-update] manual checkForUpdates threw: ${detail}`);
      this.clearCheckWatchdog();
      this.errorCode = ERROR_CODE_UPDATE_CHECK_FAILED;
      this.lastCheckedAt = this.deps.now();
      this.state = "error";
      this.emitSnapshot();
    }

    return this.getStatus();
  }

  /** Quit and install a downloaded update; no-op unless ready-to-restart. */
  quitAndInstall(): void {
    if (this.state !== "ready-to-restart") {
      return;
    }
    try {
      this.deps.getAutoUpdater().quitAndInstall();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error(`[auto-update] quitAndInstall failed: ${detail}`);
    }
  }

  /** Attach/detach the renderer status sink (one-way push on transitions). */
  setStatusSink(fn: ((snapshot: UpdateStatusSnapshot) => void) | null): void {
    this.sink = fn;
  }

  /**
   * Idempotently subscribe to the autoUpdater events that drive status
   * transitions. No-op on unsupported channels.
   */
  private ensureEventSubscribers(): void {
    if (this.subscribed) {
      return;
    }
    this.subscribed = true;
    if (this.state === "unsupported") {
      return;
    }
    const autoUpdaterRef = this.deps.getAutoUpdater();
    const events: readonly string[] = [
      "checking-for-update",
      "update-available",
      "update-not-available",
      "update-downloaded",
      "error",
    ];
    for (const eventName of events) {
      autoUpdaterRef.on(eventName, (...args: unknown[]) =>
        this.handleAutoUpdaterEvent(eventName, args),
      );
    }
  }

  private handleAutoUpdaterEvent(
    eventName: string,
    args: readonly unknown[],
  ): void {
    const next = mapAutoUpdaterEvent(eventName);
    if (next === null) {
      return;
    }
    switch (next) {
      case "ready-to-restart":
        this.availableVersion = extractAvailableVersion(args);
        this.lastCheckedAt = this.deps.now();
        this.errorCode = undefined;
        this.clearCheckWatchdog();
        break;
      case "up-to-date":
        this.availableVersion = undefined;
        this.lastCheckedAt = this.deps.now();
        this.errorCode = undefined;
        this.clearCheckWatchdog();
        break;
      case "downloading":
        // 'update-available' carries the incoming version; surface it during
        // the (possibly long) download, not only after it completes.
        this.availableVersion = extractAvailableVersion(args);
        this.clearCheckWatchdog();
        break;
      case "error":
        this.errorCode = ERROR_CODE_UPDATE_CHECK_FAILED;
        this.lastCheckedAt = this.deps.now();
        this.availableVersion = undefined;
        this.clearCheckWatchdog();
        break;
      case "checking":
        this.errorCode = undefined;
        break;
      default:
        break;
    }
    this.state = next;
    this.emitSnapshot();
  }

  /**
   * Arm the manual-check watchdog. If the state is still `checking` after
   * `watchdogMs`, force `error` so the UI never hangs on a stuck network.
   */
  private armCheckWatchdog(): void {
    this.clearCheckWatchdog();
    const ms = this.deps.watchdogMs;
    if (ms <= 0) {
      return;
    }
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (this.state !== "checking") {
        return; // a terminal event already arrived
      }
      log.warn("[auto-update] manual check watchdog timed out");
      this.errorCode = ERROR_CODE_UPDATE_CHECK_FAILED;
      this.lastCheckedAt = this.deps.now();
      this.state = "error";
      this.emitSnapshot();
    }, ms);
  }

  private clearCheckWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private emitSnapshot(): void {
    if (this.sink) {
      this.sink(this.getStatus());
    }
  }
}
