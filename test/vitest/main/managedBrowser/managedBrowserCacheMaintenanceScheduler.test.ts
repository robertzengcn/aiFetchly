import { describe, expect, it, vi, beforeEach } from "vitest";

import { ManagedBrowserCacheMaintenanceScheduler } from "@/service/ManagedBrowserCacheMaintenanceScheduler";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";

/**
 * GAP-10: the maintenance scheduler enforces cache limits on a bounded
 * cadence — resume pending deletions, plan an eviction with the worker,
 * execute the renames — at most once per 24h, failures never propagate.
 */

function makeHarness(
  overrides: {
    enforce?: ReturnType<typeof vi.fn>;
    resume?: ReturnType<typeof vi.fn>;
    cacheMaxBytes?: number;
  } = {}
) {
  const enforce =
    overrides.enforce ??
    vi.fn(async () => ({ plannedScopes: 2, plannedBytes: 1024, skipped: false }));
  const resume = overrides.resume ?? vi.fn(async () => undefined);
  const scheduler = new ManagedBrowserCacheMaintenanceScheduler({
    cacheModule: {
      resumePendingDeletions: resume,
      enforceEvictionLimits: enforce,
    },
    settings: {
      getEffectiveSettings: async () => ({
        browserEnabled: true,
        cacheEnabled: true,
        cacheMaxBytes: overrides.cacheMaxBytes ?? 500 * 1024 * 1024,
        clearCacheOnExit: false,
        disabledReasonCode: null,
      }),
    } as unknown as ManagedBrowserSettingsModule,
    now: () => 1_000_000,
  });
  return { scheduler, enforce, resume };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ManagedBrowserCacheMaintenanceScheduler (GAP-10)", () => {
  it("one pass resumes pending deletions and enforces the configured limit", async () => {
    const h = makeHarness();
    await h.scheduler.runOnce();
    expect(h.resume).toHaveBeenCalledTimes(1);
    expect(h.enforce).toHaveBeenCalledWith({
      cacheMaxBytes: 500 * 1024 * 1024,
    });
  });

  it("never runs more than once per maintenance interval", async () => {
    const h = makeHarness();
    await h.scheduler.runOnce();
    await h.scheduler.runOnce(); // within 24h — skipped
    expect(h.enforce).toHaveBeenCalledTimes(1);
  });

  it("failures are contained — the next pass retries", async () => {
    const enforce = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker gone"))
      .mockResolvedValue({
        plannedScopes: 1,
        plannedBytes: 10,
        skipped: false,
      });
    const h = makeHarness({ enforce });
    await expect(h.scheduler.runOnce()).resolves.toBeUndefined();
    // Force the interval to elapse and run again.
    const scheduler2 = new ManagedBrowserCacheMaintenanceScheduler({
      cacheModule: {
        resumePendingDeletions: vi.fn(async () => undefined),
        enforceEvictionLimits: enforce,
      },
      settings: h.scheduler["settings"],
      now: () => 1_000_000 + 25 * 60 * 60 * 1000,
    });
    await scheduler2.runOnce();
    expect(enforce).toHaveBeenCalledTimes(2);
  });
});
