import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";

/**
 * FR-COMP-004 / PRD §13.2 (acceptance criterion 17): Enter during IME
 * composition confirms the composition — it must neither send the message nor
 * select a slash suggestion prematurely. Covers both the standard
 * `isComposing` signal and the legacy keyCode-229 fallback some Chromium
 * versions report on the final composition keydown.
 */

const mockListSlashCommands = vi.fn();

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: (...args: unknown[]) => mockListSlashCommands(...args),
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

const TextareaStub = defineComponent({
  name: "VTextarea",
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue", "keydown"],
  template:
    '<div data-testid="ai-chat-composer"><textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /><slot name="append-inner" /></div>',
});

function command(name: string): SlashCommandView {
  return {
    id: `built-in:command:${name}`,
    name,
    description: `Run ${name}`,
    aliases: [],
    source: "built-in",
    sourceLabel: "Built-in",
    enabled: true,
  };
}

function mountComposer() {
  return mount(AiChatV2Composer, {
    props: { isStreaming: false },
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        "v-textarea": TextareaStub,
        "v-btn": { template: '<button class="stub-btn"><slot /></button>' },
        "v-icon": true,
        "v-chip": true,
        "v-slide-y-reverse-transition": {
          template: '<div class="stub-transition"><slot /></div>',
        },
        AiChatV2SlashSuggestions: true,
        AiChatV2AtMentionSuggestions: true,
      },
    },
  });
}

describe("AiChatV2Composer IME composition guard (FR-COMP-004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSlashCommands.mockResolvedValue({
      status: true,
      commands: [command("review")],
      diagnostics: [],
      msg: "",
    });
  });

  it("does not send when Enter is pressed during composition (isComposing)", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('[data-testid="ai-chat-composer"] textarea');
    await textarea.setValue("中途の日本語");
    await textarea.trigger("keydown", {
      key: "Enter",
      isComposing: true,
    });
    await flushPromises();

    expect(wrapper.emitted("send")).toBeUndefined();
    const el = textarea.element as HTMLTextAreaElement;
    expect(el.value).toBe("中途の日本語");
  });

  it("does not send when the composition-final keydown reports keyCode 229", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('[data-testid="ai-chat-composer"] textarea');
    await textarea.setValue("composition");
    await textarea.trigger("keydown", {
      key: "Enter",
      keyCode: 229,
      isComposing: false,
    });
    await flushPromises();

    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("does not select a slash suggestion during composition", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('[data-testid="ai-chat-composer"] textarea');
    // Open the slash dropdown with a matching prefix.
    await textarea.setValue("/rev");
    await flushPromises();
    await vi.waitFor(() =>
      expect(mockListSlashCommands).toHaveBeenCalled()
    );

    // Composition Enter: the suggestion must NOT be committed.
    await textarea.trigger("keydown", {
      key: "Enter",
      isComposing: true,
    });
    await flushPromises();
    const el = textarea.element as HTMLTextAreaElement;
    expect(el.value).toBe("/rev");

    // Control: a real Enter (no composition) commits the highlighted command
    // into the draft — proving the guard above, not the setup, blocked it.
    await textarea.trigger("keydown", {
      key: "Enter",
      isComposing: false,
      keyCode: 13,
    });
    await flushPromises();
    const after = textarea.element as HTMLTextAreaElement;
    expect(after.value.startsWith("/review")).toBe(true);
  });
});
