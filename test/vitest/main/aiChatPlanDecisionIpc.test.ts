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

// Chat availability gate: runs BEFORE any parsing (AI-first rule).
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

// Plan module: assert delegation without a DB.
const planSpies = {
  approvePlan: vi.fn(),
  rejectPlan: vi.fn(),
  requestPlanChanges: vi.fn(),
  listVersions: vi.fn(),
};
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: class {
    approvePlan = planSpies.approvePlan;
    rejectPlan = planSpies.rejectPlan;
    requestPlanChanges = planSpies.requestPlanChanges;
    listVersions = planSpies.listVersions;
  },
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "/tmp/aifetchly-plan-decision-ipc-test";
    }
  },
}));

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: class {},
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
import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import {
  AI_CHAT_V2_APPROVE_PLAN,
  AI_CHAT_V2_REJECT_PLAN,
  AI_CHAT_V2_REQUEST_PLAN_CHANGES,
  AI_CHAT_V2_PLAN_VERSIONS,
} from "@/config/channellist";

function callChannel(
  channel: string,
  payload: unknown
): Promise<{ status: boolean; msg?: string; data?: unknown }> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(
    null,
    typeof payload === "string" ? payload : JSON.stringify(payload)
  ) as never;
}

const VALID_DECISION = {
  planId: "plan-1",
  conversationId: "v2-a",
  version: 3,
};

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  chatAvailable = true;
  planSpies.approvePlan.mockResolvedValue({ state: "approved" });
  planSpies.rejectPlan.mockResolvedValue({ state: "rejected" });
  planSpies.requestPlanChanges.mockResolvedValue({ state: "revise" });
  planSpies.listVersions.mockResolvedValue([]);
  registerAiChatV2IpcHandlers();
});

describe("plan decision IPC input contract (audit R2 N07)", () => {
  it("checks the AI gate BEFORE parsing or validating any payload", async () => {
    chatAvailable = false;
    const result = await callChannel(AI_CHAT_V2_APPROVE_PLAN, "{invalid json");
    expect(result.status).toBe(false);
    expect(result.msg).toContain("not available");
    expect(planSpies.approvePlan).not.toHaveBeenCalled();
  });

  it("delegates a valid approve decision through the bounded schema", async () => {
    const result = await callChannel(AI_CHAT_V2_APPROVE_PLAN, VALID_DECISION);
    expect(result.status).toBe(true);
    expect(planSpies.approvePlan).toHaveBeenCalledWith({
      conversationId: "v2-a",
      planId: "plan-1",
      version: 3,
    });
  });

  it("denies malformed JSON without crashing the handler", async () => {
    const result = await callChannel(AI_CHAT_V2_APPROVE_PLAN, "{invalid json");
    expect(result.status).toBe(false);
    expect(planSpies.approvePlan).not.toHaveBeenCalled();
  });

  it("denies unknown keys and missing/mistyped fields on approve", async () => {
    for (const payload of [
      { conversationId: "v2-a", version: 3 }, // missing planId
      { planId: "plan-1", conversationId: "v2-a", version: "3" }, // mistyped
      { planId: "plan-1", conversationId: "v2-a", version: 1.5 }, // non-integer
      { ...VALID_DECISION, status: "approved" }, // renderer-supplied state never trusted
    ]) {
      const result = await callChannel(AI_CHAT_V2_APPROVE_PLAN, payload);
      expect(result.status).toBe(false);
    }
    expect(planSpies.approvePlan).not.toHaveBeenCalled();
  });

  it("bounds identifier and version magnitude", async () => {
    const result = await callChannel(AI_CHAT_V2_APPROVE_PLAN, {
      ...VALID_DECISION,
      planId: "p".repeat(201),
    });
    expect(result.status).toBe(false);
    expect(planSpies.approvePlan).not.toHaveBeenCalled();
  });

  it("reject forwards optional feedback through validation", async () => {
    const result = await callChannel(AI_CHAT_V2_REJECT_PLAN, {
      ...VALID_DECISION,
      feedback: "wrong direction",
    });
    expect(result.status).toBe(true);
    expect(planSpies.rejectPlan).toHaveBeenCalledWith({
      conversationId: "v2-a",
      planId: "plan-1",
      version: 3,
      feedback: "wrong direction",
    });
  });

  it("reject accepts a missing feedback but bounds its length", async () => {
    const ok = await callChannel(AI_CHAT_V2_REJECT_PLAN, VALID_DECISION);
    expect(ok.status).toBe(true);
    const overlong = await callChannel(AI_CHAT_V2_REJECT_PLAN, {
      ...VALID_DECISION,
      feedback: "x".repeat(5001),
    });
    expect(overlong.status).toBe(false);
    expect(planSpies.rejectPlan).toHaveBeenCalledTimes(1);
  });

  it("request-changes requires non-empty feedback (whitespace denied)", async () => {
    for (const payload of [
      { ...VALID_DECISION, feedback: "" },
      { ...VALID_DECISION, feedback: "   " },
    ]) {
      const result = await callChannel(
        AI_CHAT_V2_REQUEST_PLAN_CHANGES,
        payload
      );
      expect(result.status).toBe(false);
    }
    const ok = await callChannel(AI_CHAT_V2_REQUEST_PLAN_CHANGES, {
      ...VALID_DECISION,
      feedback: "narrow the scope",
    });
    expect(ok.status).toBe(true);
    expect(planSpies.requestPlanChanges).toHaveBeenCalledWith({
      conversationId: "v2-a",
      planId: "plan-1",
      version: 3,
      feedback: "narrow the scope",
    });
  });

  it("plan versions accepts a planId-only payload and denies the rest", async () => {
    const ok = await callChannel(AI_CHAT_V2_PLAN_VERSIONS, {
      planId: "plan-1",
    });
    expect(ok.status).toBe(true);
    expect(planSpies.listVersions).toHaveBeenCalledWith("plan-1");
    const bad = await callChannel(AI_CHAT_V2_PLAN_VERSIONS, {
      planId: "",
    });
    expect(bad.status).toBe(false);
  });
});
