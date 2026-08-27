"use strict";
/**
 * Regression tests for the desktop-login "timeout despite success" incident.
 *
 * Root cause: registerCommunicationIpcHandlers captured the FIRST window in
 * the registerUserIpcHandlers(() => win) closure. Because handler
 * registration is guarded to run once (HMR guard), that closure outlived
 * window recreations, so the login flow resolved a destroyed window and the
 * post-login NATIVATECOMMAND never reached the live renderer — the login
 * page's 20s watchdog then showed "Login attempt timed out" even though
 * tokens had been persisted successfully.
 *
 * These tests pin the two invariants that prevent a recurrence:
 *   1. The IPC layer wires the LAZY getWin provider (not the captured arg).
 *   2. completeDesktopLogin falls back to the mainWindowRegistry when the
 *      passed-in window reference is stale/destroyed, so the navigation
 *      command still reaches the live renderer.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mockState = vi.hoisted(() => ({
  registryWindow: null as { isDestroyed: () => boolean } | null,
}));

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  dialog: { showErrorBox: vi.fn() },
  app: {
    getName: vi.fn().mockReturnValue("aiFetchly"),
    getPath: vi.fn().mockReturnValue("/tmp/aifetchly-test-userdata"),
    isReady: vi.fn().mockReturnValue(true),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/main-process/mainWindowRegistry", () => ({
  getMainWindow: vi.fn(() => mockState.registryWindow),
  setMainWindow: vi.fn(),
}));

// The communication index pulls in every IPC module; stub the heavy ones so
// this suite isolates the wiring under test.
vi.mock("@/main-process/communication/userIpc", () => ({
  registerUserIpcHandlers: vi.fn(),
}));

// sync-msg attaches Electron listeners to the window; mock it out so the
// fake windows in this suite don't need full Electron internals.
vi.mock("@/main-process/communication/sync-msg", () => ({
  default: vi.fn(),
}));

vi.mock("@/service/AIChatConversationUpdateBroadcaster", () => ({
  AIChatConversationUpdateBroadcaster: {
    getInstance: () => ({ register: vi.fn() }),
  },
}));

// --- Mocks for completeDesktopLogin's dependency tree ---------------------
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue(""),
    setValue: vi.fn(),
  })),
}));

vi.mock("@/controller/UserController", () => ({
  UserController: vi.fn().mockImplementation(() => ({
    updateUserInfo: vi
      .fn()
      .mockResolvedValue({ id: 1, email: "t@example.com", name: "t" }),
  })),
}));

vi.mock("@/modules/deviceFingerprint", () => ({
  DeviceFingerprintService: vi.fn().mockImplementation(() => ({
    getDeviceIdHash: vi.fn().mockReturnValue("hash"),
    getDeviceName: vi.fn().mockReturnValue("name"),
    storeDeviceIdHash: vi.fn(),
  })),
}));

vi.mock("@/api/deviceApi", () => ({
  DeviceApi: vi.fn().mockImplementation(() => ({
    registerDevice: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@/config/SqliteDb", () => ({
  SqliteDb: {
    // getInstance is called by BaseDb/BaseModule constructors inside sibling
    // IPC registrars; return a minimal initialized connection so importing
    // communication/index doesn't explode during the wiring test.
    getInstance: vi.fn().mockReturnValue({
      connection: { isInitialized: true },
    }),
    resetInstance: vi.fn().mockResolvedValue({
      connection: { isInitialized: true },
    }),
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/ScheduleManager", () => ({
  ScheduleManager: { resetInstance: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/controller/SearchController", () => ({
  SearchController: { resetInstance: vi.fn() },
}));

vi.mock("@/controller/YellowPagesController", () => ({
  YellowPagesController: { resetInstance: vi.fn() },
}));

vi.mock("@/modules/YellowPagesProcessManager", () => ({
  YellowPagesProcessManager: { resetInstance: vi.fn() },
}));

vi.mock("@/main-process/communication/websocket-ipc", () => ({
  initializeWebSocketConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/main-process/communication/ai-chat-v2-ipc", () => ({
  resetAiChatV2RuntimeForDatabaseSwitch: vi.fn(),
}));

vi.mock("@/modules/tokenRefresh", () => ({
  TokenRefreshService: {
    isAutoRefreshRunning: vi.fn().mockReturnValue(true),
    startAutoRefresh: vi.fn(),
  },
}));

// completeDesktopLogin now routes the user-info fetch through the entitlement
// service (FR-2.2). Mock it so this wiring test stays isolated from the real
// reconcile logic (which is covered by subscriptionEntitlementService.test.ts).
vi.mock("@/service/SubscriptionEntitlementService", () => ({
  SubscriptionEntitlementService: {
    getInstance: () => ({
      reconcile: vi.fn().mockResolvedValue({
        ok: true,
        changed: false,
        skipped: false,
        trigger: "login",
        snapshot: { plans: [], aiEnabled: false, planNames: [] },
        previous: { plans: [], aiEnabled: false, planNames: [] },
      }),
    }),
  },
}));

vi.mock("@/modules/WebSocketClient", () => ({
  WebSocketClient: { resetInstance: vi.fn() },
}));

vi.mock("@/modules/factories/VectorDatabasePool", () => ({
  VectorDatabasePool: {
    clearAllInstances: vi.fn().mockResolvedValue(undefined),
  },
}));

import { completeDesktopLogin } from "@/modules/desktopLoginCompletion";
import { NATIVATECOMMAND } from "@/config/channellist";

type FakeWindow = {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
};

function makeWindow(destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  };
}

describe("desktop login window resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const globalState = globalThis as unknown as {
      __aifetchlyIpcHandlersRegistered?: boolean;
    };
    delete globalState.__aifetchlyIpcHandlersRegistered;
    mockState.registryWindow = null;
  });

  test("IPC layer wires the lazy getWin provider, not the captured first window", () => {
    // The communication/index registrar is guarded to run once and its
    // siblings construct DB-backed modules at registration time, so we pin
    // the wiring at the source level (same pattern as
    // ElectronStoreService.singleton.test.ts). The regression was
    // `registerUserIpcHandlers(() => win)` — a closure over the FIRST
    // window that outlived window recreations and resolved destroyed
    // windows forever.
    const source = readFileSync(
      path.resolve(
        __dirname,
        "../../../src/main-process/communication/index.ts"
      ),
      "utf-8"
    );
    expect(source).toMatch(/registerUserIpcHandlers\(getWin\)/);
    expect(source).not.toMatch(/registerUserIpcHandlers\(\(\) => win\)/);
  });

  test("completeDesktopLogin falls back to the registry window when passed a destroyed window", async () => {
    const deadWindow = makeWindow(true);
    const liveWindow = makeWindow(false);
    mockState.registryWindow = liveWindow;

    const result = await completeDesktopLogin(
      deadWindow as unknown as Parameters<typeof completeDesktopLogin>[0],
      {
        accessToken: "at",
        refreshToken: "rt",
        expiresIn: 3600,
        refreshExpiresIn: 2592000,
      }
    );

    // Login must be reported successful (tokens stored; that is the
    // contract — a dead window reference must not fail the login).
    expect(result.ok).toBe(true);

    // The navigation command must reach the LIVE window via the registry.
    expect(liveWindow.webContents.send).toHaveBeenCalledWith(
      NATIVATECOMMAND,
      expect.objectContaining({ path: "Dashboard" })
    );
    // And obviously not the destroyed one.
    expect(deadWindow.webContents.send).not.toHaveBeenCalled();
  });

  test("completeDesktopLogin succeeds (without navigation) when no window is alive at all", async () => {
    const result = await completeDesktopLogin(null, {
      accessToken: "at",
      refreshToken: "rt",
      expiresIn: 3600,
    });

    // Tokens still persist; the login is not failed by the missing window.
    expect(result.ok).toBe(true);
  });
});
