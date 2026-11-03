import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir + Token/USERSDBPATH mocked so every Module
// constructed in this file resolves this run's isolated SQLite database.
const tmpDir = path.join(os.tmpdir(), `aifetchly-ws-repair-${crypto.randomUUID()}`);

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
import { WorkspaceModel } from "@/model/Workspace.model";
import { WorkspaceModule } from "@/modules/WorkspaceModule";
import { bindApprovedWorkspace } from "@/service/AiMessageTaskWorkspace";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";

/**
 * BUGFIX 2026-11-02 — left menu never shows the new chat's workspace folder.
 *
 * Root cause layer (schedule usage): bindings created BEFORE key-at-bind
 * resolution landed kept workspaceKey = null durably. `bindApprovedWorkspace`
 * short-circuited whenever the SAME folder was already active — so a schedule
 * task re-picking (or re-running against) that folder never repaired the
 * stale null-key row, and since the once-per-process workspace-key backfill
 * only runs at the FIRST sidebar bootstrap, the conversation stayed in
 * "Other chats" for the entire session even as the schedule kept running.
 *
 * Contract under test:
 *  1. A same-folder re-bind whose active row has a NULL key must repair the
 *     grouping key (newest binding resolves to a non-null workspaceKey and
 *     stays approved).
 *  2. A same-folder re-bind whose active row already has the correct key
 *     short-circuits without creating another row.
 */

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedApprovedBinding(input: {
  conversationId: string;
  rootPath: string;
  workspaceKey: string | null;
}): Promise<void> {
  await SqliteDb.ensureInitialized();
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(WorkspaceEntity);
  const entity = new WorkspaceEntity();
  entity.conversationId = input.conversationId;
  entity.rootPath = input.rootPath;
  entity.label = null;
  entity.approvalState = "approved";
  entity.approvedAt = new Date();
  entity.workspaceKey = input.workspaceKey;
  entity.canonicalRootPath = input.workspaceKey ? input.rootPath : null;
  await repo.save(entity);
}

async function newestBindingKey(
  conversationId: string
): Promise<string | null> {
  const model = new WorkspaceModel(tmpDir);
  return model.findWorkspaceKeyForConversation(conversationId);
}

async function activeRowCount(conversationId: string): Promise<number> {
  const rows = await SqliteDb.getInstance(tmpDir).connection
    .getRepository(WorkspaceEntity)
    .find({ where: { conversationId } });
  return rows.filter((r) => r.approvalState !== "revoked").length;
}

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
});

describe("bindApprovedWorkspace repairs stale null-key bindings", () => {
  it("repairs the grouping key when the same folder was bound pre-fix (null key row)", async () => {
    await SqliteDb.ensureInitialized();
    const dir = fs.mkdtempSync(path.join(tmpDir, "stale-"));
    await seedApprovedBinding({
      conversationId: "v2-refix",
      rootPath: dir,
      workspaceKey: null,
    });

    const canonical = await bindApprovedWorkspace("v2-refix", dir);
    expect(canonical).toBeTruthy();

    const expected = await new WorkspaceKeyService().resolve(dir);
    // The convention's newest binding must now carry a RESOLVED key so the
    // sidebar projection can group the conversation immediately.
    expect(await newestBindingKey("v2-refix")).toBe(expected.workspaceKey);
    // And the conversation remains approved (file tools keep working).
    const module = new WorkspaceModule();
    const active = await module.getActiveWorkspace("v2-refix");
    expect(active?.approvalState).toBe("approved");
    expect(active?.workspaceKey).toBe(expected.workspaceKey);
  });

  it("short-circuits a same-folder re-bind when the active row already has its key", async () => {
    await SqliteDb.ensureInitialized();
    const dir = fs.mkdtempSync(path.join(tmpDir, "healthy-"));
    // Post-fix binding: created WITH its resolved key.
    await new WorkspaceModule().setWorkspace({
      conversationId: "v2-refit",
      rootPath: dir,
    });
    // Approve what setWorkspace left pending.
    const repo =
     SqliteDb.getInstance(tmpDir).connection.getRepository(WorkspaceEntity);
    const rows = await repo.find({ where: { conversationId: "v2-refit" } });
    const entity = { ...rows[0], approvalState: "approved" as const };
    await repo.save(entity);
    const before = await activeRowCount("v2-refit");

    const canonical = await bindApprovedWorkspace("v2-refit", dir);
    expect(canonical).toBeTruthy();
    expect(await activeRowCount("v2-refit")).toBe(before);
    expect(await newestBindingKey("v2-refit")).toBeTruthy();
  });
});
