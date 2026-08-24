import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import {
  PortableWorkspaceMemorySyncCoordinator,
} from "@/service/PortableWorkspaceMemorySyncCoordinator";
import { PortableWorkspaceMemoryFormat } from "@/service/PortableWorkspaceMemoryFormat";
import { PortableWorkspaceMemoryFileStore } from "@/service/PortableWorkspaceMemoryFileStore";
import type { WorkspaceMemoryScopeResolver } from "@/service/WorkspaceMemoryScopeResolver";
import type { WorkspaceMemoryScopeContext, PortableMemoryDocumentV1 } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-conflict");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
  }
  // Clean any memory dir from prior runs.
  const memDir = path.join(tmpDir, ".aifetchly", "memory");
  if (fs.existsSync(memDir)) fs.rmSync(memDir, { recursive: true, force: true });
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

const DOC_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";
const SCOPE: WorkspaceMemoryScopeContext = {
  scopeId: `wscope-legacy-${"a".repeat(32)}`,
  workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceRoot: tmpDir,
  displayName: "Alpha",
  portableEnabled: true,
  importPolicy: "automatic",
};

function makeScopeResolver(scope = SCOPE): WorkspaceMemoryScopeResolver {
  return {
    resolveForWorkspace: vi.fn().mockResolvedValue(scope),
  } as unknown as WorkspaceMemoryScopeResolver;
}

function makeDocument(title: string, content: string): PortableMemoryDocumentV1 {
  return new PortableWorkspaceMemoryFormat().buildDocument({
    id: DOC_ID,
    type: "decision",
    status: "active",
    confidence: 90,
    visibility: "local",
    createdAt: new Date("2026-08-22T08:00:00.000Z"),
    updatedAt: new Date(),
    createdBy: "aifetchly",
    title,
    content,
  });
}

function makeCoordinator() {
  const summaries: import("@/entityTypes/portableWorkspaceMemoryTypes").PortableMemorySyncSummary[] = [];
  const coordinator = new PortableWorkspaceMemorySyncCoordinator({
    scopeResolver: makeScopeResolver(),
    emitter: (s) => summaries.push(s),
    logger: () => undefined,
  });
  return { coordinator, summaries };
}

describe("PortableWorkspaceMemorySyncCoordinator conflict detection (FR-029/AC-007)", () => {
  it("marks a conflict when the on-disk hash changed since the expected hash", async () => {
    const { coordinator, summaries } = makeCoordinator();
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    // Write an initial file (simulating the last-known state).
    const doc1 = makeDocument("First", "Original content.");
    const written1 = await store.writeRecord(DOC_ID, new PortableWorkspaceMemoryFormat().serialize(doc1));

    // External edit happens between read and write.
    const external = makeDocument("External", "Edited by another agent.");
    await store.writeRecord(DOC_ID, new PortableWorkspaceMemoryFormat().serialize(external));

    const result = await coordinator.applyAppWrite(SCOPE, doc1, {
      expectedHash: written1.contentHash,
    });
    expect(result.conflicted).toBe(true);

    // External bytes are preserved (NOT overwritten).
    const after = await store.readRecord(DOC_ID);
    expect(after?.content).toContain("Edited by another agent");

    // Summary emitted with conflicted=1 and a memory-conflict diagnostic.
    const conflictSummary = summaries.find((s) => s.conflicted > 0);
    expect(conflictSummary).toBeDefined();
    expect(conflictSummary?.diagnostics[0]?.code).toBe("memory-conflict");

    // Portable state is conflicted.
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(state?.syncState).toBe("conflicted");
  });

  it("writes through cleanly when the expected hash matches the on-disk hash", async () => {
    const { coordinator, summaries } = makeCoordinator();
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    const doc1 = makeDocument("First", "Original content.");
    const written1 = await store.writeRecord(DOC_ID, new PortableWorkspaceMemoryFormat().serialize(doc1));

    const result = await coordinator.applyAppWrite(SCOPE, makeDocument("Second", "App update."), {
      expectedHash: written1.contentHash,
    });
    expect(result.conflicted).toBe(false);

    const after = await store.readRecord(DOC_ID);
    expect(after?.content).toContain("App update.");
    expect(summaries.some((s) => s.conflicted > 0)).toBe(false);
  });

  it("does not conflict when expectedHash is omitted (un guarded write)", async () => {
    const { coordinator, summaries } = makeCoordinator();
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    // Pre-existing file with different content — but no expectedHash means no
    // guard (the caller did not read first).
    await store.writeRecord(DOC_ID, new PortableWorkspaceMemoryFormat().serialize(makeDocument("Pre", "pre.")));
    const result = await coordinator.applyAppWrite(SCOPE, makeDocument("New", "new."));
    expect(result.conflicted).toBe(false);
    expect(summaries).toHaveLength(0);
    const after = await store.readRecord(DOC_ID);
    expect(after?.content).toContain("new.");
  });

  it("listConflicts surfaces conflicted records for the resolver UI", async () => {
    const { coordinator } = makeCoordinator();
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    const doc1 = makeDocument("First", "Original content.");
    const written1 = await store.writeRecord(DOC_ID, new PortableWorkspaceMemoryFormat().serialize(doc1));
    await store.writeRecord(DOC_ID, new PortableWorkspaceMemoryFormat().serialize(makeDocument("External", "external.")));
    await coordinator.applyAppWrite(SCOPE, doc1, { expectedHash: written1.contentHash });

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    // Seed a memory projection row so listConflicts has context.
    await memoryModel.create({
      memoryId: DOC_ID,
      scopeId: SCOPE.scopeId,
      workspaceKey: SCOPE.workspaceKey,
      workspaceRoot: tmpDir,
      type: "decision",
      title: "First",
      content: "Original content.",
      status: "active",
      confidence: 90,
    });

    // listConflicts lives on the module; test via the portable module.
    const { PortableWorkspaceMemoryModule } = await import("@/modules/PortableWorkspaceMemoryModule");
    const mod = new PortableWorkspaceMemoryModule();
    const conflicts = await mod.listConflicts(SCOPE);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.memoryId).toBe(DOC_ID);
    expect(conflicts[0]?.relativePath).toContain(`${DOC_ID}.md`);
  });
});
