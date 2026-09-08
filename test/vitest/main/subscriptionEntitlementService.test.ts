/**
 * Unit tests for SubscriptionEntitlementService.
 *
 * @see docs/prd/subscription-entitlement-reconciliation-technical-design.md §12.1
 *
 * Mocks: UserController.updateUserInfo / getUserInfo, BrowserWindow.getAllWindows,
 * Token (for the pricing-window restore path), and the schema broadcast parse.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted mutable mock state so tests can drive each scenario ---
const state = vi.hoisted(() => ({
  // Local cache snapshot returned by getUserInfo().
  current: {
    plans: [] as Array<{ planName: string; planId?: string; status: string }>,
    aiEnabled: false,
  },
  // What the next updateUserInfo() call should persist into the cache.
  nextPlans: null as null | Array<{
    planName: string;
    planId?: string;
    status: string;
  }>,
  // Whether updateUserInfo() should throw (simulated GET failure).
  shouldThrow: false,
  // Captures of broadcast payloads.
  broadcasts: [] as Array<unknown>,
  // Captures of Token setValue calls (for pricing-window guard test).
  tokenSets: [] as Array<{ key: string; value: string }>,
}));

vi.mock("@/controller/UserController", () => ({
  UserController: vi.fn().mockImplementation(() => ({
    getUserInfo: () => ({
      name: "Test User",
      email: "test@example.com",
      plans: state.current.plans,
      aiEnabled: state.current.aiEnabled,
    }),
    updateUserInfo: vi.fn(async () => {
      if (state.shouldThrow) {
        throw new Error("network error");
      }
      if (state.nextPlans) {
        state.current.plans = state.nextPlans;
        state.current.aiEnabled = state.current.plans.some(
          (p) =>
            p.status.toLowerCase() === "active" &&
            !p.planName.toLowerCase().includes("community") &&
            !p.planName.toLowerCase().includes("free")
        );
        state.nextPlans = null;
      }
      return { name: "Test User", email: "test@example.com", id: 1, roles: [] };
    }),
  })),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => {
            state.broadcasts.push({ channel, payload });
          },
        },
      },
    ]),
  },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    // Return a non-empty access token so the no-token skip (TODO-6) does not
    // short-circuit reconcile in these tests. Other keys stay empty.
    getValue: vi.fn((key: string) =>
      key === "user-social-market-token" ? "test-access-token" : ""
    ),
    setValue: vi.fn((key: string, value: string) => {
      state.tokenSets.push({ key, value });
    }),
  })),
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/config/viteLoginUrl", () => ({
  resolveViteLoginBase: vi.fn(() => ({
    value: "https://marketing.example.com",
  })),
}));

// Mock the schema so broadcast() validates without importing real zod at runtime.
vi.mock("@/schemas/ipc/subscriptionEntitlement", () => ({
  userInfoUpdatedEventSchema: () => ({
    parse: (e: unknown) => e,
  }),
}));

import { SubscriptionEntitlementService } from "@/service/SubscriptionEntitlementService";

const COMMUNITY = [{ planName: "Community", status: "active" }];
const PLUS = [{ planName: "AiFetch Plus", planId: "PLUS", status: "active" }];

function resetState(): void {
  state.current = { plans: [...COMMUNITY], aiEnabled: false };
  state.nextPlans = null;
  state.shouldThrow = false;
  state.broadcasts = [];
  state.tokenSets = [];
}

function newService(opts?: {
  hasAccessToken?: () => boolean;
}): SubscriptionEntitlementService {
  // Reset the singleton with fake-timer-friendly injectables.
  SubscriptionEntitlementService.resetInstance();
  const timers: ReturnType<typeof setTimeout>[] = [];
  return SubscriptionEntitlementService.getInstance({
    now: () => Date.now(),
    hasAccessToken: opts?.hasAccessToken,
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>;
      timers.push(id);
      return id;
    },
    clearTimer: (id) => {
      const idx = timers.indexOf(id);
      if (idx >= 0) timers.splice(idx, 1);
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    },
  });
}

describe("SubscriptionEntitlementService", () => {
  beforeEach(() => {
    resetState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    SubscriptionEntitlementService.resetInstance();
  });

  it("dedupes concurrent reconcile calls into one GET", async () => {
    const svc = newService();
    state.nextPlans = PLUS;

    const p1 = svc.reconcile("startup");
    const p2 = svc.reconcile("startup");
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok).toBe(true);
    expect(r1.changed).toBe(true);
    // The coalesced caller is marked skipped.
    expect(r2.skipped).toBe(true);
    expect(r2.failReason).toBe("in_flight_shared");
  });

  it("keeps the cache on GET failure (does not clear a paid plan)", async () => {
    const svc = newService();
    state.current = { plans: [...PLUS], aiEnabled: true };
    state.shouldThrow = true;

    const res = await svc.reconcile("ws_notify", { force: true });

    expect(res.ok).toBe(false);
    expect(res.failReason).toBe("network");
    expect(res.snapshot.aiEnabled).toBe(true);
    expect(res.snapshot.plans).toEqual(PLUS);
  });

  it("broadcasts USER_INFO_UPDATED on Community -> Plus change", async () => {
    const svc = newService();
    state.current = { plans: [...COMMUNITY], aiEnabled: false };
    state.nextPlans = PLUS;

    const res = await svc.reconcile("pricing", { force: true });

    expect(res.changed).toBe(true);
    expect(res.snapshot.aiEnabled).toBe(true);
    expect(state.broadcasts.length).toBe(1);
    const bcast = state.broadcasts[0] as {
      channel: string;
      payload: { changed: boolean; aiEnabled: boolean };
    };
    expect(bcast.channel).toBe("user:info:updated");
    expect(bcast.payload.changed).toBe(true);
    expect(bcast.payload.aiEnabled).toBe(true);
  });

  it("does not broadcast when the snapshot is unchanged", async () => {
    const svc = newService();
    state.current = { plans: [...PLUS], aiEnabled: true };
    // nextPlans stays null -> updateUserInfo is a no-op, snapshot unchanged.
    const res = await svc.reconcile("ws_notify", { force: true });

    expect(res.changed).toBe(false);
    expect(state.broadcasts.length).toBe(0);
  });

  it("skips focus reconcile when already on a paid plan (FR-4.2)", async () => {
    const svc = newService();
    state.current = { plans: [...PLUS], aiEnabled: true };

    const res = await svc.reconcile("focus");

    expect(res.skipped).toBe(true);
    expect(res.failReason).toBe("cooldown");
  });

  it("applies a 60s cooldown to focus reconciles (FR-4.1)", async () => {
    const svc = newService();
    state.current = { plans: [...COMMUNITY], aiEnabled: false };

    const r1 = await svc.reconcile("focus");
    expect(r1.skipped).toBe(false);

    // Immediately call again -> within 60s cooldown -> skip.
    const r2 = await svc.reconcile("focus");
    expect(r2.skipped).toBe(true);
    expect(r2.failReason).toBe("cooldown");

    // Advance past the cooldown.
    vi.advanceTimersByTime(61 * 1000);
    state.nextPlans = PLUS;
    const r3 = await svc.reconcile("focus");
    expect(r3.skipped).toBe(false);
  });

  it("applies a 30s cooldown to gated_feature reconciles (FR-6.4)", async () => {
    const svc = newService();
    state.current = { plans: [...COMMUNITY], aiEnabled: false };

    const r1 = await svc.reconcile("gated_feature");
    expect(r1.skipped).toBe(false);

    const r2 = await svc.reconcile("gated_feature");
    expect(r2.skipped).toBe(true);
    expect(r2.failReason).toBe("cooldown");

    vi.advanceTimersByTime(31 * 1000);
    const r3 = await svc.reconcile("gated_feature");
    expect(r3.skipped).toBe(false);
  });

  it("coalesces ws_connect within 10s of a startup success", async () => {
    const svc = newService();
    state.nextPlans = PLUS;
    await svc.reconcile("startup");

    const wsRes = await svc.reconcile("ws_connect");
    expect(wsRes.skipped).toBe(true);
    expect(wsRes.failReason).toBe("cooldown");

    // After the coalesce window, ws_connect should run.
    vi.advanceTimersByTime(11 * 1000);
    const wsRes2 = await svc.reconcile("ws_connect");
    expect(wsRes2.skipped).toBe(false);
  });

  it("ws_notify does not write plan fields from the notify payload", async () => {
    const svc = newService();
    state.current = { plans: [...COMMUNITY], aiEnabled: false };
    state.nextPlans = PLUS;

    // Pass a payload that should be ignored — only the GET writes plans.
    const res = await svc.reconcile("ws_notify", {
      force: true,
      notificationType: "subscription_activated",
    });

    expect(res.ok).toBe(true);
    expect(res.snapshot.plans).toEqual(PLUS);
    // The broadcast carries the notify type for toast copy, but plans came
    // from the GET (UserController), not the payload.
    const bcast = state.broadcasts[0] as {
      payload: { notificationType: string; plans: unknown[] };
    };
    expect(bcast.payload.notificationType).toBe("subscription_activated");
    expect(bcast.payload.plans).toEqual(PLUS);
  });

  it("pricing-window guard keeps the previous paid cache when GET returns Community", async () => {
    const svc = newService();
    // User was paid, opens pricing, Kill Bill lags and returns Community.
    state.current = { plans: [...PLUS], aiEnabled: true };

    // markPricingOpened records pricingOpenedAt (no retry since already paid).
    await svc.markPricingOpened();

    // Simulate Kill Bill lag: GET returns Community.
    state.nextPlans = COMMUNITY;

    const res = await svc.reconcile("pricing", { force: true });

    // Cache should be restored to the previous paid plan.
    expect(res.ok).toBe(true);
    expect(res.snapshot.aiEnabled).toBe(true);
    expect(res.snapshot.plans).toEqual(PLUS);
    // Token setValue was used to restore the cache.
    const planSet = state.tokenSets.find((s) => s.key === "user_plans");
    expect(planSet).toBeDefined();
    expect(planSet?.value).toContain("AiFetch Plus");
  });

  it("markPricingOpened starts a retry loop that stops once aiEnabled becomes true", async () => {
    const svc = newService();
    state.current = { plans: [...COMMUNITY], aiEnabled: false };

    // Schedule retries; the first (0s) won't yet see Plus, but a later one will.
    state.nextPlans = COMMUNITY; // first retry still Community
    await svc.markPricingOpened();

    // Advance to trigger the 3s retry; now make the GET see Plus.
    vi.advanceTimersByTime(1);
    state.nextPlans = PLUS;
    vi.advanceTimersByTime(3000);
    await Promise.resolve();

    // After aiEnabled becomes true, remaining timers should be cleared.
    // Advance all timers; no further broadcasts beyond the one that unlocked.
    const broadcastsBefore = state.broadcasts.length;
    vi.advanceTimersByTime(60 * 1000);
    // No additional broadcasts after the unlock (timers were cleared).
    expect(state.broadcasts.length).toBe(broadcastsBefore);
  });

  it("skip focus when within pricing window forces a reconcile", async () => {
    const svc = newService();
    state.current = { plans: [...COMMUNITY], aiEnabled: false };
    state.nextPlans = PLUS;

    await svc.markPricingOpened();
    // Focus inside the pricing window forces a reconcile even though the
    // focus cooldown would otherwise skip.
    const res = svc.onMainWindowFocus();
    // onMainWindowFocus is fire-and-forget; await the in-flight.
    await vi.advanceTimersByTimeAsync(1);

    expect(res).toBeUndefined();
    // The forced pricing reconcile should have broadcast the upgrade.
    const upgrade = state.broadcasts.find(
      (b) =>
        (b as { payload: { aiEnabled: boolean } }).payload.aiEnabled === true
    );
    expect(upgrade).toBeDefined();
  });

  it("GET empty plans OUTSIDE the pricing window persists Community (design §12.1)", async () => {
    const svc = newService();
    state.current = { plans: [...PLUS], aiEnabled: true };
    // No pricing window opened. Kill Bill returns empty -> updateUserInfo
    // writes Community + USER_AI_ENABLED=false (the mock simulates this by
    // clearing plans + aiEnabled when nextPlans is set to COMMUNITY).
    state.nextPlans = COMMUNITY;

    const res = await svc.reconcile("startup");

    expect(res.ok).toBe(true);
    // Community persisted: snapshot reflects the empty/free state.
    expect(res.snapshot.aiEnabled).toBe(false);
    expect(res.changed).toBe(true);
    // Broadcast fired because the snapshot changed (Plus -> Community).
    expect(state.broadcasts.length).toBe(1);
  });

  it("skips reconcile with no access token, keeping the cache (TODO-6)", async () => {
    // Inject hasAccessToken: () => false to simulate a signed-out user.
    const svc = newService({ hasAccessToken: () => false });
    state.current = { plans: [...PLUS], aiEnabled: true };
    // Use a forced trigger so we reach doReconcile (focus would short-circuit
    // on the paid-skip path before the no-token check runs).
    const res = await svc.reconcile("pricing", { force: true });

    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.failReason).toBe("auth");
    expect(res.snapshot.aiEnabled).toBe(true);
    expect(res.snapshot.plans).toEqual(PLUS);
  });
});
