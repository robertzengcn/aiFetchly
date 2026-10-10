import { log } from "@/modules/Logger";
import { getDefaultManagedBrowserCacheModule } from "@/modules/ManagedBrowserCacheModule";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";
import { MANAGED_BROWSER_CACHE_DEFAULTS } from "@/config/managedBrowser";

/**
 * Managed-browser cache maintenance scheduler (design §13.7, GAP-10).
 *
 * Enforces the configured global cache limit on a bounded cadence: one pass
 * shortly after startup, then at most once per maintenanceMinIntervalMs
 * (24h default). Each pass:
 *   1. resumes leftover deletion-queue entries (crash recovery);
 *   2. plans an LRU-inactive eviction with the maintenance worker
 *      (500 MB global / 200 MB per-account / 30-day retention defaults,
 *      active scopes excluded by the worker);
 *   3. executes the atomic renames for the planned scopes and delegates
 *      the bounded deletes.
 *
 * Failures never propagate — the next pass retries.
 */

export interface CacheMaintenanceSchedulerDeps {
  readonly cacheModule?: {
    resumePendingDeletions(): Promise<void>;
    enforceEvictionLimits(settings: {
      readonly cacheMaxBytes: number;
    }): Promise<{ plannedScopes: number; plannedBytes: number; skipped: boolean }>;
  };
  readonly settings?: ManagedBrowserSettingsModule;
  readonly now?: () => number;
  readonly startupDelayMs?: number;
}

export class ManagedBrowserCacheMaintenanceScheduler {
  private readonly cacheModule: NonNullable<
    CacheMaintenanceSchedulerDeps["cacheModule"]
  >;
  private readonly settings: ManagedBrowserSettingsModule;
  private readonly now: () => number;
  private readonly startupDelayMs: number;
  private lastRunAt = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  public constructor(deps: CacheMaintenanceSchedulerDeps = {}) {
    this.cacheModule =
      deps.cacheModule ?? getDefaultManagedBrowserCacheModule();
    this.settings = deps.settings ?? new ManagedBrowserSettingsModule();
    this.now = deps.now ?? Date.now;
    this.startupDelayMs = deps.startupDelayMs ?? 30_000;
  }

  /** Start the cadence: one early pass, then at-most-daily passes. */
  public start(): void {
    if (this.timer || this.intervalTimer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce();
    }, this.startupDelayMs);
    this.timer.unref?.();
    this.intervalTimer = setInterval(
      () => void this.runOnce(),
      MANAGED_BROWSER_CACHE_DEFAULTS.maintenanceMinIntervalMs
    );
    this.intervalTimer.unref?.();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /** One bounded maintenance pass (public for the startup path + tests). */
  public async runOnce(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }
    const sinceLast = this.now() - this.lastRunAt;
    if (this.lastRunAt > 0 && sinceLast < MANAGED_BROWSER_CACHE_DEFAULTS.maintenanceMinIntervalMs) {
      return; // at-most-daily cadence
    }
    this.running = true;
    try {
      await this.cacheModule.resumePendingDeletions();
      const effective = await this.settings.getEffectiveSettings();
      const outcome = await this.cacheModule.enforceEvictionLimits({
        cacheMaxBytes: effective.cacheMaxBytes,
      });
      this.lastRunAt = this.now();
      if (outcome.plannedScopes > 0) {
        // Byte counts only — never paths or identifiers (§13.4).
        log.info(
          `[ManagedBrowserCache] eviction pass: ${outcome.plannedScopes} scope(s), ~${outcome.plannedBytes} bytes planned`
        );
      }
    } catch (error) {
      log.warn(
        `[ManagedBrowserCache] maintenance pass failed: ${
          error instanceof Error ? error.name : "unknown"
        }`
      );
    } finally {
      this.running = false;
    }
  }
}

let defaultScheduler: ManagedBrowserCacheMaintenanceScheduler | null = null;

export function getDefaultManagedBrowserCacheMaintenanceScheduler(): ManagedBrowserCacheMaintenanceScheduler {
  if (!defaultScheduler) {
    defaultScheduler = new ManagedBrowserCacheMaintenanceScheduler();
  }
  return defaultScheduler;
}
