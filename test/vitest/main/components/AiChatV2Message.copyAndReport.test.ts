import { describe, expect, it, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

/**
 * Component tests for the per-assistant-output actions row: the copy
 * button and the compact (icon-only) report button.
 *
 * Must run under the dedicated happy-dom config:
 *   yarn vitest --config test/vitest/main/components/vitest.config.mjs run \
 *       test/vitest/main/components/AiChatV2Message.copyAndReport.test.ts
 */
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        copy_message: "Copy message",
        copied: "Copied",
        copy_message_aria: "Copy this AI response",
      },
      aiContentReport: {
        action: "Report AI output",
        actionAriaLabel: "Report this AI-generated output",
        reported: "Reported",
      },
    },
  },
});

// Vuetify is not registered in the component-test config, so stub VBtn as a
// real <button> that honours `disabled` and forwards `title`/`aria-label`,
// and VIcon as an inline stub. The real AIContentReportButton renders
// through these stubs so we can assert its compact/icon-only output.
const VBtn = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
    title: { type: String, default: undefined },
    ariaLabel: { type: String, default: undefined },
    icon: { type: [Boolean, String], default: false },
  },
  setup(_, { attrs, slots }) {
    return { attrs, slots };
  },
  template: `<button :disabled="disabled" :title="title" :aria-label="ariaLabel"><slot /></button>`,
});
const VIcon = { template: "<i><slot /></i>" };

function makeAssistantMessage(content = "Final answer."): ChatV2MessageView {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: { source: "chat-v2" },
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
        VBtn,
        VIcon,
      },
    },
  });
}

describe("AiChatV2Message actions row (copy + report)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the actions row on a completed assistant text message", async () => {
    const wrapper = mountWith(makeAssistantMessage());
    await flushPromises();
    expect(wrapper.find(".v2-message__actions").exists()).toBe(true);
  });

  it("renders the report button as icon-only (no 'Report AI output' text)", async () => {
    const wrapper = mountWith(makeAssistantMessage());
    await flushPromises();
    const reportBtn = wrapper.find('[data-testid="ai-content-report-btn"]');
    expect(reportBtn.exists()).toBe(true);
    // Compact mode: visible label is hidden, only the icon shows.
    expect(reportBtn.text()).not.toContain("Report AI output");
    // Accessible name is preserved via aria-label.
    expect(
      (reportBtn.element as HTMLButtonElement).getAttribute("aria-label")
    ).toBe("Report this AI-generated output");
  });

  it("renders a copy button next to the report button", async () => {
    const wrapper = mountWith(makeAssistantMessage());
    await flushPromises();
    const copyBtn = wrapper.find('[data-testid="copy-message-btn"]');
    expect(copyBtn.exists()).toBe(true);
    expect(
      (copyBtn.element as HTMLButtonElement).getAttribute("aria-label")
    ).toBe("Copy this AI response");
  });

  it("copies the plain text to the clipboard and shows confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const wrapper = mountWith(makeAssistantMessage("<b>Hello</b> world"));
    await flushPromises();

    await wrapper.find('[data-testid="copy-message-btn"]').trigger("click");
    await flushPromises();

    // HTML is stripped — only plain text is copied.
    expect(writeText).toHaveBeenCalledWith("Hello world");
    // Icon flips to the check mark while copied is true.
    const icon = wrapper.find('[data-testid="copy-message-btn"] i');
    expect(icon.text()).toContain("mdi-check");
  });

  it("falls back to execCommand when the async clipboard API is unavailable", async () => {
    // Remove the async clipboard API so the fallback path is taken.
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    // happy-dom does not define document.execCommand; install a mock so the
    // fallback path in onCopy() can exercise it.
    const execSpy = vi.fn().mockReturnValue(true);
    document.execCommand = execSpy as unknown as typeof document.execCommand;
    const wrapper = mountWith(makeAssistantMessage("Plain text"));
    await flushPromises();

    await wrapper.find('[data-testid="copy-message-btn"]').trigger("click");
    await flushPromises();

    expect(execSpy).toHaveBeenCalledWith("copy");
    const icon = wrapper.find('[data-testid="copy-message-btn"] i');
    expect(icon.text()).toContain("mdi-check");
  });

  it("omits the actions row while the assistant turn is still streaming", async () => {
    const wrapper = mountWith(makeAssistantMessage());
    await wrapper.setProps({ status: "streaming" });
    await flushPromises();
    expect(wrapper.find(".v2-message__actions").exists()).toBe(false);
  });
});
