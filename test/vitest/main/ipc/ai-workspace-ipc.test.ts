import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
  MockBrowserWindow,
} from "../../../utils/electron-mocks";

const mockState = vi.hoisted(() => ({ aiEnabled: "true" }));
const mockShowOpenDialog = vi.hoisted(() => vi.fn());
const setWorkspaceMock = vi.hoisted(() => vi.fn());
const broadcastSummaryMock = vi.hoisted(() => vi.fn());
const ensureProjectionMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
  dialog: {
    showOpenDialog: mockShowOpenDialog,
  },
}));

vi.mock("@/service/dialogs/NativeDialogServiceProvider", () => ({
  getNativeDialogService: async () => ({
    showOpenDialog: mockShowOpenDialog,
  }),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn(function TokenMock() {
      return {
    getValue: vi.fn().mockImplementation(() => mockState.aiEnabled),
      };
    }),
}));

vi.mock("@/modules/WorkspaceModule", () => ({
  WorkspaceModule: class {
    constructor() {
      return {
    setWorkspace: setWorkspaceMock,
    getActiveWorkspace: vi.fn(),
    approveWorkspace: vi.fn(),
    revokeWorkspace: vi.fn(),
    listWorkspaces: vi.fn(),
  };
    }
  },
}));

vi.mock("@/modules/AIChatConversationModule", () => ({
  AIChatConversationModule: class {
    ensureConversationProjection = ensureProjectionMock;
  },
}));

vi.mock("@/service/aiChatWorkspaceRuntime", () => ({
  sharedWorkspaceEventRouter: {
    broadcastSummary: broadcastSummaryMock,
  },
}));

import { registerAIWorkspaceIpcHandlers } from "@/main-process/communication/ai-workspace-ipc";
import { AI_WORKSPACE_SET, DIALOG_PICK_FOLDER } from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

/**
 * BUGFIX 2026-11-02 (left menu never shows the new chat's workspace folder):
 * the AI_WORKSPACE_SET handler previously persisted the binding and told the
 * renderer nothing. Combined with the once-per-process key backfill, the
 * left sidebar kept the chat under "Other chats" for the whole session.
 * Contract under test: a successful set (1) ensures the conversation
 * projection row exists (so a brand-new chat does not vanish from the next
 * sidebar refresh) and (2) broadcasts a REDACTED conversation_updated
 * summary carrying the resolved workspaceKey; a failed set must not
 * broadcast, and broadcast helpers must never fail the set itself.
 */

function stubSetWorkspaceRecord(record: unknown): void {
  setWorkspaceMock.mockResolvedValueOnce(record);
}

describe("AI workspace IPC workspace assignment broadcast", () => {
  const win = new MockBrowserWindow();

  beforeEach(() => {
    setupElectronMocks();
    resetElectronMocks();
    vi.clearAllMocks();
    ensureProjectionMock.mockResolvedValue(undefined);
    mockState.aiEnabled = "true";
    registerAIWorkspaceIpcHandlers(win as never);
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("broadcasts a conversation_updated summary with the resolved key after a successful set", async () => {
    stubSetWorkspaceRecord({
      id: 7,
      conversationId: "v2-new-chat",
      rootPath: "/tmp/workspace",
      label: null,
      approvalState: "pending",
      workspaceKey: "ws_abc123",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      revokedAt: null,
    });

    const result = (await mockIpcMain.callHandler(AI_WORKSPACE_SET, {}, {
      conversationId: "v2-new-chat",
      rootPath: "/tmp/workspace",
    })) as CommonMessage<unknown>;

    expect(result.status).toBe(true);
    expect(ensureProjectionMock).toHaveBeenCalledWith("v2-new-chat", "ws_abc123");
    expect(broadcastSummaryMock).toHaveBeenCalledTimes(1);
    const event = broadcastSummaryMock.mock
      .calls[0][0] as Record<string, unknown>;
    expect(event.conversationId).toBe("v2-new-chat");
    expect(event.workspaceKey).toBe("ws_abc123");
    expect(event.reason).toBe("conversation_updated");
    // REDACTED summary contract: status metadata only, never content or
    // run bookkeeping (PRD §18.3).
    expect(event.runtimeStatus).toBe("idle");
    expect(event.attention).toBe("none");
    expect(event.unread).toBe(false);
    expect(typeof event.lastActivityAt).toBe("string");
  });

  it("broadcasts null workspaceKey when the binding record has no key", async () => {
    stubSetWorkspaceRecord({
      id: 8,
      conversationId: "v2-unresolved-chat",
      rootPath: "/tmp/never-exists",
      label: null,
      approvalState: "pending",
      workspaceKey: null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      revokedAt: null,
    });

    const result = (await mockIpcMain.callHandler(AI_WORKSPACE_SET, {}, {
      conversationId: "v2-unresolved-chat",
      rootPath: "/tmp/never-exists",
    })) as CommonMessage<unknown>;

    expect(result.status).toBe(true);
    const event = broadcastSummaryMock.mock
      .calls[0][0] as Record<string, unknown>;
    expect(event.workspaceKey).toBeNull();
  });

  it("does not broadcast when the set fails", async () => {
    setWorkspaceMock.mockRejectedValueOnce(new Error("binding boom"));

    const result = (await mockIpcMain.callHandler(AI_WORKSPACE_SET, {}, {
      conversationId: "v2-fail-chat",
      rootPath: "/tmp/workspace",
    })) as CommonMessage<unknown>;

    expect(result.status).toBe(false);
    expect(broadcastSummaryMock).not.toHaveBeenCalled();
  });

  it("still returns the record when the sidebar broadcast helpers fail", async () => {
    stubSetWorkspaceRecord({
      id: 9,
      conversationId: "v2-resilient-chat",
      rootPath: "/tmp/workspace",
      label: null,
      approvalState: "pending",
      workspaceKey: "ws_xyz789",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      revokedAt: null,
    });
    ensureProjectionMock.mockRejectedValueOnce(new Error("projection boom"));

    const result = (await mockIpcMain.callHandler(AI_WORKSPACE_SET, {}, {
      conversationId: "v2-resilient-chat",
      rootPath: "/tmp/workspace",
    })) as CommonMessage<{ id: number }>;

    expect(result.status).toBe(true);
    expect((result.data as { id: number }).id).toBe(9);
  });
});

describe("AI workspace IPC folder picker", () => {
  const win = new MockBrowserWindow();

  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    mockState.aiEnabled = "true";
    registerAIWorkspaceIpcHandlers(win as never);
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("opens the folder picker even when AI is disabled (workspace choosing is local-only)", async () => {
    mockState.aiEnabled = "false";
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/workspace"],
    });

    const result = (await mockIpcMain.callHandler(
      DIALOG_PICK_FOLDER
    )) as CommonMessage<string | null>;

    expect(mockShowOpenDialog).toHaveBeenCalled();
    expect(result).toMatchObject({
      status: true,
      data: "/tmp/workspace",
    });
  });

  it("returns the selected folder in a standard IPC response", async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/workspace"],
    });

    const result = (await mockIpcMain.callHandler(
      DIALOG_PICK_FOLDER
    )) as CommonMessage<string | null>;

    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      properties: ["openDirectory"],
    });
    expect(result).toMatchObject({
      status: true,
      data: "/tmp/workspace",
    });
  });
});
