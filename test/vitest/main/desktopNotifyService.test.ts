import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import {
  DesktopNotifyService,
  type DesktopNotifyDeps,
  coalescePayloads,
  computeBottomRightBounds,
  isMainWindowQuiet,
} from "@/service/DesktopNotifyService";
import { AI_CHAT_V2_OPEN_FROM_NOTIFY } from "@/config/channellist";

function createMockWindow(
  overrides: Partial<{
    isDestroyed: boolean;
    isMinimized: boolean;
    isFocused: boolean;
    isVisible: boolean;
  }> = {}
): BrowserWindow {
  const state = {
    isDestroyed: overrides.isDestroyed ?? false,
    isMinimized: overrides.isMinimized ?? false,
    isFocused: overrides.isFocused ?? false,
    isVisible: overrides.isVisible ?? true,
  };
  const webContents = {
    send: vi.fn(),
    on: vi.fn(),
  };
  return {
    isDestroyed: () => state.isDestroyed,
    isMinimized: () => state.isMinimized,
    isFocused: () => state.isFocused,
    isVisible: () => state.isVisible,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(() => {
      state.isDestroyed = true;
    }),
    setBounds: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    showInactive: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    on: vi.fn(),
    webContents,
  } as unknown as BrowserWindow;
}

describe("DesktopNotifyService helpers", () => {
  it("computes bottom-right bounds from workArea", () => {
    const bounds = computeBottomRightBounds({
      x: 100,
      y: 50,
      width: 1920,
      height: 1080,
    });
    expect(bounds).toEqual({
      x: 100 + 1920 - 320 - 16,
      y: 50 + 1080 - 96 - 16,
      width: 320,
      height: 96,
    });
  });

  it("treats missing/minimized/unfocused main window as quiet", () => {
    expect(isMainWindowQuiet(null)).toBe(true);
    expect(isMainWindowQuiet(createMockWindow({ isMinimized: true }))).toBe(
      true
    );
    expect(isMainWindowQuiet(createMockWindow({ isFocused: false }))).toBe(
      true
    );
    expect(isMainWindowQuiet(createMockWindow({ isFocused: true }))).toBe(
      false
    );
  });

  it("coalesce prefers plan_ready over turn_complete", () => {
    const merged = coalescePayloads(
      {
        type: "turn_complete",
        title: "AI reply ready",
        body: "a",
        conversationId: "c1",
      },
      {
        type: "plan_ready",
        title: "Plan ready for approval",
        body: "b",
        conversationId: "c1",
        planId: "p1",
      }
    );
    expect(merged.type).toBe("plan_ready");
    expect(merged.planId).toBe("p1");
  });
});

describe("DesktopNotifyService", () => {
  let main: BrowserWindow;
  let floatWin: BrowserWindow;
  let createWindow: ReturnType<
    typeof vi.fn<[Electron.BrowserWindowConstructorOptions], BrowserWindow>
  >;
  let isSettingEnabled: ReturnType<typeof vi.fn<[], Promise<boolean>>>;
  let sendOpenConversation: ReturnType<
    typeof vi.fn<[BrowserWindow, string | undefined], void>
  >;
  let now: number;
  let service: DesktopNotifyService;

  function buildDeps(
    overrides: Partial<DesktopNotifyDeps> = {}
  ): DesktopNotifyDeps {
    return {
      getMainWindow: () => main,
      isSettingEnabled,
      createWindow,
      getDisplayWorkArea: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
      now: () => now,
      sendOpenConversation,
      ...overrides,
    };
  }

  beforeEach(() => {
    DesktopNotifyService._resetForTesting();
    main = createMockWindow({ isFocused: false });
    floatWin = createMockWindow();
    createWindow = vi.fn(
      (_options: Electron.BrowserWindowConstructorOptions): BrowserWindow =>
        floatWin
    );
    isSettingEnabled = vi.fn(async (): Promise<boolean> => true);
    sendOpenConversation = vi.fn(
      (_main: BrowserWindow, _conversationId: string | undefined): void => {
        // mock
      }
    );
    now = 1_000_000;
    service = new DesktopNotifyService(buildDeps());
  });

  afterEach(() => {
    service.destroy();
    DesktopNotifyService._resetForTesting();
  });

  it("does not show when setting is disabled", async () => {
    isSettingEnabled.mockResolvedValue(false);
    const shown = await service.show({
      type: "turn_complete",
      title: "AI reply ready",
      body: "done",
      conversationId: "c1",
    });
    expect(shown).toBe(false);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("does not show when main window is focused", async () => {
    main = createMockWindow({ isFocused: true });
    service = new DesktopNotifyService(buildDeps());
    const shown = await service.show({
      type: "turn_complete",
      title: "AI reply ready",
      body: "done",
      conversationId: "c1",
    });
    expect(shown).toBe(false);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("shows bottom-right float when main is unfocused", async () => {
    const shown = await service.show({
      type: "turn_complete",
      title: "AI reply ready",
      body: "done",
      conversationId: "c1",
    });
    expect(shown).toBe(true);
    expect(createWindow).toHaveBeenCalledTimes(1);
    const options = createWindow.mock.calls[0][0];
    expect(options).toMatchObject({
      x: 1280 - 320 - 16,
      y: 720 - 96 - 16,
      width: 320,
      height: 96,
    });
    expect(floatWin.loadURL).toHaveBeenCalled();
    expect(floatWin.showInactive).toHaveBeenCalled();
    expect(service.isShowing()).toBe(true);
  });

  it("coalesces plan_ready over turn_complete for same conversation within 3s", async () => {
    await service.show({
      type: "turn_complete",
      title: "AI reply ready",
      body: "done",
      conversationId: "c1",
    });
    now += 500;
    await service.show({
      type: "plan_ready",
      title: "Plan ready for approval",
      body: "My plan",
      conversationId: "c1",
      planId: "p1",
    });
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(floatWin.loadURL).toHaveBeenCalledTimes(2);
    const lastUrl = (floatWin.loadURL as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as string;
    expect(decodeURIComponent(lastUrl)).toContain("Plan ready for approval");
  });

  it("activate focuses main and navigates with conversationId", async () => {
    await service.show({
      type: "turn_complete",
      title: "AI reply ready",
      body: "done",
      conversationId: "conv-42",
    });
    service.handleActivate();
    expect(main.focus).toHaveBeenCalled();
    expect(sendOpenConversation).toHaveBeenCalledWith(main, "conv-42");
  });

  it("default open sender uses AI_CHAT_V2_OPEN_FROM_NOTIFY channel", () => {
    expect(AI_CHAT_V2_OPEN_FROM_NOTIFY).toBe("ai-chat-v2:open-from-notify");
  });
});

describe("DesktopNotifyService subagent regression", () => {
  it("does not import AgentRuntime notify path from DesktopNotifyService module", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const serviceSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/service/DesktopNotifyService.ts"),
      "utf-8"
    );
    const agentSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/service/AgentRuntime.ts"),
      "utf-8"
    );
    expect(serviceSrc).not.toMatch(/AgentRuntime/);
    expect(agentSrc).not.toMatch(/DesktopNotifyService/);
  });
});
