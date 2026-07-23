/**
 * AiChatV2 local voice chat — shared types, settings schema, and pure
 * Token<->typed settings conversion helpers.
 *
 * This module is intentionally free of Electron / database imports so it can
 * be unit-tested in isolation. The runtime service (`src/modules/AiChatVoiceModule.ts`)
 * and IPC handlers consume these pure building blocks.
 *
 * Design: docs/prd/local-sherpa-onnx-voice-chat-technical-design.md §5.
 */

import { z } from "zod/v4";
import {
  AI_CHAT_VOICE_INPUT_MODE,
  AI_CHAT_VOICE_TTS_MODE,
  AI_CHAT_VOICE_AUTO_SEND,
  AI_CHAT_VOICE_STT_LANGUAGE,
  AI_CHAT_VOICE_TTS_LANGUAGE,
  AI_CHAT_VOICE_STT_MODEL_ID,
  AI_CHAT_VOICE_TTS_MODEL_ID,
  AI_CHAT_VOICE_TTS_VOICE_ID,
  AI_CHAT_VOICE_TTS_SPEED,
  AI_CHAT_VOICE_MAX_RECORDING_MS,
} from "@/config/usersetting";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type AiChatVoiceInputMode = "disabled" | "push_to_talk";

export type AiChatVoiceTtsMode =
  | "disabled"
  | "after_voice_input"
  | "all_assistant_messages";

/** Zod schema for voice settings (v4). Drives parsing + validation. */
export const voiceSettingsSchema = z.object({
  inputMode: z.enum(["disabled", "push_to_talk"]),
  ttsMode: z.enum(["disabled", "after_voice_input", "all_assistant_messages"]),
  autoSendTranscript: z.boolean(),
  sttLanguage: z.string().trim().min(1).max(32),
  ttsLanguage: z.string().trim().min(1).max(32),
  sttModelId: z.string().trim().min(1).max(128),
  ttsModelId: z.string().trim().min(1).max(128),
  ttsVoiceId: z.string().trim().min(1).max(128).optional(),
  ttsSpeed: z.number().min(0.5).max(2.0),
  maxRecordingMs: z.number().int().min(1_000).max(600_000),
});

export type AiChatVoiceSettingsView = z.infer<typeof voiceSettingsSchema>;

/** Default voice settings (design §7). Voice input + spoken responses are OFF. */
export const DEFAULT_VOICE_SETTINGS: AiChatVoiceSettingsView = {
  inputMode: "disabled",
  ttsMode: "disabled",
  autoSendTranscript: false,
  sttLanguage: "auto",
  ttsLanguage: "auto",
  sttModelId: "sherpa-onnx:stt:auto",
  ttsModelId: "sherpa-onnx:tts:auto",
  ttsSpeed: 1,
  maxRecordingMs: 60_000,
};

// ---------------------------------------------------------------------------
// Runtime status
// ---------------------------------------------------------------------------

export type AiChatVoiceRuntimeState =
  | "unavailable"
  | "missing_model"
  | "loading"
  | "ready"
  | "error";

export interface AiChatVoiceRuntimeStatus {
  sttState: AiChatVoiceRuntimeState;
  ttsState: AiChatVoiceRuntimeState;
  sttModelId?: string;
  ttsModelId?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Renderer <-> Main IPC request / response types (design §5.3)
// ---------------------------------------------------------------------------

export interface AiChatVoiceTranscribeRequest {
  audioBase64: string;
  mimeType: string;
  language?: string;
  conversationId?: string;
}

export interface AiChatVoiceTranscribeResponse {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface AiChatVoiceTtsRequest {
  text: string;
  language?: string;
  modelId?: string;
  voiceId?: string;
  speed?: number;
  conversationId?: string;
}

export interface AiChatVoiceTtsResponse {
  audioBase64: string;
  mimeType: "audio/wav";
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// IPC payload limits + MIME allowlist (design §8.3)
// ---------------------------------------------------------------------------

/** Hard cap on a single audio payload (12 MB). */
/** Progress event for model downloads (main → renderer). */
export interface VoiceModelDownloadProgress {
  readonly modelId: string;
  readonly phase: "downloading" | "verifying" | "extracting" | "done" | "error";
  readonly pct?: number;
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
  readonly error?: string;
}

export const AI_CHAT_VOICE_MAX_AUDIO_BYTES = 12 * 1024 * 1024;
/** Hard cap on a single TTS synthesis text (chars). */
export const AI_CHAT_VOICE_MAX_TTS_CHARS = 1_200;

export const AI_CHAT_VOICE_AUDIO_MIME_TYPES: ReadonlySet<string> = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
]);

// ---------------------------------------------------------------------------
// Pure Token <-> typed settings conversion
// ---------------------------------------------------------------------------

/** Token settings keys that back a voice settings view. */
export const VOICE_SETTING_TOKEN_KEYS = [
  AI_CHAT_VOICE_INPUT_MODE,
  AI_CHAT_VOICE_TTS_MODE,
  AI_CHAT_VOICE_AUTO_SEND,
  AI_CHAT_VOICE_STT_LANGUAGE,
  AI_CHAT_VOICE_TTS_LANGUAGE,
  AI_CHAT_VOICE_STT_MODEL_ID,
  AI_CHAT_VOICE_TTS_MODEL_ID,
  AI_CHAT_VOICE_TTS_VOICE_ID,
  AI_CHAT_VOICE_TTS_SPEED,
  AI_CHAT_VOICE_MAX_RECORDING_MS,
] as const;

/** Read a raw Token value, returning undefined for empty/whitespace strings. */
function readToken(
  raw: Partial<Record<string, string | undefined>>,
  key: string
): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/** Parse a bounded float; fall back to `fallback` when absent/invalid. */
function parseBoundedFloat(
  raw: Partial<Record<string, string | undefined>>,
  key: string,
  min: number,
  max: number,
  fallback: number
): number {
  const value = readToken(raw, key);
  if (value === undefined) {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

/** Parse a bounded integer; fall back to `fallback` when absent/invalid. */
function parseBoundedInt(
  raw: Partial<Record<string, string | undefined>>,
  key: string,
  min: number,
  max: number,
  fallback: number
): number {
  const value = readToken(raw, key);
  if (value === undefined) {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isInteger(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

function parseEnum<T extends string>(
  raw: Partial<Record<string, string | undefined>>,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = readToken(raw, key);
  if (value !== undefined && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}

/**
 * Parse a Token key->string map into a validated `AiChatVoiceSettingsView`.
 * Unknown / invalid values fall back to the documented defaults rather than
 * throwing, so a corrupted store never blocks the chat UI.
 */
export function parseVoiceSettings(
  raw: Partial<Record<string, string | undefined>>
): AiChatVoiceSettingsView {
  const candidate: AiChatVoiceSettingsView = {
    inputMode: parseEnum(
      raw,
      AI_CHAT_VOICE_INPUT_MODE,
      ["disabled", "push_to_talk"] as const,
      DEFAULT_VOICE_SETTINGS.inputMode
    ),
    ttsMode: parseEnum(
      raw,
      AI_CHAT_VOICE_TTS_MODE,
      ["disabled", "after_voice_input", "all_assistant_messages"] as const,
      DEFAULT_VOICE_SETTINGS.ttsMode
    ),
    autoSendTranscript: readToken(raw, AI_CHAT_VOICE_AUTO_SEND) === "true",
    sttLanguage:
      readToken(raw, AI_CHAT_VOICE_STT_LANGUAGE) ??
      DEFAULT_VOICE_SETTINGS.sttLanguage,
    ttsLanguage:
      readToken(raw, AI_CHAT_VOICE_TTS_LANGUAGE) ??
      DEFAULT_VOICE_SETTINGS.ttsLanguage,
    sttModelId:
      readToken(raw, AI_CHAT_VOICE_STT_MODEL_ID) ??
      DEFAULT_VOICE_SETTINGS.sttModelId,
    ttsModelId:
      readToken(raw, AI_CHAT_VOICE_TTS_MODEL_ID) ??
      DEFAULT_VOICE_SETTINGS.ttsModelId,
    ttsVoiceId: readToken(raw, AI_CHAT_VOICE_TTS_VOICE_ID) ?? undefined,
    ttsSpeed: parseBoundedFloat(
      raw,
      AI_CHAT_VOICE_TTS_SPEED,
      0.5,
      2.0,
      DEFAULT_VOICE_SETTINGS.ttsSpeed
    ),
    maxRecordingMs: parseBoundedInt(
      raw,
      AI_CHAT_VOICE_MAX_RECORDING_MS,
      1_000,
      600_000,
      DEFAULT_VOICE_SETTINGS.maxRecordingMs
    ),
  };
  const parsed = voiceSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { ...DEFAULT_VOICE_SETTINGS };
}

/**
 * Serialize a settings view into the Token key->string map shape. The inverse
 * of `parseVoiceSettings`. Optional fields that are empty/undefined are
 * omitted so the Token store does not accumulate empty strings.
 */
export function serializeVoiceSettings(
  settings: AiChatVoiceSettingsView
): Record<string, string> {
  const out: Record<string, string> = {
    [AI_CHAT_VOICE_INPUT_MODE]: settings.inputMode,
    [AI_CHAT_VOICE_TTS_MODE]: settings.ttsMode,
    [AI_CHAT_VOICE_AUTO_SEND]: settings.autoSendTranscript ? "true" : "false",
    [AI_CHAT_VOICE_STT_LANGUAGE]: settings.sttLanguage,
    [AI_CHAT_VOICE_TTS_LANGUAGE]: settings.ttsLanguage,
    [AI_CHAT_VOICE_STT_MODEL_ID]: settings.sttModelId,
    [AI_CHAT_VOICE_TTS_MODEL_ID]: settings.ttsModelId,
    [AI_CHAT_VOICE_TTS_SPEED]: String(settings.ttsSpeed),
    [AI_CHAT_VOICE_MAX_RECORDING_MS]: String(settings.maxRecordingMs),
  };
  if (settings.ttsVoiceId) {
    out[AI_CHAT_VOICE_TTS_VOICE_ID] = settings.ttsVoiceId;
  }
  return out;
}

// ---------------------------------------------------------------------------
// IPC payload validation (pure; used by the main-process handlers)
// ---------------------------------------------------------------------------

export interface VoiceValidationOk<T> {
  ok: true;
  value: T;
}
export interface VoiceValidationErr {
  ok: false;
  error: string;
}
export type VoiceValidationResult<T> =
  | VoiceValidationOk<T>
  | VoiceValidationErr;

/** Approximate decoded byte length of a base64 string (4 chars -> 3 bytes). */
function base64DecodedBytes(base64: string): number {
  const len = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Validate a transcription request: non-empty base64, allowed MIME type, and
 * decoded size within the configured cap. Returns the validated request or a
 * user-safe error string.
 */
export function validateTranscribeRequest(
  input: unknown
): VoiceValidationResult<AiChatVoiceTranscribeRequest> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Invalid voice transcribe request." };
  }
  const { audioBase64, mimeType, language, conversationId } = input as {
    audioBase64?: unknown;
    mimeType?: unknown;
    language?: unknown;
    conversationId?: unknown;
  };
  if (typeof audioBase64 !== "string" || audioBase64.length === 0) {
    return { ok: false, error: "Audio payload is required." };
  }
  if (
    typeof mimeType !== "string" ||
    !AI_CHAT_VOICE_AUDIO_MIME_TYPES.has(mimeType)
  ) {
    return { ok: false, error: "Unsupported audio type." };
  }
  const bytes = base64DecodedBytes(audioBase64);
  if (bytes > AI_CHAT_VOICE_MAX_AUDIO_BYTES) {
    return { ok: false, error: "Audio payload is too large." };
  }
  if (
    language !== undefined &&
    (typeof language !== "string" || language.length > 32)
  ) {
    return { ok: false, error: "Invalid language value." };
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || conversationId.length > 128)
  ) {
    return { ok: false, error: "Invalid conversation id." };
  }
  return {
    ok: true,
    value: {
      audioBase64,
      mimeType,
      ...(language !== undefined ? { language } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
    },
  };
}

/**
 * Validate a TTS request: non-empty text within the char cap, optional speed
 * clamped to [0.5, 2.0], bounded optional language/voice/conversationId.
 */
export function validateTtsRequest(
  input: unknown
): VoiceValidationResult<AiChatVoiceTtsRequest> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Invalid voice TTS request." };
  }
  const { text, language, modelId, voiceId, speed, conversationId } = input as {
    text?: unknown;
    language?: unknown;
    modelId?: unknown;
    voiceId?: unknown;
    speed?: unknown;
    conversationId?: unknown;
  };
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "Text is required for speech." };
  }
  if (text.length > AI_CHAT_VOICE_MAX_TTS_CHARS) {
    return { ok: false, error: "Text is too long to synthesize." };
  }
  if (
    language !== undefined &&
    (typeof language !== "string" || language.length > 32)
  ) {
    return { ok: false, error: "Invalid language value." };
  }
  if (
    modelId !== undefined &&
    (typeof modelId !== "string" || modelId.length > 128)
  ) {
    return { ok: false, error: "Invalid model id." };
  }
  if (
    voiceId !== undefined &&
    (typeof voiceId !== "string" || voiceId.length > 128)
  ) {
    return { ok: false, error: "Invalid voice id." };
  }
  let clampedSpeed: number | undefined;
  if (speed !== undefined) {
    if (typeof speed !== "number" || !Number.isFinite(speed)) {
      return { ok: false, error: "Invalid speech speed." };
    }
    clampedSpeed = Math.min(2.0, Math.max(0.5, speed));
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || conversationId.length > 128)
  ) {
    return { ok: false, error: "Invalid conversation id." };
  }
  return {
    ok: true,
    value: {
      text,
      ...(language !== undefined ? { language } : {}),
      ...(modelId !== undefined ? { modelId } : {}),
      ...(voiceId !== undefined ? { voiceId } : {}),
      ...(clampedSpeed !== undefined ? { speed: clampedSpeed } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
    },
  };
}
