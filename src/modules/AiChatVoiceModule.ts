/**
 * AiChatVoiceModule — main-process orchestrator for local voice chat.
 *
 * Owns: voice settings persistence (Token), runtime/model status resolution,
 * and delegation of STT/TTS to `SherpaVoiceWorkerClient`. It performs NO
 * audio inference itself and stores NO chat data (design §8.1).
 *
 * Dependency-injectable (`AiChatVoiceModuleDeps`) so logic is unit-testable
 * with a mocked Token + worker client + filesystem, with no Electron APIs.
 */

import * as path from "path";
import * as fs from "fs";
import { Token } from "@/modules/token";
import { SherpaVoiceWorkerClient } from "@/service/aiChatVoice/SherpaVoiceWorkerClient";
import { isSherpaOnnxNativeAvailable } from "@/service/aiChatVoice/SherpaOnnxNative";
import { VoiceModelCatalogService } from "@/service/aiChatVoice/VoiceModelCatalogService";
import {
  parseVoiceSettings,
  serializeVoiceSettings,
  voiceSettingsSchema,
  validateTranscribeRequest,
  validateTtsRequest,
  VOICE_SETTING_TOKEN_KEYS,
  type AiChatVoiceSettingsView,
  type AiChatVoiceRuntimeState,
  type AiChatVoiceRuntimeStatus,
  type AiChatVoiceTranscribeRequest,
  type AiChatVoiceTranscribeResponse,
  type AiChatVoiceTtsRequest,
  type AiChatVoiceTtsResponse,
} from "@/entityTypes/aiChatVoiceTypes";

export interface AiChatVoiceModuleDeps {
  readonly token?: Token;
  readonly workerClient?: SherpaVoiceWorkerClient;
  /** Directory where resolved model files are expected to live. */
  readonly modelRoot?: string;
  readonly fileExists?: (filePath: string) => boolean;
  readonly runtimeAvailable?: () => boolean;
}

export class AiChatVoiceModule {
  private readonly token: Token;
  private readonly client: SherpaVoiceWorkerClient;
  private readonly modelRoot: string;
  private readonly fileExists: (filePath: string) => boolean;
  private readonly runtimeAvailable: () => boolean;
  private readonly catalog: VoiceModelCatalogService;

  constructor(deps: AiChatVoiceModuleDeps = {}) {
    this.token = deps.token ?? new Token();
    this.client = deps.workerClient ?? SherpaVoiceWorkerClient.getInstance();
    this.modelRoot = deps.modelRoot ?? path.join(process.cwd(), "voice-models");
    this.fileExists = deps.fileExists ?? ((p: string) => fs.existsSync(p));
    this.runtimeAvailable =
      deps.runtimeAvailable ?? isSherpaOnnxNativeAvailable;
    this.catalog = new VoiceModelCatalogService({
      modelRoot: this.modelRoot,
      fileExists: this.fileExists,
    });
  }

  /** Read persisted settings, typed + defaulted (never throws). */
  getSettingsView(): AiChatVoiceSettingsView {
    const raw: Record<string, string | undefined> = {};
    for (const key of VOICE_SETTING_TOKEN_KEYS) {
      const value = this.token.getValue(key);
      raw[key] =
        typeof value === "string" && value.length > 0 ? value : undefined;
    }
    return parseVoiceSettings(raw);
  }

  /** Validate + persist a settings view; returns the persisted typed view. */
  saveSettings(view: unknown): AiChatVoiceSettingsView {
    const parsed = voiceSettingsSchema.safeParse(view);
    if (!parsed.success) {
      throw new Error("Invalid voice settings.");
    }
    const serialized = serializeVoiceSettings(parsed.data);
    for (const [key, value] of Object.entries(serialized)) {
      this.token.setValue(key, value);
    }
    return parsed.data;
  }

  /** Resolve STT/TTS model availability into a runtime status. */
  getRuntimeStatus(): AiChatVoiceRuntimeStatus {
    const settings = this.getSettingsView();
    const runtimeAvailable = this.runtimeAvailable();
    return {
      sttState: this.stateForModel(settings.sttModelId, runtimeAvailable),
      ttsState: this.stateForModel(settings.ttsModelId, runtimeAvailable),
      sttModelId: settings.sttModelId,
      ttsModelId: settings.ttsModelId,
      ...(!runtimeAvailable
        ? {
            errorMessage:
              "Local voice runtime is unavailable. Install sherpa-onnx-node to enable local voice transcription.",
          }
        : {}),
    };
  }

  /** Transcribe audio via the worker; validates payload first. */
  async transcribe(
    request: AiChatVoiceTranscribeRequest
  ): Promise<AiChatVoiceTranscribeResponse> {
    const validation = validateTranscribeRequest(request);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    const settings = this.getSettingsView();
    const language = this.resolveLanguage(
      validation.value.language,
      settings.sttLanguage
    );
    const result = await this.client.transcribe(
      validation.value.audioBase64,
      validation.value.mimeType,
      language,
      {
        sttModelPath: this.resolveModelDir(settings.sttModelId) ?? undefined,
        sttLanguage: settings.sttLanguage,
      }
    );
    return {
      transcript: result.transcript,
      ...(result.language !== undefined ? { language: result.language } : {}),
      ...(result.durationMs !== undefined
        ? { durationMs: result.durationMs }
        : {}),
    };
  }

  /** Synthesize speech via the worker; validates payload first. */
  async synthesize(
    request: AiChatVoiceTtsRequest
  ): Promise<AiChatVoiceTtsResponse> {
    const validation = validateTtsRequest(request);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    const settings = this.getSettingsView();
    const language = this.resolveLanguage(
      validation.value.language,
      settings.ttsLanguage
    );
    const result = await this.client.synthesize(
      validation.value.text,
      {
        ...(language !== undefined ? { language } : {}),
        ...(validation.value.voiceId !== undefined
          ? { voiceId: validation.value.voiceId }
          : settings.ttsVoiceId !== undefined
          ? { voiceId: settings.ttsVoiceId }
          : {}),
        speed: validation.value.speed ?? settings.ttsSpeed,
      },
      {
        ttsModelPath: this.resolveModelDir(settings.ttsModelId) ?? undefined,
        ttsLanguage: settings.ttsLanguage,
      }
    );
    return {
      audioBase64: result.audioBase64,
      mimeType: "audio/wav",
      ...(result.durationMs !== undefined
        ? { durationMs: result.durationMs }
        : {}),
    };
  }

  /**
   * Best-effort cancel of active STT/TTS work (TODO P0-5). With a `jobId`
   * (worker requestId), cancels that single job; without it, cancels all
   * pending worker requests. The renderer separately clears its TTS playback
   * queue via `SpeechResponseController.stop()`. Safe when no worker is active.
   */
  async cancel(jobId?: string): Promise<{ ok: boolean }> {
    this.client.cancel(jobId);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------

  private stateForModel(
    modelId: string,
    runtimeAvailable: boolean
  ): AiChatVoiceRuntimeState {
    if (!runtimeAvailable) {
      return "unavailable";
    }
    const modelDir = this.resolveModelDir(modelId);
    if (modelDir === null || !this.catalog.isInstalled(modelId)) {
      return "missing_model";
    }
    return "ready";
  }

  /**
   * Map a logical voice model id to its downloaded model directory under
   * `modelRoot`. The consent-gated downloader (Phase 5) populates these
   * directories with the sherpa-onnx model files.
   */
  private resolveModelDir(modelId: string): string | null {
    return this.catalog.getModelPath(modelId);
  }

  /** Prefer an explicit request language; fall back to the setting unless "auto". */
  private resolveLanguage(
    requested: string | undefined,
    setting: string
  ): string | undefined {
    if (requested !== undefined) {
      return requested;
    }
    return setting === "auto" ? undefined : setting;
  }
}
