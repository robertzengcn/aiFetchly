import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir + Token/USERSDBPATH mocked so every Module
// constructed in this file resolves this run's isolated SQLite database.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-ws-module-${crypto.randomUUID()}`
);

vi.mock("@/modules/token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Token {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
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

/**
 * FR-WSP-002 supersede semantics: each conversation holds at most ONE
 * approved workspace binding. Approving a pick retires every other
 * non-terminated binding, and revoking the active binding must not silently
 * revive an older binding. Second-precision createdAt makes row ties
 * possible (change + re-pick within the same second), so the newest id is
 * the deterministic tie-break.
 */

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedWorkspace(input: {
  conversationId: string;
  rootPath: string;
  approvalState: "pending" | "approved" | "revoked";
  createdAt?: Date;
}): Promise<number> {
  await SqliteDb.ensureInitialized();
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(WorkspaceEntity);
  const entity = new WorkspaceEntity();
  entity.conversationId = input.conversationId;
  entity.rootPath = input.rootPath;
  entity.label = null;
  entity.approvalState = input.approvalState;
  if (input.createdAt) entity.createdAt = input.createdAt;
  if (input.approvalState === "approved") entity.approvedAt = new Date();
  const saved = await repo.save(entity);
  return saved.id;
}

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
});

afterEach(() => {
  resetDbSingleton();
});

describe("WorkspaceModule approval supersede (FR-WSP-002)", () => {
  it("approving a new binding revokes the other active binding of the conversation", async () => {
    await SqliteDb.ensureInitialized();
    const firstId = await seedWorkspace({
      conversationId: "conv-1",
      rootPath: "/tmp/projects-alpha",
      approvalState: "approved",
    });
    const secondId = await seedWorkspace({
      conversationId: "conv-1",
      rootPath: "/tmp/projects-beta",
      approvalState: "pending",
    });

    const module = new WorkspaceModule();
    const approved = await module.approveWorkspace(secondId);
    expect(approved?.approvalState).toBe("approved");
    expect(approved?.rootPath).toBe("/tmp/projects-beta");

    const stillActive = await module.getActiveWorkspace("conv-1");
    expect(stillActive?.id).toBe(secondId);

    // The superseded binding is revoked, not merely superseded by ordering.
    const model =
      SqliteDb.getInstance(tmpDir).connection.getRepository(WorkspaceEntity);
    const first = await model.findOne({ where: { id: firstId } });
    expect(first?.approvalState).toBe("revoked");
  });

  it("revoking the active binding leaves no active workspace after a supersede", async () => {
    await SqliteDb.ensureInitialized();
    await seedWorkspace({
      conversationId: "conv-2",
      rootPath: "/tmp/projects-alpha",
      approvalState: "approved",
    });
    const secondId = await seedWorkspace({
      conversationId: "conv-2",
      rootPath: "/tmp/projects-beta",
      approvalState: "pending",
    });
    const module = new WorkspaceModule();
    await module.approveWorkspace(secondId);
    await module.revokeWorkspace(secondId);

    expect(await module.getActiveWorkspace("conv-2")).toBeNull();
  });

  it("never touches rows of other conversations", async () => {
    await SqliteDb.ensureInitialized();
    const otherId = await seedWorkspace({
      conversationId: "conv-other",
      rootPath: "/tmp/other-root",
      approvalState: "approved",
    });
    const secondId = await seedWorkspace({
      conversationId: "conv-3",
      rootPath: "/tmp/projects-beta",
      approvalState: "pending",
    });
    const module = new WorkspaceModule();
    await module.approveWorkspace(secondId);

    const other = await module.getActiveWorkspace("conv-other");
    expect(other?.id).toBe(otherId);
  });

  it("breaks second-precision createdAt ties by newest id", async () => {
    await SqliteDb.ensureInitialized();
    const sameInstant = new Date();
    await seedWorkspace({
      conversationId: "conv-4",
      rootPath: "/tmp/tie-alpha",
      approvalState: "approved",
      createdAt: sameInstant,
    });
    const secondId = await seedWorkspace({
      conversationId: "conv-4",
      rootPath: "/tmp/tie-beta",
      approvalState: "approved",
      createdAt: sameInstant,
    });

    const module = new WorkspaceModule();
    const active = await module.getActiveWorkspace("conv-4");
    expect(active?.id).toBe(secondId);
  });
});
