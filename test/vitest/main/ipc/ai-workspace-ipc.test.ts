import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
  MockBrowserWindow,
} from "../../../utils/electron-mocks";

const mockState = vi.hoisted(() => ({ aiEnabled: "true" }));
const mockShowOpenDialog = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
  dialog: {
    showOpenDialog: mockShowOpenDialog,
  },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockImplementation(() => mockState.aiEnabled),
  })),
}));

vi.mock("@/modules/WorkspaceModule", () => ({
  WorkspaceModule: vi.fn().mockImplementation(() => ({
    setWorkspace: vi.fn(),
    getActiveWorkspace: vi.fn(),
    approveWorkspace: vi.fn(),
    revokeWorkspace: vi.fn(),
    listWorkspaces: vi.fn(),
  })),
}));

import { registerAIWorkspaceIpcHandlers } from "@/main-process/communication/ai-workspace-ipc";
import { DIALOG_PICK_FOLDER } from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

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

  it("returns a denied response instead of silent null when AI is disabled", async () => {
    mockState.aiEnabled = "false";

    const result = (await mockIpcMain.callHandler(
      DIALOG_PICK_FOLDER
    )) as CommonMessage<string | null>;

    expect(result.status).toBe(false);
    expect(result.msg).toContain("AI functionality");
    expect(mockShowOpenDialog).not.toHaveBeenCalled();
  });

  it("returns the selected folder in a standard IPC response", async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/workspace"],
    });

    const result = (await mockIpcMain.callHandler(
      DIALOG_PICK_FOLDER
    )) as CommonMessage<string | null>;

    expect(mockShowOpenDialog).toHaveBeenCalledWith(win, {
      properties: ["openDirectory"],
    });
    expect(result).toMatchObject({
      status: true,
      data: "/tmp/workspace",
    });
  });
});
