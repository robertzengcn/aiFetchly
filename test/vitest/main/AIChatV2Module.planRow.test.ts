/**
 * Durable plan lifecycle display rows (PRD §12.4) — AIChatV2Module contract.
 *
 * The workspace transcript renders the plan decision card / question flow /
 * receipts as a pure projection of `metadata.planStateView` rows. Those rows
 * previously existed only in the renderer's live stream buffer, so every
 * selection re-seed (reload, reopen, notification click) erased the card.
 * `savePlanEventMessage` persists the SAME metadata shape durably with a
 * deterministic message id so transition replays upsert instead of
 * duplicating.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the persistence delegate so no real SQLite is touched.
const saveMessageSpy = vi.fn().mockResolvedValue({} as never);
const coupleAppendSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/AIChatModule", () => ({
  AIChatModule: class {
    saveMessage = saveMessageSpy;
  },
}));

vi.mock("@/service/AIChatArchiveAppendCoupler", () => ({
  AIChatArchiveAppendCoupler: class {
    coupleAppend = coupleAppendSpy;
  },
}));

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: class {},
}));

vi.mock("@/modules/AIChatCompactionModule", () => ({
  AIChatCompactionModule: class {},
}));

vi.mock("@/modules/AIArtifactModule", () => ({
  AIArtifactModule: class {},
}));

vi.mock("@/modules/PluginFileArtifactModule", () => ({
  PluginFileArtifactModule: class {},
}));

vi.mock("@/modules/ToolResultModule", () => ({
  ToolResultModule: class {},
}));

vi.mock("@/modules/Logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks are registered.
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { MessageType } from "@/entityTypes/commonType";
import type {
  AIChatPlanStateView,
} from "@/entityTypes/aiChatPlanTypes";

const planState = (
  overrides: Partial<AIChatPlanStateView> = {}
): AIChatPlanStateView => ({
  planId: "plan-77",
  conversationId: "v2-conv-1",
  status: "awaiting_approval",
  title: "Newsletter campaign",
  objective: "Ship it",
  currentVersion: 2,
  ...overrides,
});

describe("AIChatV2Module.savePlanEventMessage (durable plan row)", () => {
  let module: AIChatV2Module;

  const okCall = (overrides?: {
    conversationId?: string;
    eventType?:
      | "plan_state"
      | "ask_user_question"
      | "plan_submitted"
      | "plan_approved"
      | "plan_rejected"
      | "plan_changes_requested"
      | "plan_blocked_tool";
    planState?: AIChatPlanStateView;
    question?: { questionId: string; planId: string; conversationId: string; status: "pending"; questions: []; createdAt: string };
  }) =>
    module.savePlanEventMessage({
      conversationId: overrides?.conversationId ?? "v2-conv-1",
      eventType: overrides?.eventType ?? "plan_submitted",
      planState: overrides?.planState ?? planState(),
      ...(overrides?.question ? { question: overrides.question } : {}),
    });

  beforeEach(() => {
    saveMessageSpy.mockClear();
    coupleAppendSpy.mockClear();
    module = new AIChatV2Module();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists a message row shaped like the stream presenter's live plan rows", async () => {
    await okCall();

    expect(saveMessageSpy).toHaveBeenCalledTimes(1);
    const saved = saveMessageSpy.mock.calls[0][0] as {
      messageId: string;
      conversationId: string;
      role: string;
      content: string;
      metadata: Record<string, unknown>;
      messageType: string;
    };
    expect(saved.messageId).toBe("plan-event-plan-77-v2-plan_submitted");
    expect(saved.conversationId).toBe("v2-conv-1");
    expect(saved.role).toBe("assistant");
    expect(saved.messageType).toBe(MessageType.MESSAGE);
    expect(saved.content).toBe("");
    expect(saved.metadata).toEqual({
      source: "chat-v2",
      planEventType: "plan_submitted",
      planId: "plan-77",
      planStateView: planState(),
    });
  });

  it("carries the question view on ask_user_question rows", async () => {
    const question = {
      questionId: "question-1",
      planId: "plan-77",
      conversationId: "v2-conv-1",
      status: "pending" as const,
      questions: [] as never[],
      createdAt: new Date(2026, 7, 20, 10, 0, 1).toISOString(),
    };
    await module.savePlanEventMessage({
      conversationId: "v2-conv-1",
      eventType: "ask_user_question",
      planState: planState({ status: "awaiting_question" as never }),
      question,
    });
    const saved = saveMessageSpy.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
      messageId: string;
    };
    expect(saved.messageId).toBe("plan-event-plan-77-v2-ask_user_question");
    expect(saved.metadata.planEventType).toBe("ask_user_question");
    expect(saved.metadata.questionView).toEqual(question);
  });

  it("writes a raw plan_state row without a planEventType marker (presenter parity)", async () => {
    await module.savePlanEventMessage({
      conversationId: "v2-conv-1",
      eventType: "plan_state",
      planState: planState({ status: "draft" }),
    });
    const saved = saveMessageSpy.mock.calls[0][0] as {
      messageId: string;
      metadata: Record<string, unknown>;
    };
    expect(saved.messageId).toBe("plan-event-plan-77-v2-plan_state");
    expect("planEventType" in saved.metadata).toBe(false);
  });

  it("is idempotent by message id: replays of the same transition reuse the row id", async () => {
    await okCall();
    await okCall();
    const ids = saveMessageSpy.mock.calls.map(
      (call) => (call[0] as { messageId: string }).messageId
    );
    expect(new Set(ids).size).toBe(1);
  });

  it("skips non-v2 conversations and rows without a plan id", async () => {
    await okCall({ conversationId: "legacy-chat" });
    await okCall({ planState: planState({ planId: "" }) });
    expect(saveMessageSpy).not.toHaveBeenCalled();
  });
});
