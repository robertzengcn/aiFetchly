import { describe, expect, it } from "vitest";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatV2MessageMetadata } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import {
  buildToolExecutionGroups,
  actionLabelFor,
} from "@/views/components/aiChatWorkspace/toolExecutionProjection";
import {
  selectPlanPresentation,
  isPinnedSurface,
  isReceiptSurface,
  createPlanQuestionDraft,
  draftMove,
  draftToggleOption,
} from "@/views/components/aiChatWorkspace/planPresentationProjection";

let idCounter = 0;

function view(
  messageType: MessageType,
  metadata?: ChatV2MessageMetadata,
  role: "user" | "assistant" = "assistant",
  content = ""
): ChatV2MessageView {
  idCounter += 1;
  return {
    id: `m${idCounter}`,
    conversationId: "v2-c",
    role,
    content,
    timestamp: new Date(2026, 7, 20, 10, 0, idCounter).toISOString(),
    messageType,
    metadata,
  };
}

describe("buildToolExecutionGroups (FR-042..050)", () => {
  it("pairs call and result by toolCallId into ONE evolving row", () => {
    const messages = [
      view(MessageType.MESSAGE, { source: "chat-v2" }, "assistant", "answer"),
      view(MessageType.TOOL_CALL, {
        source: "chat-v2",
        toolCallId: "tc-1",
        toolName: "web_search",
        toolArguments: { q: "hi" },
      }),
      view(MessageType.TOOL_RESULT, {
        source: "chat-v2",
        toolCallId: "tc-1",
        toolName: "web_search",
        toolResult: { success: true, summary: "3 results" },
        toolResultSummary: "3 results",
      }),
    ];
    const groups = buildToolExecutionGroups(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0].executions).toHaveLength(1); // ONE row, not two
    const row = groups[0].executions[0];
    expect(row.toolCallId).toBe("tc-1");
    expect(row.status).toBe("completed");
    expect(row.outputKind).toBe("summary");
    expect(row.summary).toBe("3 results");
    expect(groups[0].completedCount).toBe(1);
    expect(groups[0].totalCount).toBe(1);
  });

  it("renders unpairable legacy rows as compact standalone receipts", () => {
    const messages = [
      view(MessageType.TOOL_CALL, {
        source: "chat-v2",
        toolCallId: "",
        toolName: "legacy_tool",
      }),
      view(MessageType.TOOL_RESULT, {
        source: "chat-v2",
        toolCallId: "",
        toolName: "legacy_tool",
        toolResult: { success: true },
      }),
    ];
    const groups = buildToolExecutionGroups(messages);
    const all = groups.flatMap((g) => g.executions);
    // No invented pairing: two separate legacy receipts.
    expect(all).toHaveLength(2);
    expect(all.every((e) => e.isLegacyUnpaired)).toBe(true);
  });

  it("classifies artifact and error outputs semantically", () => {
    const messages = [
      view(MessageType.TOOL_CALL, {
        source: "chat-v2",
        toolCallId: "tc-art",
        toolName: "create_html_artifact",
      }),
      view(MessageType.TOOL_RESULT, {
        source: "chat-v2",
        toolCallId: "tc-art",
        toolName: "create_html_artifact",
        artifact: {
          id: "a1",
          conversationId: "v2-c",
          type: "html",
          title: "Report",
          mimeType: "text/html",
          version: 1,
          createdAt: "",
          updatedAt: "",
        } as ChatV2MessageMetadata["artifact"],
      }),
      view(MessageType.TOOL_CALL, {
        source: "chat-v2",
        toolCallId: "tc-err",
        toolName: "web_search",
      }),
      view(MessageType.TOOL_RESULT, {
        source: "chat-v2",
        toolCallId: "tc-err",
        toolName: "web_search",
        toolResult: { success: false, error: "network" },
        toolResultStatus: "error",
        error: "network",
      }),
    ];
    const all = buildToolExecutionGroups(messages).flatMap((g) => g.executions);
    const artifactRow = all.find((e) => e.toolCallId === "tc-art");
    const errorRow = all.find((e) => e.toolCallId === "tc-err");
    expect(artifactRow?.outputKind).toBe("artifact");
    expect(errorRow?.outputKind).toBe("error");
    expect(errorRow?.status).toBe("failed");
    expect(errorRow?.isError).toBe(true);
  });

  it("keeps running groups expanded and collapses all-success history", () => {
    const runningMessages = [
      view(MessageType.MESSAGE, { source: "chat-v2" }, "assistant", "a"),
      view(MessageType.TOOL_CALL, {
        source: "chat-v2",
        toolCallId: "tc-run",
        toolName: "web_search",
      }),
    ];
    const running = buildToolExecutionGroups(runningMessages);
    expect(running[0].defaultExpanded).toBe(true);

    const doneMessages = [
      ...runningMessages,
      view(MessageType.TOOL_RESULT, {
        source: "chat-v2",
        toolCallId: "tc-run",
        toolName: "web_search",
        toolResult: { success: true },
      }),
    ];
    const done = buildToolExecutionGroups(doneMessages);
    expect(done[0].defaultExpanded).toBe(false);
  });

  it("applies live progress overlays without mutating persisted rows", () => {
    const persisted = [
      view(MessageType.TOOL_CALL, {
        source: "chat-v2",
        toolCallId: "tc-live",
        toolName: "web_search",
      }),
    ];
    const live: ChatRunDetailEvent[] = [
      {
        conversationId: "v2-c",
        runId: "run-1",
        sequence: 1,
        emittedAt: new Date(0).toISOString(),
        eventType: "tool_progress",
        payload: {
          eventType: "tool_progress",
          toolCallId: "tc-live",
          phase: "running",
          progressFraction: 0.4,
        },
      },
    ];
    const groups = buildToolExecutionGroups(persisted, live);
    const row = groups[0].executions[0];
    expect(row.progress).toBe(0.4);
    expect(row.status).toBe("running");
    // Persisted row untouched.
    expect(persisted[0].metadata?.toolProgress).toBeUndefined();
  });

  it("preserves call order within one assistant response", () => {
    const messages = [
      view(MessageType.MESSAGE, { source: "chat-v2" }, "assistant", "a"),
      view(MessageType.TOOL_CALL, { source: "chat-v2", toolCallId: "tc-b", toolName: "b" }),
      view(MessageType.TOOL_CALL, { source: "chat-v2", toolCallId: "tc-a", toolName: "a" }),
      view(MessageType.TOOL_RESULT, { source: "chat-v2", toolCallId: "tc-a", toolName: "a", toolResult: { success: true } }),
      view(MessageType.TOOL_RESULT, { source: "chat-v2", toolCallId: "tc-b", toolName: "b", toolResult: { success: true } }),
    ];
    const groups = buildToolExecutionGroups(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0].executions.map((e) => e.toolCallId)).toEqual([
      "tc-b",
      "tc-a",
    ]);
  });

  it("maps known tool names to human-readable action labels", () => {
    expect(actionLabelFor("create_html_artifact")).toContain("HTML");
    expect(actionLabelFor("unknown_tool_xyz")).toBe("");
  });
});

function planState(overrides: Partial<AIChatPlanStateView>): AIChatPlanStateView {
  return {
    planId: "plan-1",
    conversationId: "v2-c",
    status: "awaiting_approval",
    title: "Ship the feature",
    objective: "Deliver safely",
    currentVersion: 2,
    ...overrides,
  };
}

describe("selectPlanPresentation (FR-051..064)", () => {
  it("picks the latest plan state and the correct surface", () => {
    const messages = [
      view(MessageType.MESSAGE, { source: "chat-v2", planStateView: planState({ status: "approved" }) }),
      view(MessageType.MESSAGE, {
        source: "chat-v2",
        planStateView: planState({ status: "awaiting_approval" }),
      }),
    ];
    const plan = selectPlanPresentation(messages);
    expect(plan?.surface).toBe("approval");
    expect(plan?.version).toBe(2);
    expect(isPinnedSurface(plan?.surface ?? "drafting")).toBe(true);
  });

  it("pending questions take precedence over approval", () => {
    const messages = [
      view(MessageType.MESSAGE, {
        source: "chat-v2",
        planStateView: planState({
          status: "awaiting_approval",
          pendingQuestion: {
            questionId: "q1",
            planId: "plan-1",
            conversationId: "v2-c",
            status: "pending",
            questions: [
              {
                header: "Scope",
                question: "Which DB?",
                options: [{ label: "SQLite", description: "" }, { label: "Postgres", description: "" }],
              },
            ],
            createdAt: "",
          },
        }),
      }),
    ];
    const plan = selectPlanPresentation(messages);
    expect(plan?.surface).toBe("question");
    expect(plan?.pendingQuestion?.questionId).toBe("q1");
  });

  it("resolved states collapse to receipts", () => {
    for (const status of ["approved", "rejected", "cancelled", "completed"] as const) {
      const messages = [
        view(MessageType.MESSAGE, { source: "chat-v2", planStateView: planState({ status }) }),
      ];
      const plan = selectPlanPresentation(messages);
      expect(plan).not.toBeNull();
      expect(isReceiptSurface(plan!.surface)).toBe(true);
    }
  });

  it("derives step count only from validated planJson", () => {
    const messages = [
      view(MessageType.MESSAGE, {
        source: "chat-v2",
        planStateView: planState({
          latestVersion: {
            planId: "plan-1",
            version: 2,
            planMarkdown: "# Plan",
            planJson: { steps: [{}, {}, {}] },
            createdAt: "",
            createdBy: "user",
          },
        }),
      }),
    ];
    expect(selectPlanPresentation(messages)?.scopeSummary?.stepCount).toBe(3);

    const noSteps = [
      view(MessageType.MESSAGE, {
        source: "chat-v2",
        planStateView: planState({
          latestVersion: {
            planId: "plan-1",
            version: 2,
            planMarkdown: "# Plan",
            createdAt: "",
            createdBy: "user",
          },
        }),
      }),
    ];
    expect(selectPlanPresentation(noSteps)?.scopeSummary).toBeUndefined();
  });
});

describe("plan question draft", () => {
  it("moves backward/forward within bounds and toggles multi-select", () => {
    const question = {
      questionId: "q1",
      planId: "plan-1",
      conversationId: "v2-c",
      status: "pending" as const,
      questions: [
        { header: "A", question: "a?", options: [{ label: "1", description: "" }, { label: "2", description: "" }] },
        { header: "B", question: "b?", options: [{ label: "x", description: "" }] },
      ],
      createdAt: "",
    };
    let draft = createPlanQuestionDraft(question);
    expect(draft.currentIndex).toBe(0);
    draft = draftMove(draft, 1, 2);
    expect(draft.currentIndex).toBe(1);
    draft = draftMove(draft, 1, 2); // clamped at last
    expect(draft.currentIndex).toBe(1);
    draft = draftMove(draft, -1, 2);
    expect(draft.currentIndex).toBe(0);

    draft = draftToggleOption(draft, 1, true);
    draft = draftToggleOption(draft, 0, true);
    expect(draft.selectedByIndex[0]).toEqual([1, 0]);
    draft = draftToggleOption(draft, 1, true); // deselect
    expect(draft.selectedByIndex[0]).toEqual([0]);
  });
});
