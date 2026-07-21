"use strict";
import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import {
  AI_CHAT_VOICE_MAX_AUDIO_BYTES,
  AI_CHAT_VOICE_MAX_TTS_CHARS,
  AI_CHAT_VOICE_MAX_ID_LENGTH,
  AI_CHAT_VOICE_MAX_LANGUAGE_LENGTH,
} from "@/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes";

/**
 * AiChatV2 voice worker message contracts.
 *
 * `z.discriminatedUnion("type", ...)` lets TypeScript narrow fields inside
 * each `switch(msg.type)` branch and rejects malformed messages at the
 * process boundary (defense-in-depth on top of the renderer-side validation in
 * `aiChatVoiceTypes.ts`). Mirrors the local-embedding worker schema pattern.
 */

const requestIdField = z.string().min(1).max(AI_CHAT_VOICE_MAX_ID_LENGTH);
const languageField = z
  .string()
  .min(1)
  .max(AI_CHAT_VOICE_MAX_LANGUAGE_LENGTH)
  .optional();
/** Base64 length cap matching the decoded audio byte cap (+padding slack). */
const audioBase64Field = z
  .string()
  .min(1)
  .max(Math.ceil((AI_CHAT_VOICE_MAX_AUDIO_BYTES * 4) / 3) + 4);

// ─── Main → Worker (inbound) ─────────────────────────────────────────────────

const aiChatVoiceInitSchema = z.object({
  type: z.literal("initialize"),
  requestId: requestIdField,
  sttModelPath: z.string().min(1).max(AI_CHAT_VOICE_MAX_ID_LENGTH).optional(),
  ttsModelPath: z.string().min(1).max(AI_CHAT_VOICE_MAX_ID_LENGTH).optional(),
  sttLanguage: languageField,
  ttsLanguage: languageField,
});

const aiChatVoiceTranscribeSchema = z.object({
  type: z.literal("transcribe"),
  requestId: requestIdField,
  audioBase64: audioBase64Field,
  mimeType: z.string().min(1).max(64),
  language: languageField,
});

const aiChatVoiceSynthesizeSchema = z.object({
  type: z.literal("synthesize"),
  requestId: requestIdField,
  text: z.string().min(1).max(AI_CHAT_VOICE_MAX_TTS_CHARS),
  language: languageField,
  voiceId: z.string().min(1).max(AI_CHAT_VOICE_MAX_ID_LENGTH).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
});

const aiChatVoiceCancelSchema = z.object({
  type: z.literal("cancel"),
  requestId: requestIdField,
  targetRequestId: requestIdField.optional(),
});

const aiChatVoiceShutdownSchema = z.object({
  type: z.literal("shutdown"),
  requestId: requestIdField,
});

export const aiChatVoiceInboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    aiChatVoiceInitSchema,
    aiChatVoiceTranscribeSchema,
    aiChatVoiceSynthesizeSchema,
    aiChatVoiceCancelSchema,
    aiChatVoiceShutdownSchema,
  ]),
);

// ─── Worker → Main (outbound) ────────────────────────────────────────────────

export const aiChatVoiceOutboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("ready"),
      requestId: requestIdField,
      sttAvailable: z.boolean(),
      ttsAvailable: z.boolean(),
    }),
    z.object({
      type: z.literal("transcribe-result"),
      requestId: requestIdField,
      transcript: z.string(),
      language: languageField,
      durationMs: z.number().int().nonnegative().optional(),
    }),
    z.object({
      type: z.literal("synthesize-result"),
      requestId: requestIdField,
      audioBase64: z.string().min(1),
      mimeType: z.literal("audio/wav"),
      durationMs: z.number().int().nonnegative().optional(),
    }),
    z.object({
      type: z.literal("error"),
      requestId: requestIdField,
      error: z.string().min(1),
    }),
  ]),
);
