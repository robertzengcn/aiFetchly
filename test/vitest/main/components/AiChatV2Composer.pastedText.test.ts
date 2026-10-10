import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import { listSlashCommands } from "@/views/api/slashCommands";
import { listAtMentionSuggestions } from "@/views/api/aiChatAtMentions";

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/api/aiChatAtMentions", () => ({
  listAtMentionSuggestions: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        input_placeholder: "Send a message",
        send: "Send",
        stop: "Stop",
        pastedText: {
          chip_label: "Pasted text #{id} · {lines} lines",
          truncated_chip_label: "Truncated pasted text #{id} · {lines} lines",
          view_content: "View pasted content",
          hide_content: "Hide pasted content",
          removed: "Removed pasted content",
          loading: "Loading pasted content...",
          missing_contents:
            "Pasted text is no longer available. Please paste it again.",
        },
        atMentions: {
          ariaLabel: "Mention workspace files",
          directory: "dir",
          file: "file",
        },
        attachments: {
          add: "Attach file",
          unsupported: "{name} is not supported.",
          too_large: "{name} is too large.",
        },
      },
      slashCommands: {
        aria_label: "Slash commands",
        sourceBuiltin: "Built-in",
      },
    },
  },
});

const TextareaStub = defineComponent({
  name: "VTextarea",
  props: {
    modelValue: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue", "keydown", "input", "keyup", "click", "paste"],
  template:
    '<textarea data-testid="ai-chat-composer" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event)" @keydown="$emit(\'keydown\', $event)" @keyup="$emit(\'keyup\', $event)" @click="$emit(\'click\', $event)" @paste="$emit(\'paste\', $event)" />',
});

const ButtonStub = defineComponent({
  name: "VBtn",
  emits: ["click"],
  template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

const SlideStub = defineComponent({
  name: "VSlideYReverseTransition",
  template: "<div><slot /></div>",
});

function mountComposer(
  props: { conversationId?: string | null } = {}
) {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: false,
      isProcessing: false,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VTextarea: TextareaStub,
        VBtn: ButtonStub,
        VIcon: true,
        VChip: true,
        VSlideYReverseTransition: SlideStub,
      },
    },
  });
}

describe("AiChatV2Composer pasted text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSlashCommands).mockResolvedValue({
      status: true,
      commands: [],
      diagnostics: [],
      msg: "",
    });
    vi.mocked(listAtMentionSuggestions).mockResolvedValue({
      suggestions: [],
      workspaceRequired: false,
      truncated: false,
    });
  });

  it("collapses large pasted text and emits pastedContents on send", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.find<HTMLTextAreaElement>(
      '[data-testid="ai-chat-composer"]'
    );

    const partA = "A".repeat(200);
    const partB = "B".repeat(200);
    const partC = "C".repeat(200);
    const raw = `${partA}\n${partB}\n${partC}`; // 602 chars, 2 newlines

    // Ensure the caret is at the start so paste inserts at index 0.
    textarea.element.setSelectionRange(0, 0);

    await textarea.trigger("paste", {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: () => raw,
      },
    });

    // Paste should have replaced the draft content with a short placeholder.
    expect(textarea.element.value).toBe("[Pasted text #1 +2 lines]");

    // Press Enter to send.
    await textarea.trigger("keydown", {
      key: "Enter",
      shiftKey: false,
      preventDefault: vi.fn(),
    });

    const sendEvents = wrapper.emitted("send");
    expect(sendEvents).toHaveLength(1);

    // send(text, files, options?)
    expect(sendEvents![0][0]).toBe("[Pasted text #1 +2 lines]");
    expect(sendEvents![0][1]).toEqual([]);
    expect(sendEvents![0][2]).toEqual(
      expect.objectContaining({
        pastedContents: {
          "1": raw,
        },
        onAccepted: expect.any(Function),
      })
    );
  });

  it("keeps pastedContents after conversationId changes while the draft still has a paste ref", async () => {
    const wrapper = mountComposer({ conversationId: null });
    const textarea = wrapper.find<HTMLTextAreaElement>(
      '[data-testid="ai-chat-composer"]'
    );

    const raw = `${"A".repeat(200)}\n${"B".repeat(200)}\n${"C".repeat(200)}`;
    textarea.element.setSelectionRange(0, 0);
    await textarea.trigger("paste", {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: () => raw,
      },
    });
    expect(textarea.element.value).toBe("[Pasted text #1 +2 lines]");

    await wrapper.setProps({ conversationId: "v2-new-conversation" });

    await textarea.trigger("keydown", {
      key: "Enter",
      shiftKey: false,
      preventDefault: vi.fn(),
    });

    const sendEvents = wrapper.emitted("send");
    expect(sendEvents).toHaveLength(1);
    expect(sendEvents![0][0]).toBe("[Pasted text #1 +2 lines]");
    expect(sendEvents![0][2]).toEqual(
      expect.objectContaining({
        pastedContents: {
          "1": raw,
        },
      })
    );
  });

  it("does not send when the draft has a pasted-text placeholder without contents", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.find<HTMLTextAreaElement>(
      '[data-testid="ai-chat-composer"]'
    );

    await textarea.setValue("[Pasted text #1]");
    await textarea.trigger("keydown", {
      key: "Enter",
      shiftKey: false,
      preventDefault: vi.fn(),
    });

    expect(wrapper.emitted("send")).toBeUndefined();
    expect(wrapper.text()).toContain(
      "Pasted text is no longer available. Please paste it again."
    );
  });
});
