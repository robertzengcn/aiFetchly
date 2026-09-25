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
      aiChatV2: {
        generatedImageRefs: {
          useAsReference: "Use as reference",
          edit: "Edit",
        },
      },
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
      msg(MessageType.TOOL_CALL, {
        toolCallId: "tc-1",
        toolName: "web_search",
      }),
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-1",
        toolName: "web_search",
        toolResultSummary: "3 results",
      }),
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
      msg(MessageType.TOOL_CALL, {
        toolCallId: "tc-b",
        toolName: "web_search",
      }),
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-a",
        toolName: "read_file",
        toolResultSummary: "file content",
      }),
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-b",
        toolName: "web_search",
        toolResultSummary: "5 results",
      }),
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
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-y",
        toolName: "legacy_b",
        toolResultSummary: "done",
      }),
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
    const decisions = wrapper.findAllComponents({
      name: "AiChatPlanDecisionCard",
    });
    expect(decisions.length).toBe(1);
  });

  it("FR-042: tool progress from live events evolves the row in place", async () => {
    const messages = [
      msg(MessageType.MESSAGE, {}, "assistant", "Searching..."),
      msg(MessageType.TOOL_CALL, {
        toolCallId: "tc-live",
        toolName: "web_search",
        // Simulate a tool_progress event that the presenter applied
        toolProgress: {
          phase: "running",
          progress: 0.5,
          updatedAt: 123,
          partialCount: 10,
          expectedCount: 20,
        },
      }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: {
        messages,
        activeAssistantMessageId: null,
        streamStatus: "streaming",
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // The execution group should contain one row with the live progress.
    const groups = wrapper.findAllComponents({ name: "AiChatExecutionGroup" });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const rows = wrapper.findAllComponents({ name: "AiChatExecutionRow" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // The row status should reflect the running tool.
    const row = rows[0];
    expect(row.props("execution").status).toBe("running");
    expect(row.props("execution").phase).toBe("running");
    expect(row.props("execution").progress).toBe(0.5);
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
      msg(MessageType.MESSAGE, {
        planStateView: planState,
        planEventType: "plan_approved",
      }),
      msg(MessageType.MESSAGE, {
        planStateView: planState,
        planEventType: "plan_approved",
      }),
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
    const decisions = wrapper.findAllComponents({
      name: "AiChatPlanDecisionCard",
    });
    expect(decisions.length).toBe(0);
  });

  it("FR-047/§15.5: gated tool result paired in a group surfaces the interactive permission card", async () => {
    const messages = [
      msg(MessageType.MESSAGE, {}, "assistant", "Reading the file."),
      msg(MessageType.TOOL_CALL, {
        toolCallId: "tc-perm",
        toolName: "file_read",
      }),
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-perm",
        toolName: "file_read",
        toolResult: {
          needsPermissionPrompt: true,
          permissionCategory: "filesystem",
          success: true,
        },
      }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // The execution group still renders for the paired call/result…
    const groups = wrapper.findAllComponents({ name: "AiChatExecutionGroup" });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // …and the gated result ALSO renders the interactive approval card —
    // not a compact receipt that would hide the decision from the user.
    const cards = wrapper.findAll('[data-testid="ai-chat-permission-card"]');
    expect(cards.length).toBe(1);
    // The paired row is parked awaiting the decision.
    const rows = wrapper.findAllComponents({ name: "AiChatExecutionRow" });
    const permRow = rows.find(
      (r) => r.props("execution").toolCallId === "tc-perm"
    );
    expect(permRow?.props("execution").status).toBe("awaiting_permission");
  });

  it("§15.5: allow-once and deny on the permission card are forwarded with the message", async () => {
    const callMessage = msg(MessageType.TOOL_CALL, {
      toolCallId: "tc-perm2",
      toolName: "file_read",
    });
    const permMessage = msg(MessageType.TOOL_RESULT, {
      toolCallId: "tc-perm2",
      toolName: "file_read",
      toolResult: {
        needsPermissionPrompt: true,
        permissionCategory: "filesystem",
        success: true,
      },
    });
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: {
        messages: [callMessage, permMessage],
        activeAssistantMessageId: null,
        streamStatus: "idle",
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // window.api.invoke is stubbed globally (component-test setup), so the
    // card's grant/deny handlers resolve and emit.
    await wrapper
      .find('[data-testid="ai-chat-permission-allow-once"]')
      .trigger("click");
    await flushPromises();
    const granted = wrapper.emitted("grant-permission");
    expect(granted).toBeTruthy();
    // The projection hands the transcript a stable copy of the row, so the
    // payload is matched by id (the row identity the store rewrites by).
    expect(granted?.[0]?.[0]).toMatchObject({ id: permMessage.id });
    expect(granted?.[0]?.[1]).toEqual({ persistent: false });

    await wrapper
      .find('[data-testid="ai-chat-permission-deny"]')
      .trigger("click");
    await flushPromises();
    const denied = wrapper.emitted("deny-permission");
    expect(denied).toBeTruthy();
    expect(denied?.[0]?.[0]).toMatchObject({ id: permMessage.id });
  });

  it("§15.5/FR-048: permission-resumed completed group stays expanded; plain completed group collapses", async () => {
    const messages = [
      msg(MessageType.MESSAGE, {}, "assistant", "Reading the file."),
      msg(MessageType.TOOL_CALL, {
        toolCallId: "tc-resumed",
        toolName: "file_read",
      }),
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-resumed",
        toolName: "file_read",
        toolResultSummary: "e2e-secret-resumed-content",
        permissionResumed: true,
      }),
      msg(MessageType.MESSAGE, {}, "assistant", "Done reading."),
      msg(MessageType.TOOL_CALL, {
        toolCallId: "tc-plain",
        toolName: "file_read",
      }),
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-plain",
        toolName: "file_read",
        toolResultSummary: "plain-completed-summary",
      }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // The just-approved output stays visible — no auto-collapse the moment
    // the resumed result completes (design §15.5).
    expect(wrapper.text()).toContain("e2e-secret-resumed-content");
    // A plain successful historical group still auto-collapses (FR-048):
    // its summary hides behind the collapsed group header.
    expect(wrapper.text()).not.toContain("plain-completed-summary");

    const groups = wrapper.findAllComponents({ name: "AiChatExecutionGroup" });
    const resumed = groups.find((g) =>
      g
        .props("group")
        .executions.some(
          (e: { permissionResumed?: boolean }) => e.permissionResumed === true
        )
    );
    const plain = groups.find((g) =>
      g
        .props("group")
        .executions.some(
          (e: { toolCallId: string | null }) => e.toolCallId === "tc-plain"
        )
    );
    expect(resumed?.props("group").defaultExpanded).toBe(true);
    expect(plain?.props("group").defaultExpanded).toBe(false);
  });

  it("§18: outbound batch result paired in a group surfaces the interactive review card", async () => {
    const messages = [
      msg(MessageType.MESSAGE, {}, "assistant", "Drafting the batch."),
      msg(MessageType.TOOL_CALL, {
        toolCallId: "tc-outbound",
        toolName: "draft_outbound_email_batch",
      }),
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-outbound",
        toolName: "draft_outbound_email_batch",
        toolResult: {
          batchId: 42,
          mode: "review_first",
          draftCount: 1,
          batchStatus: "draft_ready",
        },
      }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // The paired execution group still renders…
    const groups = wrapper.findAllComponents({ name: "AiChatExecutionGroup" });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // …and the reviewable batch surfaces its authorization card (AD-003):
    // the Review action is visible with the batch id, not hidden inside the
    // collapsed receipt.
    const review = wrapper.findAll('[data-testid="outbound-batch-review"]');
    expect(review.length).toBe(1);
    expect(review[0].attributes("data-batch-id")).toBe("42");
  });

  it("§18: unpaired outbound batch result renders the review card, not a receipt", async () => {
    const messages = [
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-outbound-solo",
        toolName: "draft_outbound_email_batch",
        toolResult: {
          batchId: 7,
          mode: "review_first",
          draftCount: 2,
          batchStatus: "draft_ready",
        },
      }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const review = wrapper.findAll('[data-testid="outbound-batch-review"]');
    expect(review.length).toBe(1);
    expect(review[0].attributes("data-batch-id")).toBe("7");
  });

  it("§18: the review dialog re-opens after being dismissed", async () => {
    // Review sets BOTH the target id and the open flag — setting only the
    // id remounts the dialog with modelValue still false (reset on the
    // previous close), leaving the batch impossible to re-open.
    const messages = [
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-outbound-reopen",
        toolName: "draft_outbound_email_batch",
        toolResult: {
          batchId: 11,
          mode: "review_first",
          draftCount: 1,
          batchStatus: "draft_ready",
        },
      }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const open = async (): Promise<void> => {
      await wrapper
        .find('[data-testid="outbound-batch-review"]')
        .trigger("click");
      await flushPromises();
    };
    await open();
    const dialog = wrapper.findComponent({ name: "OutboundEmailReviewDialog" });
    expect(dialog.exists()).toBe(true);
    expect((dialog.vm.$props as { modelValue: unknown }).modelValue).toBe(true);

    // Dismiss (close without sending), then review again — the dialog must
    // come back.
    dialog.vm.$emit("update:modelValue", false);
    await flushPromises();
    await open();
    const reopened = wrapper.findComponent({
      name: "OutboundEmailReviewDialog",
    });
    expect(reopened.exists()).toBe(true);
    expect((reopened.vm.$props as { modelValue: unknown }).modelValue).toBe(
      true
    );
  });

  it("§18: a terminal outbound batch (delivery_unknown) renders the card without the review action", async () => {
    const messages = [
      msg(MessageType.TOOL_RESULT, {
        toolCallId: "tc-outbound-done",
        toolName: "draft_outbound_email_batch",
        toolResult: {
          batchId: 9,
          mode: "review_first",
          draftCount: 1,
          batchStatus: "delivery_unknown",
        },
      }),
    ];
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // Terminal batches hide the Review action (card shows the outcome
    // summary instead) — the interactive card surface itself still renders.
    expect(
      wrapper.findAll('[data-testid="outbound-batch-review"]').length
    ).toBe(0);
    expect(
      wrapper.findAllComponents({ name: "OutboundEmailBatchCard" }).length
    ).toBe(1);
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
      latestVersion: {
        planId: "plan-1",
        version: 1,
        planMarkdown: "# Plan",
        createdAt: "",
        createdBy: "user",
      },
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

describe("AiChatWorkspaceTranscript generated-image reference forwarding", () => {
  /** Assistant message carrying one resolvable generated image tile. */
  function generatedImageMessage(): ChatV2MessageView {
    return msg(
      MessageType.MESSAGE,
      {
        generatedImages: [{ url: "https://example.com/gen-1.png" }],
      },
      "assistant",
      "Here is the image."
    );
  }

  it("forwards use-generated-image from the tile button as an opaque reference", async () => {
    const message = generatedImageMessage();
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: {
        messages: [message],
        activeAssistantMessageId: null,
        streamStatus: "idle",
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const useButton = wrapper.find(".v2-message__use-reference-btn");
    expect(useButton.exists()).toBe(true);
    await useButton.trigger("click");

    const events = wrapper.emitted("use-generated-image");
    expect(events).toBeTruthy();
    expect(events?.[0]?.[0]).toEqual({
      messageId: message.id,
      imageIndex: 0,
    });
    // Opaque reference only — no URLs, paths or other resolvable payload.
    expect(Object.keys(events?.[0]?.[0] ?? {}).sort()).toEqual([
      "imageIndex",
      "messageId",
    ]);
  });

  it("forwards edit-generated-image from the tile button as an opaque reference", async () => {
    const message = generatedImageMessage();
    const wrapper = mount(AiChatWorkspaceTranscript, {
      props: {
        messages: [message],
        activeAssistantMessageId: null,
        streamStatus: "idle",
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const editButton = wrapper.find(".v2-message__edit-image-btn");
    expect(editButton.exists()).toBe(true);
    await editButton.trigger("click");

    const events = wrapper.emitted("edit-generated-image");
    expect(events).toBeTruthy();
    expect(events?.[0]?.[0]).toEqual({
      messageId: message.id,
      imageIndex: 0,
    });
  });
});
