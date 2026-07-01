import { describe, expect, it, beforeEach } from "vitest";
import { WorkspaceModel } from "@/model/Workspace.model";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-workspace-model");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  // Delete any on-disk sqlite files left from prior runs (test isolation).
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  // Reset the in-memory singleton.
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("WorkspaceModel", () => {
  it("upserts and reads back a workspace", async () => {
    const model = new WorkspaceModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const record = await model.upsert({
      conversationId: "conv-1",
      rootPath: "/tmp/project",
      label: "Project",
      approvalState: "pending",
    });
    // id is DB-assigned numeric, not a client-supplied string.
    expect(typeof record.id).toBe("number");
    expect(record.conversationId).toBe("conv-1");
    expect(record.rootPath).toBe("/tmp/project");
    expect(record.label).toBe("Project");
    expect(record.approvalState).toBe("pending");

    const found = await model.findByConversation("conv-1");
    expect(found).not.toBeNull();
    expect(found?.id).toBe(record.id);
    expect(found?.rootPath).toBe("/tmp/project");
    expect(found?.label).toBe("Project");
  });

  it("updates approval state with timestamps", async () => {
    const model = new WorkspaceModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const created = await model.upsert({
      conversationId: "conv-2",
      rootPath: "/tmp/x",
      label: null,
      approvalState: "pending",
    });
    // pending -> no approval/revocation timestamps yet
    expect(created.approvedAt).toBeNull();
    expect(created.revokedAt).toBeNull();

    const approved = await model.setApprovalState(created.id, "approved");
    expect(approved).not.toBeNull();
    expect(approved?.approvalState).toBe("approved");
    expect(approved?.approvedAt).not.toBeNull();
    // approvedAt is an ISO string
    expect(typeof approved?.approvedAt).toBe("string");

    // read-back via findById confirms persistence
    const refound = await model.findById(created.id);
    expect(refound?.approvalState).toBe("approved");
    expect(refound?.approvedAt).not.toBeNull();
  });

  it("returns null for unknown conversation", async () => {
    const model = new WorkspaceModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const found = await model.findByConversation("does-not-exist");
    expect(found).toBeNull();
  });

  it("lists multiple workspaces for a conversation in desc order", async () => {
    const model = new WorkspaceModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const first = await model.upsert({
      conversationId: "conv-3",
      rootPath: "/tmp/a",
      label: null,
      approvalState: "revoked",
    });
    // SQLite CURRENT_TIMESTAMP is second-resolution; wait > 1s so the second
    // row gets a strictly-later createdAt and DESC ordering is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await model.upsert({
      conversationId: "conv-3",
      rootPath: "/tmp/b",
      label: null,
      approvalState: "approved",
    });

    const list = await model.listByConversation("conv-3");
    expect(list).toHaveLength(2);
    // Most recent first (DESC by createdAt)
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
    // Summaries carry the core fields
    expect(list[0].rootPath).toBe("/tmp/b");
    expect(list[1].rootPath).toBe("/tmp/a");
  });
});
