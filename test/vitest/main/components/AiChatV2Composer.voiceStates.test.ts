import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";

/**
 * FR-VOICE-001/003/005 (acceptance criteria 20, 22, 25): the microphone is
 * visible whenever voice input is policy-enabled OR recoverable-unavailable;
 * its accessible label always states WHY recording is impossible (busy,
 * setup-required); and a settings-load failure keeps a settings path instead
 * of silently removing the capability.
 */

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
        voice: {
          microphone: "Voice input",
          start_recording: "Start recording",
          stop_recording: "Stop recording",
          transcribing: "Transcribing…",
          settings_unavailable: "Voice input unavailable — open settings",
          busy: "Voice input is unavailable during the current run",
          settings_load_failed: "Voice settings couldn't be loaded.",
          open_model_settings: "Open settings",
        },
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

function mountComposer(props: Record<string, unknown> = {}) {
  return mount(AiChatV2Composer, {
    props: { isStreaming: false, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        "v-textarea": TextareaStub,
        "v-btn": {
          props: ["disabled", "ariaLabel", "title"],
          template: '<button class="stub-btn" :disabled="disabled" :title="title" :aria-label="ariaLabel"><slot /></button>',
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
  });
}

describe("AiChatV2Composer voice states (FR-VOICE-001/003/005)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the microphone only when policy-disabled AND settings are fine", () => {
    const wrapper = mountComposer({ voiceEnabled: false });
    expect(wrapper.find('[data-testid="ai-chat-microphone"]').exists()).toBe(
      false
    );
  });

  it("keeps a disabled, labeled microphone plus a settings action when settings failed to load", async () => {
    const wrapper = mountComposer({
      voiceEnabled: false, // policy state unknown — capability must stay visible
      voiceSettingsUnavailable: true,
    });

    const mic = wrapper.get('[data-testid="ai-chat-microphone"]');
    expect(mic.attributes("disabled")).toBeDefined();
    expect(mic.attributes("aria-label")).toBe(
      "Voice input unavailable — open settings"
    );

    const notice = wrapper.get('[data-testid="voice-settings-unavailable-notice"]');
    expect(notice.text()).toContain("Voice settings couldn't be loaded.");
    await wrapper.get('[data-testid="voice-settings-open-button"]').trigger("click");
    expect(wrapper.emitted("open-voice-settings")).toHaveLength(1);
  });

  it("labels the microphone as busy (not 'start recording') while a run is active", () => {
    const wrapper = mountComposer({
      voiceEnabled: true,
      isStreaming: true,
    });
    const mic = wrapper.get('[data-testid="ai-chat-microphone"]');
    expect(mic.attributes("disabled")).toBeDefined();
    expect(mic.attributes("aria-label")).toBe(
      "Voice input is unavailable during the current run"
    );
  });

  it("shows the ready microphone when voice input is enabled", () => {
    const wrapper = mountComposer({ voiceEnabled: true });
    const mic = wrapper.get('[data-testid="ai-chat-microphone"]');
    expect(mic.attributes("disabled")).toBeUndefined();
    expect(mic.attributes("aria-label")).toBe("Start recording");
  });

  it("preserves the typed draft while voice is unavailable", async () => {
    const wrapper = mountComposer({
      voiceEnabled: false,
      voiceSettingsUnavailable: true,
    });
    await wrapper
      .get('[data-testid="ai-chat-composer"] textarea')
      .setValue("still typing");
    await flushPromises();
    const el = wrapper.get('[data-testid="ai-chat-composer"] textarea')
      .element as HTMLTextAreaElement;
    expect(el.value).toBe("still typing");
  });
});
