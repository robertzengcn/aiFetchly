import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron's ipcMain so handlers can be driven without Electron.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
    on: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn as never);
    },
  },
}));

// Chat availability gate: controllable per test.
let chatAvailable = true;
vi.mock("@/service/aiProvider/AIProviderResolver", () => ({
  AIProviderResolver: class {
    resolveForChat(): { canUse: boolean; message?: string } {
      return chatAvailable
        ? { canUse: true }
        : { canUse: false, message: "AI chat is not available" };
    }
  },
}));

// Queue service: assert delegation without a DB.
const queueSpies = {
  submit: vi.fn(),
  list: vi.fn(),
  steer: vi.fn(),
  cancel: vi.fn(),
  resumeConversation: vi.fn(),
  recoverOnStartup: vi.fn(),
  clearConversation: vi.fn(),
  clearAll: vi.fn(),
};
vi.mock("@/service/AIChatTurnQueueService", () => ({
  AIChatTurnQueueService: class {
    submit = queueSpies.submit;
    list = queueSpies.list;
    steer = queueSpies.steer;
    cancel = queueSpies.cancel;
    resumeConversation = queueSpies.resumeConversation;
    recoverOnStartup = queueSpies.recoverOnStartup;
    clearConversation = queueSpies.clearConversation;
    clearAll = queueSpies.clearAll;
  },
  AIChatTurnQueueError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  createSteeringPromoter: () => vi.fn(),
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "/tmp/aifetchly-pending-ipc-test";
    }
  },
}));

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: class {},
}));
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: class {},
}));
vi.mock("@/modules/AIChatToolApprovalModule", () => ({
  AIChatToolApprovalModule: class {},
}));
vi.mock("@/modules/AIChatPendingMessageModule", () => ({
  AIChatPendingMessageModule: class {},
}));
vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: { getAllToolFunctions: vi.fn(async () => []), getSkill: vi.fn() },
}));
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));
vi.mock("@/service/AIChatQueryLoop", () => ({
  AIChatQueryLoop: class {},
}));
vi.mock("@/service/AIChatQueryEngine", () => ({
  AIChatQueryEngine: class {},
}));
vi.mock("@/service/AIChatCompactAgentService", () => ({
  AIChatCompactAgentService: class {},
}));
vi.mock("@/service/AIChatModelCatalogService", () => ({
  AIChatModelCatalogService: class {},
}));
vi.mock("@/service/AIChatModelFallbackService", () => ({
  AIChatModelFallbackService: class {},
}));
vi.mock("@/service/AIAutoDreamFactory", () => ({
  getSharedAutoDreamService: () => undefined,
  resetSharedAutoDreamService: () => undefined,
  getSharedWorkspaceAutoDreamService: () => undefined,
  resetSharedWorkspaceAutoDreamService: () => undefined,
}));
vi.mock("@/service/AIChatConversationUpdateBroadcaster", () => ({
  AIChatConversationUpdateBroadcaster: {
    getInstance: () => ({ emitAutoCompacted: vi.fn() }),
  },
}));
vi.mock("@/service/AIChatV2EventBroadcaster", () => ({
  AIChatV2EventBroadcaster: {
    getInstance: () => ({
      register: vi.fn(),
      emitStreamChunk: vi.fn(),
      emitStreamComplete: vi.fn(),
      emitPendingEvent: vi.fn(),
    }),
  },
}));
vi.mock("@/service/AIChatConversationTurnCoordinator", () => ({
  AIChatConversationTurnCoordinator: {
    getInstance: () => ({ tryAcquire: () => null }),
  },
}));
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: class {},
}));
vi.mock("@/service/AIChatAuthExpiredHandler", () => ({
  redirectToLoginOnAuthExpired: () => undefined,
}));
vi.mock("@/service/AIChatErrorMapper", () => ({
  userSafeError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  isContextWindowExceededError: () => false,
}));
vi.mock("@/service/pastedText/PasteStoreService", () => ({
  PasteStoreService: class {},
}));

// Import AFTER mocks are registered.
import { AIChatTurnQueueError } from "@/service/AIChatTurnQueueService";
import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import {
  AI_CHAT_V2_PENDING_CREATE,
  AI_CHAT_V2_PENDING_STEER,
  AI_CHAT_V2_PENDING_CANCEL,
} from "@/config/channellist";

function callChannel(
  channel: string,
  payload: unknown
): Promise<{ status: boolean; msg?: string; data?: unknown }> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, typeof payload === "string" ? payload : JSON.stringify(payload)) as never;
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  chatAvailable = true;
  registerAiChatV2IpcHandlers();
});

describe("pending-message IPC handlers", () => {
  it("registers all pending channels", () => {
    for (const channel of [
      AI_CHAT_V2_PENDING_CREATE,
      AI_CHAT_V2_PENDING_STEER,
      AI_CHAT_V2_PENDING_CANCEL,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it("checks chat availability before doing any work", async () => {
    chatAvailable = false;
    const result = await callChannel(AI_CHAT_V2_PENDING_CREATE, {
      clientRequestId: "cr-1",
      request: { message: "hello" },
    });
    expect(result.status).toBe(false);
    expect(result.msg).toContain("not available");
    expect(queueSpies.submit).not.toHaveBeenCalled();
  });

  it("rejects oversized messages with a stable error", async () => {
    const result = await callChannel(AI_CHAT_V2_PENDING_CREATE, {
      clientRequestId: "cr-2",
      request: { message: "x".repeat(32_001) },
    });
    expect(result.status).toBe(false);
    expect(queueSpies.submit).not.toHaveBeenCalled();
  });

  it("rejects unknown keys (strict schema)", async () => {
    const result = await callChannel(AI_CHAT_V2_PENDING_CREATE, {
      clientRequestId: "cr-3",
      request: { message: "hi" },
      status: "sent", // renderer-supplied status is never trusted
    });
    expect(result.status).toBe(false);
    expect(queueSpies.submit).not.toHaveBeenCalled();
  });

  it("delegates a valid create to the queue service", async () => {
    const receipt = {
      conversationId: "v2-a",
      disposition: "dispatch_scheduled",
      pendingMessage: { pendingMessageId: "pm-1", status: "queued" },
    };
    queueSpies.submit.mockResolvedValue(receipt);
    const result = await callChannel(AI_CHAT_V2_PENDING_CREATE, {
      clientRequestId: "cr-4",
      request: { message: "hello", conversationId: "v2-a" },
    });
    expect(result.status).toBe(true);
    expect(queueSpies.submit).toHaveBeenCalledWith({
      clientRequestId: "cr-4",
      request: { message: "hello", conversationId: "v2-a" },
    });
  });

  it("surfaces queue service error codes in the message", async () => {
    queueSpies.steer.mockRejectedValue(
      new AIChatTurnQueueError("TURN_NOT_STEERABLE", "No running response.")
    );
    const result = await callChannel(AI_CHAT_V2_PENDING_STEER, {
      conversationId: "v2-a",
      pendingMessageId: "pm-1",
    });
    expect(result.status).toBe(false);
    expect(result.msg).toContain("[TURN_NOT_STEERABLE]");
  });
});
