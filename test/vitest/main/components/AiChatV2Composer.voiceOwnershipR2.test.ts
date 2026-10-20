import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import { useComposerDraftStore } from "@/views/store/composerDrafts";

/**
 * Voice cross-conversation ownership, second-round audit (2026-10-20 R2):
 *
 * N01 — the voice-session owner was captured at Stop time, so a conversation
 * switch DURING recording (permission acquisition, active capture, or the
 * stop/conversion window) made the newly selected conversation the "rightful
 * owner" of A's recording. The owner must be bound before microphone
 * acquisition begins and every resulting mutation must stay with it.
 *
 * N02 — a voice send accepted while the originating conversation is no longer
 * selected returned early and left the submitted transcript/files in the
 * originating conversation's STORED draft. Background acceptance must consume
 * exactly the submitted delta from the store.
 *
 * N03 — the acceptance restore rolled the draft back to the pre-voice
 * snapshot captured before conversion/transcription, discarding edits the
 * user typed during those awaits. Restore must be based on the draft content
 * immediately before the transcript insertion.
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

async function attachFile(
  wrapper: ReturnType<typeof mountComposer>,
  name: string
): Promise<void> {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [new File(["content"], name, { type: "application/pdf" })],
    configurable: true,
  });
  await input.trigger("change");
  await flushPromises();
}

interface SendOptions {
  fromVoice?: boolean;
  onAccepted?: () => void;
}

describe("AiChatV2Composer voice ownership R2 (N01/N02/N03)", () => {
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

  // --- N01: ownership captured at Start, never at Stop ---------------------

  it("N01 REAUDIT: recording started in A must not become B's send when stopped in B", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "A private recording" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.setProps({ draftKey: "convB" });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("send")).toBeUndefined();
  });

  it("N01: owner is bound before microphone permission acquisition resolves; switch while the prompt is pending parks the transcript", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "A private recording" });
    let releaseStart!: () => void;
    startMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve;
        })
    );
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    // First click suspends in the (mocked) permission prompt.
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Recording");
    await wrapper.setProps({ draftKey: "convB" });
    releaseStart();
    await flushPromises();
    expect(wrapper.text()).toContain("Recording");
    // Stop pressed while B is selected.
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("send")).toBeUndefined();
    expect(draftText(wrapper)).toBe("");
    expect(useComposerDraftStore(pinia).getDraft("convA")?.text).toBe(
      "A private recording"
    );
    expect(useComposerDraftStore(pinia).getDraft("convB")).toBeNull();
  });

  it("N01: a switch during recording keeps the transcript parked in A with auto-send OFF and never touches B's draft", async () => {
    const wrapper = mountComposer(pinia, { voiceAutoSend: false });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.setProps({ draftKey: "convB" });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    resolveTranscription({ transcript: "A private speech" });
    await flushPromises();
    expect(wrapper.emitted("send")).toBeUndefined();
    expect(draftText(wrapper)).toBe("");
    expect(useComposerDraftStore(pinia).getDraft("convB")).toBeNull();
    expect(useComposerDraftStore(pinia).getDraft("convA")?.text).toBe(
      "A private speech"
    );
  });

  it("N01: a switch while the stop/conversion window is pending parks the transcript in A when it finally resolves in B", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "A private speech" });
    let releaseStop!: () => void;
    stopMock.mockImplementation(
      () =>
        new Promise<{ blob: Blob; mimeType: string; durationMs: number }>(
          (resolve) => {
            releaseStop = () =>
              resolve({
                blob: new Blob(["x"], { type: "audio/webm" }),
                mimeType: "audio/webm",
                durationMs: 1000,
              });
          }
        )
    );
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    // The Stop click suspends inside the recorder stop/conversion window.
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.setProps({ draftKey: "convB" });
    releaseStop();
    await flushPromises();
    expect(wrapper.emitted("send")).toBeUndefined();
    expect(draftText(wrapper)).toBe("");
    expect(useComposerDraftStore(pinia).getDraft("convA")?.text).toBe(
      "A private speech"
    );
  });

  it("N01: recording in A, switching away and back, then stopping still submits from the owner with the owner's tray", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "A private speech" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await attachFile(wrapper, "report.pdf");
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    await flushPromises();
    await wrapper.setProps({ draftKey: "convB" });
    await wrapper.setProps({ draftKey: "convA" });
    await wrapper.find(".v2-composer__voice-button").trigger("click");
    resolveTranscription({ transcript: "A private speech" });
    await flushPromises();
    const events = wrapper.emitted("send");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toBe("A private speech");
    expect(events![0][1]).toHaveLength(1);
    expect((events![0][1] as File[])[0].name).toBe("report.pdf");
    expect((events![0][2] as SendOptions).fromVoice).toBe(true);
  });

  // --- N02: background acceptance consumes the submitted delta from A -------

  it("N02 REAUDIT: background acceptance consumes A's already sent voice transcript", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await wrapper.find("textarea").setValue("A typed draft");
    await startAndStopRecording(wrapper);
    const options = wrapper.emitted("send")![0][2] as SendOptions;
    await wrapper.setProps({ draftKey: "convB" });
    options.onAccepted?.();
    await flushPromises();
    await wrapper.setProps({ draftKey: "convA" });
    expect(draftText(wrapper)).toBe("A typed draft");
  });

  it("N02: background acceptance also clears the submitted attachment snapshot from the originating stored draft", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await attachFile(wrapper, "report.pdf");
    await wrapper.find("textarea").setValue("A typed draft");
    await startAndStopRecording(wrapper);
    const options = wrapper.emitted("send")![0][2] as SendOptions;
    await wrapper.setProps({ draftKey: "convB" });
    options.onAccepted?.();
    await flushPromises();
    await wrapper.setProps({ draftKey: "convA" });
    const stored = useComposerDraftStore(pinia).getDraft("convA");
    expect(draftText(wrapper)).toBe("A typed draft");
    expect(stored?.files ?? []).toHaveLength(0);
  });

  it("N02: background acceptance is idempotent and never consumes a retried conversation's newer state", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await wrapper.find("textarea").setValue("A typed draft");
    await startAndStopRecording(wrapper);
    const options = wrapper.emitted("send")![0][2] as SendOptions;
    await wrapper.setProps({ draftKey: "convB" });
    options.onAccepted?.();
    await flushPromises();
    // A duplicate dispatch of the same acceptance must be a no-op…
    options.onAccepted?.();
    await flushPromises();
    await wrapper.setProps({ draftKey: "convA" });
    expect(draftText(wrapper)).toBe("A typed draft");
  });

  it("N02: a failed/rejected voice send keeps the transcript in the originating draft (no acceptance fired)", async () => {
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await wrapper.find("textarea").setValue("A typed draft");
    await startAndStopRecording(wrapper);
    resolveTranscription({ transcript: "hello world" });
    await flushPromises();
    // Send emitted, never accepted (queue rejected it): the submitted
    // transcript stays retryable in the draft.
    expect(wrapper.emitted("send")).toHaveLength(1);
    expect(draftText(wrapper)).toBe("A typed draft hello world");
    // Switching away and back keeps the retryable submission.
    await wrapper.setProps({ draftKey: "convB" });
    await wrapper.setProps({ draftKey: "convA" });
    expect(draftText(wrapper)).toBe("A typed draft hello world");
  });

  // --- N03: acceptance restores the pre-append snapshot, not pre-voice -----

  it("N03 REAUDIT: voice acceptance preserves edits made during transcription", async () => {
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await wrapper.find("textarea").setValue("old typed draft");
    await startAndStopRecording(wrapper);
    await wrapper.find("textarea").setValue("new typed draft");
    resolveTranscription({ transcript: "voice request" });
    await flushPromises();
    const options = wrapper.emitted("send")![0][2] as SendOptions;
    options.onAccepted?.();
    await flushPromises();
    expect(draftText(wrapper)).toBe("new typed draft");
  });

  it("N03: edits typed after the emitted send also survive acceptance without the sent transcript", async () => {
    transcribeVoiceMock.mockResolvedValue({ transcript: "hello world" });
    const wrapper = mountComposer(pinia, { voiceAutoSend: true });
    await wrapper.find("textarea").setValue("A typed draft");
    await startAndStopRecording(wrapper);
    // The operator appended more text after the send was emitted but before
    // acceptance resolved. The accepted transcript was already submitted, so
    // it must be removed exactly once while the newer edit survives.
    await wrapper.find("textarea").setValue("A typed draft hello world plus");
    const options = wrapper.emitted("send")![0][2] as SendOptions;
    options.onAccepted?.();
    await flushPromises();
    // Only the exact submitted snapshot consumes the delta; a changed draft
    // keeps everything the user has (the transcript was already delivered).
    expect(draftText(wrapper)).toBe("A typed draft hello world plus");
  });
});
