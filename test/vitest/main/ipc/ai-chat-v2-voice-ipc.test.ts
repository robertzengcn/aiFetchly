import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as os from "node:os";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";
import {
  AI_CHAT_V2_VOICE_STATUS,
  AI_CHAT_V2_VOICE_TRANSCRIBE,
  AI_CHAT_V2_VOICE_TTS,
  AI_CHAT_V2_VOICE_CANCEL,
  AI_CHAT_V2_VOICE_GET_SETTINGS,
  AI_CHAT_V2_VOICE_SET_SETTINGS,
} from "@/config/channellist";

// Token store so AiChatVoiceModule reads/writes settings without the DB.
const tokenStore = vi.hoisted(() => new Map<string, string>());
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: (key: string) => tokenStore.get(key) ?? "",
    setValue: (key: string, val: string) => {
      tokenStore.set(key, val);
    },
  })),
}));

// Stub the worker client so no utility process is forked during IPC tests.
const mockClient = vi.hoisted(() => ({
  transcribe: vi.fn(),
  synthesize: vi.fn(),
  cancel: vi.fn(() => 0),
}));
vi.mock("@/service/aiChatVoice/SherpaVoiceWorkerClient", () => ({
  SherpaVoiceWorkerClient: { getInstance: () => mockClient },
}));

// AiChatVoiceModule gates state on runtime availability BEFORE checking model
// files (c1039eaf). Report the native runtime as available so the model-file
// check is reached and absent models resolve to "missing_model".
vi.mock("@/service/aiChatVoice/SherpaOnnxNative", () => ({
  isSherpaOnnxNativeAvailable: () => true,
  loadSherpaOnnxNative: () => null,
}));

vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { registerAiChatVoiceIpcHandlers } from "@/main-process/communication/ai-chat-v2-voice-ipc";

interface IpcResult<T> {
  status: boolean;
  msg: string;
  data?: T;
}

describe("AiChatV2 voice IPC handlers", () => {
  beforeEach(() => {
    setupElectronMocks();
    tokenStore.clear();
    mockClient.transcribe.mockReset();
    mockClient.synthesize.mockReset();
    mockClient.cancel.mockReset();
    mockClient.cancel.mockReturnValue(0);
    registerAiChatVoiceIpcHandlers();
  });
  afterEach(() => {
    resetElectronMocks();
  });

  const EXPECTED_CHANNELS = [
    AI_CHAT_V2_VOICE_STATUS,
    AI_CHAT_V2_VOICE_TRANSCRIBE,
    AI_CHAT_V2_VOICE_TTS,
    AI_CHAT_V2_VOICE_CANCEL,
    AI_CHAT_V2_VOICE_GET_SETTINGS,
    AI_CHAT_V2_VOICE_SET_SETTINGS,
  ];

  it("registers all expected voice channels", () => {
    const registered = mockIpcMain.getRegisteredChannels();
    for (const channel of EXPECTED_CHANNELS) {
      expect(registered).toContain(channel);
    }
  });

  it("status reports missing_model when model files are absent", async () => {
    const res = (await mockIpcMain.callHandler(
      AI_CHAT_V2_VOICE_STATUS
    )) as IpcResult<{
      sttState: string;
      ttsState: string;
    }>;
    expect(res.status).toBe(true);
    expect(res.data?.sttState).toBe("missing_model");
    expect(res.data?.ttsState).toBe("missing_model");
  });

  it("transcribe rejects an invalid payload with a safe error", async () => {
    const res = (await mockIpcMain.callHandler(
      AI_CHAT_V2_VOICE_TRANSCRIBE,
      {},
      { audioBase64: "", mimeType: "audio/wav" }
    )) as IpcResult<unknown>;
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/audio payload is required/i);
    expect(mockClient.transcribe).not.toHaveBeenCalled();
  });

  it("maps a worker crash to a recoverable error response", async () => {
    mockClient.transcribe.mockRejectedValue(
      new Error("Voice worker unavailable (exit code: 1)")
    );
    const res = (await mockIpcMain.callHandler(
      AI_CHAT_V2_VOICE_TRANSCRIBE,
      {},
      { audioBase64: "AAAA", mimeType: "audio/wav" }
    )) as IpcResult<unknown>;
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/unavailable/i);
  });

  it("tts rejects empty text with a safe error", async () => {
    const res = (await mockIpcMain.callHandler(
      AI_CHAT_V2_VOICE_TTS,
      {},
      { text: "   " }
    )) as IpcResult<unknown>;
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/text is required/i);
    expect(mockClient.synthesize).not.toHaveBeenCalled();
  });

  it("cancel resolves ok and forwards a jobId to the client", async () => {
    const res = (await mockIpcMain.callHandler(
      AI_CHAT_V2_VOICE_CANCEL,
      {},
      { jobId: "stt-123" }
    )) as IpcResult<{ ok: boolean }>;
    expect(res.status).toBe(true);
    expect(res.data?.ok).toBe(true);
    expect(mockClient.cancel).toHaveBeenCalledWith("stt-123");
  });
});
