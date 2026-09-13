/**
 * IPC tests for subscription entitlement reconciliation.
 *
 * @see docs/prd/subscription-entitlement-reconciliation-technical-design.md §12.2
 *
 * Captures ipcMain.handle registrations and drives them directly, mocking the
 * entitlement service so the wiring (Zod validation, channel registration,
 * markPricingOpened delegation) is isolated from the real reconcile logic.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

const entitlementState = vi.hoisted(() => ({
  reconcileResult: {
    ok: true,
    changed: false,
    skipped: false,
    trigger: "manual",
  },
  markPricingOpenedCalled: false,
  openedUrl: "",
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  shell: {
    openExternal: vi.fn(async (url: string) => {
      entitlementState.openedUrl = url;
    }),
  },
  dialog: { showErrorBox: vi.fn() },
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// UserController is invoked as `new UserController()` for getUserInfo, and
// accessed statically for setMainWindowProvider. vi.hoisted ensures the mock
// is initialized before the hoisted vi.mock() factory runs.
const { UserControllerMock } = vi.hoisted(() => {
  const fn = vi.fn().mockImplementation(() => ({
    getUserInfo: vi.fn(() => ({
      name: "t",
      email: "t@e",
      plans: [],
      aiEnabled: false,
    })),
  }));
  (
    fn as unknown as { setMainWindowProvider: (p: unknown) => void }
  ).setMainWindowProvider = vi.fn();
  return { UserControllerMock: fn };
});
vi.mock("@/controller/UserController", () => ({
  UserController: UserControllerMock,
}));

vi.mock("@/modules/user", () => ({
  User: vi.fn().mockImplementation(() => ({ Signout: vi.fn() })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue(""),
    setValue: vi.fn(),
  })),
}));

vi.mock("@/modules/tokenRefresh", () => ({
  TokenRefreshService: {
    isAutoRefreshRunning: vi.fn().mockReturnValue(false),
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
    onRefreshSuccess: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock("@/modules/pendingDesktopAuth", () => ({
  clearPendingDesktopAuth: vi.fn(),
}));

vi.mock("@/service/SubscriptionEntitlementService", () => ({
  SubscriptionEntitlementService: {
    getInstance: () => ({
      setMainWindow: vi.fn(),
      reconcile: vi.fn(async (trigger: string) => ({
        ...entitlementState.reconcileResult,
        trigger,
      })),
      markPricingOpened: vi.fn(async () => {
        entitlementState.markPricingOpenedCalled = true;
        return { url: "https://marketing.example.com/pricing-plan" };
      }),
      onMainWindowFocus: vi.fn(),
      clearPricingRetries: vi.fn(),
    }),
    resetInstance: vi.fn(),
  },
}));

import { registerUserIpcHandlers } from "@/main-process/communication/userIpc";
import {
  USER_REFRESH_ENTITLEMENT,
  USER_OPEN_PRICING_PLAN,
} from "@/config/channellist";

describe("subscriptionEntitlementIpc", () => {
  beforeEach(() => {
    handlers.clear();
    entitlementState.reconcileResult = {
      ok: true,
      changed: false,
      skipped: false,
      trigger: "manual",
    };
    entitlementState.markPricingOpenedCalled = false;
    entitlementState.openedUrl = "";
    registerUserIpcHandlers(() => null);
  });

  it("registers the USER_REFRESH_ENTITLEMENT channel", () => {
    expect(handlers.has(USER_REFRESH_ENTITLEMENT)).toBe(true);
  });

  it("registers the USER_OPEN_PRICING_PLAN channel", () => {
    expect(handlers.has(USER_OPEN_PRICING_PLAN)).toBe(true);
  });

  it("rejects a bad trigger with status:false (Zod validation)", async () => {
    const fn = handlers.get(USER_REFRESH_ENTITLEMENT)!;
    const result = (await fn({}, { trigger: "not_a_real_trigger" })) as {
      status: boolean;
      msg: string;
      data: unknown;
    };
    expect(result.status).toBe(false);
    expect(typeof result.msg).toBe("string");
    expect(result.msg.length).toBeGreaterThan(0);
    expect(result.data).toBeNull();
  });

  it("defaults trigger to 'manual' when omitted and calls the service", async () => {
    const fn = handlers.get(USER_REFRESH_ENTITLEMENT)!;
    const result = (await fn({}, undefined)) as {
      status: boolean;
      data: { trigger: string; ok: boolean };
    };
    expect(result.status).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.trigger).toBe("manual");
  });

  it("passes an explicit trigger through to the service", async () => {
    const fn = handlers.get(USER_REFRESH_ENTITLEMENT)!;
    const result = (await fn({}, { trigger: "focus" })) as {
      status: boolean;
      data: { trigger: string };
    };
    expect(result.status).toBe(true);
    expect(result.data.trigger).toBe("focus");
  });

  it("USER_OPEN_PRICING_PLAN calls markPricingOpened and opens the URL", async () => {
    const fn = handlers.get(USER_OPEN_PRICING_PLAN)!;
    const result = (await fn({}, undefined)) as {
      status: boolean;
      data: { opened: boolean; url: string };
    };
    expect(result.status).toBe(true);
    expect(entitlementState.markPricingOpenedCalled).toBe(true);
    expect(result.data.opened).toBe(true);
    expect(result.data.url).toBe("https://marketing.example.com/pricing-plan");
    expect(entitlementState.openedUrl).toBe(
      "https://marketing.example.com/pricing-plan"
    );
  });

  it("USER_OPEN_PRICING_PLAN returns the expected success envelope shape", async () => {
    const fn = handlers.get(USER_OPEN_PRICING_PLAN)!;
    const result = (await fn({}, undefined)) as {
      status: boolean;
      msg: string;
      data: { opened: boolean; url: string };
    };
    expect(result.status).toBe(true);
    expect(result.msg).toBe("ok");
    expect(result.data).toEqual({
      opened: true,
      url: "https://marketing.example.com/pricing-plan",
    });
    // markPricingOpened failure path (status:false) is unit-tested in
    // subscriptionEntitlementService.test.ts; the IPC wrapper surfaces it
    // via the same CommonMessage envelope (verified by the Zod-reject test).
  });
});
