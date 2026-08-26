import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_MESSAGE_TASK_CREATE,
  AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
} from "@/config/channellist";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

const mocks = vi.hoisted(() => ({
  listSchedulableBuiltInTools: vi.fn(() => [
    {
      name: "file_read",
      description: "Read a file",
      permissionCategory: "filesystem",
      source: "built-in" as const,
      requiresConfirmation: false,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "low" as const,
    },
  ]),
  createTask: vi.fn(async () => 42),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: vi.fn(() => false),
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/service/AiMessageToolCatalogService", () => ({
  listSchedulableBuiltInTools: mocks.listSchedulableBuiltInTools,
}));

vi.mock("@/modules/AiMessageTaskModule", () => ({
  AiMessageTaskModule: vi.fn().mockImplementation(() => ({
    createTask: mocks.createTask,
  })),
}));

vi.mock("@/modules/AiMessageTaskRunModule", () => ({
  AiMessageTaskRunModule: vi.fn().mockImplementation(() => ({})),
}));

import { registerAiMessageTaskIpcHandlers } from "@/main-process/communication/aiMessageTask-ipc";

function invoke(
  channel: string,
  payload?: Record<string, unknown>
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return handler(
    {},
    payload === undefined ? undefined : JSON.stringify(payload)
  );
}

describe("aiMessageTask-ipc catalog vs AI gate", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerAiMessageTaskIpcHandlers();
  });

  it("returns the tools catalog when AI is disabled", async () => {
    const result = await invoke(AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS);

    expect(result).toMatchObject({
      status: true,
      data: [
        {
          name: "file_read",
          schedulable: true,
          riskLevel: "low",
        },
      ],
    });
    expect(mocks.listSchedulableBuiltInTools).toHaveBeenCalledTimes(1);
  });

  it("still blocks create when AI is disabled", async () => {
    const result = await invoke(AI_MESSAGE_TASK_CREATE, {
      name: "Nightly recap",
      message: "Summarize inbox",
    });

    expect(result).toMatchObject({
      status: false,
      msg: "AI feature is not enabled",
      data: null,
    });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
