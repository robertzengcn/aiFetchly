import { describe, it, expect } from "vitest";
import {
  parseVoiceSettings,
  serializeVoiceSettings,
  validateTranscribeRequest,
  validateTtsRequest,
  DEFAULT_VOICE_SETTINGS,
  AI_CHAT_VOICE_MAX_AUDIO_BYTES,
  AI_CHAT_VOICE_MAX_TTS_CHARS,
  voiceSettingsSchema,
} from "@/entityTypes/aiChatVoiceTypes";
import {
  AI_CHAT_VOICE_INPUT_MODE,
  AI_CHAT_VOICE_TTS_MODE,
  AI_CHAT_VOICE_AUTO_SEND,
  AI_CHAT_VOICE_TTS_SPEED,
  AI_CHAT_VOICE_MAX_RECORDING_MS,
  AI_CHAT_VOICE_TTS_VOICE_ID,
  AI_CHAT_VOICE_STT_LANGUAGE,
} from "@/config/usersetting";

describe("voiceSettingsSchema", () => {
  it("accepts the documented defaults", () => {
    const parsed = voiceSettingsSchema.safeParse(DEFAULT_VOICE_SETTINGS);
    expect(parsed.success).toBe(true);
  });
});

describe("parseVoiceSettings", () => {
  it("returns the documented defaults for an empty Token map", () => {
    expect(parseVoiceSettings({})).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("parses well-formed Token values into the typed view", () => {
    const view = parseVoiceSettings({
      [AI_CHAT_VOICE_INPUT_MODE]: "push_to_talk",
      [AI_CHAT_VOICE_TTS_MODE]: "all_assistant_messages",
      [AI_CHAT_VOICE_AUTO_SEND]: "true",
      [AI_CHAT_VOICE_STT_LANGUAGE]: "en",
      [AI_CHAT_VOICE_TTS_SPEED]: "1.25",
      [AI_CHAT_VOICE_MAX_RECORDING_MS]: "45000",
      [AI_CHAT_VOICE_TTS_VOICE_ID]: "af-heart",
    });
    expect(view.inputMode).toBe("push_to_talk");
    expect(view.ttsMode).toBe("all_assistant_messages");
    expect(view.autoSendTranscript).toBe(true);
    expect(view.sttLanguage).toBe("en");
    expect(view.ttsSpeed).toBe(1.25);
    expect(view.maxRecordingMs).toBe(45000);
    expect(view.ttsVoiceId).toBe("af-heart");
  });

  it("falls back to defaults for unknown enum values", () => {
    const view = parseVoiceSettings({
      [AI_CHAT_VOICE_INPUT_MODE]: "always-listening",
      [AI_CHAT_VOICE_TTS_MODE]: "weird",
    });
    expect(view.inputMode).toBe(DEFAULT_VOICE_SETTINGS.inputMode);
    expect(view.ttsMode).toBe(DEFAULT_VOICE_SETTINGS.ttsMode);
  });

  it("treats empty / whitespace Token strings as absent (fallback)", () => {
    const view = parseVoiceSettings({
      [AI_CHAT_VOICE_STT_LANGUAGE]: "   ",
      [AI_CHAT_VOICE_TTS_SPEED]: "",
    });
    expect(view.sttLanguage).toBe(DEFAULT_VOICE_SETTINGS.sttLanguage);
    expect(view.ttsSpeed).toBe(DEFAULT_VOICE_SETTINGS.ttsSpeed);
  });

  it("clamps ttsSpeed into [0.5, 2.0]", () => {
    expect(parseVoiceSettings({ [AI_CHAT_VOICE_TTS_SPEED]: "0.1" }).ttsSpeed).toBe(0.5);
    expect(parseVoiceSettings({ [AI_CHAT_VOICE_TTS_SPEED]: "9" }).ttsSpeed).toBe(2.0);
    expect(parseVoiceSettings({ [AI_CHAT_VOICE_TTS_SPEED]: "not-a-number" }).ttsSpeed).toBe(
      DEFAULT_VOICE_SETTINGS.ttsSpeed
    );
  });

  it("clamps maxRecordingMs to an integer in [1000, 600000]", () => {
    expect(
      parseVoiceSettings({ [AI_CHAT_VOICE_MAX_RECORDING_MS]: "10" }).maxRecordingMs
    ).toBe(1000);
    expect(
      parseVoiceSettings({ [AI_CHAT_VOICE_MAX_RECORDING_MS]: "9999999" }).maxRecordingMs
    ).toBe(600_000);
    expect(
      parseVoiceSettings({ [AI_CHAT_VOICE_MAX_RECORDING_MS]: "12345.6" }).maxRecordingMs
    ).toBe(DEFAULT_VOICE_SETTINGS.maxRecordingMs);
  });

  it("only treats the literal 'true' string as auto-send enabled", () => {
    expect(
      parseVoiceSettings({ [AI_CHAT_VOICE_AUTO_SEND]: "true" }).autoSendTranscript
    ).toBe(true);
    expect(
      parseVoiceSettings({ [AI_CHAT_VOICE_AUTO_SEND]: "false" }).autoSendTranscript
    ).toBe(false);
    expect(parseVoiceSettings({}).autoSendTranscript).toBe(false);
  });
});

describe("serializeVoiceSettings", () => {
  it("round-trips a settings view through parse -> serialize -> parse", () => {
    const original = parseVoiceSettings({
      [AI_CHAT_VOICE_INPUT_MODE]: "push_to_talk",
      [AI_CHAT_VOICE_TTS_MODE]: "after_voice_input",
      [AI_CHAT_VOICE_AUTO_SEND]: "true",
      [AI_CHAT_VOICE_TTS_SPEED]: "1.5",
      [AI_CHAT_VOICE_MAX_RECORDING_MS]: "30000",
      [AI_CHAT_VOICE_TTS_VOICE_ID]: "af-heart",
    });
    const reparsed = parseVoiceSettings(serializeVoiceSettings(original));
    expect(reparsed).toEqual(original);
  });

  it("omits an empty ttsVoiceId from the Token map", () => {
    const out = serializeVoiceSettings({ ...DEFAULT_VOICE_SETTINGS });
    expect(out[AI_CHAT_VOICE_TTS_VOICE_ID]).toBeUndefined();
  });

  it("serializes booleans as 'true'/'false' strings", () => {
    const enabled = serializeVoiceSettings({
      ...DEFAULT_VOICE_SETTINGS,
      autoSendTranscript: true,
    });
    expect(enabled[AI_CHAT_VOICE_AUTO_SEND]).toBe("true");
  });
});

describe("validateTranscribeRequest", () => {
  const validBase64 = "AAAA";

  it("rejects non-object payloads", () => {
    expect(validateTranscribeRequest(null).ok).toBe(false);
    expect(validateTranscribeRequest("nope").ok).toBe(false);
  });

  it("rejects an empty audio payload", () => {
    const r = validateTranscribeRequest({ audioBase64: "", mimeType: "audio/webm" });
    expect(r.ok).toBe(false);
  });

  it("rejects a disallowed MIME type", () => {
    const r = validateTranscribeRequest({
      audioBase64: validBase64,
      mimeType: "audio/ogg",
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a well-formed request and preserves optional fields", () => {
    const r = validateTranscribeRequest({
      audioBase64: validBase64,
      mimeType: "audio/webm;codecs=opus",
      language: "en",
      conversationId: "conv-1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mimeType).toBe("audio/webm;codecs=opus");
    expect(r.value.language).toBe("en");
    expect(r.value.conversationId).toBe("conv-1");
  });

  it("rejects an oversized audio payload", () => {
    // Smallest base64 length whose decoded size exceeds the 12 MB cap.
    const overLimitChars = Math.ceil(((AI_CHAT_VOICE_MAX_AUDIO_BYTES + 1) * 4) / 3);
    const r = validateTranscribeRequest({
      audioBase64: "A".repeat(overLimitChars),
      mimeType: "audio/webm",
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateTtsRequest", () => {
  it("rejects empty / whitespace-only text", () => {
    expect(validateTtsRequest({ text: "" }).ok).toBe(false);
    expect(validateTtsRequest({ text: "   " }).ok).toBe(false);
  });

  it("rejects oversized text", () => {
    const r = validateTtsRequest({ text: "A".repeat(AI_CHAT_VOICE_MAX_TTS_CHARS + 1) });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-finite speed", () => {
    expect(validateTtsRequest({ text: "hi", speed: "fast" }).ok).toBe(false);
    expect(validateTtsRequest({ text: "hi", speed: Number.NaN }).ok).toBe(false);
  });

  it("clamps a valid speed into [0.5, 2.0]", () => {
    const r = validateTtsRequest({ text: "hi", speed: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.speed).toBe(2.0);
  });

  it("accepts a well-formed request", () => {
    const r = validateTtsRequest({ text: "Hello world.", voiceId: "af-heart" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe("Hello world.");
    expect(r.value.voiceId).toBe("af-heart");
  });
});
