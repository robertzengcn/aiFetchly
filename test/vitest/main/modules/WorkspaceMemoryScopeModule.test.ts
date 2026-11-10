import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryScopeModel } from "@/model/AIWorkspaceMemoryScope.model";
import { AIWorkspaceMemoryScopePathModel } from "@/model/AIWorkspaceMemoryScopePath.model";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-ws-scope-module");
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

const KEY_A = "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EXPECTED_SCOPE_A = `wscope-legacy-${"a".repeat(32)}`;

function makeModule(): WorkspaceMemoryScopeModule {
  return new WorkspaceMemoryScopeModule();
}

function makeMemoryModel(): AIWorkspaceMemoryModel {
  return new AIWorkspaceMemoryModel(tmpDir);
}

describe("WorkspaceMemoryScopeModule", () => {
  it("derives a deterministic legacy scope id", () => {
    expect(WorkspaceMemoryScopeModule.legacyScopeIdForWorkspaceKey(KEY_A)).toBe(
      EXPECTED_SCOPE_A
    );
    expect(
      WorkspaceMemoryScopeModule.legacyScopeIdForWorkspaceKey("no-prefix")
    ).toBe("wscope-legacy-no-prefix");
  });

  it("creates the legacy scope on first resolution with portable-local defaults", async () => {
    const mod = makeModule();
    const ctx = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    expect(ctx.scopeId).toBe(EXPECTED_SCOPE_A);
    expect(ctx.portableEnabled).toBe(true);
    expect(ctx.defaultStorageMode).toBe("portable-local");
    expect(ctx.importPolicy).toBe("review-new");
    expect(ctx.workspaceKey).toBe(KEY_A);
    expect(ctx.workspaceRoot).toBe("/projects/alpha");

    const scopeModel = new AIWorkspaceMemoryScopeModel(tmpDir);
    const row = await scopeModel.findByScopeId(EXPECTED_SCOPE_A);
    expect(row).not.toBeNull();
    expect(row?.displayName).toBe("Alpha");

    const pathModel = new AIWorkspaceMemoryScopePathModel(tmpDir);
    const pathRow = await pathModel.findByWorkspaceKey(KEY_A);
    expect(pathRow?.scopeId).toBe(EXPECTED_SCOPE_A);
  });

  it("is idempotent for repeated resolutions of the same key", async () => {
    const mod = makeModule();
    const first = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    const second = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    expect(second.scopeId).toBe(first.scopeId);

    const scopeModel = new AIWorkspaceMemoryScopeModel(tmpDir);
    const rows = await scopeModel.repository.find();
    expect(rows.filter((r) => r.scopeId === EXPECTED_SCOPE_A)).toHaveLength(1);
  });

  it("backfills pre-portable memory rows onto the scope", async () => {
    // Create a legacy row without a scopeId, as pre-portable data would be.
    const memoryModel = makeMemoryModel();
    await memoryModel.create({
      memoryId: "wmem-11111111-1111-4111-8111-111111111111",
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      type: "decision",
      title: "Legacy decision",
      content: "Old SQLite-only memory.",
      status: "active",
      confidence: 90,
    });

    const mod = makeModule();
    await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });

    const row = await memoryModel.getByScopeAndMemoryId(
      EXPECTED_SCOPE_A,
      "wmem-11111111-1111-4111-8111-111111111111"
    );
    expect(row).not.toBeNull();
    expect(row?.scopeId).toBe(EXPECTED_SCOPE_A);
  });

  it("binds a portable identity to a scope and is idempotent", async () => {
    const mod = makeModule();
    const ctx = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    const portableId = `ws-${"c".repeat(8)}-1111-4111-8111-111111111111`;
    const bound = await mod.bindPortableIdentity({
      scopeId: ctx.scopeId,
      portableWorkspaceId: portableId,
    });
    expect(bound.portableWorkspaceId).toBe(portableId);

    const again = await mod.bindPortableIdentity({
      scopeId: ctx.scopeId,
      portableWorkspaceId: portableId,
    });
    expect(again.portableWorkspaceId).toBe(portableId);

    const scopeModel = new AIWorkspaceMemoryScopeModel(tmpDir);
    const rows = await scopeModel.repository.find();
    expect(rows).toHaveLength(1);
  });

  it("merges two scopes that claim the same portable identity, keeping duplicate memory ids", async () => {
    const mod = makeModule();
    const ctxA = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    const ctxB = await mod.resolveLegacyScope({
      workspaceKey: KEY_B,
      workspaceRoot: "/projects/beta",
      displayName: "Beta",
    });

    const sharedMemoryId = "wmem-22222222-2222-4222-8222-222222222222";
    const memoryModel = makeMemoryModel();
    await memoryModel.create({
      memoryId: sharedMemoryId,
      scopeId: ctxA.scopeId,
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      type: "decision",
      title: "Alpha decision",
      content: "From clone A.",
      status: "active",
      confidence: 90,
    });
    await memoryModel.create({
      memoryId: sharedMemoryId,
      scopeId: ctxB.scopeId,
      workspaceKey: KEY_B,
      workspaceRoot: "/projects/beta",
      type: "decision",
      title: "Beta decision",
      content: "From clone B.",
      status: "active",
      confidence: 80,
    });

    const portableId = `ws-${"d".repeat(8)}-1111-4111-8111-111111111111`;
    await mod.bindPortableIdentity({
      scopeId: ctxA.scopeId,
      portableWorkspaceId: portableId,
    });
    // Binding the same identity from scope B merges B into A.
    const merged = await mod.bindPortableIdentity({
      scopeId: ctxB.scopeId,
      portableWorkspaceId: portableId,
    });
    expect(merged.portableWorkspaceId).toBe(portableId);

    // Both memories survive: the incoming duplicate got a fresh id.
    const aRow = await memoryModel.getByScopeAndMemoryId(
      ctxA.scopeId,
      sharedMemoryId
    );
    expect(aRow?.title).toBe("Alpha decision");
    const inScope = await memoryModel.listByScope({ scopeId: ctxA.scopeId });
    expect(inScope).toHaveLength(2);
    const titles = inScope.map((r) => r.title).sort();
    expect(titles).toEqual(["Alpha decision", "Beta decision"]);

    // Scope B is gone; its path key now maps to the surviving scope.
    const pathModel = new AIWorkspaceMemoryScopePathModel(tmpDir);
    const pathB = await pathModel.findByWorkspaceKey(KEY_B);
    expect(pathB?.scopeId).toBe(ctxA.scopeId);
    const scopeModel = new AIWorkspaceMemoryScopeModel(tmpDir);
    expect(await scopeModel.findByScopeId(ctxB.scopeId)).toBeNull();
  });

  it("rejects policy updates for unknown scopes", async () => {
    const mod = makeModule();
    await expect(
      mod.updatePolicy({
        scopeId: "wscope-legacy-missing",
        portableEnabled: true,
      })
    ).rejects.toThrow(/not found/i);
  });

  it("enables portable storage via updatePolicy", async () => {
    const mod = makeModule();
    const ctx = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    const updated = await mod.updatePolicy({
      scopeId: ctx.scopeId,
      portableEnabled: true,
      defaultStorageMode: "portable-local",
      importPolicy: "automatic",
    });
    expect(updated.portableEnabled).toBe(true);
    expect(updated.defaultStorageMode).toBe("portable-local");
    expect(updated.importPolicy).toBe("automatic");
  });

  it("upgrades never-configured SQLite-only scopes to portable-local", async () => {
    const scopeModel = new AIWorkspaceMemoryScopeModel(tmpDir);
    await scopeModel.create({
      scopeId: EXPECTED_SCOPE_A,
      displayName: "Alpha",
      portableEnabled: false,
      defaultStorageMode: "private-only",
      importPolicy: "review-new",
    });
    const mod = makeModule();
    const ctx = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    expect(ctx.portableEnabled).toBe(true);
    expect(ctx.defaultStorageMode).toBe("portable-local");
  });

  it("does not re-enable a scope the user explicitly disabled", async () => {
    const mod = makeModule();
    const created = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    await mod.updatePolicy({
      scopeId: created.scopeId,
      portableEnabled: false,
    });
    const again = await mod.resolveLegacyScope({
      workspaceKey: KEY_A,
      workspaceRoot: "/projects/alpha",
      displayName: "Alpha",
    });
    expect(again.portableEnabled).toBe(false);
    expect(again.defaultStorageMode).toBe("portable-local");
  });
});
