import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";
import {
  AI_EMAIL_TEMPLATE_ERROR,
  AI_EMAIL_TEMPLATE_GENERATE_STREAM,
} from "@/config/channellist";

vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
}));

const tokenStore = vi.hoisted(() => new Map<string, string>());
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: (key: string) => tokenStore.get(key) ?? "",
  })),
}));

const mockAiChatApi = vi.hoisted(() => vi.fn());
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: mockAiChatApi,
}));

vi.mock("@/modules/RagSearchModule", () => ({
  RagSearchModule: vi.fn(),
}));

vi.mock("@/views/utils/variableValidation", () => ({
  validateAIRequest: vi.fn(() => ({ isValid: true })),
  validateAIOutputVariables: vi.fn(() => ({ isValid: true })),
  parseEmailTemplateFromStream: vi.fn(() => ({ title: "", content: "" })),
  extractVariables: vi.fn(() => []),
}));

vi.mock("@/main-process/communication/_shared/registerValidatedHandler", () => ({
  registerValidatedHandler: vi.fn(),
}));

import { registerAIEmailTemplateHandlers } from "@/main-process/communication/ai-email-template-ipc";

describe("AI email template IPC hosted entitlement gate", () => {
  beforeEach(() => {
    setupElectronMocks();
    tokenStore.clear();
    mockAiChatApi.mockClear();
    registerAIEmailTemplateHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("does not allow local provider settings to unlock hosted email template generation", async () => {
    tokenStore.set("user_ai_enabled", "false");
    tokenStore.set("user_ai_provider_mode", "local");
    tokenStore.set("user_local_ai_enabled", "true");
    tokenStore.set(
      "user_local_ai_provider_config",
      JSON.stringify({
        preset: "ollama",
        name: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        defaultModel: "llama3.1",
      })
    );

    const sender = { send: vi.fn() };
    await mockIpcMain.callHandler(
      AI_EMAIL_TEMPLATE_GENERATE_STREAM,
      { sender },
      { prompt: "Write a promo email", platform: "email" }
    );

    expect(sender.send).toHaveBeenCalledWith(
      AI_EMAIL_TEMPLATE_ERROR,
      expect.objectContaining({
        status: false,
        msg: expect.stringMatching(/upgrade your plan/i),
      })
    );
    expect(mockAiChatApi).not.toHaveBeenCalled();
  });
});
