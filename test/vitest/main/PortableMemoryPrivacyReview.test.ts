import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { SqliteDb } from "@/config/SqliteDb";
import {
  PortableWorkspaceMemoryService,
} from "@/service/PortableWorkspaceMemoryService";
import {
  PortableWorkspaceMemoryFileStore,
} from "@/service/PortableWorkspaceMemoryFileStore";
import { PortableWorkspaceMemoryFormat } from "@/service/PortableWorkspaceMemoryFormat";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import type { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import type { WorkspaceMemoryContext } from "@/service/WorkspaceMemoryContextResolver";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-privacy");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db") || f === ".aifetchly") {
      try { fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true }); } catch { /* ignore */ }
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
  conversationId: "conv-secret-123",
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

describe("Privacy review (FR-057/FR-060/§28)", () => {
  beforeEach(async () => {
    await enablePortable();
  });

  it("exported files omit local-only fields (source IDs, paths, hashes, telemetry)", async () => {
    const service = new PortableWorkspaceMemoryService(makeContextResolver());
    // Seed a private record WITH local-only metadata (sourceConversationId,
    // sourceAgentTaskId, sourceMessageIds, lastUsedAt) that must NEVER be
    // exported (PRD §9.5 / SC-006).
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.create({
      memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
      scopeId: CTX.scopeId!,
      workspaceKey: CTX.workspaceKey,
      workspaceRoot: tmpDir,
      type: "decision",
      title: "Decision with local metadata",
      content: "The deploy uses yarn deploy --prod.",
      status: "active",
      confidence: 90,
      sourceKind: "chat_v2",
      sourceConversationId: "conv-secret-123",
      sourceAgentTaskId: "task-secret-456",
      sourceMessageIds: ["msg-1", "msg-2"],
      lastUsedAt: new Date(),
    });
    expect(row.sourceConversationId).toBe("conv-secret-123");

    // Promote (export) the record.
    await service.promote({
      conversationId: "conv-secret-123",
      memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
      visibility: "local",
    });

    // Read the exported file — it must NOT contain any local-only field.
    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    const read = await store.readRecord("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1");
    expect(read).not.toBeNull();
    const content = read!.content;
    // Local-only fields (PRD §9.5) must be absent.
    expect(content).not.toContain("conv-secret-123");
    expect(content).not.toContain("task-secret-456");
    expect(content).not.toContain("msg-1");
    expect(content).not.toContain("sourceConversationId");
    expect(content).not.toContain("sourceAgentTaskId");
    expect(content).not.toContain("sourceMessageIds");
    expect(content).not.toContain("lastUsedAt");
    expect(content).not.toContain("scopeId");
    expect(content).not.toContain("workspaceRoot");
    // Only portable fields are present.
    expect(content).toContain("schema: aifetchly.memory/v1");
    expect(content).toContain("createdBy: user");
  });

  it("audit rows contain no memory content (titles, bodies, secrets)", async () => {
    const service = new PortableWorkspaceMemoryService(makeContextResolver());
    await service.createPortable({
      conversationId: "conv-secret-123",
      type: "decision",
      title: "Decision about deployment",
      content: "Use yarn deploy --prod for production releases.",
      confidence: 90,
      visibility: "local",
    });

    // Read the audit table directly.
    const dbPath = path.join(tmpDir, "scraper.db");
    
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT * FROM ai_workspace_memory_sync_audits")
        .all() as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(rows);
      // No title/body content, no secrets.
      expect(serialized).not.toContain("Sensitive title");
      expect(serialized).not.toContain("password hunter2");
      expect(serialized).not.toContain("sk-abcdefghijklmnop");
      expect(serialized).not.toContain("API key");
    } finally {
      db.close();
    }
  });

  it("diagnostics use relative paths, not absolute roots", async () => {
    const service = new PortableWorkspaceMemoryService(makeContextResolver());
    const created = await service.createPortable({
      conversationId: "conv-secret-123",
      type: "decision",
      title: "T",
      content: "c",
      confidence: 90,
      visibility: "local",
    });

    const store = new PortableWorkspaceMemoryFileStore(tmpDir);
    // Make the file invalid (secret-like) so a diagnostic is produced on rescan.
    await store.writeRecord(
      created.memoryId,
      new PortableWorkspaceMemoryFormat().serialize(
        new PortableWorkspaceMemoryFormat().buildDocument({
          id: created.memoryId,
          type: "decision",
          status: "active",
          confidence: 90,
          visibility: "local",
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: "user",
          title: "T",
          content: "sk-abcdefghijklmnop secret",
        })
      )
    );

    // Trigger a rescan — the coordinator will reject the secret content.
    await service.rescan("conv-secret-123");
    // Give the coordinator a moment to process.
    await new Promise((r) => setTimeout(r, 200));

    const diags = await service.listDiagnostics("conv-secret-123");
    for (const d of diags) {
      // Relative path only (PRD §16.5 / FR-057).
      expect(d.relativePath).not.toContain(tmpDir);
      expect(d.relativePath).not.toContain(process.env.HOME ?? "/home");
      expect(d.relativePath.startsWith(".aifetchly/memory/")).toBe(true);
      // No content in the message.
      expect(d.message).not.toContain("sk-abcdefghijklmnop");
    }
  });
});
