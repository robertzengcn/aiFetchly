import { describe, expect, it, beforeEach, vi } from "vitest";

const spies = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockPreviewEnable: vi.fn(),
  mockEnable: vi.fn(),
  mockExportMemories: vi.fn(),
  mockPromote: vi.fn(),
  mockPrivatize: vi.fn(),
  mockListDiagnostics: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockApplyBridge: vi.fn(),
  mockListConflicts: vi.fn(),
  mockResolveConflict: vi.fn(),
}));

vi.mock("@/service/PortableWorkspaceMemoryService", () => ({
  PortableWorkspaceMemoryService: vi.fn().mockImplementation(() => ({
    getStatus: spies.mockGetStatus,
    previewEnable: spies.mockPreviewEnable,
    enable: spies.mockEnable,
    exportMemories: spies.mockExportMemories,
    promote: spies.mockPromote,
    privatize: spies.mockPrivatize,
    listDiagnostics: spies.mockListDiagnostics,
    updatePolicy: spies.mockUpdatePolicy,
    applyBridge: spies.mockApplyBridge,
    listConflicts: spies.mockListConflicts,
    resolveConflict: spies.mockResolveConflict,
  })),
}));

const handlers: Record<string, (e: unknown, data: string) => Promise<unknown>> =
  {};
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      chan: string,
      h: (e: unknown, data: string) => Promise<unknown>
    ) => {
      handlers[chan] = h;
    },
  },
}));

import {
  registerPortableWorkspaceMemoryIpcHandlers,
  _resetPortableWorkspaceMemorySingletonsForTesting,
} from "@/main-process/communication/portable-workspace-memory-ipc";
import {
  AI_PORTABLE_WORKSPACE_MEMORY_STATUS,
  AI_PORTABLE_WORKSPACE_MEMORY_ENABLE,
  AI_PORTABLE_WORKSPACE_MEMORY_EXPORT,
  AI_PORTABLE_WORKSPACE_MEMORY_PROMOTE,
  AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_APPLY,
  AI_PORTABLE_WORKSPACE_MEMORY_CONFLICTS_LIST,
  AI_PORTABLE_WORKSPACE_MEMORY_CONFLICT_RESOLVE,
} from "@/config/channellist";

beforeEach(() => {
  for (const h of Object.keys(handlers)) delete handlers[h];
  for (const s of Object.values(spies)) s.mockReset();
  _resetPortableWorkspaceMemorySingletonsForTesting();
  registerPortableWorkspaceMemoryIpcHandlers();
});

function resp<T>(r: unknown): { status: boolean; msg: string; data?: T } {
  return r as { status: boolean; msg: string; data?: T };
}

describe("portable workspace memory IPC", () => {
  it("registers all channels", () => {
    for (const chan of [
      AI_PORTABLE_WORKSPACE_MEMORY_STATUS,
      AI_PORTABLE_WORKSPACE_MEMORY_ENABLE,
      AI_PORTABLE_WORKSPACE_MEMORY_EXPORT,
      AI_PORTABLE_WORKSPACE_MEMORY_PROMOTE,
    ]) {
      expect(handlers[chan]).toBeTypeOf("function");
    }
  });

  it("requires a conversationId", async () => {
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_STATUS](
        null,
        JSON.stringify({})
      )
    );
    expect(r.status).toBe(false);
    expect(r.msg).toContain("conversationId");
  });

  it("rejects forged scope fields in the payload (strict schemas)", async () => {
    // A forged workspaceRoot/scopeId must not reach the service.
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_STATUS](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          workspaceRoot: "/etc",
          scopeId: "wscope-legacy-evil",
        })
      )
    );
    expect(r.status).toBe(false);
    expect(spies.mockGetStatus).not.toHaveBeenCalled();
  });

  it("rejects malformed enable payloads", async () => {
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_ENABLE](
        null,
        JSON.stringify({ conversationId: "conv-1", visibility: "public" })
      )
    );
    expect(r.status).toBe(false);
    expect(r.msg).toContain("invalid enable request");
    expect(spies.mockEnable).not.toHaveBeenCalled();
  });

  it("forwards a valid enable request to the service", async () => {
    spies.mockEnable.mockResolvedValue({ enabled: true });
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_ENABLE](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          defaultStorageMode: "portable-local",
          importPolicy: "review-new",
          exportScope: "active",
          visibility: "local",
          installBridges: ["AGENTS.md"],
        })
      )
    );
    expect(r.status).toBe(true);
    expect(spies.mockEnable).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1" })
    );
  });

  it("passes promote requests through; the path-safe store rejects bad ids", async () => {
    spies.mockPromote.mockResolvedValue(undefined);
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_PROMOTE](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
          visibility: "local",
        })
      )
    );
    expect(r.status).toBe(true);
    // The service only ever receives a memory id — never a filesystem path.
    expect(spies.mockPromote).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
      })
    );
  });

  it("surfaces service errors as structured denials", async () => {
    spies.mockGetStatus.mockRejectedValue(
      new Error("Choose an approved workspace before using portable memory.")
    );
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_STATUS](
        null,
        JSON.stringify({ conversationId: "conv-none" })
      )
    );
    expect(r.status).toBe(false);
    expect(r.msg).toContain("approved workspace");
  });

  it("rejects unknown fields in export requests", async () => {
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_EXPORT](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          scope: "active",
          visibility: "team",
          destinationRoot: "/forged",
        })
      )
    );
    expect(r.status).toBe(false);
    expect(spies.mockExportMemories).not.toHaveBeenCalled();
  });

  it("forwards bridge applies with the expected hash token", async () => {
    spies.mockApplyBridge.mockResolvedValue({
      target: "AGENTS.md",
      applied: true,
      message: "bridge installed",
    });
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_APPLY](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          target: "AGENTS.md",
          expectedBeforeHash: "a".repeat(64),
        })
      )
    );
    expect(r.status).toBe(true);
    expect(spies.mockApplyBridge).toHaveBeenCalledWith(
      expect.objectContaining({ target: "AGENTS.md" })
    );
  });

  it("rejects bridge targets outside the enum", async () => {
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_APPLY](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          target: "../.bashrc",
        })
      )
    );
    expect(r.status).toBe(false);
    expect(spies.mockApplyBridge).not.toHaveBeenCalled();
  });

  it("lists conflicts through the conflicts-list channel", async () => {
    spies.mockListConflicts.mockResolvedValue([
      {
        memoryId: "wmem-x",
        relativePath: ".aifetchly/memory/wmem-x.md",
        message: "concurrent edit",
        currentFileParseable: true,
      },
    ]);
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_CONFLICTS_LIST](
        null,
        JSON.stringify({ conversationId: "conv-1" })
      )
    );
    expect(r.status).toBe(true);
    expect(spies.mockListConflicts).toHaveBeenCalledWith("conv-1");
  });

  it("rejects unknown conflict actions", async () => {
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_CONFLICT_RESOLVE](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          memoryId: "wmem-x",
          action: "delete-everything",
        })
      )
    );
    expect(r.status).toBe(false);
    expect(spies.mockResolveConflict).not.toHaveBeenCalled();
  });

  it("forwards a valid use-file resolution", async () => {
    spies.mockResolveConflict.mockResolvedValue(undefined);
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_CONFLICT_RESOLVE](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          memoryId: "wmem-x",
          action: "use-file",
        })
      )
    );
    expect(r.status).toBe(true);
    expect(spies.mockResolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ action: "use-file" })
    );
  });

  it("rejects use-app without a mergedDocument", async () => {
    const r = resp(
      await handlers[AI_PORTABLE_WORKSPACE_MEMORY_CONFLICT_RESOLVE](
        null,
        JSON.stringify({
          conversationId: "conv-1",
          memoryId: "wmem-x",
          action: "use-app",
        })
      )
    );
    expect(r.status).toBe(false);
    expect(spies.mockResolveConflict).not.toHaveBeenCalled();
  });
});
