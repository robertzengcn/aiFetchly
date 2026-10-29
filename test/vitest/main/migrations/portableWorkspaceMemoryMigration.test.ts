import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-migration");

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

describe("PortableWorkspaceMemory migration (FR-067/068)", () => {
  it("creates the four scope tables with correct indexes", async () => {
    // Initialize the DataSource (synchronize creates the tables; the migration
    // runs if DB_MIGRATIONS is non-empty AND it's a packaged build — in dev
    // we run the migration manually to test it).
    const { PortableWorkspaceMemory1700000000000 } = await import(
      "@/migrations/1700000000000-portable-workspace-memory"
    );
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const connection = SqliteDb.getInstance(tmpDir).connection;
    const queryRunner = connection.createQueryRunner();
    try {
      await new PortableWorkspaceMemory1700000000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    // Query through the DataSource connection (WAL: a second better-sqlite3
    // handle may not see just-committed schema changes).
    const tables = (await connection.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN
       ('ai_workspace_memory_scopes','ai_workspace_memory_scope_paths',
        'ai_workspace_memory_portable_states','ai_workspace_memory_sync_audits')`
    )) as { name: string }[];
    const tableNames = new Set(tables.map((t) => t.name));
    expect(tableNames.has("ai_workspace_memory_scopes")).toBe(true);
    expect(tableNames.has("ai_workspace_memory_scope_paths")).toBe(true);
    expect(tableNames.has("ai_workspace_memory_portable_states")).toBe(true);
    expect(tableNames.has("ai_workspace_memory_sync_audits")).toBe(true);
    const indexes = (await connection.query(
      `SELECT name FROM sqlite_master WHERE type='index' AND name IN
       ('uq_ai_workspace_memory_scope_id','uq_ai_workspace_memory_portable_id',
        'uq_ai_workspace_portable_state_record','uq_ai_workspace_memory_audit_event')`
    )) as { name: string }[];
    const indexNames = new Set(indexes.map((i) => i.name));
    expect(indexNames.has("uq_ai_workspace_memory_scope_id")).toBe(true);
    expect(indexNames.has("uq_ai_workspace_memory_portable_id")).toBe(true);
    expect(indexNames.has("uq_ai_workspace_portable_state_record")).toBe(true);
    expect(indexNames.has("uq_ai_workspace_memory_audit_event")).toBe(true);
  });

  it("backfills existing memory rows onto deterministic legacy scopes", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const connection = SqliteDb.getInstance(tmpDir).connection;

    // Seed pre-portable memory rows (scopeId IS NULL, as legacy data would be).
    await connection.query(
      `INSERT INTO "ai_workspace_memories"
       ("memoryId", "workspaceKey", "workspaceRoot", "type", "title", "content", "status", "confidence")
       VALUES
       ('wmem-11111111-1111-4111-8111-111111111111', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '/p/a', 'decision', 'A', 'content a', 'active', 90),
       ('wmem-22222222-2222-4222-8222-222222222222', 'ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '/p/a', 'decision', 'B', 'content b', 'active', 80),
       ('wmem-33333333-3333-4333-8333-333333333333', 'ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '/p/b', 'warning', 'C', 'content c', 'active', 70)`
    );

    const { PortableWorkspaceMemory1700000000000 } = await import(
      "@/migrations/1700000000000-portable-workspace-memory"
    );
    const queryRunner = connection.createQueryRunner();
    try {
      await new PortableWorkspaceMemory1700000000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    // Query through the DataSource connection (WAL isolation).
    const rows = (await connection.query(
      `SELECT "memoryId", "scopeId" FROM "ai_workspace_memories" ORDER BY "memoryId"`
    )) as { memoryId: string; scopeId: string }[];
    for (const row of rows) {
      expect(row.scopeId).not.toBeNull();
    }
    // Two distinct workspace keys → two distinct legacy scopes.
    const scopes = new Set(rows.map((r) => r.scopeId));
    expect(scopes.size).toBe(2);
    expect(
      rows.some(
        (r) => r.scopeId === "wscope-legacy-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      )
    ).toBe(true);
    expect(
      rows.some(
        (r) => r.scopeId === "wscope-legacy-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      )
    ).toBe(true);
    // The scope table has one row per key.
    const scopeRows = (await connection.query(
      `SELECT "scopeId" FROM "ai_workspace_memory_scopes"`
    )) as { scopeId: string }[];
    expect(scopeRows).toHaveLength(2);
  });

  it("is idempotent (running twice is a no-op)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const connection = SqliteDb.getInstance(tmpDir).connection;
    const { PortableWorkspaceMemory1700000000000 } = await import(
      "@/migrations/1700000000000-portable-workspace-memory"
    );
    const qr1 = connection.createQueryRunner();
    await new PortableWorkspaceMemory1700000000000().up(qr1);
    await qr1.release();
    // Second run must not throw.
    const qr2 = connection.createQueryRunner();
    await expect(
      new PortableWorkspaceMemory1700000000000().up(qr2)
    ).resolves.toBeUndefined();
    await qr2.release();
  });

  it("refuses down migration when duplicate memoryIds exist across scopes", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const connection = SqliteDb.getInstance(tmpDir).connection;
    const { PortableWorkspaceMemory1700000000000 } = await import(
      "@/migrations/1700000000000-portable-workspace-memory"
    );
    const qr = connection.createQueryRunner();
    await new PortableWorkspaceMemory1700000000000().up(qr);
    // Seed a duplicate memoryId across two scopes.
    await connection.query(
      `INSERT INTO "ai_workspace_memories"
       ("memoryId", "workspaceKey", "workspaceRoot", "type", "title", "content", "status", "confidence", "scopeId")
       VALUES
       ('wmem-dup-00000000-0000-4000-8000-000000000000', 'ws_cccccccccccccccccccccccccccccccc', '/p/c', 'decision', 'D', 'c', 'active', 90, 'wscope-legacy-cccccccccccccccccccccccccccccccc'),
       ('wmem-dup-00000000-0000-4000-8000-000000000000', 'ws_dddddddddddddddddddddddddddddddd', '/p/d', 'decision', 'E', 'd', 'active', 90, 'wscope-legacy-dddddddddddddddddddddddddddddddd')`
    );
    await expect(
      new PortableWorkspaceMemory1700000000000().down(qr)
    ).rejects.toThrow(/duplicate memoryId/);
    await qr.release();
  });
});
