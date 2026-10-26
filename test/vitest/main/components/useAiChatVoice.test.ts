import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { AiChatVoiceSettingsView } from "@/entityTypes/aiChatVoiceTypes";
import type { AiChatVoiceState } from "@/views/composables/useAiChatVoice";

const getVoiceSettingsMock = vi.fn();
const getVoiceStatusMock = vi.fn();
const setVoiceSettingsMock = vi.fn();
const downloadVoiceModelMock = vi.fn();
const cancelVoiceJobMock = vi.fn();
const notifyVoiceModelsChangedMock = vi.fn();
const onVoiceModelDownloadProgressMock = vi.fn();
const synthesizeVoiceMock = vi.fn();
const getLocalAiRuntimeStatusMock = vi.fn();
const prepareLocalAiRuntimeInstallMock = vi.fn();
const installLocalAiRuntimeMock = vi.fn();
const onLocalAiRuntimeProgressMock = vi.fn();

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-models-changed",
  cancelVoiceJob: (...args: unknown[]) => cancelVoiceJobMock(...args),
  downloadVoiceModel: (...args: unknown[]) => downloadVoiceModelMock(...args),
  getVoiceSettings: (...args: unknown[]) => getVoiceSettingsMock(...args),
  getVoiceStatus: (...args: unknown[]) => getVoiceStatusMock(...args),
  notifyVoiceModelsChanged: (...args: unknown[]) =>
    notifyVoiceModelsChangedMock(...args),
  onVoiceModelDownloadProgress: (...args: unknown[]) =>
    onVoiceModelDownloadProgressMock(...args),
  setVoiceSettings: (...args: unknown[]) => setVoiceSettingsMock(...args),
  synthesizeVoice: (...args: unknown[]) => synthesizeVoiceMock(...args),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  getLocalAiRuntimeStatus: (...args: unknown[]) =>
    getLocalAiRuntimeStatusMock(...args),
  prepareLocalAiRuntimeInstall: (...args: unknown[]) =>
    prepareLocalAiRuntimeInstallMock(...args),
  installLocalAiRuntime: (...args: unknown[]) =>
    installLocalAiRuntimeMock(...args),
  onLocalAiRuntimeProgress: (...args: unknown[]) =>
    onLocalAiRuntimeProgressMock(...args),
}));

vi.mock("@/views/utils/localAiRuntimeUi", () => ({
  isLocalAiRuntimeUsable: (state: unknown) => state === "installed",
}));

const recordWorkspaceActionMock = vi.fn();
vi.mock("@/views/api/aiChatWorkspaceActions", () => ({
  recordWorkspaceActionCount: (...args: unknown[]) =>
    recordWorkspaceActionMock(...args),
}));

import { useAiChatVoice } from "@/views/composables/useAiChatVoice";
import { SpeechResponseController } from "@/views/components/aiChatV2/voice/SpeechResponseController";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        voice: {
          runtime_install_size:
            "Runtime download: {runtimeSize}. Whisper Base model: ~{modelSize}.",
          model_install_failed: "Voice model installation failed.",
        },
      },
    },
  },
});

const baseSettings: AiChatVoiceSettingsView = {
  inputMode: "push_to_talk",
  ttsMode: "disabled",
  autoSendTranscript: false,
  sttLanguage: "auto",
  ttsLanguage: "auto",
  sttModelId: "sherpa-onnx:stt:auto",
  ttsModelId: "sherpa-onnx:tts:auto",
  ttsSpeed: 1,
  maxRecordingMs: 45_000,
};

function readyStatus(overrides: Record<string, unknown> = {}) {
  return { sttState: "ready", ttsState: "ready", ...overrides };
}

/** Mounted hosts — unmounted after each test so scope-dispose runs. */
const hosts: ReturnType<typeof mount>[] = [];

function mountVoice(chatReady: () => boolean = () => true): AiChatVoiceState {
  let state!: AiChatVoiceState;
  const Host = defineComponent({
    setup() {
      state = useAiChatVoice({ chatReady });
      return () => null;
    },
  });
  hosts.push(mount(Host, { global: { plugins: [i18n] } }));
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  onVoiceModelDownloadProgressMock.mockReturnValue(() => undefined);
  onLocalAiRuntimeProgressMock.mockReturnValue(() => undefined);
  getLocalAiRuntimeStatusMock.mockResolvedValue({ state: "installed" });
});

afterEach(() => {
  while (hosts.length > 0) {
    hosts.pop()?.unmount();
  }
});

describe("useAiChatVoice (chat-first shell design §11.1)", () => {
  it("loads settings, status, and runtime availability", async () => {
    getVoiceSettingsMock.mockResolvedValue({
      ...baseSettings,
      ttsMode: "all_assistant_messages",
    });
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    const voice = mountVoice();

    await voice.loadSettings();

    expect(voice.inputEnabled.value).toBe(true);
    expect(voice.autoSend.value).toBe(false);
    expect(voice.maxRecordingMs.value).toBe(45_000);
    expect(voice.ttsMode.value).toBe("all_assistant_messages");
    expect(voice.spokenResponseEnabled.value).toBe(true);
    expect(voice.missingInputModel.value).toBe(false);
    expect(voice.runtimeUnavailable.value).toBe(false);
    expect(voice.chatReady.value).toBe(true);
  });

  it("settings-load failure degrades voice without breaking state", async () => {
    getVoiceSettingsMock.mockRejectedValue(new Error("ipc down"));
    const voice = mountVoice();

    await voice.loadSettings();

    expect(voice.inputEnabled.value).toBe(false);
    expect(voice.spokenResponseEnabled.value).toBe(false);
  });

  it("flags missing STT model and unusable runtime from status", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(
      readyStatus({ sttState: "missing_model" })
    );
    const voice = mountVoice();
    await voice.loadSettings();
    expect(voice.missingInputModel.value).toBe(true);

    getVoiceStatusMock.mockResolvedValue(readyStatus({ sttState: "ready" }));
    getLocalAiRuntimeStatusMock.mockResolvedValue({ state: "downloading" });
    await voice.loadSettings();
    expect(voice.runtimeUnavailable.value).toBe(true);
  });

  it("enabling spoken responses persists after prerequisites verify", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    setVoiceSettingsMock.mockImplementation(async (s) => s);
    const voice = mountVoice();
    await voice.loadSettings();

    await voice.toggleSpokenResponse();

    expect(setVoiceSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ttsMode: "all_assistant_messages" })
    );
    expect(voice.spokenResponseEnabled.value).toBe(true);
  });

  it("disabling spoken responses persists disabled", async () => {
    getVoiceSettingsMock.mockResolvedValue({
      ...baseSettings,
      ttsMode: "all_assistant_messages",
    });
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    setVoiceSettingsMock.mockImplementation(async (s) => s);
    const voice = mountVoice();
    await voice.loadSettings();

    await voice.toggleSpokenResponse();

    expect(setVoiceSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ttsMode: "disabled" })
    );
    expect(voice.spokenResponseEnabled.value).toBe(false);
  });

  it("R8 P2: turning spoken responses off cancels speech already queued (FR-VOI-009)", async () => {
    getVoiceSettingsMock.mockResolvedValue({
      ...baseSettings,
      ttsMode: "all_assistant_messages",
    });
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    setVoiceSettingsMock.mockImplementation(async (s) => s);
    const stopSpy = vi.spyOn(SpeechResponseController.prototype, "stop");
    try {
      const voice = mountVoice();
      await voice.loadSettings();

      await voice.toggleSpokenResponse();

      // The saved mode gates NEW speech only — already queued/playing
      // utterances must be cancelled when the user turns the control off.
      expect(setVoiceSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ ttsMode: "disabled" })
      );
      expect(stopSpy).toHaveBeenCalledTimes(1);
    } finally {
      stopSpy.mockRestore();
    }
  });

  it("enabling with a missing TTS model prompts install without persisting", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(
      readyStatus({ ttsState: "missing_model" })
    );
    const voice = mountVoice();
    await voice.loadSettings();

    await voice.toggleSpokenResponse();

    expect(voice.ttsInstallPrompt.value).toBe(true);
    expect(setVoiceSettingsMock).not.toHaveBeenCalled();
  });

  it("enabling with an unavailable TTS runtime opens the runtime installer", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(
      readyStatus({ ttsState: "unavailable" })
    );
    prepareLocalAiRuntimeInstallMock.mockResolvedValue({
      operationId: "op-1",
      runtimeId: "voice-sherpa",
      runtimeVersion: "1",
      consentToken: "tok",
      archiveSizeBytes: 4096,
    });
    const voice = mountVoice();
    await voice.loadSettings();

    await voice.toggleSpokenResponse();

    expect(voice.runtimeInstallDialog.value).toBe(true);
    expect(voice.runtimeInstallSizeText.value).toContain("KB");
    expect(setVoiceSettingsMock).not.toHaveBeenCalled();
  });

  it("installTtsModel downloads the configured speech model", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    downloadVoiceModelMock.mockResolvedValue(undefined);
    setVoiceSettingsMock.mockImplementation(async (s) => s);
    const voice = mountVoice();
    await voice.loadSettings();
    // The popup was open when the user confirmed the install.
    voice.ttsInstallPrompt.value = true;

    await voice.installTtsModel();

    expect(downloadVoiceModelMock).toHaveBeenCalledWith("sherpa-onnx:tts:auto");
    expect(notifyVoiceModelsChangedMock).toHaveBeenCalled();
    expect(voice.modelInstalling.value).toBe(false);
    // Popup confirm completes the original enable intent: when the model
    // is usable after install, persist the enablement the user requested.
    expect(setVoiceSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ttsMode: "all_assistant_messages" })
    );
    expect(voice.spokenResponseEnabled.value).toBe(true);
    // The popup's job (install + enable) is done: it closes itself.
    expect(voice.ttsInstallPrompt.value).toBe(false);
  });

  it("installTtsModel leaves spoken responses disabled when the model is still missing after download", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(
      readyStatus({ ttsState: "missing_model" })
    );
    downloadVoiceModelMock.mockResolvedValue(undefined);
    const voice = mountVoice();
    await voice.loadSettings();
    voice.ttsInstallPrompt.value = true;

    await voice.installTtsModel();

    expect(downloadVoiceModelMock).toHaveBeenCalledWith("sherpa-onnx:tts:auto");
    expect(setVoiceSettingsMock).not.toHaveBeenCalled();
    expect(voice.spokenResponseEnabled.value).toBe(false);
    // The popup stays open: the user can retry the install or cancel.
    expect(voice.ttsInstallPrompt.value).toBe(true);
  });

  it("installTtsModel failure keeps spoken responses off, the popup open, and surfaces a localized error", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    downloadVoiceModelMock.mockRejectedValue(new Error("network"));
    const voice = mountVoice();
    await voice.loadSettings();
    voice.ttsInstallPrompt.value = true;

    await voice.installTtsModel();

    expect(voice.modelInstallError.value).toBeTruthy();
    expect(setVoiceSettingsMock).not.toHaveBeenCalled();
    expect(voice.spokenResponseEnabled.value).toBe(false);
    // The popup stays open so the install error and retry are visible.
    expect(voice.ttsInstallPrompt.value).toBe(true);
  });

  it("installRequiredModel surfaces a localized failure", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(
      readyStatus({
        sttState: "missing_model",
        sttModelId: "sherpa-onnx:stt:whisper-base",
      })
    );
    downloadVoiceModelMock.mockRejectedValue(new Error("network"));
    const voice = mountVoice();
    await voice.loadSettings();

    await voice.installRequiredModel();

    expect(downloadVoiceModelMock).toHaveBeenCalledWith(
      "sherpa-onnx:stt:whisper-base"
    );
    // PRD §14.5: the failure is the bounded localized message — the raw
    // exception text ("network") is never surfaced.
    expect(voice.modelInstallError.value).toContain(
      "Voice model installation failed."
    );
    expect(voice.modelInstallError.value).not.toContain("network");
  });

  it("confirmRuntimeInstall installs runtime + STT model and enables push-to-talk", async () => {
    const offer = {
      operationId: "op-2",
      runtimeId: "voice-sherpa",
      runtimeVersion: "1",
      consentToken: "tok",
      archiveSizeBytes: 8192,
    };
    prepareLocalAiRuntimeInstallMock.mockResolvedValue(offer);
    installLocalAiRuntimeMock.mockResolvedValue(undefined);
    downloadVoiceModelMock.mockResolvedValue(undefined);
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    setVoiceSettingsMock.mockImplementation(async (s) => s);
    const voice = mountVoice();
    await voice.loadSettings();

    await voice.installRequiredRuntime();
    expect(voice.runtimeInstallDialog.value).toBe(true);

    await voice.confirmRuntimeInstall();

    expect(installLocalAiRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-2" })
    );
    expect(downloadVoiceModelMock).toHaveBeenCalledWith(
      "sherpa-onnx:stt:whisper-base"
    );
    expect(setVoiceSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMode: "push_to_talk",
        sttModelId: "sherpa-onnx:stt:whisper-base",
      })
    );
    expect(voice.runtimeInstallDialog.value).toBe(false);
  });

  /** R8 §2: renderer-side voice actions count into the workspace action
   * counter (fire-and-forget, labels only). */
  it("counts capability-state, install, and install-offer actions", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    const voice = mountVoice();

    await voice.loadSettings();

    const capabilityCalls = recordWorkspaceActionMock.mock.calls.filter(
      (c) => c[0] === "voice" && c[1] === "capability_state"
    );
    expect(capabilityCalls.length).toBeGreaterThanOrEqual(1);
    expect(capabilityCalls[0][2]).toBe("ready");

    recordWorkspaceActionMock.mockClear();
    downloadVoiceModelMock.mockResolvedValue(undefined);
    await voice.installRequiredModel();
    expect(recordWorkspaceActionMock).toHaveBeenCalledWith(
      "voice",
      "install_model",
      "ok"
    );

    recordWorkspaceActionMock.mockClear();
    const offer = {
      operationId: "op-3",
      runtimeId: "voice-sherpa",
      runtimeVersion: "1",
      consentToken: "tok",
      archiveSizeBytes: 8192,
    };
    prepareLocalAiRuntimeInstallMock.mockResolvedValue(offer);
    installLocalAiRuntimeMock.mockResolvedValue(undefined);
    setVoiceSettingsMock.mockImplementation(async (s) => s);
    await voice.installRequiredRuntime();
    expect(recordWorkspaceActionMock).toHaveBeenCalledWith(
      "voice",
      "install_runtime_offer",
      "ok"
    );
    await voice.confirmRuntimeInstall();
    expect(recordWorkspaceActionMock).toHaveBeenCalledWith(
      "voice",
      "install_runtime",
      "ok"
    );
  });

  it("stopSpeaking halts playback and cancels worker synthesis", async () => {
    cancelVoiceJobMock.mockResolvedValue({ ok: true });
    const voice = mountVoice();

    await voice.stopSpeaking();

    expect(cancelVoiceJobMock).toHaveBeenCalled();
  });

  it("onRecordingStart stops speech without surfacing errors", () => {
    cancelVoiceJobMock.mockResolvedValue({ ok: true });
    const voice = mountVoice();
    voice.onRecordingStart();
    expect(cancelVoiceJobMock).toHaveBeenCalled();
  });

  it("dispose removes the settings-changed subscription", async () => {
    getVoiceSettingsMock.mockResolvedValue(baseSettings);
    getVoiceStatusMock.mockResolvedValue(readyStatus());
    const voice = mountVoice();
    await voice.loadSettings();
    expect(getVoiceSettingsMock).toHaveBeenCalledTimes(1);

    voice.dispose();
    getVoiceSettingsMock.mockClear();
    window.dispatchEvent(
      new Event("aifetchly:ai-chat-v2-voice-settings-changed")
    );
    await Promise.resolve();
    expect(getVoiceSettingsMock).not.toHaveBeenCalled();
  });
});
