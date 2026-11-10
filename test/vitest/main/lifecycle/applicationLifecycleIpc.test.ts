import { describe, expect, it, vi, beforeEach } from "vitest";
import "vitest";

/**
 * applicationLifecycle IPC handler tests (design §10): sender
 * authorization, stale-token reporting, and state snapshot shape.
 * electron's ipcMain + BrowserWindow are mocked at the module level.
 */

const handleMock = vi.fn();
const removeHandlerMock = vi.fn();
const invokeHandlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) => {
      handleMock(channel, fn);
      invokeHandlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      removeHandlerMock(channel);
      invokeHandlers.delete(channel);
    },
  },
}));

import {
  registerApplicationLifecycleIpcHandlers,
  removeApplicationLifecycleIpcHandlers,
  broadcastLifecycleState,
} from "@/main-process/communication/applicationLifecycle-ipc";
import {
  APPLICATION_LIFECYCLE_GET_STATE,
  APPLICATION_CLOSE_CHOICE_ACK,
  APPLICATION_CLOSE_CHOICE_SUBMIT,
} from "@/config/channellist";
import { ApplicationLifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";
import { CloseChoiceFlow } from "@/main-process/lifecycle/CloseChoiceFlow";

interface FakeWebContents {
  readonly id: number;
}

function makeEvent(senderId: number): { sender: FakeWebContents } {
  return { sender: { id: senderId } };
}

describe("applicationLifecycle IPC", () => {
  let lifecycle: ApplicationLifecycleService;
  let flow: CloseChoiceFlow;

  beforeEach(() => {
    invokeHandlers.clear();
    handleMock.mockClear();
    lifecycle = new ApplicationLifecycleService();
    lifecycle.setBackgroundAvailable(true);
    flow = new CloseChoiceFlow(lifecycle, {
      sendRendererRequest: () => undefined,
      showNativeFallback: async () => "cancel",
      hideWindow: () => undefined,
      setTimeoutFn: (() => 0) as unknown as typeof setTimeout,
      clearTimeoutFn: () => undefined,
    });
  });

  function register(mainSenderId = 7): void {
    registerApplicationLifecycleIpcHandlers({
      lifecycle,
      closeChoiceFlow: flow,
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          webContents: { id: mainSenderId },
        }) as never,
    });
  }

  it("registers exactly the three invoke channels", () => {
    register();
    expect([...invokeHandlers.keys()].sort()).toEqual(
      [
        APPLICATION_LIFECYCLE_GET_STATE,
        APPLICATION_CLOSE_CHOICE_ACK,
        APPLICATION_CLOSE_CHOICE_SUBMIT,
      ].sort()
    );
    removeApplicationLifecycleIpcHandlers();
    expect(invokeHandlers.size).toBe(0);
  });

  it("get-state returns the lifecycle snapshot", async () => {
    register();
    const handler = invokeHandlers.get(APPLICATION_LIFECYCLE_GET_STATE)!;
    const result = (await handler(makeEvent(7), {})) as {
      status: boolean;
      data: { state: string; backgroundAvailable: boolean };
    };
    expect(result.status).toBe(true);
    expect(result.data.state).toBe("visible");
    expect(result.data.backgroundAvailable).toBe(true);
  });

  it("get-state from a NON-main sender returns null (uniform authorization)", async () => {
    register();
    const handler = invokeHandlers.get(APPLICATION_LIFECYCLE_GET_STATE)!;
    const result = (await handler(makeEvent(99), {})) as {
      status: boolean;
      data: { state: string } | null;
    };
    expect(result.status).toBe(true);
    expect(result.data).toBeNull();
  });

  it("ack from the main window acknowledges the live token", async () => {
    register();
    const issued = lifecycle.beginCloseChoice();
    const token = issued.result === "issued" ? issued.token : "";
    const handler = invokeHandlers.get(APPLICATION_CLOSE_CHOICE_ACK)!;
    const result = (await handler(makeEvent(7), { token })) as {
      status: boolean;
      data: { acknowledged: boolean };
    };
    expect(result.data.acknowledged).toBe(true);
  });

  it("ack from a NON-main sender is refused (authorization, §10)", async () => {
    register();
    const issued = lifecycle.beginCloseChoice();
    const token = issued.result === "issued" ? issued.token : "";
    const handler = invokeHandlers.get(APPLICATION_CLOSE_CHOICE_ACK)!;
    const result = (await handler(makeEvent(99), { token })) as {
      data: { acknowledged: boolean };
    };
    expect(result.data.acknowledged).toBe(false);
  });

  it("submit from the main window with a live token is accepted", async () => {
    register();
    flow.begin();
    const token = (lifecycle.beginCloseChoice() as { result: string; token?: string })
      .token!;
    const handler = invokeHandlers.get(APPLICATION_CLOSE_CHOICE_SUBMIT)!;
    const result = (await handler(makeEvent(7), { token, choice: "cancel" })) as {
      data: { accepted: boolean; stale: boolean };
    };
    expect(result.data.accepted).toBe(true);
    expect(result.data.stale).toBe(false);
  });

  it("submit with a stale token reports stale", async () => {
    register();
    const handler = invokeHandlers.get(APPLICATION_CLOSE_CHOICE_SUBMIT)!;
    const result = (await handler(makeEvent(7), {
      token: "deadbeef-token",
      choice: "hide",
    })) as {
      data: { accepted: boolean; stale: boolean };
    };
    expect(result.data.accepted).toBe(false);
    expect(result.data.stale).toBe(true);
  });

  it("submit with an unknown choice value fails schema validation", async () => {
    register();
    const handler = invokeHandlers.get(APPLICATION_CLOSE_CHOICE_SUBMIT)!;
    const result = (await handler(makeEvent(7), {
      token: "abcd1234-token",
      choice: "restart",
    })) as { status: boolean; msg: string };
    expect(result.status).toBe(false);
  });

  it("submit with smuggled extra fields fails schema validation", async () => {
    register();
    const handler = invokeHandlers.get(APPLICATION_CLOSE_CHOICE_SUBMIT)!;
    const result = (await handler(makeEvent(7), {
      token: "abcd1234-token",
      choice: "exit",
      pid: 1234,
    })) as { status: boolean };
    expect(result.status).toBe(false);
  });

  it("broadcastLifecycleState is a no-op for a destroyed window", () => {
    expect(() =>
      broadcastLifecycleState(null, { state: "quitting" })
    ).not.toThrow();
    const destroyed = {
      isDestroyed: () => true,
      webContents: { send: vi.fn() },
    } as never;
    broadcastLifecycleState(destroyed, { state: "quitting" });
  });
});
