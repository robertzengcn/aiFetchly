import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  type ComputedRef,
  type Ref,
} from "vue";
import { useI18n } from "vue-i18n";
import { SpeechResponseController } from "@/views/components/aiChatV2/voice/SpeechResponseController";
import {
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT,
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT,
  cancelVoiceJob,
  downloadVoiceModel,
  getVoiceSettings,
  getVoiceStatus,
  notifyVoiceModelsChanged,
  onVoiceModelDownloadProgress,
  setVoiceSettings,
} from "@/views/api/aiChatV2Voice";
import {
  getLocalAiRuntimeStatus,
  installLocalAiRuntime,
  onLocalAiRuntimeProgress,
  prepareLocalAiRuntimeInstall,
} from "@/views/api/localAiRuntime";
import { isLocalAiRuntimeUsable } from "@/views/utils/localAiRuntimeUi";
import type {
  AiChatVoiceRuntimeStatus,
  AiChatVoiceSettingsView,
  AiChatVoiceTtsMode,
  VoiceModelDownloadProgress,
} from "@/entityTypes/aiChatVoiceTypes";
import type {
  LocalAiRuntimeDownloadProgress,
  LocalAiRuntimeInstallOffer,
  LocalAiRuntimeStatus,
} from "@/entityTypes/localAiRuntimeTypes";

const VOICE_SHERPA_RUNTIME_ID = "voice-sherpa";
const DEFAULT_VOICE_STT_MODEL_ID = "sherpa-onnx:stt:whisper-base";
const DEFAULT_MAX_RECORDING_MS = 60_000;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Shared voice orchestration (chat-first shell design §11.1).
 *
 * Extracted from the classic chat (`AiChatV2.vue`) so the classic dock and
 * the new chat center surface share ONE implementation of voice settings
 * loading, availability detection, STT/TTS model install, the local
 * voice-runtime install flow, and spoken-response playback control.
 *
 * Instance-scoped: each consumer creates its own SpeechResponseController and
 * subscriptions; `dispose()` releases them (design §17.3 — disposing one
 * surface never unregisters listeners another surface owns).
 */
export interface AiChatVoiceState {
  readonly inputEnabled: Readonly<Ref<boolean>>;
  readonly autoSend: Readonly<Ref<boolean>>;
  readonly maxRecordingMs: Readonly<Ref<number>>;
  readonly ttsMode: Readonly<Ref<AiChatVoiceTtsMode>>;
  readonly spokenResponseEnabled: Readonly<ComputedRef<boolean>>;
  readonly spokenResponseToggleTitle: Readonly<ComputedRef<string>>;
  readonly speaking: Readonly<Ref<boolean>>;
  readonly settingsSaving: Readonly<Ref<boolean>>;
  readonly modelInstalling: Readonly<Ref<boolean>>;
  readonly modelInstallError: Readonly<Ref<string | null>>;
  /** True when TTS enablement is blocked on installing the speech model. */
  readonly ttsInstallPrompt: Readonly<Ref<boolean>>;
  readonly playbackError: Readonly<Ref<string | null>>;
  readonly missingInputModel: Readonly<ComputedRef<boolean>>;
  readonly runtimeUnavailable: Readonly<ComputedRef<boolean>>;
  readonly chatReady: Readonly<ComputedRef<boolean>>;
  readonly runtimeInstallDialog: Readonly<Ref<boolean>>;
  readonly runtimeInstalling: Readonly<Ref<boolean>>;
  readonly runtimeInstallError: Readonly<Ref<string | null>>;
  readonly runtimeInstallSizeText: Readonly<ComputedRef<string>>;
  readonly runtimeInstallProgressText: Readonly<ComputedRef<string>>;
  readonly runtimeInstallPercent: Readonly<ComputedRef<number | undefined>>;
  loadSettings(): Promise<void>;
  toggleSpokenResponse(): Promise<void>;
  /** Install the STT (voice input) model. */
  installRequiredModel(): Promise<void>;
  /** Install the TTS (spoken response) model. */
  installTtsModel(): Promise<void>;
  /** Open the local voice-runtime install dialog and prepare its offer. */
  installRequiredRuntime(): Promise<void>;
  confirmRuntimeInstall(): Promise<void>;
  /** Halt TTS playback + worker synthesis (user-facing Stop speaking). */
  stopSpeaking(): Promise<void>;
  /** Microphone recording started: stop active speech (PRD §7.5). */
  onRecordingStart(): void;
  /** Arm a fresh spoken-response session for the next assistant turn. */
  beginAssistantResponse(latestInputWasVoice: boolean): void;
  /** Feed an assistant text delta into the speech pipeline. */
  pushAssistantDelta(delta: string): void;
  /** Flush buffered speech text at response completion. */
  completeAssistantResponse(): void;
  /** Stop playback without the user-facing error-clearing side effects. */
  stopSpeechPlayback(): void;
  dispose(): void;
}

export function useAiChatVoice(options: {
  /** Whether the chat can currently accept a voice auto-send. */
  chatReady: () => boolean;
}): AiChatVoiceState {
  const { t } = useI18n();

  const speaking = ref(false);
  const playbackError = ref<string | null>(null);
  const speechController = new SpeechResponseController(
    { ttsMode: "disabled", latestInputWasVoice: false },
    undefined,
    undefined,
    (error) => {
      const fallback =
        t("aiChatV2.voice.tts_failed") || "Speech playback failed.";
      playbackError.value =
        error.message.trim().length > 0
          ? `${fallback} ${error.message}`
          : fallback;
    }
  );
  speechController.start();
  const unsubscribeSpeaking = speechController.subscribe((value) => {
    speaking.value = value;
  });

  const inputEnabled = ref(false);
  const autoSend = ref(false);
  const maxRecordingMs = ref<number>(DEFAULT_MAX_RECORDING_MS);
  const ttsMode = ref<AiChatVoiceTtsMode>("disabled");
  const settings = ref<AiChatVoiceSettingsView | null>(null);
  const status = ref<AiChatVoiceRuntimeStatus | null>(null);
  const localRuntimeStatus = ref<LocalAiRuntimeStatus | null>(null);
  const settingsSaving = ref(false);
  const modelInstalling = ref(false);
  const modelInstallError = ref<string | null>(null);
  const ttsInstallPrompt = ref(false);

  const runtimeInstallDialog = ref(false);
  const runtimeInstalling = ref(false);
  const runtimeInstallError = ref<string | null>(null);
  const runtimeInstallOffer = ref<LocalAiRuntimeInstallOffer | null>(null);
  const runtimeInstallProgress = ref<LocalAiRuntimeDownloadProgress | null>(
    null
  );
  const runtimeModelProgress = ref<VoiceModelDownloadProgress | null>(null);
  let unsubscribeRuntimeProgress: (() => void) | null = null;
  let unsubscribeModelProgress: (() => void) | null = null;
  let disposed = false;

  const spokenResponseEnabled = computed(() => ttsMode.value !== "disabled");
  const spokenResponseToggleTitle = computed(() =>
    spokenResponseEnabled.value
      ? t("aiChatV2.voice.disable_spoken_responses") ||
        "Disable spoken responses"
      : t("aiChatV2.voice.enable_spoken_responses") || "Enable spoken responses"
  );
  const missingInputModel = computed(
    () =>
      inputEnabled.value &&
      (status.value?.sttState === "missing_model" ||
        status.value?.sttState === "unavailable")
  );
  const runtimeUnavailable = computed(() => {
    if (!inputEnabled.value) return false;
    // PRD §10.4: prompt for the downloadable voice-sherpa runtime when
    // absent, even if a legacy bundled sherpa addon still satisfies sttState.
    if (!isLocalAiRuntimeUsable(localRuntimeStatus.value?.state)) {
      return true;
    }
    return status.value?.sttState === "unavailable";
  });
  const chatReady = computed(() => options.chatReady());
  const runtimeInstallPercent = computed<number | undefined>(() => {
    if (runtimeModelProgress.value?.pct !== undefined) {
      return runtimeModelProgress.value.pct;
    }
    return runtimeInstallProgress.value?.percent;
  });
  const runtimeInstallSizeText = computed(() => {
    const offer = runtimeInstallOffer.value;
    if (!offer) return "";
    return (
      t("aiChatV2.voice.runtime_install_size", {
        runtimeSize: formatBytes(offer.archiveSizeBytes),
        modelSize: "198MB",
      }) ||
      `Runtime download: ${formatBytes(
        offer.archiveSizeBytes
      )}. Whisper Base model: ~198MB.`
    );
  });
  const runtimeInstallProgressText = computed(() => {
    const modelProgress = runtimeModelProgress.value;
    if (modelProgress) {
      if (modelProgress.phase === "downloading") {
        return (
          t("aiChatV2.voice.runtime_install_downloading_model", {
            pct: modelProgress.pct ?? 0,
          }) || `Downloading Whisper Base... ${modelProgress.pct ?? 0}%`
        );
      }
      if (modelProgress.phase === "verifying") {
        return (
          t("aiChatV2.voice.runtime_install_verifying_model") ||
          "Verifying Whisper Base..."
        );
      }
      if (modelProgress.phase === "extracting") {
        return (
          t("aiChatV2.voice.runtime_install_extracting_model") ||
          "Installing Whisper Base..."
        );
      }
    }
    const progress = runtimeInstallProgress.value;
    if (!progress) {
      return (
        t("aiChatV2.voice.runtime_install_preparing") || "Preparing download..."
      );
    }
    const phaseKey = `localAiRuntime.${progress.phase}`;
    const phaseText = t(phaseKey) || progress.phase;
    if (progress.percent !== undefined) {
      return `${phaseText} ${progress.percent}%`;
    }
    return phaseText;
  });

  function applySettings(next: AiChatVoiceSettingsView): void {
    settings.value = next;
    inputEnabled.value = next.inputMode === "push_to_talk";
    autoSend.value = next.autoSendTranscript;
    maxRecordingMs.value = next.maxRecordingMs;
    ttsMode.value = next.ttsMode;
    // Push the full TTS option set so spoken responses use the saved
    // language/voice/speed. "auto" language defers detection to the worker;
    // an unset voice id is omitted.
    speechController.updateOptions({
      ttsMode: next.ttsMode,
      ...(next.ttsLanguage !== "auto" ? { language: next.ttsLanguage } : {}),
      ...(next.ttsVoiceId !== undefined ? { voiceId: next.ttsVoiceId } : {}),
      speed: next.ttsSpeed,
    });
  }

  async function loadSettings(): Promise<void> {
    try {
      const [loadedSettings, runtime, localRuntime] = await Promise.all([
        getVoiceSettings(),
        getVoiceStatus(),
        getLocalAiRuntimeStatus(VOICE_SHERPA_RUNTIME_ID).catch(() => null),
      ]);
      if (disposed) return;
      applySettings(loadedSettings);
      status.value = runtime;
      localRuntimeStatus.value = localRuntime;
      if (
        runtime.sttState !== "missing_model" &&
        runtime.sttState !== "unavailable"
      ) {
        modelInstallError.value = null;
      }
    } catch {
      // Settings load failure: voice actions show unavailable/setup state;
      // typed chat remains usable (design §11.4).
      inputEnabled.value = false;
      autoSend.value = false;
      maxRecordingMs.value = DEFAULT_MAX_RECORDING_MS;
      settings.value = null;
      ttsMode.value = "disabled";
      speechController.updateOptions({ ttsMode: "disabled" });
      status.value = null;
      localRuntimeStatus.value = null;
    }
  }

  async function toggleSpokenResponse(): Promise<void> {
    if (settingsSaving.value) return;
    settingsSaving.value = true;
    modelInstallError.value = null;
    playbackError.value = null;
    ttsInstallPrompt.value = false;
    try {
      const current = settings.value ?? (await getVoiceSettings());
      const enabling = current.ttsMode === "disabled";
      if (enabling) {
        // Verify the TTS runtime + model are installed before persisting an
        // enablement that would silently fail on every reply.
        const runtime = await getVoiceStatus();
        status.value = runtime;
        if (runtime.ttsState === "unavailable") {
          await installRequiredRuntime();
          return;
        }
        if (runtime.ttsState === "missing_model") {
          ttsInstallPrompt.value = true;
          return;
        }
      }
      const saved = await setVoiceSettings({
        ...current,
        ttsMode: enabling ? "all_assistant_messages" : "disabled",
      });
      applySettings(saved);
    } catch (err) {
      modelInstallError.value =
        err instanceof Error ? err.message : String(err);
    } finally {
      settingsSaving.value = false;
    }
  }

  async function installRequiredModel(): Promise<void> {
    if (modelInstalling.value) return;
    modelInstalling.value = true;
    modelInstallError.value = null;
    try {
      await downloadVoiceModel(
        status.value?.sttModelId ?? "sherpa-onnx:stt:auto"
      );
      await loadSettings();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      modelInstallError.value = `${
        t("aiChatV2.voice.model_install_failed") ||
        "Voice model installation failed."
      } ${msg}`;
      await loadSettings();
    } finally {
      modelInstalling.value = false;
    }
  }

  async function installTtsModel(): Promise<void> {
    if (modelInstalling.value) return;
    modelInstalling.value = true;
    modelInstallError.value = null;
    ttsInstallPrompt.value = false;
    try {
      const ttsModelId = settings.value?.ttsModelId ?? "sherpa-onnx:tts:auto";
      await downloadVoiceModel(ttsModelId);
      notifyVoiceModelsChanged();
      await loadSettings();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      modelInstallError.value = `${
        t("aiChatV2.voice.tts_model_install_failed") ||
        "Speech model installation failed."
      } ${msg}`;
      await loadSettings();
    } finally {
      modelInstalling.value = false;
    }
  }

  async function installRequiredRuntime(): Promise<void> {
    if (runtimeInstalling.value) return;
    runtimeInstallError.value = null;
    runtimeInstallOffer.value = null;
    runtimeInstallProgress.value = null;
    runtimeModelProgress.value = null;
    runtimeInstallDialog.value = true;
    try {
      runtimeInstallOffer.value = await prepareLocalAiRuntimeInstall(
        VOICE_SHERPA_RUNTIME_ID
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtimeInstallError.value = `${
        t("aiChatV2.voice.runtime_install_prepare_failed") ||
        "Could not prepare the voice runtime download."
      } ${msg}`;
    }
  }

  async function confirmRuntimeInstall(): Promise<void> {
    if (runtimeInstalling.value) return;
    runtimeInstalling.value = true;
    modelInstalling.value = true;
    runtimeInstallError.value = null;
    modelInstallError.value = null;
    runtimeInstallProgress.value = null;
    runtimeModelProgress.value = null;
    try {
      const offer = await prepareLocalAiRuntimeInstall(VOICE_SHERPA_RUNTIME_ID);
      runtimeInstallOffer.value = offer;
      await installLocalAiRuntime({
        operationId: offer.operationId,
        runtimeId: offer.runtimeId,
        expectedRuntimeVersion: offer.runtimeVersion,
        consentToken: offer.consentToken,
      });
      await downloadVoiceModel(DEFAULT_VOICE_STT_MODEL_ID);
      notifyVoiceModelsChanged();
      const current = settings.value ?? (await getVoiceSettings());
      const saved = await setVoiceSettings({
        ...current,
        inputMode: "push_to_talk",
        sttModelId: DEFAULT_VOICE_STT_MODEL_ID,
      });
      applySettings(saved);
      await loadSettings();
      runtimeInstallDialog.value = false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtimeInstallError.value = `${
        t("aiChatV2.voice.runtime_install_failed") ||
        "Voice runtime installation failed."
      } ${msg}`;
      await loadSettings();
    } finally {
      runtimeInstalling.value = false;
      modelInstalling.value = false;
      runtimeInstallProgress.value = null;
      runtimeModelProgress.value = null;
    }
  }

  function stopSpeechPlayback(): void {
    speechController.stop();
  }

  async function stopSpeaking(): Promise<void> {
    playbackError.value = null;
    speechController.stop();
    try {
      await cancelVoiceJob();
    } catch {
      // No active job — nothing to stop.
    }
  }

  function onRecordingStart(): void {
    playbackError.value = null;
    speechController.stop();
    void cancelVoiceJob();
  }

  function beginAssistantResponse(latestInputWasVoice: boolean): void {
    playbackError.value = null;
    speechController.updateOptions({ latestInputWasVoice });
    speechController.start();
  }

  function pushAssistantDelta(delta: string): void {
    speechController.pushDelta(delta);
  }

  function completeAssistantResponse(): void {
    speechController.flush();
  }

  function handleSettingsChanged(): void {
    void loadSettings();
  }

  function startSubscriptions(): void {
    window.addEventListener(
      AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT,
      handleSettingsChanged
    );
    // Model install/remove changes installed status without altering
    // settings; reload status so the mic button reflects availability live.
    window.addEventListener(
      AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT,
      handleSettingsChanged
    );
    unsubscribeRuntimeProgress = onLocalAiRuntimeProgress((progress) => {
      if (progress.runtimeId !== VOICE_SHERPA_RUNTIME_ID) return;
      runtimeInstallProgress.value = progress;
      if (progress.phase === "done") {
        void getLocalAiRuntimeStatus(VOICE_SHERPA_RUNTIME_ID)
          .then((next) => {
            localRuntimeStatus.value = next;
          })
          .catch(() => undefined);
      }
    });
    unsubscribeModelProgress = onVoiceModelDownloadProgress((progress) => {
      if (progress.modelId !== DEFAULT_VOICE_STT_MODEL_ID) return;
      runtimeModelProgress.value = progress;
    });
  }

  startSubscriptions();

  function dispose(): void {
    disposed = true;
    speechController.stop();
    unsubscribeSpeaking();
    window.removeEventListener(
      AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT,
      handleSettingsChanged
    );
    window.removeEventListener(
      AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT,
      handleSettingsChanged
    );
    unsubscribeRuntimeProgress?.();
    unsubscribeRuntimeProgress = null;
    unsubscribeModelProgress?.();
    unsubscribeModelProgress = null;
  }

  // Component unmount stops local playback resources and subscriptions
  // without cancelling the AI run (design §11.4). Explicit dispose() calls
  // are idempotent with this hook.
  if (getCurrentScope()) {
    onScopeDispose(dispose);
  }

  return {
    inputEnabled,
    autoSend,
    maxRecordingMs,
    ttsMode,
    spokenResponseEnabled,
    spokenResponseToggleTitle,
    speaking,
    settingsSaving,
    modelInstalling,
    modelInstallError,
    ttsInstallPrompt,
    playbackError,
    missingInputModel,
    runtimeUnavailable,
    chatReady,
    runtimeInstallDialog,
    runtimeInstalling,
    runtimeInstallError,
    runtimeInstallSizeText,
    runtimeInstallProgressText,
    runtimeInstallPercent,
    loadSettings,
    toggleSpokenResponse,
    installRequiredModel,
    installTtsModel,
    installRequiredRuntime,
    confirmRuntimeInstall,
    stopSpeaking,
    onRecordingStart,
    beginAssistantResponse,
    pushAssistantDelta,
    completeAssistantResponse,
    stopSpeechPlayback,
    dispose,
  };
}
