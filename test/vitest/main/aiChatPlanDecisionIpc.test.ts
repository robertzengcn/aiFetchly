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

// G01 integration: the SAME queue service mock the pending-message harness
// uses, so the start-run handler can drive real submissions end-to-end.
const queueSpies = {
  submit: vi.fn(),
};
vi.mock("@/service/AIChatTurnQueueService", () => ({
  AIChatTurnQueueService: class {
    submit = queueSpies.submit;
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
  AIChatQueryEngine: class {
    getConversationRuntimeStatus = vi.fn(() => "idle");
  },
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
import { registerAiChatWorkspaceIpcHandlers } from "@/main-process/communication/ai-chat-workspace-ipc";
import { resetPlanDecisionTimingForTest } from "@/main-process/communication/aiChatPlanDecisionTiming";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";
import {
  AI_CHAT_V2_APPROVE_PLAN,
  AI_CHAT_V2_REJECT_PLAN,
  AI_CHAT_V2_REQUEST_PLAN_CHANGES,
  AI_CHAT_V2_PLAN_VERSIONS,
  AI_CHAT_WORKSPACE_START_RUN,
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
  queueSpies.submit.mockResolvedValue({
    pendingMessage: { pendingMessageId: 77 },
    disposition: "queued",
  });
  aiChatQueueCounters.reset();
  resetPlanDecisionTimingForTest();
  registerAiChatV2IpcHandlers();
  registerAiChatWorkspaceIpcHandlers();
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

/** Workspace start-run request body for a plan-continuation turn. */
function continuationRequest(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    conversationId: "v2-a",
    clientRequestId: "plan-cont-abcdef1234567890abcdef1234567890abcdef12",
    message: "Plan approved. Please begin executing the plan now.",
    mode: "chat",
    planContinuation: {
      planId: "plan-1",
      version: 3,
      action: "approve-plan",
    },
    ...overrides,
  };
}

async function callStartRun(
  payload: unknown
): Promise<{ status: boolean; msg?: string }> {
  const handler = handlers.get(AI_CHAT_WORKSPACE_START_RUN);
  if (!handler) throw new Error("start-run handler not registered");
  return (await handler(
    null,
    typeof payload === "string" ? payload : JSON.stringify(payload)
  )) as { status: boolean; msg?: string };
}

function continuationTiming(): { count: number; meanMs: number } | undefined {
  return aiChatQueueCounters.timingSnapshot()
    .plan_decision_to_continuation_ms as
    | { count: number; meanMs: number }
    | undefined;
}

/**
 * Audit R2 G01: the decision → durable continuation acceptance measurement
 * through the REAL workspace channels. The old wrapper measured decision
 * persistence only; the sample must now close at the queue submission
 * receipt, and a failed continuation must never produce one.
 */
describe("plan decision → durable continuation acceptance (audit R2 G01)", () => {
  it("decision persistence alone no longer produces a sample", async () => {
    await callChannel(AI_CHAT_V2_APPROVE_PLAN, VALID_DECISION);
    expect(planSpies.approvePlan).toHaveBeenCalledTimes(1);
    expect(continuationTiming()).toBeUndefined();
  });

  it("delays both stages and observes the sample at the acceptance boundary", async () => {
    // Stage delays force the real IPC round-trips to take measurable time.
    planSpies.approvePlan.mockImplementation(async () => {
      await sleep(40);
      return { state: "approved" };
    });
    queueSpies.submit.mockImplementation(async () => {
      await sleep(40);
      return {
        pendingMessage: { pendingMessageId: 88 },
        disposition: "dispatch_scheduled",
      };
    });
    await callChannel(AI_CHAT_V2_APPROVE_PLAN, VALID_DECISION);
    const started = await callStartRun(continuationRequest());
    expect(started.status).toBe(true);
    const timing = continuationTiming();
    expect(timing?.count).toBe(1);
    // Both 40 ms stage delays sit between the anchor and the acceptance.
    expect(timing?.meanMs).toBeGreaterThanOrEqual(20);
  });

  it("a rejected continuation (busy queue) produces no sample", async () => {
    await callChannel(AI_CHAT_V2_APPROVE_PLAN, VALID_DECISION);
    queueSpies.submit.mockResolvedValue({ pendingMessage: null });
    const rejected = await callStartRun(continuationRequest());
    expect(rejected.status).toBe(false);
    expect(continuationTiming()).toBeUndefined();
  });

  it("a continuation with no anchored decision produces no sample", async () => {
    // No approve/reject/request-changes call happened first.
    const result = await callStartRun(continuationRequest());
    expect(result.status).toBe(true);
    expect(continuationTiming()).toBeUndefined();
  });

  it("a mismatched continuation identity produces no sample", async () => {
    await callChannel(AI_CHAT_V2_APPROVE_PLAN, VALID_DECISION);
    const mismatched = await callStartRun(
      continuationRequest({
        planContinuation: {
          planId: "plan-1",
          version: 9,
          action: "approve-plan",
        },
      })
    );
    expect(mismatched.status).toBe(true);
    expect(continuationTiming()).toBeUndefined();
  });

  it("reject and request-changes continuations are anchored by their actions", async () => {
    // Delay the acceptance stage (between the anchor and the receipt).
    queueSpies.submit.mockImplementation(async () => {
      await sleep(15);
      return { pendingMessage: { pendingMessageId: 90 }, disposition: "queued" };
    });
    await callChannel(AI_CHAT_V2_REJECT_PLAN, {
      ...VALID_DECISION,
      feedback: "wrong direction",
    });
    const rejected = await callStartRun(
      continuationRequest({
        message: "Plan rejected. Please revise the plan.",
        planContinuation: {
          planId: "plan-1",
          version: 3,
          action: "reject-plan",
        },
      })
    );
    expect(rejected.status).toBe(true);
    const timing = continuationTiming();
    expect(timing?.count).toBe(1);
    // The 15 ms acceptance delay sits between the anchor and the receipt.
    expect(timing?.meanMs).toBeGreaterThanOrEqual(5);
  });
});
