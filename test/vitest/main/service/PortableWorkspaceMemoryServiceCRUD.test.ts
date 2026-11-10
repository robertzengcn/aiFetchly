import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import {
  PortableWorkspaceMemoryService,
} from "@/service/PortableWorkspaceMemoryService";
import {
  PortableWorkspaceMemoryFileStore,
} from "@/service/PortableWorkspaceMemoryFileStore";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import type { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import type { WorkspaceMemoryContext } from "@/service/WorkspaceMemoryContextResolver";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-service-crud");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db") || f === ".aifetchly") {
      try {
        fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

const CTX: WorkspaceMemoryContext = {
  conversationId: "conv-1",
  workspaceId: 42,
  workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceRoot: tmpDir,
  displayName: "Alpha",
  scopeId: `wscope-legacy-${"a".repeat(32)}`,
};

function makeContextResolver(): WorkspaceMemoryContextResolver {
  return {
    resolveForConversation: vi.fn().mockResolvedValue(CTX),
  } as unknown as WorkspaceMemoryContextResolver;
}

async function enablePortable(): Promise<void> {
  const scopeModule = new WorkspaceMemoryScopeModule();
  await scopeModule.resolveLegacyScope({
    workspaceKey: CTX.workspaceKey,
    workspaceRoot: tmpDir,
    displayName: "Alpha",
  });
  await scopeModule.updatePolicy({
    scopeId: CTX.scopeId!,
    portableEnabled: true,
    defaultStorageMode: "portable-local",
    importPolicy: "automatic",
  });
}

function makeService(): PortableWorkspaceMemoryService {
  return new PortableWorkspaceMemoryService(makeContextResolver());
}

describe("PortableWorkspaceMemoryService CRUD (file-first, FR-037/039/029)", () => {
  beforeEach(async () => {
    await enablePortable();
  });

  it("creates a portable record file-first + projection + portable state", async () => {
    const service = makeService();
    const row = await service.createPortable({
      conversationId: "conv-1",
      type: "decision",
      title: "Portable decision",
      content: "Files own portable fields.",
      confidence: 90,
      visibility: "local",
    });
    expect(row.storageMode).toBe("portable-local");
    expect(row.syncState).toBe("synced");

    // The file exists on disk with canonical frontmatter.
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    const read = await store.readRecord(row.memoryId);
    expect(read?.content).toContain("schema: aifetchly.memory/v1");
    expect(read?.content).toContain("Portable decision");

    // SQLite projection + portable state exist.
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const memRow = await memoryModel.getByScopeAndMemoryId(
      CTX.scopeId!,
      row.memoryId
    );
    expect(memRow?.title).toBe("Portable decision");
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(
      CTX.scopeId!,
      row.memoryId
    );
    expect(state?.syncState).toBe("synced");
    expect(state?.lastValidHash).toBe(read?.contentHash);
  });

  it("updates a portable record file-first and rejects concurrent edits", async () => {
    const service = makeService();
    const created = await service.createPortable({
      conversationId: "conv-1",
      type: "decision",
      title: "Original",
      content: "first",
      confidence: 80,
      visibility: "local",
    });
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    const original = await store.readRecord(created.memoryId);

    // External edit between read and write → conflict (AC-007).
    await store.writeRecord(
      created.memoryId,
      original!.content.replace("first", "external edit")
    );

    await expect(
      service.updatePortable({
        conversationId: "conv-1",
        memoryId: created.memoryId,
        type: "decision",
        title: "Updated",
        content: "second",
        confidence: 85,
        status: "active",
        visibility: "local",
        expectedHash: original!.contentHash,
      })
    ).rejects.toThrow(/concurrent external edit/);

    // External bytes preserved (not overwritten).
    const after = await store.readRecord(created.memoryId);
    expect(after?.content).toContain("external edit");
    expect(after?.content).not.toContain("second");
  });

  it("archives a portable record by updating the file status first", async () => {
    const service = makeService();
    const created = await service.createPortable({
      conversationId: "conv-1",
      type: "decision",
      title: "To archive",
      content: "content",
      confidence: 70,
      visibility: "local",
    });
    await service.archivePortable({
      conversationId: "conv-1",
      memoryId: created.memoryId,
    });
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    const read = await store.readRecord(created.memoryId);
    expect(read?.content).toContain("status: archived");
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.getByScopeAndMemoryId(
      CTX.scopeId!,
      created.memoryId
    );
    expect(row?.status).toBe("archived");
  });

  it("hard-deletes a portable record: file first, then projection", async () => {
    const service = makeService();
    const created = await service.createPortable({
      conversationId: "conv-1",
      type: "decision",
      title: "To delete",
      content: "content",
      confidence: 70,
      visibility: "local",
    });
    await service.deletePortable({
      conversationId: "conv-1",
      memoryId: created.memoryId,
    });
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    expect(await store.readRecord(created.memoryId)).toBeNull();
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(CTX.scopeId!, created.memoryId)
    ).toBeNull();
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    expect(
      await stateModel.getByScopeAndMemoryId(CTX.scopeId!, created.memoryId)
    ).toBeNull();
  });

  it("rebuilds INDEX.md from the complete eligible set after create", async () => {
    const service = makeService();
    await service.createPortable({
      conversationId: "conv-1",
      type: "decision",
      title: "First",
      content: "c1",
      confidence: 90,
      visibility: "local",
    });
    const second = await service.createPortable({
      conversationId: "conv-1",
      type: "warning",
      title: "Second",
      content: "c2",
      confidence: 95,
      visibility: "local",
    });
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    const index = await store.readIndexHash();
    expect(index).toMatch(/^[0-9a-f]{64}$/);
    // INDEX exists and references both records (the refreshIndex wrote it).
    const indexContent = await fs.promises
      .readFile(store.indexPath(), "utf8")
      .catch(() => "");
    expect(indexContent).toContain("First");
    expect(indexContent).toContain("Second");
    // Archived record is excluded from the index.
    await service.archivePortable({
      conversationId: "conv-1",
      memoryId: second.memoryId,
    });
    const indexAfterArchive = await fs.promises
      .readFile(store.indexPath(), "utf8")
      .catch(() => "");
    expect(indexAfterArchive).toContain("First");
    expect(indexAfterArchive).not.toContain("Second");
  });
});
