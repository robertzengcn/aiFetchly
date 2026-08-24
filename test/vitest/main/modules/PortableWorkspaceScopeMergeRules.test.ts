import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import {
  WorkspaceMemoryScopeModule,
} from "@/modules/WorkspaceMemoryScopeModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `aifetchly-scope-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return tmpDir;
    }
  },
}));

const KEY_A = "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SCOPE_A = `wscope-legacy-${"a".repeat(32)}`;
const SCOPE_B = `wscope-legacy-${"b".repeat(32)}`;
const SHARED_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";
const HASH = "a".repeat(64);

function makeModule(): WorkspaceMemoryScopeModule {
  return new WorkspaceMemoryScopeModule();
}
function memoryModel(): AIWorkspaceMemoryModel {
  return new AIWorkspaceMemoryModel(tmpDir);
}
function stateModel(): AIWorkspaceMemoryPortableStateModel {
  return new AIWorkspaceMemoryPortableStateModel(tmpDir);
}

async function seedMemory(
  scopeId: string,
  memoryId: string,
  title: string,
  workspaceKey: string
): Promise<void> {
  await memoryModel().create({
    memoryId,
    scopeId,
    workspaceKey,
    workspaceRoot: "/p",
    type: "decision",
    title,
    content: `content for ${title}`,
    status: "active",
    confidence: 90,
  });
}

async function seedPortableState(
  scopeId: string,
  memoryId: string,
  hash: string,
  visibility: "local" | "team" = "local"
): Promise<void> {
  await stateModel().upsert({
    scopeId,
    memoryId,
    relativePath: `.aifetchly/memory/${memoryId}.md`,
    visibility,
    createdBy: "user",
    portableCreatedAt: new Date("2026-08-22T08:00:00.000Z"),
    portableUpdatedAt: new Date("2026-08-22T08:00:00.000Z"),
    lastValidHash: hash,
    observedHash: hash,
    syncState: "synced",
    lastImportedAt: new Date(),
  });
}

describe("WorkspaceMemoryScopeModule merge rules (FR-067/068/AC-013)", () => {
  beforeEach(async () => {
    const mod = makeModule();
    await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/p/a",
      displayName: "Alpha",
    });
    await mod.resolveLegacyScope({
      workspaceKey: KEY_B,
      workspaceRoot: "/p/b",
      displayName: "Beta",
    });
  });

  it("deduplicates when both portable records share the same hash (keep one)", async () => {
    const mod = makeModule();
    await seedMemory(SCOPE_A, SHARED_ID, "A copy", KEY_A);
    await seedPortableState(SCOPE_A, SHARED_ID, HASH, "local");
    await seedMemory(SCOPE_B, SHARED_ID, "B copy", KEY_B);
    await seedPortableState(SCOPE_B, SHARED_ID, HASH, "local");

    const portableId = `ws-${"c".repeat(8)}-1111-4111-8111-111111111111`;
    await mod.bindPortableIdentity({
      scopeId: SCOPE_A,
      portableWorkspaceId: portableId,
    });
    // Binding the same identity from B merges B into A.
    const merged = await mod.bindPortableIdentity({
      scopeId: SCOPE_B,
      portableWorkspaceId: portableId,
    });
    expect(merged.scopeId).toBe(SCOPE_A);

    // Only ONE projection of the shared id remains (on scope A).
    const rowsA = await memoryModel().listByScope({ scopeId: SCOPE_A, limit: 200 });
    const withSharedId = rowsA.filter((r) => r.memoryId === SHARED_ID);
    expect(withSharedId).toHaveLength(1);
    // Scope B is gone.
    expect(await memoryModel().listByScope({ scopeId: SCOPE_B, limit: 200 })).toHaveLength(0);
  });

  it("preserves portable over colliding private and re-IDs the private copy", async () => {
    const mod = makeModule();
    await seedMemory(SCOPE_A, SHARED_ID, "Portable on A", KEY_A);
    await seedPortableState(SCOPE_A, SHARED_ID, HASH, "team");
    // B has the same id but is PRIVATE (no portable state).
    await seedMemory(SCOPE_B, SHARED_ID, "Private on B", KEY_B);

    const portableId = `ws-${"d".repeat(8)}-1111-4111-8111-111111111111`;
    await mod.bindPortableIdentity({
      scopeId: SCOPE_A,
      portableWorkspaceId: portableId,
    });
    await mod.bindPortableIdentity({
      scopeId: SCOPE_B,
      portableWorkspaceId: portableId,
    });

    // The portable record (on A) keeps the shared id; the private copy got a fresh id.
    const rowsA = await memoryModel().listByScope({ scopeId: SCOPE_A, limit: 200 });
    expect(rowsA.filter((r) => r.memoryId === SHARED_ID)).toHaveLength(1);
    expect(rowsA.filter((r) => r.memoryId !== SHARED_ID && r.title === "Private on B")).toHaveLength(1);
    // Both records survive (no data loss).
    expect(rowsA.length).toBe(2);
  });

  it("marks differing portable records as scope-merge conflicts", async () => {
    const mod = makeModule();
    await seedMemory(SCOPE_A, SHARED_ID, "A version", KEY_A);
    await seedPortableState(SCOPE_A, SHARED_ID, HASH, "local");
    await seedMemory(SCOPE_B, SHARED_ID, "B version", KEY_B);
    // Different hash → differs.
    await seedPortableState(SCOPE_B, SHARED_ID, "b".repeat(64), "local");

    const portableId = `ws-${"e".repeat(8)}-1111-4111-8111-111111111111`;
    await mod.bindPortableIdentity({
      scopeId: SCOPE_A,
      portableWorkspaceId: portableId,
    });
    await mod.bindPortableIdentity({
      scopeId: SCOPE_B,
      portableWorkspaceId: portableId,
    });

    // Both records survive; the incoming one (formerly B) is conflicted.
    const rowsA = await memoryModel().listByScope({ scopeId: SCOPE_A, limit: 200 });
    expect(rowsA.length).toBe(2);
    // The re-ID'd (formerly B) record has a conflicted portable state.
    const reIded = rowsA.find((r) => r.memoryId !== SHARED_ID);
    expect(reIded).toBeDefined();
    const conflictState = await stateModel().getByScopeAndMemoryId(
      SCOPE_A,
      reIded!.memoryId
    );
    expect(conflictState?.syncState).toBe("conflicted");
    expect(conflictState?.diagnosticCode).toBe("memory-conflict");
  });
});
