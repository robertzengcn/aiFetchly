/**
 * TRS-05 Strategy A — slash-command IPC gating matrix.
 *
 * ALL four phase-13 handlers (list/dispatch/reload/status) use
 * `registerValidatedHandler` (the NON-AI wrapper). When USER_AI_ENABLED is
 * "false", every handler STILL returns status:true. The dispatch handler
 * returns submit_prompt for prompt commands; the renderer submits via the
 * existing AI_CHAT_V2_STREAM channel which gates USER_AI_ENABLED FIRST
 * (verified at ai-chat-v2-ipc.ts handleStream lines 385-393). No duplicate
 * gate in the dispatcher.
 *
 * Mocks:
 *   - electron (ipcMain + BrowserWindow via test/utils/electron-mocks)
 *   - @/modules/token (controls USER_AI_ENABLED)
 *   - @/modules/SlashCommandModule (per-method spies)
 *   - @/service/aifetchlyConfig/AIFetchlyConfigManager (singleton stub)
 *
 * SlashCommandDispatcher behavior is covered by its own test file. This
 * file covers the IPC envelope, the AI-gating matrix, zod validation,
 * and the AIFETCHLY_CONFIG_CHANGED event emission.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
  MockBrowserWindow,
} from "../../../utils/electron-mocks";

// --- Mocks (hoisted so vi.mock sees them) -----------------------------------

const mockState = vi.hoisted(() => ({ aiEnabled: "false" }));

const moduleMocks = vi.hoisted(() => ({
  listCommands: vi.fn(),
  dispatch: vi.fn(),
  reloadConfig: vi.fn(),
  getStatus: vi.fn(),
}));

const managerMocks = vi.hoisted(() => ({
  getCommandRegistry: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockImplementation(() => mockState.aiEnabled),
  })),
}));

vi.mock("@/modules/SlashCommandModule", () => ({
  SlashCommandModule: vi.fn().mockImplementation(() => ({
    listCommands: moduleMocks.listCommands,
    dispatch: moduleMocks.dispatch,
    reloadConfig: moduleMocks.reloadConfig,
    getStatus: moduleMocks.getStatus,
  })),
}));

vi.mock("@/service/aifetchlyConfig/AIFetchlyConfigManager", () => ({
  getAIFetchlyConfigManager: () => ({
    getCommandRegistry: managerMocks.getCommandRegistry,
  }),
}));

// --- Imports (resolve after mocks are in place) -----------------------------

import { registerSlashCommandHandlers } from "@/main-process/communication/slash-command-ipc";
import {
  SLASH_COMMAND_LIST,
  SLASH_COMMAND_DISPATCH,
  AIFETCHLY_CONFIG_RELOAD,
  AIFETCHLY_CONFIG_STATUS,
  AIFETCHLY_CONFIG_CHANGED,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

// --- Setup ------------------------------------------------------------------

describe("slash-command IPC handlers (TRS-05 Strategy A gating matrix)", () => {
  const win = new MockBrowserWindow();

  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    // TRS-05 matrix: AI is DISABLED for every test in this file.
    // All four handlers MUST still return status:true.
    mockState.aiEnabled = "false";
    managerMocks.getCommandRegistry.mockReturnValue({ register: vi.fn() });

    // Default-success implementations; per-test overrides can change these.
    moduleMocks.listCommands.mockResolvedValue({
      status: true,
      commands: [],
      diagnostics: [],
      msg: "",
    });
    moduleMocks.dispatch.mockResolvedValue({
      status: true,
      action: "show_result",
      commandId: "built-in:command:status",
      content: "AiFetchly configuration status:\nCommands: 0",
    });
    moduleMocks.reloadConfig.mockResolvedValue({
      commandCount: 0,
      diagnosticCount: 0,
      lastReloadAt: 12345,
      instructionsChanged: false,
    });
    moduleMocks.getStatus.mockResolvedValue({
      commandCount: 0,
      agentCount: 0,
      hookCount: 0,
      skillCount: 0,
      diagnosticCount: 0,
      lastReloadAt: 0,
      watcherState: "not-started",
      source: "user",
    });

    registerSlashCommandHandlers(win as never);
  });

  afterEach(() => {
    resetElectronMocks();
  });

  // --- TRS-05 matrix: NOT gated when USER_AI_ENABLED="false" ----------------

  it("list returns status:true when USER_AI_ENABLED=false (NOT gated)", async () => {
    const r = (await mockIpcMain.callHandler(
      SLASH_COMMAND_LIST,
      {},
      { conversationId: "conv-1", query: "" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(moduleMocks.listCommands).toHaveBeenCalledTimes(1);
  });

  it("dispatch of built-in /status returns show_result when USER_AI_ENABLED=false", async () => {
    const r = (await mockIpcMain.callHandler(
      SLASH_COMMAND_DISPATCH,
      {},
      { conversationId: "conv-1", rawInput: "/status" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(moduleMocks.dispatch).toHaveBeenCalledTimes(1);
    // Built-in returns show_result — NOT a prompt that would submit to AI.
    // (The mock simulates the dispatcher's show_result for /status.)
  });

  it("dispatch of built-in /help returns show_result when USER_AI_ENABLED=false", async () => {
    moduleMocks.dispatch.mockResolvedValueOnce({
      status: true,
      action: "show_result",
      commandId: "built-in:command:help",
      content: "Available commands:\n/help\n/clear",
    });
    const r = (await mockIpcMain.callHandler(
      SLASH_COMMAND_DISPATCH,
      {},
      { conversationId: "conv-1", rawInput: "/help" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
  });

  it("reload returns status:true when USER_AI_ENABLED=false", async () => {
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_CONFIG_RELOAD,
      {},
      { conversationId: "conv-1" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(moduleMocks.reloadConfig).toHaveBeenCalledTimes(1);
  });

  it("status returns status:true when USER_AI_ENABLED=false", async () => {
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_CONFIG_STATUS,
      {},
      { conversationId: "conv-1" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(moduleMocks.getStatus).toHaveBeenCalledTimes(1);
  });

  // --- AIFETCHLY_CONFIG_CHANGED emission on reload --------------------------

  it("emits AIFETCHLY_CONFIG_CHANGED via win.webContents.send on reload", async () => {
    const sendSpy = vi.spyOn(win.webContents, "send");
    await mockIpcMain.callHandler(
      AIFETCHLY_CONFIG_RELOAD,
      {},
      { conversationId: "conv-1" }
    );
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toBe(AIFETCHLY_CONFIG_CHANGED);
    // Payload is a JSON string carrying source + summary metadata only.
    const payload = JSON.parse(sendSpy.mock.calls[0][1] as string);
    expect(payload.source).toBe("user");
    expect(payload.summary).toBeDefined();
    expect(payload.summary.commandCount).toBe(0);
  });

  it("does NOT emit AIFETCHLY_CONFIG_CHANGED when reload throws", async () => {
    const sendSpy = vi.spyOn(win.webContents, "send");
    moduleMocks.reloadConfig.mockRejectedValueOnce(new Error("scan failed"));
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_CONFIG_RELOAD,
      {},
      { conversationId: "conv-1" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  // --- Zod validation: malformed payloads fail closed ----------------------

  it("dispatch with missing rawInput returns status:false (zod validation)", async () => {
    const r = (await mockIpcMain.callHandler(
      SLASH_COMMAND_DISPATCH,
      {},
      { conversationId: "conv-1" /* missing rawInput */ }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(moduleMocks.dispatch).not.toHaveBeenCalled();
  });

  it("dispatch with non-string rawInput returns status:false (zod validation)", async () => {
    const r = (await mockIpcMain.callHandler(
      SLASH_COMMAND_DISPATCH,
      {},
      { conversationId: "conv-1", rawInput: 42 }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(moduleMocks.dispatch).not.toHaveBeenCalled();
  });

  it("list with non-string query returns status:false (zod validation)", async () => {
    const r = (await mockIpcMain.callHandler(
      SLASH_COMMAND_LIST,
      {},
      { query: 123 }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(moduleMocks.listCommands).not.toHaveBeenCalled();
  });

  // --- Handler-ownership: registerBuiltInSlashCommands wired in -------------

  it("registerSlashCommandHandlers calls registerBuiltInSlashCommands on the singleton registry", () => {
    // The mock registry's register spy was set in beforeEach. registerSlashCommandHandlers
    // runs in beforeEach, so by the time the test body runs, the four built-ins
    // MUST have been registered.
    expect(managerMocks.getCommandRegistry).toHaveBeenCalled();
    const registry = managerMocks.getCommandRegistry.mock.results[0].value;
    expect(registry.register).toHaveBeenCalled();
    // Four built-ins (help/clear/status/reload-config).
    expect(registry.register.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
