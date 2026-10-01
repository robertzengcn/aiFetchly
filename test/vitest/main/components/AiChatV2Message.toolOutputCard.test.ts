import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

/**
 * Result-card tests for preserved tool output.
 *
 * The distinction these lock down is the product's most important one: a
 * storage failure must be shown as "the output could not be saved" while the
 * tool status stays SUCCESSFUL, because "the command ran but its output was
 * not kept" is a different fact from "the command failed".
 */

const exportToolOutput = vi.fn();
const getToolOutput = vi.fn();
vi.mock("@/views/api/aiToolResult", () => ({
  getToolOutput: (...args: unknown[]) => getToolOutput(...args),
  readToolOutput: vi.fn(),
  searchToolOutput: vi.fn(),
  exportToolOutput: (...args: unknown[]) => exportToolOutput(...args),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        tool_result_title: "Tool Result",
        tool_name: "Tool",
        toolOutput: {
          saved: "Full output saved",
          partial: "Part of the output was saved",
          unavailable: "The full output could not be saved",
          preview_label: "Preview only — not the whole result",
          view: "View full result",
          export: "Export result",
          size: "Saved size",
          source_incomplete: "The tool itself stopped early",
        },
      },
    },
  },
});

const OUTPUT_ID = "out_0123456789abcdef0123456789abcdef";

function makeMessage(
  metadata: Record<string, unknown>,
  content = ""
): ChatV2MessageView {
  return {
    id: "m1",
    conversationId: "conv-1",
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    messageType: MessageType.TOOL_RESULT,
    metadata: {
      source: "chat-v2",
      toolCallId: "tc1",
      toolName: "scrape_businesses",
      success: true,
      ...metadata,
    },
  } as unknown as ChatV2MessageView;
}

function mountCard(metadata: Record<string, unknown>, content = "") {
  return mount(AiChatV2Message, {
    props: {
      message: makeMessage(metadata, content),
      disabled: false,
    },
    global: {
      plugins: [i18n],
      stubs: {
        "v-btn": {
          props: ["disabled"],
          emits: ["click"],
          template:
            '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        "v-icon": true,
        "v-alert": { template: "<div><slot /></div>" },
        "v-text-field": { template: "<div />" },
      },
    },
  });
}

describe("AiChatV2Message — preserved output card", () => {
  beforeEach(() => {
    // Default: main reports the viewer as enabled.
    getToolOutput.mockReset();
    getToolOutput.mockResolvedValue({
      outputId: OUTPUT_ID,
      viewerEnabled: true,
      state: "committed",
      preservation: "complete",
      sourceCompleteness: "complete",
      capturedBytes: 2048,
      format: "json",
      mediaType: "application/json",
      toolName: "scrape_businesses",
    });
  });

  it("shows no card for an ordinary inline result (AC-01)", () => {
    const wrapper = mountCard({ summary: "Found 3 businesses" });
    expect(wrapper.find('[data-testid="tool-output-card"]').exists()).toBe(false);
  });

  it("shows the saved state, size, and actions for a preserved output", () => {
    const wrapper = mountCard({
      toolResult: {},
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 2048,
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "complete",
    });
    const card = wrapper.find('[data-testid="tool-output-card"]');
    expect(card.exists()).toBe(true);
    expect(wrapper.find('[data-testid="tool-output-state"]').text()).toBe(
      "Full output saved"
    );
    expect(wrapper.find('[data-testid="tool-output-meta"]').text()).toContain("2.0 KB");
    expect(wrapper.find('[data-testid="tool-output-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tool-output-export"]').exists()).toBe(true);
  });

  it("says 'partial', never 'saved', when the capture is incomplete", () => {
    const wrapper = mountCard({
      toolResult: {},
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 1024,
          preservation: "partial",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "partial",
    });
    const state = wrapper.find('[data-testid="tool-output-state"]').text();
    expect(state).toBe("Part of the output was saved");
    // A partial capture must never claim the full output was saved.
    expect(state).not.toBe("Full output saved");
  });

  it("reports an unavailable output WITHOUT marking the tool as failed (AC-12)", () => {
    const message = makeMessage({
      toolResult: {},
      toolOutputRefs: [],
      toolOutputPreservation: "unavailable",
      storageErrorCode: "OUTPUT_DISK_FULL",
      success: true,
    });
    const wrapper = mountCard({
      toolResult: {},
      toolOutputRefs: [],
      toolOutputPreservation: "unavailable",
      storageErrorCode: "OUTPUT_DISK_FULL",
      success: true,
    });
    const state = wrapper.find('[data-testid="tool-output-state"]').text();
    expect(state).toBe("The full output could not be saved");
    // The tool itself still succeeded: the command ran, only its output was
    // not kept, and the two must not be conflated.
    expect(message.metadata?.success).toBe(true);
  });

  it("surfaces producer truncation separately from our own capture state", () => {
    const wrapper = mountCard({
      toolResult: {},
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 4096,
          preservation: "complete",
          sourceCompleteness: "partial",
        },
      ],
      toolOutputPreservation: "complete",
    });
    const state = wrapper.find('[data-testid="tool-output-state"]').text();
    expect(state).toContain("Full output saved");
    // The producer's own truncation is disclosed, not conflated.
    expect(state).toContain("The tool itself stopped early");
  });

  it("labels the preview as a preview, not the whole result", () => {
    const wrapper = mountCard({
      toolResult: {},
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 8192,
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "complete",
      toolOutputPreview: "2400 records. Fields: name, city",
    });
    const preview = wrapper.find('[data-testid="tool-output-preview"]');
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain("Preview only");
    expect(preview.text()).toContain("2400 records");
  });

  it("exports through the validated save flow", async () => {
    exportToolOutput.mockResolvedValue({ status: "exported" });
    const wrapper = mountCard({
      toolResult: {},
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 2048,
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "complete",
    });
    await wrapper.find('[data-testid="tool-output-export"]').trigger("click");
    await flushPromises();
    expect(exportToolOutput).toHaveBeenCalledWith("conv-1", OUTPUT_ID);
  });

  it("opens the paged viewer on demand and not before", async () => {
    const wrapper = mountCard({
      toolResult: {},
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 2048,
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "complete",
    });
    await flushPromises();
    // Not mounted until the user asks for it.
    expect(wrapper.find('[data-testid="tool-output-viewer"]').exists()).toBe(false);
    await wrapper.find('[data-testid="tool-output-view"]').trigger("click");
    await flushPromises();
    expect(wrapper.findComponent({ name: "AiChatToolResultViewer" }).exists()).toBe(
      true
    );
  });

  // ---- `ui` rollout flag (audit T13) ----

  it("does not open the viewer when main reports it disabled", async () => {
    // The gate is resolved in MAIN, not the renderer: disabling `ui` must
    // actually withhold the viewer rather than leave a dead flag.
    getToolOutput.mockResolvedValue({
      outputId: OUTPUT_ID,
      viewerEnabled: false,
      state: "committed",
      preservation: "complete",
      sourceCompleteness: "complete",
      capturedBytes: 2048,
      format: "json",
      mediaType: "application/json",
      toolName: "scrape_businesses",
    });
    const wrapper = mountCard({
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 2048,
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "complete",
    });
    await flushPromises();

    await wrapper.find('[data-testid="tool-output-view"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.findComponent({ name: "AiChatToolResultViewer" }).exists()
    ).toBe(false);
    // The bounded card and export are unaffected: `ui` gates the viewer only.
    expect(wrapper.find('[data-testid="tool-output-export"]').exists()).toBe(true);
  });

  it("does not open the viewer when the descriptor is unavailable", async () => {
    // A missing descriptor means the output is gone or unauthorized; opening an
    // empty viewer would be worse than not opening one.
    getToolOutput.mockResolvedValue(null);
    const wrapper = mountCard({
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 2048,
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "complete",
    });
    await flushPromises();

    await wrapper.find('[data-testid="tool-output-view"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.findComponent({ name: "AiChatToolResultViewer" }).exists()
    ).toBe(false);
  });

  it("closes an open viewer when the button is pressed again", async () => {
    const wrapper = mountCard({
      toolOutputRefs: [
        {
          outputId: OUTPUT_ID,
          capturedBytes: 2048,
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      toolOutputPreservation: "complete",
    });
    await flushPromises();

    await wrapper.find('[data-testid="tool-output-view"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "AiChatToolResultViewer" }).exists()
    ).toBe(true);

    await wrapper.find('[data-testid="tool-output-view"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "AiChatToolResultViewer" }).exists()
    ).toBe(false);
  });
});
