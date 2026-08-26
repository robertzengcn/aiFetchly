import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";
import { buildGeneratedImageProtocolUrl } from "@/service/AIChatGeneratedImageProtocol";
import { GeneratedImageReferenceError } from "@/entityTypes/generatedImageReferenceTypes";
import type { AuthorizedGeneratedImageSource } from "@/entityTypes/generatedImageReferenceTypes";
import { extractArtifactExportOperations } from "@/views/components/aiChatV2/fileOperationMetadata";

// Mutable temp state read at handler-call time via the mocked app.getPath.
const tempState = vi.hoisted(() => ({
  userDataDir: "/tmp/aifetchly-export-test-userdata",
  workspaceRoot: "/tmp/aifetchly-export-test-workspace",
}));

// Mock electron module — must be hoisted by vitest before handler import.
vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: {
    getPath: vi.fn().mockImplementation((name: string) => {
      if (name === "userData") return tempState.userDataDir;
      return "/tmp";
    }),
  },
}));

// Mock Token so the AI gate and current-user email are controllable.
const mockState = vi.hoisted(() => ({
  aiEnabled: "true",
  tokenStore: new Map<string, string>(),
}));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockImplementation((key: string) => {
      if (key === "USER_AI_ENABLED") return mockState.aiEnabled;
      return mockState.tokenStore.get(key) ?? "";
    }),
    setValue: vi.fn(),
    deleteValue: vi.fn(),
    hasValue: vi.fn(() => false),
  })),
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    USER_AI_ENABLED: "USER_AI_ENABLED",
    USERSDBPATH: "USERSDBPATH",
    USEREMAIL: "user_email",
  };
});

// Mock the v2 module (chip-compatible tool_result persistence).
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    saveToolResultMessage: mockSaveToolResultMessage,
    getDefaultSystemPrompt: vi.fn().mockReturnValue("You are helpful."),
  })),
}));

// Mock workspace resolution seam shared with the export tool.
const mockResolveWorkspace = vi.fn();
vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: vi.fn().mockImplementation(() => ({
    resolve: mockResolveWorkspace,
  })),
}));

// Mock reference authorization at the service boundary; the typed error class
// stays real so forged-reference handling exercises actual error mapping.
const mockAuthorizeOnly = vi.fn();
vi.mock("@/service/GeneratedImageReferenceService", () => ({
  GeneratedImageReferenceService: vi
    .fn()
    .mockImplementation(() => ({
      authorizeOnly: mockAuthorizeOnly,
    })),
}));

import { registerGeneratedImageExportIpcHandlers } from "@/main-process/communication/generatedImageExportIpc";
import { AI_CHAT_V2_EXPORT_GENERATED_IMAGE } from "@/config/channellist";

const TEST_EMAIL = "tester@example.com";
const CONVERSATION_ID = "v2-conv-1";
const MESSAGE_ID = "msg-1";

function sourceImagePath(): string {
  return path.join(
    tempState.userDataDir,
    "ai-chat-generated-images",
    TEST_EMAIL,
    CONVERSATION_ID,
    MESSAGE_ID,
    "img.png"
  );
}

function protocolUrl(): string {
  return buildGeneratedImageProtocolUrl({
    userEmail: TEST_EMAIL,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    fileName: "img.png",
  });
}

function authorizedSource(): AuthorizedGeneratedImageSource[] {
  return [
    {
      reference: { messageId: MESSAGE_ID, imageIndex: 0 },
      conversationId: CONVERSATION_ID,
      sourceMessageId: MESSAGE_ID,
      protocolUrl: protocolUrl(),
      fileName: "img.png",
      absolutePath: sourceImagePath(),
    },
  ];
}

async function makeSourceFile(): Promise<void> {
  await fs.mkdir(path.dirname(sourceImagePath()), { recursive: true });
  await fs.writeFile(sourceImagePath(), Buffer.from("png-fake-bytes"));
}

async function callHandler(
  payload?: unknown
): Promise<{ status: boolean; msg?: string; data?: unknown }> {
  return (await mockIpcMain.callHandler(
    AI_CHAT_V2_EXPORT_GENERATED_IMAGE,
    {},
    payload
  )) as { status: boolean; msg?: string; data?: unknown };
}

describe("AI Chat V2 — generated-image save-to-workspace IPC", () => {
  beforeEach(async () => {
    setupElectronMocks();
    vi.clearAllMocks();
    mockState.aiEnabled = "true";
    mockState.tokenStore.clear();
    mockState.tokenStore.set("user_email", TEST_EMAIL);
    tempState.userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "aifetchly-genimg-userdata-")
    );
    tempState.workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "aifetchly-genimg-wsroot-")
    );
    await makeSourceFile();
    registerGeneratedImageExportIpcHandlers();
  });

  afterEach(async () => {
    resetElectronMocks();
    await fs.rm(tempState.userDataDir, { recursive: true, force: true });
    await fs.rm(tempState.workspaceRoot, { recursive: true, force: true });
  });

  it("registers a handler for the export channel", () => {
    expect(
      mockIpcMain.getRegisteredChannels()
    ).toContain(AI_CHAT_V2_EXPORT_GENERATED_IMAGE);
  });

  it("runs the chat availability gate BEFORE authorization, workspace lookup, or writes", async () => {
    mockState.aiEnabled = "false";
    const result = await callHandler({
      conversationId: CONVERSATION_ID,
      reference: { messageId: MESSAGE_ID, imageIndex: 0 },
    });

    expect(result.status).toBe(false);
    expect(result.msg).toBe(
      "Hosted aiFetchly AI requires a subscription. Configure a local AI provider or upgrade your plan to use AI Chat."
    );
    expect(mockAuthorizeOnly).not.toHaveBeenCalled();
    expect(mockResolveWorkspace).not.toHaveBeenCalled();
    expect(mockSaveToolResultMessage).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads before any authorization work", async () => {
    const result = await callHandler({
      reference: { messageId: MESSAGE_ID, url: "file:///etc/passwd" },
    });

    expect(result.status).toBe(false);
    expect(mockAuthorizeOnly).not.toHaveBeenCalled();
    expect(mockSaveToolResultMessage).not.toHaveBeenCalled();
  });

  it("rejects a forged reference with the safe typed error code", async () => {
    mockAuthorizeOnly.mockRejectedValueOnce(
      new GeneratedImageReferenceError("generated_image_not_owned")
    );
    const result = await callHandler({
      conversationId: CONVERSATION_ID,
      reference: { messageId: "someone-elses", imageIndex: 0 },
    });

    expect(result.status).toBe(false);
    expect(result.msg).toBe("generated_image_not_owned");
    // No paths or stack traces leak to the renderer.
    expect(result.msg).not.toContain("/");
    expect(mockResolveWorkspace).not.toHaveBeenCalled();
    expect(mockSaveToolResultMessage).not.toHaveBeenCalled();
  });

  it("returns workspace_required without persisting anything when no approved workspace exists", async () => {
    mockAuthorizeOnly.mockResolvedValueOnce(authorizedSource());
    mockResolveWorkspace.mockResolvedValue(null);

    const result = await callHandler({
      conversationId: CONVERSATION_ID,
      reference: { messageId: MESSAGE_ID, imageIndex: 0 },
    });

    expect(mockAuthorizeOnly).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeOnly).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      references: [{ messageId: MESSAGE_ID, imageIndex: 0 }],
    });
    expect(result).toMatchObject({
      status: true,
      data: { status: "workspace_required" },
    });
    expect(mockSaveToolResultMessage).not.toHaveBeenCalled();
  });

  it("exports the file into the workspace root and persists a chip-compatible tool_result row", async () => {
    mockAuthorizeOnly.mockResolvedValueOnce(authorizedSource());
    mockResolveWorkspace.mockResolvedValue({
      workspaceId: 1,
      rootPath: tempState.workspaceRoot,
    });

    const result = await callHandler({
      conversationId: CONVERSATION_ID,
      reference: { messageId: MESSAGE_ID, imageIndex: 0 },
    });

    expect(result.status).toBe(true);
    const destinationPath = path.join(
      tempState.workspaceRoot,
      "generated-artifacts",
      "img.png"
    );

    // The copy actually happened inside the workspace.
    await expect(fs.access(destinationPath)).resolves.toBeUndefined();
    await expect(fs.readFile(destinationPath, "utf-8")).resolves.toBe(
      "png-fake-bytes"
    );

    const data = result.data as {
      status: string;
      destinationPath: string;
      relativeDestinationPath: string;
      fileName: string;
    };
    expect(data).toMatchObject({
      status: "exported",
      destinationPath,
      relativeDestinationPath: path.join("generated-artifacts", "img.png"),
      fileName: "img.png",
    });

    // A chip-compatible tool_result row was persisted.
    expect(mockSaveToolResultMessage).toHaveBeenCalledTimes(1);
    const persisted = mockSaveToolResultMessage.mock.calls[0][0] as {
      conversationId: string;
      assistantMessageId: string;
      toolName: string;
      toolResult: Record<string, unknown>;
    };
    expect(persisted.conversationId).toBe(CONVERSATION_ID);
    expect(persisted.assistantMessageId).toBe(MESSAGE_ID);
    expect(persisted.toolName).toBe("export_generated_artifacts");
    expect(persisted.toolResult).toMatchObject({
      success: true,
      status: "completed",
      items: [
        {
          status: "exported",
          destination: destinationPath,
        },
      ],
    });

    // End-to-end chip compatibility: the renderer metadata extractor rebuilds
    // an openable record from exactly this persisted shape.
    const records = extractArtifactExportOperations(
      {
        id: "tool-result-x",
        conversationId: CONVERSATION_ID,
        timestamp: new Date().toISOString(),
        messageType: "tool_result",
        metadata: {
          toolCallId: persisted.toolResult.toolCallId as string | undefined,
          toolName: persisted.toolName,
          toolResult: persisted.toolResult,
        },
      },
      CONVERSATION_ID,
      tempState.workspaceRoot
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      filePath: destinationPath,
      skillName: "export_generated_artifacts",
      success: true,
    });
  });

  it("reports export failures as denied errors without persisting rows", async () => {
    mockAuthorizeOnly.mockResolvedValueOnce(authorizedSource());
    mockResolveWorkspace.mockResolvedValue({
      workspaceId: 1,
      rootPath: tempState.workspaceRoot,
    });
    // The authorized source vanished between authorization and copy.
    await fs.rm(sourceImagePath());

    const result = await callHandler({
      conversationId: CONVERSATION_ID,
      reference: { messageId: MESSAGE_ID, imageIndex: 0 },
    });

    expect(result.status).toBe(false);
    expect(typeof result.msg).toBe("string");
    expect((result.msg ?? "").length).toBeGreaterThan(0);
    expect(mockSaveToolResultMessage).not.toHaveBeenCalled();
  });
});
