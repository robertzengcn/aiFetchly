import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2GeneratedImageReference,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";

/**
 * Component test for the per-image actions ("Use as reference" / "Edit")
 * rendered under each AI-generated image in an assistant message.
 *
 * The component must emit opaque references — exactly
 * `{ messageId, imageIndex }` — and must never leak `localPath`, URLs or
 * any other resolvable payload through these events.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (happy-dom environment).
 */

const TOO_LARGE_LABEL =
  "This image exceeds the size limit. Try fewer or smaller images.";
const BATCH_CANCELLED_LABEL =
  "Batch stopped. Completed results are kept; you can resume the remaining items.";
const BATCH_PARTIAL_LABEL =
  "Some batch items failed. Keep the successes and retry the failed items.";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        generated_image_alt: "AI generated image",
        open_generated_image: "Open generated image",
        generatedImageRefs: {
          useAsReference: "Use as reference",
          edit: "Edit",
          saveToWorkspace: "Save to workspace",
          stopBatch: "Stop batch",
          retryFailed: "Retry failed items ({count})",
          progressSummary:
            "{completed} of {requested} completed · concurrency {concurrency}",
          errors: {
            generated_image_too_large: TOO_LARGE_LABEL,
            generated_image_batch_cancelled: BATCH_CANCELLED_LABEL,
            generated_image_batch_partial: BATCH_PARTIAL_LABEL,
          },
        },
      },
    },
  },
});

/**
 * Build an assistant message carrying two resolvable generated images:
 * one via https URL, one via b64_json data URL.
 */
function makeTwoImageMessage(): ChatV2MessageView {
  return {
    id: "msg-gen-1",
    conversationId: "c1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: {
      source: "chat-v2",
      generatedImages: [
        { url: "https://example.com/gen-1.png" },
        { b64_json: "QUJD", mime_type: "image/png" },
      ],
    },
  } as unknown as ChatV2MessageView;
}

function mountWith(message: ChatV2MessageView) {
  return mount(AiChatV2Message, {
    props: { message },
    global: {
      plugins: [i18n],
      stubs: {
        SkillApprovalCard: true,
        AiChatV2StreamStatus: true,
        AiChatV2PlanApprovalCard: true,
        VIcon: true,
        VProgressLinear: true,
      },
    },
  });
}

function emittedRefs(
  wrapper: ReturnType<typeof mountWith>,
  event: string
): ChatV2GeneratedImageReference[] {
  const events = wrapper.emitted(event) ?? [];
  return events.map((args) => args[0] as ChatV2GeneratedImageReference);
}

describe("AiChatV2Message generated image actions", () => {
  it("renders an action row with translated labels for every generated image", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const rows = wrapper.findAll(".v2-message__image-actions");
    expect(rows.length).toBe(2);
    expect(wrapper.findAll(".v2-message__use-reference-btn").length).toBe(2);
    expect(wrapper.findAll(".v2-message__edit-image-btn").length).toBe(2);
    expect(wrapper.text()).toContain("Use as reference");
    expect(wrapper.text()).toContain("Edit");
  });

  it("shows a visible order badge of imageIndex + 1", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const badges = wrapper.findAll(".v2-message__generated-image-index");
    expect(badges.length).toBe(2);
    expect(badges[0].text()).toBe("1");
    expect(badges[1].text()).toBe("2");
  });

  it("emits use-generated-image with exact opaque references", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const useButtons = wrapper.findAll(".v2-message__use-reference-btn");
    await useButtons[0].trigger("click");
    await useButtons[1].trigger("click");

    const refs = emittedRefs(wrapper, "use-generated-image");
    expect(refs).toEqual([
      { messageId: "msg-gen-1", imageIndex: 0 },
      { messageId: "msg-gen-1", imageIndex: 1 },
    ]);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["imageIndex", "messageId"]);
      expect(ref).not.toHaveProperty("localPath");
      expect(ref).not.toHaveProperty("url");
    }
  });

  it("emits edit-generated-image with exact opaque references", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const editButtons = wrapper.findAll(".v2-message__edit-image-btn");
    await editButtons[0].trigger("click");
    await editButtons[1].trigger("click");

    const refs = emittedRefs(wrapper, "edit-generated-image");
    expect(refs).toEqual([
      { messageId: "msg-gen-1", imageIndex: 0 },
      { messageId: "msg-gen-1", imageIndex: 1 },
    ]);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["imageIndex", "messageId"]);
    }
  });

  it("renders a save-to-workspace button with an accessible label after Edit", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const saveButtons = wrapper.findAll(".v2-message__save-image-btn");
    expect(saveButtons.length).toBe(2);
    for (const btn of saveButtons) {
      expect(btn.attributes("aria-label")).toBe("Save to workspace");
      expect(btn.text()).toBe("Save to workspace");
    }

    // Ordering: Save comes after Edit within each action row.
    const rows = wrapper.findAll(".v2-message__image-actions");
    for (const row of rows) {
      const classes = row.findAll("button").map((b) => b.classes()[0]);
      expect(classes.indexOf("v2-message__save-image-btn")).toBeGreaterThan(
        classes.indexOf("v2-message__edit-image-btn")
      );
    }
  });

  it("emits save-generated-image with exact opaque references (no paths or URLs)", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const saveButtons = wrapper.findAll(".v2-message__save-image-btn");
    await saveButtons[0].trigger("click");
    await saveButtons[1].trigger("click");

    const refs = emittedRefs(wrapper, "save-generated-image");
    expect(refs).toEqual([
      { messageId: "msg-gen-1", imageIndex: 0 },
      { messageId: "msg-gen-1", imageIndex: 1 },
    ]);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["imageIndex", "messageId"]);
      expect(ref).not.toHaveProperty("localPath");
      expect(ref).not.toHaveProperty("url");
    }
  });

  it("keeps the original array index when earlier images are unresolvable", async () => {
    const message = makeTwoImageMessage();
    message.metadata = {
      ...message.metadata,
      generatedImages: [{}, { url: "https://example.com/gen-2.png" }],
    } as ChatV2MessageView["metadata"];
    const wrapper = mountWith(message);
    await flushPromises();

    // The unresolvable first entry renders no action row at all; the second
    // keeps its original index (badge "2", imageIndex 1).
    const rows = wrapper.findAll(".v2-message__image-actions");
    expect(rows.length).toBe(1);
    expect(wrapper.find(".v2-message__generated-image-index").text()).toBe("2");

    await wrapper.find(".v2-message__use-reference-btn").trigger("click");
    expect(emittedRefs(wrapper, "use-generated-image")).toEqual([
      { messageId: "msg-gen-1", imageIndex: 1 },
    ]);
  });

  it("exposes translated accessible names on both action buttons", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    for (const btn of wrapper.findAll(".v2-message__use-reference-btn")) {
      expect(btn.attributes("aria-label")).toBe("Use as reference");
    }
    for (const btn of wrapper.findAll(".v2-message__edit-image-btn")) {
      expect(btn.attributes("aria-label")).toBe("Edit");
    }
  });
});

/**
 * Build the metadata.toolResult payload exactly as the chat loop persists it
 * for a partial `process_artifact_batch` run (normalizeToolResult flattens
 * success/executionTimeMs plus the ArtifactBatchResult fields).
 */
function makePartialBatchToolResult(): Record<string, unknown> {
  return {
    success: true,
    executionTimeMs: 5231,
    status: "partial",
    processor: "image_edit",
    requestedCount: 3,
    completedCount: 1,
    failedCount: 1,
    cancelledCount: 1,
    concurrency: 3,
    items: [
      {
        input: {
          kind: "workspace_file",
          path: "/tmp/ws/photos/vacation-photo.png",
        },
        status: "completed",
        agentTaskId: "task-1",
        outputFilePaths: [],
        outputImages: [{ b64_json: "QUJDREVG", mime_type: "image/png" }],
        durationMs: 4210,
      },
      {
        input: {
          kind: "workspace_file",
          path: "/tmp/ws/photos/huge-file.tiff",
        },
        status: "failed",
        outputFilePaths: [],
        outputImages: [],
        error: TOO_LARGE_LABEL,
        errorCode: "generated_image_too_large",
        durationMs: 812,
      },
      {
        input: {
          kind: "generated_image",
          reference: { messageId: "msg-gen-1", imageIndex: 0 },
        },
        status: "cancelled",
        outputFilePaths: [],
        outputImages: [],
        error: "Batch processing was cancelled.",
        errorCode: "generated_image_batch_cancelled",
        durationMs: 0,
      },
    ],
    outputImages: [{ b64_json: "QUJDREVG", mime_type: "image/png" }],
  };
}

function makeBatchResultMessage(
  toolResult: Record<string, unknown>
): ChatV2MessageView {
  return {
    id: "msg-tool-batch-1",
    conversationId: "c1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    messageType: MessageType.TOOL_RESULT,
    metadata: {
      source: "chat-v2",
      toolCallId: "call-batch-1",
      toolName: "process_artifact_batch",
      toolResult,
      success: true,
    },
  } as unknown as ChatV2MessageView;
}

describe("AiChatV2Message artifact batch progress", () => {
  it("renders the aggregate summary line with counts, concurrency and overall status", async () => {
    const wrapper = mountWith(
      makeBatchResultMessage(makePartialBatchToolResult())
    );
    await flushPromises();

    const summary = wrapper.find(".v2-message__batch-summary");
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain("1 of 3 completed");
    expect(summary.text()).toContain("concurrency 3");
    expect(wrapper.find(".v2-message__batch-status").text()).toBe("partial");
  });

  it("lists failed and cancelled items with safe labels and translated errors in an expandable section", async () => {
    const wrapper = mountWith(
      makeBatchResultMessage(makePartialBatchToolResult())
    );
    await flushPromises();

    const failures = wrapper.find(".v2-message__batch-failures");
    expect(failures.exists()).toBe(true);
    // Expandable: opening it reveals the per-item rows.
    expect((failures.element as HTMLDetailsElement).open).toBe(false);
    await failures.find("summary").trigger("click");
    expect((failures.element as HTMLDetailsElement).open).toBe(true);

    const rows = wrapper.findAll(".v2-message__batch-failure-row");
    expect(rows.length).toBe(2);

    const firstLabel = rows[0].find(".v2-message__batch-item-label").text();
    expect(firstLabel).toBe("huge-file.tiff");
    expect(firstLabel).not.toContain("/tmp");
    expect(rows[0].find(".v2-message__batch-error").text()).toBe(
      TOO_LARGE_LABEL
    );

    const secondLabel = rows[1].find(".v2-message__batch-item-label").text();
    expect(secondLabel).toBe("#3");
    expect(secondLabel).not.toContain("/");
    expect(rows[1].find(".v2-message__batch-error").text()).toBe(
      BATCH_CANCELLED_LABEL
    );
  });

  it("never renders absolute paths or base64 bytes from the batch result", async () => {
    const wrapper = mountWith(
      makeBatchResultMessage(makePartialBatchToolResult())
    );
    await flushPromises();

    const text = wrapper.text();
    expect(text).not.toContain("/tmp");
    expect(text).not.toContain("/ws/");
    expect(text).not.toContain("QUJDREVG");
    expect(text).not.toContain("b64_json");
    // Completed items are not failure rows.
    expect(text).not.toContain("vacation-photo.png");
  });

  it("renders no failures section for a fully completed batch", async () => {
    const toolResult = makePartialBatchToolResult();
    const wrapper = mountWith(
      makeBatchResultMessage({
        ...toolResult,
        status: "completed",
        requestedCount: 1,
        completedCount: 1,
        failedCount: 0,
        cancelledCount: 0,
        items: [(toolResult.items as unknown[])[0]],
      })
    );
    await flushPromises();

    expect(wrapper.find(".v2-message__batch-summary").text()).toContain(
      "1 of 1 completed"
    );
    expect(wrapper.find(".v2-message__batch-failures").exists()).toBe(false);
  });

  it("renders nothing for non-batch tool results", async () => {
    const attachMessage = {
      id: "msg-tool-attach-1",
      conversationId: "c1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      messageType: MessageType.TOOL_RESULT,
      metadata: {
        source: "chat-v2",
        toolCallId: "call-attach-1",
        toolName: "attach_local_images",
        toolResult: { success: true },
        success: true,
      },
    } as unknown as ChatV2MessageView;
    const attachWrapper = mountWith(attachMessage);
    await flushPromises();
    expect(attachWrapper.find(".v2-message__batch-progress").exists()).toBe(
      false
    );

    const plainWrapper = mountWith(makeTwoImageMessage());
    await flushPromises();
    expect(plainWrapper.find(".v2-message__batch-progress").exists()).toBe(
      false
    );
  });

  it("renders nothing when a batch tool result is malformed", async () => {
    const malformedWrapper = mountWith(
      makeBatchResultMessage({
        success: false,
        error: "Provide either `files` or `generatedImageReferences`.",
      })
    );
    await flushPromises();
    expect(malformedWrapper.find(".v2-message__batch-progress").exists()).toBe(
      false
    );
    expect(malformedWrapper.find(".v2-message__batch-summary").exists()).toBe(
      false
    );
  });

  /**
   * Mixed partial batch: one workspace completed, one workspace failed, one
   * generated failed, one generated cancelled — plus the instruction echo.
   * Retry must resubmit ONLY the failed/cancelled generated references, in
   * input order, with the shared instruction.
   */
  function makeRetryableBatchToolResult(): Record<string, unknown> {
    return {
      success: true,
      executionTimeMs: 9000,
      status: "partial",
      processor: "image_edit",
      requestedCount: 4,
      completedCount: 1,
      failedCount: 2,
      cancelledCount: 1,
      concurrency: 3,
      instruction: "make the lighting warmer",
      items: [
        {
          input: {
            kind: "workspace_file",
            path: "/tmp/ws/photos/vacation-photo.png",
          },
          status: "completed",
          outputFilePaths: ["/tmp/ws/out/1.png"],
          outputImages: [],
          durationMs: 4000,
        },
        {
          input: { kind: "workspace_file", path: "/tmp/ws/photos/bad.tiff" },
          status: "failed",
          outputFilePaths: [],
          outputImages: [],
          error: TOO_LARGE_LABEL,
          errorCode: "generated_image_too_large",
          durationMs: 500,
        },
        {
          input: {
            kind: "generated_image",
            reference: { messageId: "msg-gen-9", imageIndex: 0 },
          },
          status: "failed",
          outputImages: [],
          error: "provider error",
          errorCode: "image_edit_provider_failed",
          durationMs: 1200,
        },
        {
          input: {
            kind: "generated_image",
            reference: { messageId: "msg-gen-4", imageIndex: 2 },
          },
          status: "cancelled",
          outputImages: [],
          error: "Batch processing was cancelled.",
          errorCode: "generated_image_batch_cancelled",
          durationMs: 0,
        },
      ],
    };
  }

  it("renders Retry failed with the generated retryable count and emits exact refs plus instruction", async () => {
    const wrapper = mountWith(
      makeBatchResultMessage(makeRetryableBatchToolResult())
    );
    await flushPromises();

    const retry = wrapper.find(".v2-message__batch-retry");
    expect(retry.exists()).toBe(true);
    // Only failed+cancelled GENERATED items count (2), not the workspace file.
    expect(retry.text()).toContain("Retry failed items (2)");
    expect(retry.attributes("aria-label")).toContain("Retry failed items");

    await retry.trigger("click");
    const events = wrapper.emitted("retry-generated-image-batch") ?? [];
    expect(events.length).toBe(1);
    const payload = events[0][0] as {
      references: ChatV2GeneratedImageReference[];
      instruction: string;
    };
    // Input order preserved; workspace failure and completed items excluded.
    expect(payload.references).toEqual([
      { messageId: "msg-gen-9", imageIndex: 0 },
      { messageId: "msg-gen-4", imageIndex: 2 },
    ]);
    expect(payload.instruction).toBe("make the lighting warmer");
    // Payload stays opaque — no paths or URLs ride along.
    expect(JSON.stringify(payload)).not.toContain("/tmp");
  });

  it("omits the retry action for fully completed batches", async () => {
    const toolResult = makeRetryableBatchToolResult();
    const wrapper = mountWith(
      makeBatchResultMessage({
        ...toolResult,
        status: "completed",
        completedCount: 4,
        failedCount: 0,
        cancelledCount: 0,
        instruction: "make the lighting warmer",
        items: (toolResult.items as unknown[]).map((item) => ({
          ...(item as Record<string, unknown>),
          status: "completed",
        })),
      })
    );
    await flushPromises();
    expect(wrapper.find(".v2-message__batch-retry").exists()).toBe(false);
  });

  it("omits the retry action when only workspace-file inputs failed", async () => {
    // Workspace-only failure set: the completed + failed workspace items with
    // the generated cancelled item removed.
    const toolResult = makePartialBatchToolResult();
    const workspaceOnly = {
      ...toolResult,
      items: [
        (toolResult.items as unknown[])[0],
        (toolResult.items as unknown[])[1],
      ],
      requestedCount: 2,
      cancelledCount: 0,
    };
    const workspaceWrapper = mountWith(makeBatchResultMessage(workspaceOnly));
    await flushPromises();
    expect(workspaceWrapper.find(".v2-message__batch-retry").exists()).toBe(
      false
    );
  });

  it("omits the retry action when the instruction echo is missing", async () => {
    const toolResult = makeRetryableBatchToolResult();
    const wrapper = mountWith(
      makeBatchResultMessage({
        ...toolResult,
        instruction: undefined,
      })
    );
    await flushPromises();
    expect(wrapper.find(".v2-message__batch-retry").exists()).toBe(false);
  });

  it("renders Stop while the batch tool is pending and emits stop-batch on click", async () => {
    const wrapper = mountWith({
      id: "msg-tool-batch-pending",
      conversationId: "c1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      messageType: MessageType.TOOL_RESULT,
      metadata: {
        source: "chat-v2",
        toolCallId: "call-batch-pending",
        toolName: "process_artifact_batch",
        toolResult: { executionPending: true },
        success: true,
      },
    } as unknown as ChatV2MessageView);
    await flushPromises();

    const stop = wrapper.find(".v2-message__batch-stop");
    expect(stop.exists()).toBe(true);
    expect(stop.text()).toContain("Stop batch");
    expect(stop.attributes("aria-label")).toBe("Stop batch");

    await stop.trigger("click");
    expect(wrapper.emitted("stop-batch")?.length).toBe(1);
  });

  it("renders Stop on the batch TOOL_CALL card while live progress streams", async () => {
    // The async batch job runs between the tool_call card and its result; the
    // tool_call card carries live toolProgress and must expose Stop there.
    const wrapper = mountWith({
      id: "msg-tool-batch-call",
      conversationId: "c1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      messageType: MessageType.TOOL_CALL,
      metadata: {
        source: "chat-v2",
        toolCallId: "call-batch-call",
        toolName: "process_artifact_batch",
        toolArguments: { instruction: "warm" },
        toolProgress: {
          phase: "running",
          message: "processing completed=1",
          progress: 0.25,
          partialCount: 1,
          expectedCount: 4,
          updatedAt: Date.now(),
        },
      },
    } as unknown as ChatV2MessageView);
    await flushPromises();

    const stop = wrapper.find(".v2-message__batch-stop");
    expect(stop.exists()).toBe(true);
    expect(stop.text()).toContain("Stop batch");
    // The card-level disabled prop mirrors isStreaming — exactly the state in
    // which Stop must stay clickable — so the button must NOT be disabled.
    expect((stop.element as HTMLButtonElement).disabled).toBe(false);

    await stop.trigger("click");
    expect(wrapper.emitted("stop-batch")?.length).toBe(1);
  });

  it("hides Stop on a batch tool_call card without live progress", async () => {
    const wrapper = mountWith({
      id: "msg-tool-batch-call-idle",
      conversationId: "c1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      messageType: MessageType.TOOL_CALL,
      metadata: {
        source: "chat-v2",
        toolCallId: "call-batch-call-idle",
        toolName: "process_artifact_batch",
        toolArguments: { instruction: "warm" },
      },
    } as unknown as ChatV2MessageView);
    await flushPromises();
    expect(wrapper.find(".v2-message__batch-stop").exists()).toBe(false);
  });

  it("hides Stop once the batch result settles and on non-batch tool cards", async () => {
    const settledWrapper = mountWith(
      makeBatchResultMessage(makeRetryableBatchToolResult())
    );
    await flushPromises();
    expect(settledWrapper.find(".v2-message__batch-stop").exists()).toBe(false);

    const otherPending = mountWith({
      id: "msg-tool-other-pending",
      conversationId: "c1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      messageType: MessageType.TOOL_RESULT,
      metadata: {
        source: "chat-v2",
        toolCallId: "call-other",
        toolName: "attach_local_images",
        toolResult: { executionPending: true },
        success: true,
      },
    } as unknown as ChatV2MessageView);
    await flushPromises();
    expect(otherPending.find(".v2-message__batch-stop").exists()).toBe(false);
  });
});
