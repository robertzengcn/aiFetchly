import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { PortableWorkspaceMemoryModule } from "@/modules/PortableWorkspaceMemoryModule";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import type {
  PortableMemoryDocumentV1,
  WorkspaceMemoryScopeContext,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-mem-module");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
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

const DOC_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";
const DOC_ID_2 = "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0";

function makeDocument(
  overrides: Partial<PortableMemoryDocumentV1["frontmatter"]> = {},
  title = "Storage decision",
  content = "Markdown files own portable fields."
): PortableMemoryDocumentV1 {
  const frontmatter = {
    schema: "aifetchly.memory/v1",
    id: DOC_ID,
    type: "decision",
    status: "active",
    confidence: 95,
    visibility: "team",
    createdAt: "2026-08-22T08:30:00.000Z",
    updatedAt: "2026-08-22T08:30:00.000Z",
    createdBy: "aifetchly",
    ...overrides,
  } as PortableMemoryDocumentV1["frontmatter"];
  return {
    frontmatter,
    title,
    content,
    relativePath: `.aifetchly/memory/${frontmatter.id}.md`,
    contentHash: "a".repeat(64),
    sizeBytes: 100,
    mtimeMs: 0,
  };
}

async function makeScope(): Promise<WorkspaceMemoryScopeContext> {
  const scopeModule = new WorkspaceMemoryScopeModule();
  return scopeModule.resolveLegacyScope({
    workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workspaceRoot: "/projects/alpha",
    displayName: "Alpha",
  });
}

function makeModule(): PortableWorkspaceMemoryModule {
  return new PortableWorkspaceMemoryModule();
}

describe("PortableWorkspaceMemoryModule", () => {
  it("imports a validated document into projection + portable state", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: false,
    });

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID);
    expect(row?.title).toBe("Storage decision");
    expect(row?.scopeId).toBe(scope.scopeId);

    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID);
    expect(state?.syncState).toBe("synced");
    expect(state?.lastValidHash).toBe("a".repeat(64));
    expect(state?.visibility).toBe("team");
  });

  it("marks new external records pending-review under review-new", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: true,
    });
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID);
    expect(state?.syncState).toBe("pending-review");

    await mod.approvePendingReview(scope, DOC_ID);
    const approved = await stateModel.getByScopeAndMemoryId(
      scope.scopeId,
      DOC_ID
    );
    expect(approved?.syncState).toBe("synced");
  });

  it("retains the last valid projection when a file becomes rejected", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: false,
    });

    await mod.markRejectedFile(scope, {
      relativePath: `.aifetchly/memory/${DOC_ID}.md`,
      memoryId: DOC_ID,
      observedHash: "b".repeat(64),
      diagnostic: {
        code: "memory-secret-rejected",
        relativePath: `.aifetchly/memory/${DOC_ID}.md`,
        message: "content looks like a credential",
        recoverable: false,
      },
    });

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID);
    expect(row?.title).toBe("Storage decision"); // last valid projection kept

    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID);
    expect(state?.syncState).toBe("rejected");
    expect(state?.lastValidHash).toBe("a".repeat(64)); // NOT overwritten
    expect(state?.observedHash).toBe("b".repeat(64));

    // Fail-closed: excluded from retrieval.
    const excluded = await mod.listExcludedMemoryIds(scope);
    expect(excluded.has(DOC_ID)).toBe(true);
  });

  it("marks conflicts without touching the projection", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: false,
    });
    await mod.markConflict(scope, {
      memoryId: DOC_ID,
      relativePath: `.aifetchly/memory/${DOC_ID}.md`,
      message: "file changed during app edit",
    });
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID);
    expect(state?.syncState).toBe("conflicted");
    const diags = await mod.listDiagnostics(scope);
    expect(diags.some((d) => d.code === "memory-conflict")).toBe(true);
  });

  it("deletes missing files under automatic policy after a complete scan", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: false,
    });
    await mod.upsertValidatedDocument(
      scope,
      makeDocument({ id: DOC_ID_2 }, "Second", "Another memory."),
      { actor: "external", pendingReview: false }
    );

    const result = await mod.reconcileMissingPaths(
      scope,
      new Set([`.aifetchly/memory/${DOC_ID_2}.md`]),
      "pmem-scan-1",
      "automatic"
    );
    expect(result.deletedMemoryIds).toEqual([DOC_ID]);
    expect(result.missingMemoryIds).toEqual([]);

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID)
    ).toBeNull();
    expect(
      await memoryModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID_2)
    ).not.toBeNull();
  });

  it("marks missing files for review under review-new policy", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: false,
    });
    const result = await mod.reconcileMissingPaths(
      scope,
      new Set([]),
      "pmem-scan-2",
      "review-new"
    );
    expect(result.deletedMemoryIds).toEqual([]);
    expect(result.missingMemoryIds).toEqual([DOC_ID]);

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID)
    ).not.toBeNull(); // projection retained pending approval
  });

  it("promotes a private memory without duplicating the logical record", async () => {
    const scope = await makeScope();
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const created = await memoryModel.create({
      memoryId: DOC_ID,
      scopeId: scope.scopeId,
      workspaceKey: scope.workspaceKey,
      workspaceRoot: scope.workspaceRoot,
      type: "decision",
      title: "Old private title",
      content: "Old content",
      status: "active",
      confidence: 50,
      sourceKind: "manual",
    });
    expect(created.memoryId).toBe(DOC_ID);

    const mod = makeModule();
    await mod.promotePrivateMemory(
      scope,
      DOC_ID,
      makeDocument({ id: DOC_ID }, "Promoted title", "Portable content."),
      "c".repeat(64)
    );

    const rows = await memoryModel.listByScope({ scopeId: scope.scopeId });
    expect(rows).toHaveLength(1); // linked, not duplicated
    expect(rows[0]?.title).toBe("Promoted title");

    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID);
    expect(state?.syncState).toBe("synced");
  });

  it("privatizes a portable record (detach keeps the projection row)", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: false,
    });
    await mod.privatizeMemory(scope, DOC_ID, `.aifetchly/memory/${DOC_ID}.md`);
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    expect(
      await stateModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID)
    ).toBeNull();
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(scope.scopeId, DOC_ID)
    ).not.toBeNull();
  });

  it("never stores memory content in audit rows", async () => {
    const scope = await makeScope();
    const mod = makeModule();
    await mod.upsertValidatedDocument(scope, makeDocument(), {
      actor: "external",
      pendingReview: false,
    });
    await mod.recordAudit({
      scopeId: scope.scopeId,
      action: "scan",
      actor: "system",
      outcome: "completed",
      message: "scan finished",
    });
    const dbFile = path.join(tmpDir, "scraper.db");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database =
      require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(dbFile, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT * FROM ai_workspace_memory_sync_audits")
        .all() as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain("Markdown files own portable fields.");
      expect(serialized).not.toContain("Storage decision");
    } finally {
      db.close();
    }
  });
});
