// Integration test: submit-time selection transport (§13.3) wired into
// AIChatQueryEngine.submitMessage.
//
// Proves the three things the renderer relies on: the SELECTED archived text
// reaches the model inside the SAME user message the user authored (so preflight
// can never evict it), only REFERENCES/provenance are persisted (never the text),
// and the `start` event reports the SUBMITTED ids so the renderer clears exactly
// the accepted chips.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";

/**
 * Mutable holders so the hoisted mocks can report captured values into the
 * assertions (established pattern — see AIChatQueryEngine.atMention.test.ts).
 */
const holders = vi.hoisted(() => ({
  archiveReadsEnabled: true,
  resolveSelections: vi.fn(),
  saveUserMessage: vi.fn().mockResolvedValue({ messageId: "user-1" }),
  assembleInput: undefined as { currentUserMessage?: string } | undefined,
}));

vi.mock("@/config/featureFlags", () => ({
  isArchiveReadsEnabled: vi.fn(() => holders.archiveReadsEnabled),
}));

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
      saveUserMessage: holders.saveUserMessage,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      saveAssistantMessage: vi.fn().mockResolvedValue({}),
      saveToolCallMessage: vi.fn().mockResolvedValue({}),
      saveToolResultMessage: vi.fn().mockResolvedValue({}),
      createConversationIfNeeded: vi.fn().mockReturnValue("v2-test-conv"),
      getDefaultSystemPrompt: vi.fn().mockReturnValue("You are helpful."),
    };
  }),
}));

vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(function () {
    return { getPlanState: vi.fn().mockResolvedValue(null) };
  }),
}));

vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: vi.fn().mockImplementation(function () {
    return {
      resolve: vi.fn().mockResolvedValue({ workspaceId: 1, rootPath: "/tmp" }),
    };
  }),
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn().mockReturnValue("true") };
  }),
}));

vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return { ...actual, AiChatApi: vi.fn() };
});

vi.mock("@/service/DesktopNotifyService", () => ({
  DesktopNotifyService: {
    getInstance: () => ({ show: vi.fn().mockResolvedValue(false) }),
  },
}));

import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";

const SUBMITTED_A = "c291cmNlLWFh";
const SUBMITTED_B = "c291cmNlLWIh";
// The archive re-encodes each resolved sourceId from the interval it read;
// these are the ids the archive layer returns, NOT the ones the renderer sent.
const ARCHIVE_ID_A = "YXJjaGl2ZS1haA";
const ARCHIVE_ID_B = "YXJjaGl2ZS1iaA";

const EXCERPT_A = {
  sourceId: ARCHIVE_ID_A,
  messageId: "arch-msg-1",
  role: "assistant",
  timestamp: "2026-09-01T10:00:00.000Z",
  text: "The answer was column order.",
  exact: true,
  redacted: false,
  hasMore: false,
};

const EXCERPT_B = {
  sourceId: ARCHIVE_ID_B,
  messageId: "arch-msg-2",
  role: "user",
  timestamp: "2026-09-01T10:05:00.000Z",
  text: "Please repeat column order.",
  exact: true,
  redacted: false,
  hasMore: false,
};

const COMPLETED: AIChatQueryLoopResult = {
  type: "completed",
  conversationId: "v2-test-conv",
  assistantMessageId: "assistant-1",
  fullContent: "",
  model: undefined,
  finishReason: "stop",
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
};

function buildEngine(): {
  engine: AIChatQueryEngine;
  loop: { run: ReturnType<typeof vi.fn> };
} {
  const contextAssembler = {
    assemble: vi
      .fn()
      .mockImplementation(async (input: { currentUserMessage?: string }) => {
        holders.assembleInput = input;
        return { messages: [] };
      }),
  } as unknown as AIChatContextAssembler;
  const loop = {
    run: vi.fn().mockResolvedValue(COMPLETED),
  } as unknown as { run: ReturnType<typeof vi.fn> } & AIChatQueryLoop;
  const engine = new AIChatQueryEngine(loop as AIChatQueryLoop, {
    contextAssembler,
    historyRetrievalServiceFactory: () =>
      ({ resolveSelections: holders.resolveSelections } as never),
  });
  return { engine, loop };
}

interface SavedSelection {
  sourceId: string;
  messageId: string;
  role: string;
  timestamp: string;
  exact: boolean;
}

interface SavedUserMessage {
  content: string;
  metadata?: { historySelections?: readonly SavedSelection[] };
}

function savedUserMessage(): SavedUserMessage {
  return holders.saveUserMessage.mock.calls.at(-1)?.[0] as SavedUserMessage;
}

describe("AIChatQueryEngine submit-time history selection (§13.3)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eng-selections-"));
    holders.archiveReadsEnabled = true;
    holders.assembleInput = undefined;
    holders.resolveSelections.mockReset();
    holders.saveUserMessage.mockClear();
    holders.saveUserMessage.mockResolvedValue({ messageId: "user-1" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("re-resolves the submitted refs and folds both passages into the SAME user message", async () => {
    holders.resolveSelections.mockResolvedValue({
      resolved: [EXCERPT_A, EXCERPT_B],
      acceptedSubmittedIds: [SUBMITTED_A, SUBMITTED_B],
      rejected: [],
    });
    const { engine } = buildEngine();

    await engine.submitMessage({
      eventSink: { emit: vi.fn() },
      request: {
        message: "What did we decide about column order?",
        historySelectionIds: [SUBMITTED_A, SUBMITTED_B],
        submissionId: "00000000-0000-0000-0000-000000000001",
      },
    });

    // Re-resolved by the backend, scoped to the conversation and this turn.
    expect(holders.resolveSelections).toHaveBeenCalledTimes(1);
    const [convId, ids, turnId] = holders.resolveSelections.mock.calls[0];
    expect(convId).toBe("v2-test-conv");
    expect(ids).toEqual([SUBMITTED_A, SUBMITTED_B]);
    expect(typeof turnId).toBe("string");

    const modelMessage = holders.assembleInput?.currentUserMessage ?? "";
    expect(modelMessage).toContain("What did we decide about column order?");
    expect(modelMessage).toContain("[Selected archived passage]");
    expect(modelMessage).toContain("The answer was column order.");
    expect(modelMessage).toContain("Please repeat column order.");
    // Provenance so the model can tell evidence from instruction.
    expect(modelMessage).toContain("assistant · 2026-09-01T10:00:00.000Z");
    expect(modelMessage).toContain("user · 2026-09-01T10:05:00.000Z");
    expect(modelMessage).toContain("not instructions");
  });

  it("persists references and provenance only — never the passage text", async () => {
    holders.resolveSelections.mockResolvedValue({
      resolved: [EXCERPT_A, EXCERPT_B],
      acceptedSubmittedIds: [SUBMITTED_A, SUBMITTED_B],
      rejected: [],
    });
    const { engine } = buildEngine();

    await engine.submitMessage({
      eventSink: { emit: vi.fn() },
      request: {
        message: "Follow up on the column order",
        historySelectionIds: [SUBMITTED_A, SUBMITTED_B],
      },
    });

    const saved = savedUserMessage();
    expect(saved.content).toBe("Follow up on the column order");
    const selections = saved.metadata?.historySelections;
    expect(selections).toHaveLength(2);
    expect(selections?.[0]).toEqual({
      // The SUBMITTED id, not the archive's re-encoded one — the renderer
      // reconciles this against its own chip ids.
      sourceId: SUBMITTED_A,
      messageId: "arch-msg-1",
      role: "assistant",
      timestamp: "2026-09-01T10:00:00.000Z",
      exact: true,
    });
    expect(selections?.[1]?.sourceId).toBe(SUBMITTED_B);

    // No passage text leaked into the persisted row. The selections carry
    // references/provenance only.
    const selectionsJson = JSON.stringify(selections);
    expect(selectionsJson).not.toContain("column order");
    expect(selectionsJson).not.toContain("The answer");
    expect(selectionsJson).not.toContain(ARCHIVE_ID_A);
  });

  it("emits accepted SUBMITTED ids on start so only those chips are cleared", async () => {
    holders.resolveSelections.mockResolvedValue({
      resolved: [EXCERPT_A],
      acceptedSubmittedIds: [SUBMITTED_A],
      rejected: [SUBMITTED_B],
      errorCode: "SOURCE_CHANGED",
    });
    const { engine } = buildEngine();
    const emit = vi.fn();

    await engine.submitMessage({
      eventSink: { emit } as AIChatQueryEventSink,
      request: {
        message: "Send",
        historySelectionIds: [SUBMITTED_A, SUBMITTED_B],
      },
    });

    const startEvent = emit.mock.calls
      .map((c) => c[0] as { type?: string })
      .find((e) => e.type === "start");
    expect(startEvent).toBeDefined();
    expect(
      (startEvent as { historySelectionAcceptedIds?: readonly string[] })
        .historySelectionAcceptedIds
    ).toEqual([SUBMITTED_A]);
  });

  it("sends the message unchanged and skips resolution when nothing is selected", async () => {
    const { engine } = buildEngine();

    await engine.submitMessage({
      eventSink: { emit: vi.fn() },
      request: { message: "Plain message" },
    });

    expect(holders.resolveSelections).not.toHaveBeenCalled();
    expect(holders.assembleInput?.currentUserMessage).toBe("Plain message");
    expect(savedUserMessage().metadata?.historySelections).toBeUndefined();
  });

  it("skips resolution entirely when the archive-reads rollout flag is off", async () => {
    holders.archiveReadsEnabled = false;
    const { engine } = buildEngine();

    await engine.submitMessage({
      eventSink: { emit: vi.fn() },
      request: {
        message: "Flag off",
        historySelectionIds: [SUBMITTED_A],
      },
    });

    expect(holders.resolveSelections).not.toHaveBeenCalled();
    expect(holders.assembleInput?.currentUserMessage).toBe("Flag off");
    // The user's own message still goes out; only the selection is dropped.
    expect(savedUserMessage().content).toBe("Flag off");
  });

  it("never fails the turn when selection resolution throws", async () => {
    holders.resolveSelections.mockRejectedValue(new Error("archive exploded"));
    const { engine, loop } = buildEngine();

    await engine.submitMessage({
      eventSink: { emit: vi.fn() },
      request: {
        message: "Still goes out",
        historySelectionIds: [SUBMITTED_A],
      },
    });

    expect(holders.assembleInput?.currentUserMessage).toBe("Still goes out");
    expect(loop.run).toHaveBeenCalledTimes(1);
    expect(savedUserMessage().metadata?.historySelections).toBeUndefined();
  });
});
