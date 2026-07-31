/**
 * Workspace-watch IPC handler tests (Plan 14-03 Task 1).
 *
 * Covers the four new invoke channels:
 *   AIFETCHLY_WORKSPACE_WATCH_ACQUIRE  — chat-open acquire flow (CFG-02)
 *   AIFETCHLY_WORKSPACE_WATCH_RELEASE  — chat-close release flow
 *   AIFETCHLY_WORKSPACE_TRUST_PREVIEW  — main-side AGENTS.md preview (TRS-07)
 *   AIFETCHLY_WORKSPACE_TRUST_SET      — approval + rescan (TRS-03)
 *
 * Trust boundary assertions:
 *   - CFG-02: a renderer-provided workspaceRoot is NEVER forwarded to the
 *     manager; WorkspaceResolver is the sole source of truth.
 *   - TRS-07: preview returns the AGENTS.md file CONTENT (string body),
 *     never a path the renderer could re-read.
 *   - WAT-06 / zod: every channel validates input via registerValidatedHandler;
 *     malformed payloads fail closed.
 *
 * The test exercises the IPC layer end-to-end with a stubbed manager,
 * stubbed WorkspaceResolver, and stubbed WorkspaceModule — verifying the
 * three-layer delegation (IPC → Module → Manager/Resolver/WorkspaceModule).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
  MockBrowserWindow,
} from "../../../utils/electron-mocks";

// --- Mocks (hoisted so vi.mock sees them) -----------------------------------

const resolverMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

const workspaceModuleMocks = vi.hoisted(() => ({
  approveWorkspace: vi.fn(),
  revokeWorkspace: vi.fn(),
}));

const managerMocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  rescan: vi.fn(),
  getWorkspaceSnapshot: vi.fn(),
  getStatus: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
}));

vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: vi.fn().mockImplementation(() => ({
    resolve: resolverMocks.resolve,
  })),
}));

vi.mock("@/modules/WorkspaceModule", () => ({
  WorkspaceModule: vi.fn().mockImplementation(() => ({
    approveWorkspace: workspaceModuleMocks.approveWorkspace,
    revokeWorkspace: workspaceModuleMocks.revokeWorkspace,
  })),
}));

// --- Imports (after mocks) --------------------------------------------------

import { registerWorkspaceWatchHandlers } from "@/main-process/communication/workspace-watch-ipc";
import {
  AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
  AIFETCHLY_WORKSPACE_WATCH_RELEASE,
  AIFETCHLY_WORKSPACE_TRUST_PREVIEW,
  AIFETCHLY_WORKSPACE_TRUST_SET,
  AIFETCHLY_CONFIG_CHANGED,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { WorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManager";

/**
 * Build a stub WorkspaceWatchManager. Cast through unknown — the IPC layer
 * only invokes a small subset of methods (acquire/release/rescan/
 * getWorkspaceSnapshot/getStatus/shutdown) and the stub provides spies for
 * each so we can assert call shape.
 */
function makeStubManager(): WorkspaceWatchManager {
  return {
    acquire: managerMocks.acquire,
    release: managerMocks.release,
    rescan: managerMocks.rescan,
    getWorkspaceSnapshot: managerMocks.getWorkspaceSnapshot,
    getStatus: managerMocks.getStatus,
    shutdown: managerMocks.shutdown,
  } as unknown as WorkspaceWatchManager;
}

describe("workspace-watch IPC handlers (CFG-02 + TRS-07 + WAT-06)", () => {
  const win = new MockBrowserWindow();

  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    resolverMocks.resolve.mockResolvedValue(null);
    managerMocks.getStatus.mockReturnValue({
      workerState: "not-started",
      watchedCount: 0,
      recentRestarts: [],
      restartCapExceeded: false,
      watched: [],
    });
    registerWorkspaceWatchHandlers(win as never, makeStubManager());
  });

  afterEach(() => {
    resetElectronMocks();
  });

  // --- ACQUIRE (CFG-02) -----------------------------------------------------

  it("acquire delegates to manager.acquire with consumerId `chat:<conversationId>`", async () => {
    resolverMocks.resolve.mockResolvedValue({
      workspaceId: 42,
      rootPath: "/tmp/workspaces/acme",
    });
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
      {},
      { conversationId: "conv-1" }
    )) as CommonMessage<{ workspaceId: string } | null>;
    expect(r.status).toBe(true);
    expect(managerMocks.acquire).toHaveBeenCalledTimes(1);
    const call = managerMocks.acquire.mock.calls[0][0];
    expect(call.workspaceId).toBe("42"); // serialised DB primary key
    expect(call.workspaceRoot).toBe("/tmp/workspaces/acme"); // resolved root
    expect(call.consumerId).toMatch(/^chat:conv-1$/);
    // Response carries the resolved workspaceId string so the renderer can
    // pass it back on release/preview/setTrust.
    expect(r.data).toEqual({ workspaceId: "42" });
  });

  it("acquire returns null when no approved workspace (CFG-02 fail-closed)", async () => {
    resolverMocks.resolve.mockResolvedValue(null);
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
      {},
      { conversationId: "conv-no-approved" }
    )) as CommonMessage<{ workspaceId: string } | null>;
    expect(r.status).toBe(true);
    expect(r.data).toBe(null);
    expect(managerMocks.acquire).not.toHaveBeenCalled();
  });

  it("acquire NEVER trusts a renderer-provided workspaceRoot (CFG-02)", async () => {
    resolverMocks.resolve.mockResolvedValue({
      workspaceId: 42,
      rootPath: "/resolved/path",
    });
    // The renderer attempts to override the workspaceRoot. The zod schema
    // only accepts { conversationId, workspaceId } — workspaceRoot is
    // schema-stripped, and the manager MUST receive the resolver's value.
    await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
      {},
      {
        conversationId: "conv-1",
        workspaceId: "42",
        workspaceRoot: "/attacker/controlled/path",
      } as unknown as { conversationId: string }
    );
    const call = managerMocks.acquire.mock.calls[0][0];
    expect(call.workspaceRoot).toBe("/resolved/path");
    expect(call.workspaceRoot).not.toBe("/attacker/controlled/path");
  });

  it("acquire rejects malformed payload (missing conversationId) — zod", async () => {
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
      {},
      {}
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(managerMocks.acquire).not.toHaveBeenCalled();
  });

  // --- RELEASE --------------------------------------------------------------

  it("release delegates to manager.release with consumerId `chat:<conversationId>`", async () => {
    resolverMocks.resolve.mockResolvedValue({
      workspaceId: 42,
      rootPath: "/tmp/workspaces/acme",
    });
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_WATCH_RELEASE,
      {},
      { conversationId: "conv-1" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(managerMocks.release).toHaveBeenCalledWith("42", "chat:conv-1");
  });

  it("release uses renderer-provided workspaceId when resolver has no record", async () => {
    // Covers the chat-close path where the workspace may have been revoked
    // mid-session; the renderer still knows the workspaceId and we must
    // release the consumer to avoid a leak.
    resolverMocks.resolve.mockResolvedValue(null);
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_WATCH_RELEASE,
      {},
      { conversationId: "conv-1", workspaceId: "42" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(managerMocks.release).toHaveBeenCalledWith("42", "chat:conv-1");
  });

  // --- PREVIEW (TRS-07) -----------------------------------------------------

  it("preview returns the AGENTS.md file CONTENT, never a path (TRS-07)", async () => {
    managerMocks.getWorkspaceSnapshot.mockReturnValue({
      source: "workspace",
      sourceId: "workspace:42",
      rootPath: "/tmp/workspaces/acme",
      version: 1,
      files: [],
      instructions: [
        {
          id: "ws:AGENTS.md",
          source: "workspace",
          sourceId: "workspace:42",
          label: "",
          relativePath: "AGENTS.md",
          content: "# Project rules\n\nBe kind to each other.",
          contentHash: "h1",
          trusted: false,
        },
      ],
      commands: [],
      agents: [],
      hooks: [],
      skills: [],
      diagnostics: [],
    });
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_TRUST_PREVIEW,
      {},
      { workspaceId: "42" }
    )) as CommonMessage<{ content: string } | null>;
    expect(r.status).toBe(true);
    expect(r.data).not.toBeNull();
    expect(typeof r.data!.content).toBe("string");
    // TRS-07: the response is the file body, not a path. The body has
    // newlines but no leading "/"; a renderer that re-reads paths from
    // this response would get nothing useful.
    expect(r.data!.content).toContain("Be kind to each other.");
    expect(r.data!.content).not.toMatch(/^\/[A-Za-z]/);
  });

  it("preview returns null when no snapshot cached (workspace not watched)", async () => {
    managerMocks.getWorkspaceSnapshot.mockReturnValue(null);
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_TRUST_PREVIEW,
      {},
      { workspaceId: "unwatched-id" }
    )) as CommonMessage<{ content: string } | null>;
    expect(r.status).toBe(true);
    expect(r.data).toBe(null);
  });

  it("preview rejects non-string workspaceId — zod", async () => {
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_TRUST_PREVIEW,
      {},
      { workspaceId: 42 }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(managerMocks.getWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  // --- SET TRUST (TRS-03) ---------------------------------------------------

  it("setTrust scope='instructions' approves the workspace + rescans", async () => {
    workspaceModuleMocks.approveWorkspace.mockResolvedValue({
      id: 42,
      approvalState: "approved",
    });
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_TRUST_SET,
      {},
      { workspaceId: "42", scope: "instructions" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(workspaceModuleMocks.approveWorkspace).toHaveBeenCalledWith(42);
    expect(managerMocks.rescan).toHaveBeenCalledWith("42");
  });

  it("setTrust scope='all' also approves (Phase 14 binary gate)", async () => {
    workspaceModuleMocks.approveWorkspace.mockResolvedValue({
      id: 42,
      approvalState: "approved",
    });
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_TRUST_SET,
      {},
      { workspaceId: "42", scope: "all" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(true);
    expect(workspaceModuleMocks.approveWorkspace).toHaveBeenCalledWith(42);
    expect(managerMocks.rescan).toHaveBeenCalledWith("42");
  });

  it("setTrust rejects invalid scope (zod enum)", async () => {
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_TRUST_SET,
      {},
      { workspaceId: "42", scope: "nonsense" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(workspaceModuleMocks.approveWorkspace).not.toHaveBeenCalled();
    expect(managerMocks.rescan).not.toHaveBeenCalled();
  });

  it("setTrust rejects non-numeric workspaceId — fail closed", async () => {
    const r = (await mockIpcMain.callHandler(
      AIFETCHLY_WORKSPACE_TRUST_SET,
      {},
      { workspaceId: "not-a-number", scope: "instructions" }
    )) as CommonMessage<unknown>;
    expect(r.status).toBe(false);
    expect(workspaceModuleMocks.approveWorkspace).not.toHaveBeenCalled();
  });
});
