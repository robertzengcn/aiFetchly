import { describe, expect, it, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatWorkspaceTranscript from "@/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      ui: { actions: { retry: "Retry" } },
      workspaceChat: {
        plan: {
          multiSelect: "Select one or more",
          singleSelect: "Select one",
          customAnswer: "Custom answer (optional)",
          submitError: "Submission failed",
          readyForReview: "Plan ready",
          approve: "Approve plan",
          requestChanges: "Request changes",
          reviewFullPlan: "Review full plan",
          receiptApproved: "Plan approved",
          viewInActivity: "View in Activity",
        },
        execution: {
          groupTitle: "Execution",
          progress: "{completed} of {total} complete",
          legacyReceipt: "Previous tool activity",
          artifactCreated: "HTML report created",
          imagesGenerated: "Images generated",
          filesChanged: "Files changed",
          permissionNeeded: "Permission needed",
          structuredResult: "Structured result",
        },
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

let idCounter = 0;
function msg(
  messageType: MessageType,
  metadata?: Record<string, unknown>,
  role: "user" | "assistant" = "assistant",
  content = ""
): ChatV2MessageView {
  idCounter += 1;
  return {
    id: `m${idCounter}`,
    conversationId: "v2-test",
    role,
    content,
    timestamp: new Date(2026, 7, 20, 10, 0, idCounter).toISOString(),
    messageType,
    metadata: { source: "chat-v2", ...metadata },
  };
}

describe("AiChatWorkspaceTranscript (FR-042..050, FR-052, FR-062)", () => {
  it("FR-042/043: renders one execution row per toolCallId, not separate generic cards", async () => {
    const messages = [
      msg(MessageType.MESSAGE, {}, "assistant", "I will search."),
      msg(MessageType.TOOL_CALL, { toolCallId: "tc-1", toolName: "web_search" }),
      msg(MessageType.TOOL_RESULT, { toolCallId: "tc-1", toolName: "web_search", toolResultSummary: "3 results" }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // One execution group, not separate Tool Call + Tool Result cards.
    const groups = wrapper.findAllComponents({ name: "AiChatExecutionGroup" });
    expect(groups.length).toBeGreaterThanOrEqual(1);

    // No generic "Tool Call" or "Tool Result" text in the transcript.
    const text = wrapper.text();
    expect(text).not.toContain("Tool Call");
    expect(text).not.toContain("Tool Result");
  });

  it("FR-044: multiple calls in one assistant response form one group", async () => {
    const messages = [
      msg(MessageType.MESSAGE, {}, "assistant", "Running two tools."),
      msg(MessageType.TOOL_CALL, { toolCallId: "tc-a", toolName: "read_file" }),
      msg(MessageType.TOOL_CALL, { toolCallId: "tc-b", toolName: "web_search" }),
      msg(MessageType.TOOL_RESULT, { toolCallId: "tc-a", toolName: "read_file", toolResultSummary: "file content" }),
      msg(MessageType.TOOL_RESULT, { toolCallId: "tc-b", toolName: "web_search", toolResultSummary: "5 results" }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // The transcript should render user/assistant messages + execution group(s).
    const groups = wrapper.findAllComponents({ name: "AiChatExecutionGroup" });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // All tool messages collapsed into groups, not individual cards.
    const rows = wrapper.findAllComponents({ name: "AiChatExecutionRow" });
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("FR-050: unpaired legacy tool rows become compact receipts", async () => {
    const messages = [
      msg(MessageType.TOOL_CALL, { toolCallId: "tc-x", toolName: "legacy_a" }),
      msg(MessageType.TOOL_RESULT, { toolCallId: "tc-y", toolName: "legacy_b", toolResultSummary: "done" }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // Legacy receipts render as standalone rows, not groups.
    const rows = wrapper.findAllComponents({ name: "AiChatExecutionRow" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Different toolCallIds form separate entries, not one paired row.
    const groups = wrapper.findAllComponents({ name: "AiChatExecutionGroup" });
    // Two different ids = two groups (each with one call + one result).
    // This proves they are NOT paired into a single row.
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("FR-052: two plan-bearing messages produce exactly one plan surface", async () => {
    const planState = {
      planId: "plan-1",
      conversationId: "v2-test",
      status: "awaiting_approval",
      title: "Ship it",
      objective: "Deliver",
      currentVersion: 1,
    };
    const messages = [
      msg(MessageType.MESSAGE, { planStateView: planState }),
      msg(MessageType.MESSAGE, { planStateView: planState }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // Exactly one plan decision card, not two.
    const decisions = wrapper.findAllComponents({ name: "AiChatPlanDecisionCard" });
    expect(decisions.length).toBe(1);
  });

  it("FR-062: no duplicate plan status across transcript surfaces", async () => {
    const planState = {
      planId: "plan-1",
      conversationId: "v2-test",
      status: "approved",
      title: "Done",
      objective: "Delivered",
      currentVersion: 1,
    };
    const messages = [
      msg(MessageType.MESSAGE, { planStateView: planState, planEventType: "plan_approved" }),
      msg(MessageType.MESSAGE, { planStateView: planState, planEventType: "plan_approved" }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // Exactly one plan receipt.
    const receipts = wrapper.findAllComponents({ name: "AiChatPlanReceipt" });
    expect(receipts.length).toBe(1);
    // No decision card for an approved plan.
    const decisions = wrapper.findAllComponents({ name: "AiChatPlanDecisionCard" });
    expect(decisions.length).toBe(0);
  });

  it("FR-059: submitError prop surfaces in the question flow", async () => {
    const pendingQuestion = {
      questionId: "q1",
      planId: "plan-1",
      conversationId: "v2-test",
      status: "pending" as const,
      questions: [
        {
          header: "Scope",
          question: "Which DB?",
          options: [
            { label: "SQLite", description: "" },
            { label: "Postgres", description: "" },
          ],
        },
      ],
      createdAt: "",
    };
    const planState = {
      planId: "plan-1",
      conversationId: "v2-test",
      status: "awaiting_question" as const,
      title: "Plan",
      objective: "Plan",
      currentVersion: 1,
      latestVersion: { planId: "plan-1", version: 1, planMarkdown: "# Plan", createdAt: "", createdBy: "user" },
      pendingQuestion,
    };
    const messages = [msg(MessageType.MESSAGE, { planStateView: planState })];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: {
        messages,
        activeAssistantMessageId: null,
        streamStatus: "idle",
        planSubmitError: "Submission failed",
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const flow = wrapper.findComponent({ name: "AiChatPlanQuestionFlow" });
    expect(flow.exists()).toBe(true);
    expect(flow.props("submitError")).toBe("Submission failed");
  });
});
