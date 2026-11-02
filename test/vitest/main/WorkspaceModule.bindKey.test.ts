import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir + Token/USERSDBPATH mocked so every Module
// constructed in this file resolves this run's isolated SQLite database.
const tmpDir = path.join(os.tmpdir(), `aifetchly-ws-bind-${crypto.randomUUID()}`);

vi.mock("@/modules/token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Token {
    getValue(name: string) {
      void name;
      return tmpDir;
    }
    setValue() {
      // no-op in tests
    }
  }
  return { ...actual, Token };
});
vi.mock("@/config/usersetting", () => ({
  USERSDBPATH: "user_dbpath",
}));

import { SqliteDb } from "@/config/SqliteDb";
import { WorkspaceEntity } from "@/entity/Workspace.entity";
import { WorkspaceModule } from "@/modules/WorkspaceModule";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";

/**
 * Bugfix 2026-11-02 — left menu never shows the new chat's workspace folder.
 *
 * Root cause layer 1: bindings created mid-session kept workspaceKey = null
 * (the stable key only materialized through the once-per-process workspace-key
 * backfill that runs on the FIRST bootstrap). Any workspace bound after that
 * point — the new-chat workspace pick, or a scheduled task's workspace_path —
 * could never be grouped by getWorkspaceSidebar until an app restart.
 *
 * Contract under test: WorkspaceModule.setWorkspace resolves the stable
 * WorkspaceKeyService key at bind time and persists it (+ its canonical root)
 * on the binding row. Resolution failure keeps the row null-keyed so the
 * conversation stays visible under Unassigned (design §26.3 semantics).
 */

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function readBindingRow(conversationId: string): Promise<
  | {
      workspaceKey: string | null;
      canonicalRootPath: string | null;
      approvalState: string;
    }
  | undefined
> {
  const entity = await SqliteDb.getInstance(tmpDir).connection
    .getRepository(WorkspaceEntity)
    .findOne({ where: { conversationId } });
  if (!entity) return undefined;
  return {
    workspaceKey: entity.workspaceKey ?? null,
    canonicalRootPath: entity.canonicalRootPath ?? null,
    approvalState: entity.approvalState,
  };
}

describe("WorkspaceModule.setWorkspace key-at-bind resolution", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
  });

  it("persists the resolved workspaceKey and canonicalRootPath on the new binding", async () => {
    await SqliteDb.ensureInitialized();
    const dir = fs.mkdtempSync(path.join(tmpDir, "root-"));

    const record = await new WorkspaceModule().setWorkspace({
      conversationId: "v2-bind-key-1",
      rootPath: dir,
    });

    const expected = await new WorkspaceKeyService().resolve(dir);
    const row = await readBindingRow("v2-bind-key-1");
    expect(row).toBeDefined();
    // RED target: the key must be non-null immediately at bind time.
    expect(row?.workspaceKey).toBe(expected.workspaceKey);
    expect(row?.canonicalRootPath).toBe(expected.canonicalRootPath);
    expect(row?.approvalState).toBe("pending");
    // The returned record carries the key so callers (IPC broadcast) need no
    // second lookup.
    expect(record.workspaceKey).toBe(expected.workspaceKey);
  });

  it("keeps the binding row null-keyed when the path cannot be resolved", async () => {
    await SqliteDb.ensureInitialized();
    const missingDir = path.join(tmpDir, "does-not-exist");

    const record = await new WorkspaceModule().setWorkspace({
      conversationId: "v2-bind-key-2",
      rootPath: missingDir,
    });

    const row = await readBindingRow("v2-bind-key-2");
    expect(row).toBeDefined();
    // Unresolvable path → unresolved binding, still grouped as Unassigned.
    expect(row?.workspaceKey).toBeNull();
    expect(row?.canonicalRootPath).toBeNull();
    expect(record.workspaceKey).toBeNull();
  });

  it("assigns one shared key to two conversations resolving the same root", async () => {
    await SqliteDb.ensureInitialized();
    const dir = fs.mkdtempSync(path.join(tmpDir, "shared-"));

    await new WorkspaceModule().setWorkspace({
      conversationId: "v2-bind-key-3a",
      rootPath: dir,
    });
    await new WorkspaceModule().setWorkspace({
      conversationId: "v2-bind-key-3b",
      rootPath: dir,
    });

    const a = await readBindingRow("v2-bind-key-3a");
    const b = await readBindingRow("v2-bind-key-3b");
    expect(a?.workspaceKey).toBeTruthy();
    expect(b?.workspaceKey).toBe(a?.workspaceKey);
  });
});
