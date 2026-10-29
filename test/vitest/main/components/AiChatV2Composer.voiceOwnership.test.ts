import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import { useComposerDraftStore } from "@/views/store/composerDrafts";

/**
 * Voice cross-conversation ownership (audit 2026-10-20 B01/B02):
 *
 * B01 — the recorder/conversion/transcription chain is asynchronous; whatever
 * conversation is selected when that chain resolves used to receive A's
 * recording transcript (and auto-send). The ownership must be captured at
 * mic-click time and every resulting mutation must stay with the originating
 * conversation (park the transcript in the originating draft, never emit).
 *
 * B02 — the accepted-send closure of a voice send restored the pre-send draft
 * into whatever conversation was selected at acceptance time. Acceptance must
 * only act on the originating conversation, and must not clobber newer edits
 * made after the submission.
 */

const { startMock, stopMock, transcribeVoiceMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  stopMock: vi.fn(),
  transcribeVoiceMock: vi.fn(),
}));

vi.mock("@/views/components/aiChatV2/voice/BrowserVoiceRecorder", () => ({
  BrowserVoiceRecorder: vi.fn(function BrowserVoiceRecorderMock() {
    return {
      start: startMock,
      stop: stopMock,
      dispose: vi.fn(),
    };
  }),
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
        voice: {
          microphone: "Voice input",
          recording: "Recording...",
          transcribing: "Transcribing...",
          empty_transcript: "No speech was detected.",
          conversion_failed: "Could not convert the recording.",
          transcription_failed: "Voice transcription failed.",
          chat_unavailable: "Chat is unavailable.",
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
    '<div><textarea data-testid="composer-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /><slot name="append-inner" /></div>',
});

const ButtonStub = defineComponent({
  name: "VBtn",
  props: { disabled: { type: Boolean, default: false } },
  template: '<button type="button" :disabled="disabled"><slot /></button>',
});

const TransitionStub = defineComponent({
  name: "VSlideYReverseTransition",
  template: "<div><slot /></div>",
});

function mountComposer(
  pinia: Pinia,
  props: Record<string, unknown> = {}
) {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: false,
      isProcessing: false,
      voiceChatReady: true,
      voiceEnabled: true,
      draftKey: "convA",
      ...props,
    },
    global: {
      plugins: [pinia, i18n],
      stubs: {
        VTextarea: TextareaStub,
        VBtn: ButtonStub,
        VIcon: true,
        VChip: true,
        VSlideYReverseTransition: TransitionStub,
      },
    },
  });
}

async function startAndStopRecording(
  wrapper: ReturnType<typeof mountComposer>
): Promise<void> {
  await wrapper.find(".v2-composer__voice-button").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("Recording");
  // Second click stops the recording and runs: stop -> convert -> transcribe.
  await wrapper.find(".v2-composer__voice-button").trigger("click");
  await flushPromises();
}

function draftText(wrapper: ReturnType<typeof mountComposer>): string {
  return wrapper.findComponent(TextareaStub).props("modelValue") as string;
}

interface SendOptions {
  fromVoice?: boolean;
  onAccepted?: () => void;
}

describe("AiChatV2Composer voice cross-conversation ownership", () => {
  let pinia: Pinia;
  let resolveTranscription: (value: { transcript: string }) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    pinia = createPinia();
    resolveTranscription = () => undefined;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    startMock.mockResolvedValue(undefined);
    stopMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "audio/webm" }),
      mimeType: "audio/webm",
      durationMs: 1000,
    });
    transcribeVoiceMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTranscription = resolve;
        })
    );
  });

  it("B01 manual mode: parks a late-resolved transcript in the originating draft, never appends into the switched conversation", async () => {
    const wrapper = mountComposer(pinia, { voiceAutoSend: false });
    await startAndStopRecording(wrapper);

    // Selection switches while the transcription promise is pending. The
    // composer restores the new conversation's (empty) draft.
    await wrapper.setProps({ draftKey: "convB" });
    expect(draftText(wrapper)).toBe("");
    resolveTranscription({ transcript: "A private speech" });
    await flushPromises();

    // B's draft is untouched...
    expect(draftText(wrapper)).toBe("");
    // ...and A's draft received the transcript.
    expect(useComposerDraftStore(pinia).getDraft("convA")?.text).toBe(
      "A private speech"
    );
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("B01 auto-send: never emits the send of a transcript that resolved after the conversation switched", async () => {
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await startAndStopRecording(wrapper);

    await wrapper.setProps({ draftKey: "convB" });
    resolveTranscription({ transcript: "A private speech" });
    await flushPromises();

    // No send into B; the transcript is parked for A's own review.
    expect(wrapper.emitted("send")).toBeUndefined();
    expect(draftText(wrapper)).toBe("");
    expect(useComposerDraftStore(pinia).getDraft("convA")?.text).toBe(
      "A private speech"
    );
  });

  it("B01 round trip: acts within the originating conversation when the user returns before the transcript resolves", async () => {
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await startAndStopRecording(wrapper);

    await wrapper.setProps({ draftKey: "convB" });
    await wrapper.setProps({ draftKey: "convA" });
    resolveTranscription({ transcript: "A private speech" });
    await flushPromises();

    const events = wrapper.emitted("send");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toBe("A private speech");
    expect((events![0][2] as SendOptions).fromVoice).toBe(true);
  });

  it("B02 acceptance: accepting a voice send after switching never overwrites the newly selected conversation's draft", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });

    await wrapper.find("textarea").setValue("A typed draft");
    await flushPromises();
    await startAndStopRecording(wrapper);

    const events = wrapper.emitted("send");
    expect(events).toHaveLength(1);
    const options = events![0][2] as SendOptions;
    expect(typeof options.onAccepted).toBe("function");

    // User switches to B and types a private draft there.
    await wrapper.setProps({ draftKey: "convB" });
    await wrapper.find("textarea").setValue("B private draft");
    await flushPromises();

    options.onAccepted?.();
    await wrapper.vm.$nextTick();

    // B's unsent text survives exactly as typed.
    expect(draftText(wrapper)).toBe("B private draft");
    expect(useComposerDraftStore(pinia).getDraft("convB")?.text).toBe(
      "B private draft"
    );
  });

  it("B02 idempotency: a double-dispatched acceptance after switching still leaves B untouched while A was restored", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });

    await wrapper.find("textarea").setValue("A typed draft");
    await flushPromises();
    await startAndStopRecording(wrapper);

    const options = (wrapper.emitted("send")![0][2] as SendOptions).onAccepted;
    // First dispatch: owner still selected -> restores A's draft.
    options?.();
    await wrapper.vm.$nextTick();
    expect(draftText(wrapper)).toBe("A typed draft");

    // User switches to B and types there; a stale second acceptance call
    // (duplicate callback path) must not corrupt B.
    await wrapper.setProps({ draftKey: "convB" });
    await wrapper.find("textarea").setValue("B private draft");
    await flushPromises();
    options?.();

    expect(draftText(wrapper)).toBe("B private draft");
  });

  it("B02 acceptance with owner selected: restores the pre-send draft when the composer was not edited since the send", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });

    await wrapper.find("textarea").setValue("A typed draft");
    await flushPromises();
    await startAndStopRecording(wrapper);

    const options = (wrapper.emitted("send")![0][2] as SendOptions);
    options.onAccepted?.();
    await wrapper.vm.$nextTick();

    expect(draftText(wrapper)).toBe("A typed draft");
  });

  it("B02 acceptance with owner selected: preserves newer edits made after the voice send instead of rolling them back", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });

    await wrapper.find("textarea").setValue("A typed draft");
    await flushPromises();
    await startAndStopRecording(wrapper);

    const options = (wrapper.emitted("send")![0][2] as SendOptions);
    await wrapper.find("textarea").setValue("A typed draft plus new edits");
    options.onAccepted?.();
    await wrapper.vm.$nextTick();

    expect(draftText(wrapper)).toBe("A typed draft plus new edits");
  });
});
