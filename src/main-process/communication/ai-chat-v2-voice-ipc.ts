import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  AiChatVoiceRuntimeStatus,
  AiChatVoiceSettingsView,
  AiChatVoiceTranscribeRequest,
  AiChatVoiceTranscribeResponse,
  AiChatVoiceTtsRequest,
  AiChatVoiceTtsResponse,
} from "@/entityTypes/aiChatVoiceTypes";
import {
  AI_CHAT_V2_VOICE_STATUS,
  AI_CHAT_V2_VOICE_TRANSCRIBE,
  AI_CHAT_V2_VOICE_TTS,
  AI_CHAT_V2_VOICE_CANCEL,
  AI_CHAT_V2_VOICE_GET_SETTINGS,
  AI_CHAT_V2_VOICE_SET_SETTINGS,
} from "@/config/channellist";
import { AiChatVoiceModule } from "@/modules/AiChatVoiceModule";
import { VoiceModelCatalogService } from "@/service/aiChatVoice/VoiceModelCatalogService";
import { VoiceModelDownloadService } from "@/service/aiChatVoice/VoiceModelDownloadService";
import { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeStateStore } from "@/service/localAiRuntime/LocalAiRuntimeStateStore";
import { LocalAiRuntimeResolver } from "@/service/localAiRuntime/LocalAiRuntimeResolver";
import { isSherpaOnnxNativeAvailable } from "@/service/aiChatVoice/SherpaOnnxNative";
import {
  AI_CHAT_V2_VOICE_MODEL_LIST,
  AI_CHAT_V2_VOICE_MODEL_DOWNLOAD,
  AI_CHAT_V2_VOICE_MODEL_DOWNLOAD_PROGRESS,
  AI_CHAT_V2_VOICE_MODEL_CANCEL_DOWNLOAD,
} from "@/config/channellist";

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}
function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

/** Parse an IPC arg that may arrive as a JSON string or an object. */
function parseArg<T>(data: unknown): T | null {
  if (data == null) {
    return null;
  }
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }
  return data as T;
}

/**
 * Build a module instance with the app-owned model directory. Per-call so a
 * settings/model change between calls is reflected without stale state.
 */
function voiceModule(): AiChatVoiceModule {
  return new AiChatVoiceModule({
    modelRoot: path.join(app.getPath("userData"), "voice-models"),
  });
}

async function isVoiceRuntimeAvailable(): Promise<boolean> {
  if (isSherpaOnnxNativeAvailable()) {
    return true;
  }
  try {
    const paths = new LocalAiRuntimePathService(app.getPath("userData"));
    const state = new LocalAiRuntimeStateStore(paths);
    const appInfo = app as {
      getVersion?: () => string;
    };
    const resolver = new LocalAiRuntimeResolver(paths, state, {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron ?? "",
      nodeModuleAbi: String(process.versions.modules ?? ""),
      appVersion: appInfo.getVersion?.() ?? "0.0.0",
    });
    const resolved = await resolver.resolve("voice-sherpa");
    return (
      resolved !== null && isSherpaOnnxNativeAvailable(resolved.runtimeRoot)
    );
  } catch {
    return false;
  }
}

/**
 * Register AiChatV2 local voice IPC handlers (design §6).
 *
 * All channels are request/response (no streaming events). Payload validation
 * (MIME / size / text-length / speed) happens inside the module before any
 * worker call. Local STT/TTS does not require hosted AI entitlement; sending
 * a transcribed message still goes through the existing AiChatV2 chat
 * availability resolver.
 */
export function registerAiChatVoiceIpcHandlers(): void {
  ipcMain.handle(
    AI_CHAT_V2_VOICE_STATUS,
    async (): Promise<CommonMessage<AiChatVoiceRuntimeStatus>> => {
      try {
        return ok(
          voiceModule().getRuntimeStatus(await isVoiceRuntimeAvailable())
        );
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_CHAT_V2_VOICE_GET_SETTINGS,
    async (): Promise<CommonMessage<AiChatVoiceSettingsView>> => {
      try {
        return ok(voiceModule().getSettingsView());
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_CHAT_V2_VOICE_SET_SETTINGS,
    async (
      _e,
      data: unknown
    ): Promise<CommonMessage<AiChatVoiceSettingsView>> => {
      try {
        const view = parseArg<AiChatVoiceSettingsView>(data);
        if (!view) {
          return denied("Voice settings are required.");
        }
        return ok(voiceModule().saveSettings(view));
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_CHAT_V2_VOICE_TRANSCRIBE,
    async (
      _e,
      data: unknown
    ): Promise<CommonMessage<AiChatVoiceTranscribeResponse>> => {
      try {
        const request = parseArg<AiChatVoiceTranscribeRequest>(data);
        if (!request) {
          return denied("Voice transcribe request is required.");
        }
        return ok(await voiceModule().transcribe(request));
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_CHAT_V2_VOICE_TTS,
    async (
      _e,
      data: unknown
    ): Promise<CommonMessage<AiChatVoiceTtsResponse>> => {
      try {
        const request = parseArg<AiChatVoiceTtsRequest>(data);
        if (!request) {
          return denied("Voice TTS request is required.");
        }
        return ok(await voiceModule().synthesize(request));
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_CHAT_V2_VOICE_CANCEL,
    async (_e, data: unknown): Promise<CommonMessage<{ ok: boolean }>> => {
      try {
        // Accept either { jobId } or a bare jobId string for flexibility.
        const parsed = parseArg<{ jobId?: string } | string>(data);
        const jobId = typeof parsed === "string" ? parsed : parsed?.jobId;
        return ok(await voiceModule().cancel(jobId));
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // --- Phase 5: Model catalog + consent-gated download ---

  let downloadService: VoiceModelDownloadService | null = null;
  function getDownloadService(): VoiceModelDownloadService {
    if (!downloadService) {
      downloadService = new VoiceModelDownloadService({
        modelRoot: path.join(app.getPath("userData"), "voice-models"),
      });
    }
    return downloadService;
  }

  ipcMain.handle(
    AI_CHAT_V2_VOICE_MODEL_LIST,
    async (): Promise<CommonMessage<unknown[]>> => {
      try {
        const catalog = new VoiceModelCatalogService({
          modelRoot: path.join(app.getPath("userData"), "voice-models"),
        });
        return ok(catalog.listModels());
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_CHAT_V2_VOICE_MODEL_DOWNLOAD,
    async (_e, data: unknown): Promise<CommonMessage<{ ok: boolean }>> => {
      const req = parseArg<{ modelId: string }>(data);
      if (!req?.modelId) {
        return denied("modelId is required.");
      }
      try {
        await getDownloadService().downloadModel(req.modelId, (progress) => {
          const windows = BrowserWindow.getAllWindows();
          const win = windows[0] as
            | {
                isDestroyed: () => boolean;
                webContents: {
                  send: (channel: string, payload: unknown) => void;
                };
              }
            | undefined;
          if (win && !win.isDestroyed()) {
            win.webContents.send(
              AI_CHAT_V2_VOICE_MODEL_DOWNLOAD_PROGRESS,
              progress
            );
          }
        });
        return ok({ ok: true });
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_CHAT_V2_VOICE_MODEL_CANCEL_DOWNLOAD,
    async (_e, data: unknown): Promise<CommonMessage<{ ok: boolean }>> => {
      const req = parseArg<{ modelId: string }>(data);
      if (!req?.modelId) {
        return denied("modelId is required.");
      }
      getDownloadService().cancelDownload(req.modelId);
      return ok({ ok: true });
    }
  );
}
