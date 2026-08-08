import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";

// --- Mocks: the composer owns a BrowserVoiceRecorder and calls transcribeVoice
// + blobToWavBase64. We stub them so the voice flow is deterministic and fast.
// vi.hoisted exposes the mocks to the hoisted vi.mock factories below.

const { startMock, stopMock, transcribeVoiceMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  stopMock: vi.fn(),
  transcribeVoiceMock: vi.fn(),
}));

vi.mock("@/views/components/aiChatV2/voice/BrowserVoiceRecorder", () => ({
  BrowserVoiceRecorder: vi.fn(() => ({
    start: startMock,
    stop: stopMock,
  })),
}));

vi.mock("@/views/components/aiChatV2/voice/audioConversion", () => ({
  blobToWavBase64: vi.fn().mockResolvedValue("BASE64_WAV"),
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  transcribeVoice: transcribeVoiceMock,
}));

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
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
          recording: "Recording...",
          transcribing: "Transcribing...",
          stop_speaking: "Stop speaking",
          empty_transcript: "No speech was detected.",
          transcription_failed: "Voice transcription failed.",
        },
      },
    },
  },
});

// VTextarea stub mirrors v-model so we can read the draft via props, and
// renders the named append-inner slot so the mic button (slot content) is in
// the DOM and clickable.
const TextareaStub = defineComponent({
  name: "VTextarea",
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue", "keydown"],
  template:
    '<div><textarea data-testid="composer-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /><slot name="append-inner" /></div>',
});

// Minimal button stub: by NOT declaring `emits: ["click"]`, the composer's
// `@click.stop="onMicClick"` falls through to the root <button> as a NATIVE
// click listener (so .stop works on a real event, and the handler fires
// exactly once). `:disabled` also falls through, so a disabled button is
// non-interactive and exposes `.disabled` for assertions.
const ButtonStub = defineComponent({
  name: "VBtn",
  props: { disabled: { type: Boolean, default: false } },
  template: '<button type="button" :disabled="disabled"><slot /></button>',
});

// Transition stub that renders its default slot so status text inside a
// <v-slide-y-reverse-transition> is queryable.
const TransitionStub = defineComponent({
  name: "VSlideYReverseTransition",
  template: "<div><slot /></div>",
});

function mountComposer(props: Record<string, unknown> = {}) {
  return mount(AiChatV2Composer, {
    // voiceChatReady defaults to true: Vue coerces an absent Boolean prop to
    // false, which would route auto-send down the chat-unavailable path. The
    // parent always passes an explicit boolean in production.
    props: {
      isStreaming: false,
      isProcessing: false,
      voiceChatReady: true,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VTextarea: TextareaStub,
        VBtn: ButtonStub,
        VIcon: true,
        VChip: true,
        // Render slot content so the voice status (inside the transition) is
        // in the DOM and queryable.
        VSlideYReverseTransition: TransitionStub,
      },
    },
  });
}

describe("AiChatV2Composer voice controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startMock.mockResolvedValue(undefined);
    stopMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      durationMs: 1000,
    });
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
  });

  it("shows the mic button when voice input is enabled", () => {
    const wrapper = mountComposer({ voiceEnabled: true });
    expect(wrapper.find(".v2-composer__voice-button").exists()).toBe(true);
  });

  it("hides the mic button when voice input is disabled", () => {
    const wrapper = mountComposer({ voiceEnabled: false });
    expect(wrapper.find(".v2-composer__voice-button").exists()).toBe(false);
  });

  it("disables the mic button while streaming", () => {
    const wrapper = mountComposer({ voiceEnabled: true, isStreaming: true });
    const mic = wrapper.find(".v2-composer__voice-button");
    expect((mic.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a Recording status while recording and Transcribing after stop", async () => {
    const wrapper = mountComposer({ voiceEnabled: true });

    // Start recording (re-query: the button re-renders on state change).
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".v2-composer__voice-status").text()).toContain(
      "Recording..."
    );

    // Stop -> transcribe. Transcribing state shows until the IPC resolves.
    transcribeVoiceMock.mockReturnValue(new Promise(() => undefined)); // never resolves
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".v2-composer__voice-status").text()).toContain(
      "Transcribing..."
    );
  });

  it("populates the draft with the transcript when auto-send is off", async () => {
    const wrapper = mountComposer({ voiceEnabled: true, voiceAutoSend: false });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.findComponent(TextareaStub).props("modelValue")).toBe(
      "hello world"
    );
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("auto-send emits send with the transcript and fromVoice flag", async () => {
    const wrapper = mountComposer({ voiceEnabled: true, voiceAutoSend: true });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    const sendEvents = wrapper.emitted("send");
    expect(sendEvents).toHaveLength(1);
    expect(sendEvents![0][0]).toBe("hello world");
    expect(sendEvents![0][2]).toEqual({ fromVoice: true });
  });

  it("does not send an empty transcript", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "   " });
    const wrapper = mountComposer({ voiceEnabled: true, voiceAutoSend: true });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("shows the transcription failure detail returned by the main process", async () => {
    transcribeVoiceMock.mockRejectedValue(new Error("STT model is not loaded."));
    const wrapper = mountComposer({ voiceEnabled: true });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".v2-composer__notice").text()).toContain(
      "Voice transcription failed. STT model is not loaded."
    );
  });

  it("keeps the transcript in the draft when chat is unavailable on auto-send", async () => {
    const wrapper = mountComposer({
      voiceEnabled: true,
      voiceAutoSend: true,
      voiceChatReady: false,
    });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    // Transcript kept in the draft; no send emitted (PRD §7.13 / TODO P1-5).
    expect(wrapper.findComponent(TextareaStub).props("modelValue")).toBe(
      "hello world"
    );
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("renders a stop-speaking control when speech is playing and emits stop-speaking", async () => {
    const wrapper = mountComposer({
      voiceEnabled: true,
      voiceSpeaking: true,
    });
    const stopBtn = wrapper.find(".v2-composer__stop-speaking");
    expect(stopBtn.exists()).toBe(true);
    await stopBtn.trigger("click");
    expect(wrapper.emitted("stop-speaking")).toHaveLength(1);
  });

  it("shows spoken-response playback errors", () => {
    const wrapper = mountComposer({
      voicePlaybackError: "Speech playback failed. NotAllowedError",
    });
    expect(wrapper.find(".v2-composer__notice").text()).toContain(
      "Speech playback failed. NotAllowedError"
    );
  });
});
