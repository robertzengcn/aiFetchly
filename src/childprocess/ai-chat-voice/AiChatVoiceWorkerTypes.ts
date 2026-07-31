/**
 * AiChatV2 local voice worker — protocol types + hard limits.
 *
 * Shared between the worker entry (`AiChatVoiceWorker.ts`), the worker client
 * (`SherpaVoiceWorkerClient.ts`), and the Zod schemas
 * (`src/schemas/worker/aiChatVoice.ts`). Design §5.4.
 *
 * Boundary rule (CLAUDE.md): this is worker-process code. It must NOT import
 * TypeORM, Models, Modules, or anything that touches the database.
 */

// ---------------------------------------------------------------------------
// Hard limits (cross-referenced by the renderer-side validation in
// aiChatVoiceTypes.ts and the worker Zod schemas).
// ---------------------------------------------------------------------------

/** Max decoded bytes of one STT audio payload (12 MB). */
export const AI_CHAT_VOICE_MAX_AUDIO_BYTES = 12 * 1024 * 1024;
/** Max chars of one TTS synthesis request. */
export const AI_CHAT_VOICE_MAX_TTS_CHARS = 1_200;
/** Per-request timeout for a worker round-trip (ms). */
export const AI_CHAT_VOICE_REQUEST_TIMEOUT_MS = 120_000;
/** Bounded lengths for optional id/language strings crossing the boundary. */
export const AI_CHAT_VOICE_MAX_ID_LENGTH = 128;
export const AI_CHAT_VOICE_MAX_LANGUAGE_LENGTH = 32;

// ---------------------------------------------------------------------------
// Main -> Worker (inbound)
// ---------------------------------------------------------------------------

export interface AiChatVoiceInitializeMessage {
  type: "initialize";
  requestId: string;
  sttModelPath?: string;
  ttsModelPath?: string;
  sttLanguage?: string;
  ttsLanguage?: string;
  /**
   * Optional downloaded voice-sherpa runtime root (Phase 7, design §16.2).
   * When present, the worker loads sherpa-onnx-node from this directory via a
   * scoped createRequire instead of the bundled package. Supplied by the main
   * process LocalAiRuntimeResolver — never renderer-provided.
   */
  runtimeRoot?: string;
}

export interface AiChatVoiceTranscribeMessage {
  type: "transcribe";
  requestId: string;
  audioBase64: string;
  mimeType: string;
  language?: string;
}

export interface AiChatVoiceSynthesizeMessage {
  type: "synthesize";
  requestId: string;
  text: string;
  language?: string;
  voiceId?: string;
  speed?: number;
}

export interface AiChatVoiceCancelMessage {
  type: "cancel";
  requestId: string;
  targetRequestId?: string;
}

export interface AiChatVoiceShutdownMessage {
  type: "shutdown";
  requestId: string;
}

export type AiChatVoiceInboundMessage =
  | AiChatVoiceInitializeMessage
  | AiChatVoiceTranscribeMessage
  | AiChatVoiceSynthesizeMessage
  | AiChatVoiceCancelMessage
  | AiChatVoiceShutdownMessage;

// ---------------------------------------------------------------------------
// Worker -> Main (outbound)
// ---------------------------------------------------------------------------

export interface AiChatVoiceReadyMessage {
  type: "ready";
  requestId: string;
  sttAvailable: boolean;
  ttsAvailable: boolean;
}

export interface AiChatVoiceTranscribeResultMessage {
  type: "transcribe-result";
  requestId: string;
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface AiChatVoiceSynthesizeResultMessage {
  type: "synthesize-result";
  requestId: string;
  audioBase64: string;
  mimeType: "audio/wav";
  durationMs?: number;
}

export interface AiChatVoiceErrorMessage {
  type: "error";
  requestId: string;
  error: string;
}

export type AiChatVoiceOutboundMessage =
  | AiChatVoiceReadyMessage
  | AiChatVoiceTranscribeResultMessage
  | AiChatVoiceSynthesizeResultMessage
  | AiChatVoiceErrorMessage;
