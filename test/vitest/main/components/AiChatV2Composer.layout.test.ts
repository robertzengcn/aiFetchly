import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/api/aiChatAtMentions", () => ({
  listAtMentionSuggestions: vi.fn(),
}));

vi.mock("@/views/components/aiChatV2/voice/BrowserVoiceRecorder", () => ({
  BrowserVoiceRecorder: vi.fn(),
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
        voice: { stop_speaking: "Stop speaking" },
      },
    },
  },
});

// VTextarea stub: mirrors v-model AND reflects row/auto-grow attrs on a real
// <textarea> so DOM-order and row assertions see the actual configuration.
const TextareaStub = defineComponent({
  name: "VTextarea",
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue", "keydown"],
  template:
    '<div data-testid="ai-chat-composer"><textarea :rows="$attrs.rows" :data-auto-grow="$attrs[\'auto-grow\'] !== undefined ? \'\' : undefined" :data-max-rows="$attrs[\'max-rows\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /><slot name="append-inner" /></div>',
});

function mountComposer(slots: Record<string, string> = {}) {
  return mount(AiChatV2Composer, {
    global: {
      plugins: [i18n],
      stubs: {
        "v-textarea": TextareaStub,
        "v-btn": {
          template: '<button class="stub-btn"><slot /></button>',
        },
        "v-icon": true,
        "v-chip": true,
        "v-slide-y-reverse-transition": {
          template: '<div class="stub-transition"><slot /></div>',
        },
        AiChatV2SlashSuggestions: true,
        AiChatV2AtMentionSuggestions: true,
      },
    },
    slots,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AiChatV2Composer layout (chat-first shell design §10)", () => {
  it("renders a textarea that starts at two visible rows", () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("rows")).toBe("2");
  });

  it("auto-grows with a six-row ceiling", () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("data-auto-grow")).toBeDefined();
    expect(textarea.attributes("data-max-rows")).toBe("6");
  });

  it("places the lower-toolbar controls after the textarea in DOM order", () => {
    const wrapper = mountComposer({
      controls: '<div data-testid="slot-controls">mode model approval</div>',
    });
    const composerIndex = wrapper
      .get('[data-testid="ai-chat-composer"]')
      .element.compareDocumentPosition(
        wrapper.get('[data-testid="slot-controls"]').element
      );
    // FOLLOWING (4) = controls node comes after the textarea node.
    expect(composerIndex & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      wrapper.get('[data-testid="v2-composer-controls"]').text()
    ).toContain("mode model approval");
  });

  it("keeps the legacy prepend slot rendering when controls is absent (rollback)", () => {
    const wrapper = mountComposer({
      prepend: '<div data-testid="slot-prepend">legacy controls</div>',
    });
    expect(wrapper.get('[data-testid="slot-prepend"]').text()).toBe(
      "legacy controls"
    );
    expect(wrapper.find('[data-testid="slot-controls"]').exists()).toBe(false);
  });

  it("prefers the controls slot when both are provided", () => {
    const wrapper = mountComposer({
      controls: '<div data-testid="slot-controls">new</div>',
      prepend: '<div data-testid="slot-prepend">legacy</div>',
    });
    expect(wrapper.find('[data-testid="slot-prepend"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="slot-controls"]').text()).toBe("new");
  });

  it("renders toolbar-actions before the send control", () => {
    const wrapper = mountComposer({
      "toolbar-actions": '<div data-testid="slot-actions">spoken</div>',
    });
    const actionsBar = wrapper.get(
      '[data-testid="v2-composer-toolbar-actions"]'
    );
    expect(actionsBar.text()).toBe("spoken");
    const send = wrapper.get('[data-testid="ai-chat-send"]');
    const relation = actionsBar.element.compareDocumentPosition(send.element);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
