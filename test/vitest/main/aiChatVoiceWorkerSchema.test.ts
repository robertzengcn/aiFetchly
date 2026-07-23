import { describe, it, expect } from "vitest";
import {
  aiChatVoiceInboundSchema,
  aiChatVoiceOutboundSchema,
} from "@/schemas/worker/aiChatVoice";
import { AI_CHAT_VOICE_MAX_TTS_CHARS } from "@/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes";

describe("aiChatVoiceInboundSchema", () => {
  it("accepts each valid inbound variant", () => {
    const schema = aiChatVoiceInboundSchema();
    expect(
      schema.safeParse({ type: "initialize", requestId: "r1" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        type: "initialize",
        requestId: "r1",
        sttModelPath: "/m/stt",
        sttLanguage: "en",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        type: "transcribe",
        requestId: "r1",
        audioBase64: "AAAA",
        mimeType: "audio/webm;codecs=opus",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        type: "synthesize",
        requestId: "r1",
        text: "Hello world.",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ type: "cancel", requestId: "r1" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ type: "shutdown", requestId: "r1" }).success,
    ).toBe(true);
  });

  it("rejects an unknown message type", () => {
    const r = aiChatVoiceInboundSchema().safeParse({
      type: "do-something-else",
      requestId: "r1",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing/empty requestId", () => {
    const schema = aiChatVoiceInboundSchema();
    expect(
      schema.safeParse({ type: "shutdown", requestId: "" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ type: "shutdown" }).success,
    ).toBe(false);
  });

  it("rejects an empty transcribe payload", () => {
    const r = aiChatVoiceInboundSchema().safeParse({
      type: "transcribe",
      requestId: "r1",
      audioBase64: "",
      mimeType: "audio/webm",
    });
    expect(r.success).toBe(false);
  });

  it("rejects oversized TTS text", () => {
    const r = aiChatVoiceInboundSchema().safeParse({
      type: "synthesize",
      requestId: "r1",
      text: "A".repeat(AI_CHAT_VOICE_MAX_TTS_CHARS + 1),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-range TTS speed", () => {
    const schema = aiChatVoiceInboundSchema();
    expect(
      schema.safeParse({
        type: "synthesize",
        requestId: "r1",
        text: "hi",
        speed: 5,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        type: "synthesize",
        requestId: "r1",
        text: "hi",
        speed: 0.1,
      }).success,
    ).toBe(false);
  });

  it("accepts a clamped-range speed and optional voiceId", () => {
    const r = aiChatVoiceInboundSchema().safeParse({
      type: "synthesize",
      requestId: "r1",
      text: "hi",
      speed: 1.5,
      voiceId: "af-heart",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an over-long language tag", () => {
    const r = aiChatVoiceInboundSchema().safeParse({
      type: "transcribe",
      requestId: "r1",
      audioBase64: "AAAA",
      mimeType: "audio/webm",
      language: "x".repeat(64),
    });
    expect(r.success).toBe(false);
  });
});

describe("aiChatVoiceOutboundSchema", () => {
  it("accepts each valid outbound variant", () => {
    const schema = aiChatVoiceOutboundSchema();
    expect(
      schema.safeParse({
        type: "ready",
        requestId: "r1",
        sttAvailable: true,
        ttsAvailable: false,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        type: "transcribe-result",
        requestId: "r1",
        transcript: "hello",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        type: "synthesize-result",
        requestId: "r1",
        audioBase64: "//uQ",
        mimeType: "audio/wav",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ type: "error", requestId: "r1", error: "boom" })
        .success,
    ).toBe(true);
  });

  it("rejects a synthesize-result with the wrong MIME type", () => {
    const r = aiChatVoiceOutboundSchema().safeParse({
      type: "synthesize-result",
      requestId: "r1",
      audioBase64: "//uQ",
      mimeType: "audio/mp3",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an error with an empty message", () => {
    const r = aiChatVoiceOutboundSchema().safeParse({
      type: "error",
      requestId: "r1",
      error: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative durationMs", () => {
    const r = aiChatVoiceOutboundSchema().safeParse({
      type: "transcribe-result",
      requestId: "r1",
      transcript: "hi",
      durationMs: -5,
    });
    expect(r.success).toBe(false);
  });
});
