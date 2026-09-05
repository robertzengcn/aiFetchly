import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron's ipcMain so we can drive handlers without a real Electron.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

// Control the AI gate: AI-facing channels must be blocked FIRST when off.
const isAiEnabledMock = vi.fn(() => true);
vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: () => isAiEnabledMock(),
}));

// Fake the browser module singleton (spies; no DB, no worker).
const browserModuleSpies = {
  setStatusSink: vi.fn(),
  setNoticeSink: vi.fn(),
  listEligibleAccounts: vi.fn(async () => [
    { accountId: 101, platformId: 2, accountLabel: "My Channel" },
  ]),
  listActiveSessions: vi.fn(async () => []),
  start: vi.fn(async () => ({ sessionId: "mb_test000000001", state: "ready" })),
  getStatus: vi.fn(() => null),
  requestHandoff: vi.fn(async () => ({ sessionId: "mb_test000000001" })),
  verifyManualLogin: vi.fn(async () => ({ sessionId: "mb_test000000001" })),
  resumeAfterHandoff: vi.fn(async () => ({ sessionId: "mb_test000000001" })),
  stop: vi.fn(async () => ({ sessionId: "mb_test000000001" })),
  recordApproval: vi.fn(),
  extendHandoff: vi.fn(async () => ({ sessionId: "mb_test000000001" })),
  getEffectiveSettingsForRenderer: vi.fn(async () => ({
    browserEnabled: true,
    cacheEnabled: true,
    cacheMaxBytes: 500 * 1024 * 1024,
    clearCacheOnExit: false,
    disabledReasonCode: null,
  })),
};
vi.mock("@/modules/ManagedBrowserModule", () => ({
  getDefaultManagedBrowserModule: () => browserModuleSpies,
}));

// Fake the cache module singleton + the typed error class. The class must
// live in vi.hoisted — vi.mock factories run before test-file declarations.
const { FakeCacheError } = vi.hoisted(() => {
  class FakeCacheError extends Error {
    public constructor(
      public readonly code: string,
      public readonly reasonCode: string | null = null
    ) {
      super(code);
    }
  }
  return { FakeCacheError };
});
const cacheModuleSpies = {
  setNoticeSink: vi.fn(),
  setProgressSink: vi.fn(),
  getStatus: vi.fn(async () => null),
  getStatusForAllScopes: vi.fn(async () => ({
    scope: "all",
    approximateBytes: 0,
    lastClearedAt: null,
    active: false,
    pendingClear: false,
  })),
  issueClearConfirmation: vi.fn(() => "conf-1234-abcd"),
  clearCache: vi.fn(async () => ({
    state: "cleared",
    scope: "account",
    approximateDeletedBytes: 4096,
    savedLoginSessionPreserved: true as const,
    reasonCode: null,
  })),
};
vi.mock("@/modules/ManagedBrowserCacheModule", () => ({
  getDefaultManagedBrowserCacheModule: () => cacheModuleSpies,
  ManagedBrowserCacheError: FakeCacheError,
}));

// Import AFTER mocks are registered.
import { registerManagedBrowserIpcHandlers } from "@/main-process/communication/managed-browser-ipc";
import {
  MANAGED_BROWSER_LIST_ELIGIBLE_ACCOUNTS,
  MANAGED_BROWSER_LIST_ACTIVE,
  MANAGED_BROWSER_START,
  MANAGED_BROWSER_STATUS,
  MANAGED_BROWSER_HANDOFF,
  MANAGED_BROWSER_VERIFY_MANUAL_LOGIN,
  MANAGED_BROWSER_RESUME,
  MANAGED_BROWSER_STOP,
  MANAGED_BROWSER_APPROVE,
  MANAGED_BROWSER_EXTEND_HANDOFF,
  MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS,
  MANAGED_BROWSER_GET_CACHE_STATUS,
  MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION,
  MANAGED_BROWSER_CLEAR_CACHE,
  MANAGED_BROWSER_STATUS_EVENT,
  MANAGED_BROWSER_CHAT_NOTICE_EVENT,
  MANAGED_BROWSER_CACHE_PROGRESS_EVENT,
} from "@/config/channellist";

function makeFakeWin(): {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
} {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } };
}

async function invoke(
  channel: string,
  payload: unknown
): Promise<{
  status: boolean;
  msg: string;
  data: unknown;
}> {
  const fn = handlers.get(channel);
  if (!fn) {
    throw new Error(`channel not registered: ${channel}`);
  }
  return (await fn({}, payload)) as {
    status: boolean;
    msg: string;
    data: unknown;
  };
}

describe("managed-browser-ipc", () => {
  let fakeWin: ReturnType<typeof makeFakeWin>;

  beforeEach(() => {
    handlers.clear();
    isAiEnabledMock.mockReturnValue(true);
    Object.values(browserModuleSpies).forEach((s) => s.mockClear());
    Object.values(cacheModuleSpies).forEach((s) => s.mockClear());
    fakeWin = makeFakeWin();
    registerManagedBrowserIpcHandlers(fakeWin as never);
  });

  it("registers all 14 channels", () => {
    for (const channel of [
      MANAGED_BROWSER_LIST_ELIGIBLE_ACCOUNTS,
      MANAGED_BROWSER_LIST_ACTIVE,
      MANAGED_BROWSER_START,
      MANAGED_BROWSER_STATUS,
      MANAGED_BROWSER_HANDOFF,
      MANAGED_BROWSER_VERIFY_MANUAL_LOGIN,
      MANAGED_BROWSER_RESUME,
      MANAGED_BROWSER_STOP,
      MANAGED_BROWSER_APPROVE,
      MANAGED_BROWSER_EXTEND_HANDOFF,
      MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS,
      MANAGED_BROWSER_GET_CACHE_STATUS,
      MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION,
      MANAGED_BROWSER_CLEAR_CACHE,
    ]) {
      expect(handlers.has(channel), channel).toBe(true);
    }
  });

  it("wires the renderer event bridge from the singletons", () => {
    expect(browserModuleSpies.setStatusSink).toHaveBeenCalledTimes(1);
    expect(browserModuleSpies.setNoticeSink).toHaveBeenCalledTimes(1);
    expect(cacheModuleSpies.setNoticeSink).toHaveBeenCalledTimes(1);
    expect(cacheModuleSpies.setProgressSink).toHaveBeenCalledTimes(1);

    // Status events flow through webContents.send.
    const statusSink = browserModuleSpies.setStatusSink.mock.calls[0][0] as (
      status: unknown
    ) => void;
    statusSink({ sessionId: "mb_test000000001", state: "ready" });
    expect(fakeWin.webContents.send).toHaveBeenCalledWith(
      MANAGED_BROWSER_STATUS_EVENT,
      { sessionId: "mb_test000000001", state: "ready" }
    );

    const noticeSink = browserModuleSpies.setNoticeSink.mock.calls[0][0] as (
      notice: unknown
    ) => void;
    noticeSink({ eventId: "evt-1", type: "login_required" });
    expect(fakeWin.webContents.send).toHaveBeenCalledWith(
      MANAGED_BROWSER_CHAT_NOTICE_EVENT,
      { eventId: "evt-1", type: "login_required" }
    );

    const progressSink = cacheModuleSpies.setProgressSink.mock.calls[0][0] as (
      progress: unknown
    ) => void;
    progressSink({ scope: "all", phase: "done", approximateBytes: 1 });
    expect(fakeWin.webContents.send).toHaveBeenCalledWith(
      MANAGED_BROWSER_CACHE_PROGRESS_EVENT,
      { scope: "all", phase: "done", approximateBytes: 1 }
    );
  });

  it("blocks AI-facing channels FIRST when AI is disabled", async () => {
    isAiEnabledMock.mockReturnValue(false);
    const result = await invoke(MANAGED_BROWSER_START, {
      accountId: 101,
      purpose: "test",
    });
    expect(result.status).toBe(false);
    expect(browserModuleSpies.start).not.toHaveBeenCalled();
  });

  it("start delegates with the AI entry point flag", async () => {
    const result = await invoke(MANAGED_BROWSER_START, {
      accountId: 101,
      purpose: "contact_scan",
      conversationId: "conv-1",
    });
    expect(result.status).toBe(true);
    expect(browserModuleSpies.start).toHaveBeenCalledWith(
      {
        accountId: 101,
        purpose: "contact_scan",
        conversationId: "conv-1",
      },
      { aiEntryPoint: true }
    );
  });

  it("rejects an invalid session id", async () => {
    const result = await invoke(MANAGED_BROWSER_STATUS, {
      sessionId: "../etc/passwd",
    });
    expect(result.status).toBe(false);
    expect(browserModuleSpies.getStatus).not.toHaveBeenCalled();
  });

  it("settings and cache channels are NOT AI-gated", async () => {
    isAiEnabledMock.mockReturnValue(false);
    const settings = await invoke(MANAGED_BROWSER_GET_EFFECTIVE_SETTINGS, {});
    expect(settings.status).toBe(true);
    expect(
      browserModuleSpies.getEffectiveSettingsForRenderer
    ).toHaveBeenCalledTimes(1);
  });

  it("cache status routes account vs all scopes", async () => {
    await invoke(MANAGED_BROWSER_GET_CACHE_STATUS, {
      scope: "account",
      accountId: 101,
    });
    expect(cacheModuleSpies.getStatus).toHaveBeenCalledWith(101);
    expect(cacheModuleSpies.getStatusForAllScopes).not.toHaveBeenCalled();

    await invoke(MANAGED_BROWSER_GET_CACHE_STATUS, { scope: "all" });
    expect(cacheModuleSpies.getStatusForAllScopes).toHaveBeenCalledTimes(1);
  });

  it("issue-clear-confirmation returns a single-use confirmationId", async () => {
    const result = await invoke(MANAGED_BROWSER_ISSUE_CLEAR_CONFIRMATION, {
      scope: "account",
      accountId: 101,
    });
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ confirmationId: "conf-1234-abcd" });
    expect(cacheModuleSpies.issueClearConfirmation).toHaveBeenCalledWith({
      scope: "account",
      accountId: 101,
    });
  });

  it("clear-cache surfaces the typed cache error code as msg", async () => {
    cacheModuleSpies.clearCache.mockRejectedValueOnce(
      new FakeCacheError("approval_required", "confirmation_unknown")
    );
    const result = await invoke(MANAGED_BROWSER_CLEAR_CACHE, {
      scope: "account",
      accountId: 101,
      activeSessionDecision: "defer",
      confirmationId: "conf-1234-abcd",
    });
    expect(result.status).toBe(false);
    expect(result.msg).toBe("approval_required");
  });

  it("clear-cache rejects a smuggled path field (strict schema)", async () => {
    const result = await invoke(MANAGED_BROWSER_CLEAR_CACHE, {
      scope: "account",
      accountId: 101,
      activeSessionDecision: "defer",
      confirmationId: "conf-1234-abcd",
      path: "/etc/passwd",
    });
    expect(result.status).toBe(false);
    expect(cacheModuleSpies.clearCache).not.toHaveBeenCalled();
  });

  it("handoff/stop/approve/extend delegate to the module", async () => {
    await invoke(MANAGED_BROWSER_HANDOFF, { sessionId: "mb_test000000001" });
    expect(browserModuleSpies.requestHandoff).toHaveBeenCalledWith(
      "mb_test000000001"
    );

    await invoke(MANAGED_BROWSER_STOP, {
      sessionId: "mb_test000000001",
      reason: "user_stop",
    });
    expect(browserModuleSpies.stop).toHaveBeenCalledWith(
      "mb_test000000001",
      "user_stop"
    );

    await invoke(MANAGED_BROWSER_APPROVE, {
      sessionId: "mb_test000000001",
      requestId: "req-1",
      decision: "approve",
    });
    expect(browserModuleSpies.recordApproval).toHaveBeenCalledWith({
      sessionId: "mb_test000000001",
      requestId: "req-1",
      decision: "approve",
    });

    await invoke(MANAGED_BROWSER_EXTEND_HANDOFF, {
      sessionId: "mb_test000000001",
      extendMinutes: 10,
    });
    expect(browserModuleSpies.extendHandoff).toHaveBeenCalledWith(
      "mb_test000000001",
      10
    );

    await invoke(MANAGED_BROWSER_VERIFY_MANUAL_LOGIN, {
      sessionId: "mb_test000000001",
    });
    expect(browserModuleSpies.verifyManualLogin).toHaveBeenCalledWith(
      "mb_test000000001"
    );

    await invoke(MANAGED_BROWSER_RESUME, { sessionId: "mb_test000000001" });
    expect(browserModuleSpies.resumeAfterHandoff).toHaveBeenCalledWith(
      "mb_test000000001"
    );
  });
});
