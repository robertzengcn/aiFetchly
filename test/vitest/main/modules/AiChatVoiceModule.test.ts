import { describe, it, expect, vi } from "vitest";
import { AiChatVoiceModule } from "@/modules/AiChatVoiceModule";
import type { SherpaVoiceWorkerClient } from "@/service/aiChatVoice/SherpaVoiceWorkerClient";
import type { Token } from "@/modules/token";
import { DEFAULT_VOICE_SETTINGS } from "@/entityTypes/aiChatVoiceTypes";
import {
  AI_CHAT_VOICE_INPUT_MODE,
  AI_CHAT_VOICE_TTS_SPEED,
} from "@/config/usersetting";

function makeTokenMock(initial: Record<string, string> = {}): {
  token: Token;
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  const token = {
    getValue: (k: string) => store[k],
    setValue: (k: string, v: string) => {
      store[k] = v;
    },
  } as unknown as Token;
  return { token, store };
}

describe("AiChatVoiceModule.getSettingsView", () => {
  it("returns the documented defaults when no Token values are set", () => {
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: {} as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    expect(mod.getSettingsView()).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("parses persisted Token values into the typed view", () => {
    const { token } = makeTokenMock({
      [AI_CHAT_VOICE_INPUT_MODE]: "push_to_talk",
      [AI_CHAT_VOICE_TTS_SPEED]: "1.5",
    });
    const mod = new AiChatVoiceModule({
      token,
      workerClient: {} as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    const view = mod.getSettingsView();
    expect(view.inputMode).toBe("push_to_talk");
    expect(view.ttsSpeed).toBe(1.5);
  });
});

describe("AiChatVoiceModule.saveSettings", () => {
  it("persists a valid view and returns it typed", () => {
    const { token, store } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: {} as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    const saved = mod.saveSettings({
      ...DEFAULT_VOICE_SETTINGS,
      inputMode: "push_to_talk",
      autoSendTranscript: true,
    });
    expect(saved.inputMode).toBe("push_to_talk");
    expect(store[AI_CHAT_VOICE_INPUT_MODE]).toBe("push_to_talk");
    // round-trips through getSettingsView
    expect(mod.getSettingsView().inputMode).toBe("push_to_talk");
    expect(mod.getSettingsView().autoSendTranscript).toBe(true);
  });

  it("rejects an invalid settings view", () => {
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: {} as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    expect(() =>
      mod.saveSettings({ ...DEFAULT_VOICE_SETTINGS, inputMode: "bogus" })
    ).toThrow(/invalid voice settings/i);
  });
});

describe("AiChatVoiceModule.getRuntimeStatus", () => {
  it("reports missing_model when the model file is absent", () => {
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: {} as SherpaVoiceWorkerClient,
      modelRoot: "/models",
      fileExists: () => false,
      runtimeAvailable: () => true,
    });
    const status = mod.getRuntimeStatus();
    expect(status.sttState).toBe("missing_model");
    expect(status.ttsState).toBe("missing_model");
  });

  it("reports ready when the model file is present", () => {
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: {} as SherpaVoiceWorkerClient,
      modelRoot: "/models",
      fileExists: () => true,
      runtimeAvailable: () => true,
    });
    const status = mod.getRuntimeStatus();
    expect(status.sttState).toBe("ready");
    expect(status.ttsState).toBe("ready");
  });

  it("reports unavailable when model files exist but the sherpa runtime is missing", () => {
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: {} as SherpaVoiceWorkerClient,
      modelRoot: "/models",
      fileExists: () => true,
      runtimeAvailable: () => false,
    });
    const status = mod.getRuntimeStatus();
    expect(status.sttState).toBe("unavailable");
    expect(status.ttsState).toBe("unavailable");
    expect(status.errorMessage).toMatch(/local voice runtime/i);
  });
});

describe("AiChatVoiceModule.transcribe", () => {
  it("delegates to the worker client and returns the transcript", async () => {
    const transcribe = vi.fn(async () => ({ transcript: "hello world" }));
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: { transcribe } as unknown as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    const result = await mod.transcribe({
      audioBase64: "AAAA",
      mimeType: "audio/webm",
    });
    expect(result.transcript).toBe("hello world");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid payload before calling the worker", async () => {
    const transcribe = vi.fn(async () => ({ transcript: "x" }));
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: { transcribe } as unknown as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    await expect(
      mod.transcribe({ audioBase64: "", mimeType: "audio/webm" })
    ).rejects.toThrow(/audio payload is required/i);
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe("AiChatVoiceModule.synthesize", () => {
  it("delegates to the worker client and returns WAV audio", async () => {
    const synthesize = vi.fn(async () => ({ audioBase64: "//uQAAAA" }));
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: { synthesize } as unknown as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    const result = await mod.synthesize({ text: "Hello." });
    expect(result.audioBase64).toBe("//uQAAAA");
    expect(result.mimeType).toBe("audio/wav");
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("rejects empty text before calling the worker", async () => {
    const synthesize = vi.fn(async () => ({ audioBase64: "x" }));
    const { token } = makeTokenMock();
    const mod = new AiChatVoiceModule({
      token,
      workerClient: { synthesize } as unknown as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    await expect(mod.synthesize({ text: "   " })).rejects.toThrow(
      /text is required/i
    );
    expect(synthesize).not.toHaveBeenCalled();
  });
});

describe("AiChatVoiceModule.cancel", () => {
  it("resolves ok and cancels all pending when no jobId is given", async () => {
    const { token } = makeTokenMock();
    const cancel = vi.fn(() => 0);
    const mod = new AiChatVoiceModule({
      token,
      workerClient: { cancel } as unknown as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    await expect(mod.cancel()).resolves.toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledWith(undefined);
  });

  it("forwards a jobId to the worker client for a targeted cancel", async () => {
    const { token } = makeTokenMock();
    const cancel = vi.fn(() => 1);
    const mod = new AiChatVoiceModule({
      token,
      workerClient: { cancel } as unknown as SherpaVoiceWorkerClient,
      fileExists: () => false,
    });
    await expect(mod.cancel("stt-123")).resolves.toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledWith("stt-123");
  });
});
