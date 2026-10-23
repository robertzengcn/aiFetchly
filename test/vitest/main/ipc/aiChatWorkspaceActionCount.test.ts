/**
 * R8 §2 observability — renderer-originated workspace action counter IPC.
 *
 * The PRD's workspace action counter (design §18.1 / PRD §20) must also
 * count actions that happen RENDERER-side: report dialog opened, generated
 * image chooser open, batch confirm/retry/stop, and voice record/playback/
 * install/capability-state. The bounded channel validates capability against
 * the shared enum and bounds action/outcome to stable enum-like labels —
 * never content (same contract as the main-process recordWorkspaceAction).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron's ipcMain so handlers can be driven without Electron.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

import { registerAiChatWorkspaceActionCountIpcHandlers } from "@/main-process/communication/aiChatWorkspaceActionCountIpc";
import { AI_CHAT_WORKSPACE_ACTION_COUNT } from "@/config/channellist";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";
import type { IpcMainInvokeEvent } from "electron";

const fakeEvent = { sender: { isDestroyed: () => true } } as IpcMainInvokeEvent;

function call(payload: unknown): Promise<{ status: boolean; msg: string }> {
  const handler = handlers.get(AI_CHAT_WORKSPACE_ACTION_COUNT);
  if (!handler) throw new Error("handler not registered");
  // windowInvoke stringifies payloads.
  return handler(fakeEvent, JSON.stringify(payload)) as Promise<{
    status: boolean;
    msg: string;
  }>;
}

beforeEach(() => {
  aiChatQueueCounters.reset();
  registerAiChatWorkspaceActionCountIpcHandlers();
});

describe("workspace action count IPC (R8 §2)", () => {
  it("counts a valid renderer action into the workspace action counter", async () => {
    const result = await call({
      capability: "report",
      action: "dialog_open",
      outcome: "ok",
    });
    expect(result.status).toBe(true);
    expect(
      aiChatQueueCounters.snapshot()[
        'ai_chat_workspace_action_total{action="dialog_open",capability="report",outcome="ok"}'
      ]
    ).toBe(1);
  });

  it("counts voice actions with bounded labels", async () => {
    await call({
      capability: "voice",
      action: "record_start",
      outcome: "ok",
    });
    await call({
      capability: "voice",
      action: "record_start",
      outcome: "error",
    });
    const snapshot = aiChatQueueCounters.snapshot();
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="record_start",capability="voice",outcome="ok"}'
      ]
    ).toBe(1);
    expect(
      snapshot[
        'ai_chat_workspace_action_total{action="record_start",capability="voice",outcome="error"}'
      ]
    ).toBe(1);
  });

  it("rejects an unknown capability (strict enum)", async () => {
    const result = await call({
      capability: "not_a_capability",
      action: "dialog_open",
      outcome: "ok",
    });
    expect(result.status).toBe(false);
  });

  it("rejects unbounded action/outcome labels", async () => {
    expect(
      (
        await call({
          capability: "image",
          action: "BAD LABEL with spaces",
          outcome: "ok",
        })
      ).status
    ).toBe(false);
    expect(
      (
        await call({
          capability: "image",
          action: "chooser_open",
          outcome: "x".repeat(64),
        })
      ).status
    ).toBe(false);
  });

  it("rejects unknown keys (strict schema)", async () => {
    const result = await call({
      capability: "report",
      action: "dialog_open",
      outcome: "ok",
      prompt: "leak attempt",
    });
    expect(result.status).toBe(false);
  });
});
