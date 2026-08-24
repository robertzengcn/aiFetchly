import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { PortableWorkspaceMemoryService } from "@/service/PortableWorkspaceMemoryService";
import { PortableWorkspaceMemoryFileStore } from "@/service/PortableWorkspaceMemoryFileStore";
import { PortableWorkspaceMemoryFormat } from "@/service/PortableWorkspaceMemoryFormat";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import type { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import type { WorkspaceMemoryContext } from "@/service/WorkspaceMemoryContextResolver";
import type { WorkspaceMemoryScopeResolver } from "@/service/WorkspaceMemoryScopeResolver";
import type { WorkspaceMemoryScopeContext } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { PortableWorkspaceMemorySyncCoordinator } from "@/service/PortableWorkspaceMemorySyncCoordinator";
import type { PortableMemoryScanSnapshot } from "@/entityTypes/portableWorkspaceMemoryTypes";
import path from "node:path";
import yaml from "js-yaml";
import { createHash } from "crypto";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-race");

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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
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

const SCOPE: WorkspaceMemoryScopeContext = {
  scopeId: `wscope-legacy-${"a".repeat(32)}`,
  workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceRoot: tmpDir,
  displayName: "Alpha",
  portableEnabled: true,
  importPolicy: "automatic",
};

const CTX: WorkspaceMemoryContext = {
  conversationId: "conv-1",
  workspaceId: 42,
  workspaceKey: SCOPE.workspaceKey,
  workspaceRoot: tmpDir,
  displayName: "Alpha",
  scopeId: SCOPE.scopeId,
};

function makeContextResolver(): WorkspaceMemoryContextResolver {
  return {
    resolveForConversation: vi.fn().mockResolvedValue(CTX),
  } as unknown as WorkspaceMemoryContextResolver;
}

function makeScopeResolver(): WorkspaceMemoryScopeResolver {
  return {
    resolveForWorkspace: vi.fn().mockResolvedValue(SCOPE),
  } as unknown as WorkspaceMemoryScopeResolver;
}

async function enablePortable(): Promise<void> {
  const scopeModule = new WorkspaceMemoryScopeModule();
  await scopeModule.resolveLegacyScope({
    workspaceKey: SCOPE.workspaceKey,
    workspaceRoot: tmpDir,
    displayName: "Alpha",
  });
  await scopeModule.updatePolicy({
    scopeId: SCOPE.scopeId,
    portableEnabled: true,
    defaultStorageMode: "portable-local",
    importPolicy: "automatic",
  });
}

function makeService(): PortableWorkspaceMemoryService {
  return new PortableWorkspaceMemoryService(makeContextResolver());
}

const DOC_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";

function makeRecord(id: string, title: string, body: string): string {
  return new PortableWorkspaceMemoryFormat().serialize(
    new PortableWorkspaceMemoryFormat().buildDocument({
      id,
      type: "decision",
      status: "active",
      confidence: 90,
      visibility: "local",
      createdAt: new Date("2026-08-22T08:00:00.000Z"),
      updatedAt: new Date("2026-08-22T08:00:00.000Z"),
      createdBy: "external-agent",
      title,
      content: body,
    })
  );
}

function draftFromContent(content: string, relativePath: string) {
  const fmStart = content.indexOf("---\n") + 4;
  const fmEnd = content.indexOf("\n---\n", fmStart);
  return {
    relativePath,
    fileName: relativePath.split("/").pop()!,
    contentHash: createHash("sha256").update(content).digest("hex"),
    sizeBytes: Buffer.byteLength(content),
    mtimeMs: 1,
    rawFrontmatter: yaml.load(content.slice(fmStart, fmEnd)) as unknown,
    markdownBody: content.slice(fmEnd + 5),
    isSymbolicLink: false,
  };
}

function snapshot(records: ReturnType<typeof draftFromContent>[]): {
  workspaceId: string;
  workspaceRoot: string;
  approved: boolean;
  snapshot: PortableMemoryScanSnapshot;
} {
  return {
    workspaceId: "ws-1",
    workspaceRoot: tmpDir,
    approved: true,
    snapshot: {
      schemaVersion: 1,
      directoryPresent: true,
      complete: true,
      records,
      seenRelativePaths: records.map((r) => r.relativePath),
      totalBytes: 100,
      diagnostics: [],
    },
  };
}

describe("PortableWorkspaceMemoryService race-safe conflict resolution (FR-029/FR-041/AC-007)", () => {
  beforeEach(async () => {
    await enablePortable();
  });

  it("re-conflicts when the file changes between resolve and apply", async () => {
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
    // Simulate the conflict that put the record in conflicted state.
    await store.writeRecord(
      created.memoryId,
      original!.content.replace("first", "external v1")
    );
    await service
      .updatePortable({
        conversationId: "conv-1",
        memoryId: created.memoryId,
        type: "decision",
        title: "App v1",
        content: "app v1",
        confidence: 80,
        status: "active",
        visibility: "local",
        expectedHash: original!.contentHash,
      })
      .catch(() => undefined); // expected to throw (conflict)

    // Now resolve with use-app, but ANOTHER external edit happens before apply.
    const currentRead = (await store.readRecord(created.memoryId))!;
    const observedHash = currentRead.contentHash;
    await store.writeRecord(
      created.memoryId,
      currentRead.content.replace("external v1", "external v2 — racing!")
    );
    await expect(
      service.resolveConflict({
        conversationId: "conv-1",
        memoryId: created.memoryId,
        action: "use-app",
        expectedObservedHash: observedHash,
        mergedDocument: {
          title: "Merged",
          content: "merged content",
          type: "decision",
          status: "active",
          confidence: 85,
          visibility: "local",
        },
      })
    ).rejects.toThrow(/changed again before resolution/);

    // The racing external bytes are preserved.
    const after = await store.readRecord(created.memoryId);
    expect(after?.content).toContain("external v2 — racing!");
  });

  it("use-file resolves by importing the current file content", async () => {
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
    await store.writeRecord(
      created.memoryId,
      original!.content.replace("first", "external authoritative version")
    );
    // Force a conflict state.
    await service
      .updatePortable({
        conversationId: "conv-1",
        memoryId: created.memoryId,
        type: "decision",
        title: "App",
        content: "app",
        confidence: 80,
        status: "active",
        visibility: "local",
        expectedHash: original!.contentHash,
      })
      .catch(() => undefined);

    const observedHash = (await store.readRecord(created.memoryId))!
      .contentHash;
    await service.resolveConflict({
      conversationId: "conv-1",
      memoryId: created.memoryId,
      action: "use-file",
      expectedObservedHash: observedHash,
    });
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.getByScopeAndMemoryId(
      SCOPE.scopeId,
      created.memoryId
    );
    expect(row?.content).toContain("external authoritative version");
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(
      SCOPE.scopeId,
      created.memoryId
    );
    expect(state?.syncState).toBe("synced");
  });
});

describe("PortableWorkspaceMemorySyncCoordinator duplicate-ID rejection (FR-009/FR-014/FR-028)", () => {
  beforeEach(async () => {
    await enablePortable();
  });

  it("imports neither copy when two files share a memory id", async () => {
    const coordinator = new PortableWorkspaceMemorySyncCoordinator({
      scopeResolver: makeScopeResolver(),
      emitter: () => undefined,
      logger: () => undefined,
    });
    const content1 = makeRecord(DOC_ID, "First", "from file one");
    const content2 = makeRecord(DOC_ID, "Second", "from file two");
    const drafts = [
      draftFromContent(content1, `.aifetchly/memory/${DOC_ID}.md`),
      draftFromContent(content2, `.aifetchly/memory/${DOC_ID}-dup.md`),
    ];
    await coordinator.enqueueSnapshot(snapshot(drafts));

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    // Neither copy was imported.
    expect(
      await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID)
    ).toBeNull();
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    expect(
      await stateModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID)
    ).toBeNull();
  });

  it("imports a single-occurrence id normally", async () => {
    const coordinator = new PortableWorkspaceMemorySyncCoordinator({
      scopeResolver: makeScopeResolver(),
      emitter: () => undefined,
      logger: () => undefined,
    });
    const content = makeRecord(DOC_ID, "Solo", "only one file");
    await coordinator.enqueueSnapshot(
      snapshot([draftFromContent(content, `.aifetchly/memory/${DOC_ID}.md`)])
    );
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(row?.title).toBe("Solo");
  });
});
