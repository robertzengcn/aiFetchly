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
    setWorkspace: vi.fn(),
    getActiveWorkspace: vi.fn(),
    approveWorkspace: vi.fn(),
    revokeWorkspace: vi.fn(),
    listWorkspaces: vi.fn(),
  };
    }
  },
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
