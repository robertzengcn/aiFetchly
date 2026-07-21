/**
 * Renderer-side wrappers for the AiChatV2 local voice channels.
 *
 * Each call goes through the preload `invoke` allowlist and the typed main-
 * process handlers in `src/main-process/communication/ai-chat-v2-voice-ipc.ts`.
 * `windowInvoke` unwraps the `CommonMessage` envelope and returns the inner
 * `data` payload, so the return type matches the inner payload directly.
 *
 * Design: docs/prd/local-sherpa-onnx-voice-chat-technical-design.md §3.1, §6.
 */

import { windowInvoke } from "@/views/utils/apirequest";
import type {
  AiChatVoiceSettingsView,
  AiChatVoiceRuntimeStatus,
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

/** Read STT/TTS runtime + model availability (no audio payload). */
export function getVoiceStatus(): Promise<AiChatVoiceRuntimeStatus> {
  return windowInvoke(AI_CHAT_V2_VOICE_STATUS, {});
}

/**
 * Transcribe a recorded audio payload. The renderer is responsible for
 * capturing audio (BrowserVoiceRecorder) and encoding it as base64 with a
 * supported MIME type before calling this.
 */
export function transcribeVoice(
  request: AiChatVoiceTranscribeRequest
): Promise<AiChatVoiceTranscribeResponse> {
  return windowInvoke(AI_CHAT_V2_VOICE_TRANSCRIBE, request);
}

/** Synthesize speech (TTS) from sanitized assistant text. */
export function synthesizeVoice(
  request: AiChatVoiceTtsRequest
): Promise<AiChatVoiceTtsResponse> {
  return windowInvoke(AI_CHAT_V2_VOICE_TTS, request);
}

/** Best-effort cancel of an active STT/TTS job. Safe when no worker is active. */
export function cancelVoiceJob(jobId?: string): Promise<{ ok: boolean }> {
  return windowInvoke(AI_CHAT_V2_VOICE_CANCEL, jobId ? { jobId } : {});
}

/** Read the persisted voice settings view (typed, with defaults applied). */
export function getVoiceSettings(): Promise<AiChatVoiceSettingsView> {
  return windowInvoke(AI_CHAT_V2_VOICE_GET_SETTINGS, {});
}

/** Validate and persist a voice settings view; returns the persisted view. */
export function setVoiceSettings(
  settings: AiChatVoiceSettingsView
): Promise<AiChatVoiceSettingsView> {
  return windowInvoke(AI_CHAT_V2_VOICE_SET_SETTINGS, settings);
}
