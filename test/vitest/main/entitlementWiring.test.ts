/**
 * Wiring tests for entitlement reconciliation triggers (TODO-7).
 *
 * - TokenRefreshService.onRefreshSuccess fires on success, not on failure
 *   (design §12.4).
 * - WebSocketClient subscription notify routes through the entitlement
 *   service, not UserController.updateUserInfo directly (design §12.3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const fired = vi.hoisted(() => ({ refreshSuccessFired: false }));

// Capture the onRefreshSuccess listener registered by userIpc wiring.
const refreshListener = vi.hoisted(() => ({
  current: null as null | (() => void),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  shell: { openExternal: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  app: {
    getName: vi.fn(() => "aiFetchly"),
    getPath: vi.fn(() => "/tmp"),
    isReady: vi.fn(() => true),
  },
}));

vi.mock("@/modules/Logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn(() => ""),
    setValue: vi.fn(),
  })),
}));

vi.mock("@/modules/tokenRefresh", () => ({
  TokenRefreshService: {
    isAutoRefreshRunning: vi.fn(() => false),
    startAutoRefresh: vi.fn(),
    stopAutoRefresh: vi.fn(),
    onRefreshSuccess: vi.fn((listener: () => void) => {
      refreshListener.current = listener;
      return () => {
        refreshListener.current = null;
      };
    }),
    performAutoRefreshCheck: vi.fn(async () => {}),
  },
}));

vi.mock("@/controller/UserController", () => {
  const fn = vi.fn().mockImplementation(() => ({
    getUserInfo: vi.fn(() => ({ plans: [], aiEnabled: false })),
  }));
  (
    fn as unknown as { setMainWindowProvider: (p: unknown) => void }
  ).setMainWindowProvider = vi.fn();
  return { UserController: fn };
});

vi.mock("@/modules/user", () => ({
  User: vi.fn().mockImplementation(() => ({ Signout: vi.fn() })),
}));

vi.mock("@/modules/pendingDesktopAuth", () => ({
  clearPendingDesktopAuth: vi.fn(),
}));

vi.mock("@/service/SubscriptionEntitlementService", () => ({
  SubscriptionEntitlementService: {
    getInstance: () => ({
      setMainWindow: vi.fn(),
      reconcile: vi.fn(async () => {
        fired.refreshSuccessFired = true;
        return {
          ok: true,
          changed: false,
          skipped: false,
          trigger: "token_refresh",
        };
      }),
      onMainWindowFocus: vi.fn(),
      markPricingOpened: vi.fn(async () => ({ url: "https://x/pricing-plan" })),
      clearPricingRetries: vi.fn(),
    }),
    resetInstance: vi.fn(),
  },
}));

vi.mock("@/schemas/ipc/subscriptionEntitlement", () => ({
  refreshEntitlementInputSchema: () => ({
    safeParse: (e: unknown) => ({ success: true, data: e }),
  }),
  openPricingPlanInputSchema: () => ({
    safeParse: () => ({ success: true, data: undefined }),
  }),
}));

// Importing userIpc triggers registerUserIpcHandlers, which registers the
// onRefreshSuccess listener against the mocked TokenRefreshService.
import { registerUserIpcHandlers } from "@/main-process/communication/userIpc";

describe("entitlement wiring", () => {
  beforeEach(() => {
    fired.refreshSuccessFired = false;
    refreshListener.current = null;
    registerUserIpcHandlers(() => null);
  });

  it("TokenRefreshService.onRefreshSuccess invokes entitlement reconcile (design §12.4)", async () => {
    expect(refreshListener.current).not.toBeNull();
    // Simulate a successful token refresh: the listener should call reconcile.
    (refreshListener.current as () => void)();
    // reconcile is async; flush microtasks.
    await Promise.resolve();
    expect(fired.refreshSuccessFired).toBe(true);
  });

  it("does not invoke reconcile until onRefreshSuccess fires", () => {
    // The listener is registered but not yet invoked.
    expect(fired.refreshSuccessFired).toBe(false);
  });
});

const WEBSOCKET_CLIENT_SRC = readFileSync(
  "src/modules/WebSocketClient.ts",
  "utf8"
);

describe("WebSocketClient notify routing (design §12.3)", () => {
  it("routes subscription notify through SubscriptionEntitlementService.reconcile, not updateUserInfo", () => {
    // refreshUserInfoOnSubscriptionChange must call reconcile with "ws_notify".
    const methodSrc = WEBSOCKET_CLIENT_SRC.slice(
      WEBSOCKET_CLIENT_SRC.indexOf("refreshUserInfoOnSubscriptionChange"),
      WEBSOCKET_CLIENT_SRC.indexOf("private sendToRenderer")
    );
    expect(methodSrc).toContain('"ws_notify"');
    // It must NOT call UserController.updateUserInfo directly in the notify path.
    expect(methodSrc).not.toContain("updateUserInfo()");
    // And the WebSocketClient module as a whole no longer imports UserController
    // for a direct call in the notify path.
    expect(WEBSOCKET_CLIENT_SRC).not.toMatch(/import.*UserController/);
  });

  it("reconciles on ws_connect in the 'connected' case (FR-5.2)", () => {
    expect(WEBSOCKET_CLIENT_SRC).toContain('"ws_connect"');
  });
});
