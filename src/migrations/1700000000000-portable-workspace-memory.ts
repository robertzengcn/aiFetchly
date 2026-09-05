import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Portable workspace memory schema migration (design §9.2).
 *
 * Creates the four scope tables, adds the nullable `scopeId` column to
 * ai_workspace_memories, backfills every row onto a deterministic legacy
 * scope (`wscope-legacy-<workspaceKey without ws_ prefix>`), and swaps the
 * global memoryId unique index for the composite (scopeId, memoryId) unique
 * index.
 *
 * This migration is idempotent: every CREATE/ALTER is guarded so re-running
 * it (or running it against a DB already synchronized by TypeORM) is a no-op.
 * The runtime legacy-scope backfill in WorkspaceMemoryScopeModule covers dev
 * DBs that never ran this migration; this file makes packaged builds
 * converge (PRD §9.1 / FR-067-068).
 */
export class PortableWorkspaceMemory1700000000000
  implements MigrationInterface
{
  name = "PortableWorkspaceMemory1700000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Scope tables (idempotent CREATE).
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_workspace_memory_scopes" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "scopeId" varchar(100) NOT NULL,
        "portableWorkspaceId" varchar(100),
        "displayName" varchar(255) NOT NULL,
        "portableEnabled" boolean NOT NULL DEFAULT (0),
        "defaultStorageMode" varchar(30) NOT NULL DEFAULT ('private-only'),
        "importPolicy" varchar(30) NOT NULL DEFAULT ('review-new'),
        "lastCompleteScanAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_workspace_memory_scope_id"
       ON "ai_workspace_memory_scopes" ("scopeId")`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_workspace_memory_portable_id"
       ON "ai_workspace_memory_scopes" ("portableWorkspaceId")`
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_workspace_memory_scope_paths" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "scopeId" varchar(100) NOT NULL,
        "workspaceKey" varchar(100) NOT NULL,
        "workspaceRoot" varchar(1024) NOT NULL,
        "lastSeenAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_workspace_scope_path_key"
       ON "ai_workspace_memory_scope_paths" ("workspaceKey")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_scope_path_scope"
       ON "ai_workspace_memory_scope_paths" ("scopeId")`
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_workspace_memory_portable_states" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "scopeId" varchar(100) NOT NULL,
        "memoryId" varchar(100) NOT NULL,
        "relativePath" varchar(1024) NOT NULL,
        "visibility" varchar(20) NOT NULL,
        "createdBy" varchar(30) NOT NULL,
        "portableCreatedAt" datetime NOT NULL,
        "portableUpdatedAt" datetime NOT NULL,
        "supersedes" text,
        "tags" text,
        "reviewedAt" datetime,
        "reviewedBy" varchar(100),
        "lastValidHash" varchar(64),
        "observedHash" varchar(64),
        "syncState" varchar(30) NOT NULL,
        "diagnosticCode" varchar(80),
        "diagnosticMessage" varchar(1000),
        "lastImportedAt" datetime,
        "lastScanId" varchar(100),
        "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_workspace_portable_state_record"
       ON "ai_workspace_memory_portable_states" ("scopeId", "memoryId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_portable_state_sync"
       ON "ai_workspace_memory_portable_states" ("scopeId", "syncState")`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_workspace_portable_state_path"
       ON "ai_workspace_memory_portable_states" ("scopeId", "relativePath")`
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_workspace_memory_sync_audits" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "eventId" varchar(100) NOT NULL,
        "scopeId" varchar(100) NOT NULL,
        "memoryId" varchar(100),
        "relativePath" varchar(1024),
        "action" varchar(40) NOT NULL,
        "actor" varchar(30) NOT NULL,
        "outcome" varchar(30) NOT NULL,
        "previousHash" varchar(64),
        "nextHash" varchar(64),
        "diagnosticCode" varchar(80),
        "message" varchar(1000),
        "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_workspace_memory_audit_event"
       ON "ai_workspace_memory_sync_audits" ("eventId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_memory_audit_scope"
       ON "ai_workspace_memory_sync_audits" ("scopeId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_memory_audit_memory"
       ON "ai_workspace_memory_sync_audits" ("memoryId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_memory_audit_created"
       ON "ai_workspace_memory_sync_audits" ("createdAt")`
    );

    // 2. Add nullable scopeId to ai_workspace_memories (SQLite ADD COLUMN).
    //    Guard against the column already existing (TypeORM synchronize may
    //    have created it from entity metadata before the migration runs).
    const cols = (await queryRunner.query(
      `PRAGMA table_info("ai_workspace_memories")`
    )) as { name: string }[];
    if (!cols.some((c) => c.name === "scopeId")) {
      await queryRunner.query(
        `ALTER TABLE "ai_workspace_memories" ADD COLUMN "scopeId" varchar(100)`
      );
    }

    // 3. Backfill: create a legacy scope per distinct workspaceKey + map rows.
    const keys = (await queryRunner.query(
      `SELECT DISTINCT "workspaceKey" FROM "ai_workspace_memories" WHERE "scopeId" IS NULL`
    )) as { workspaceKey: string }[];
    for (const row of keys) {
      const key = row.workspaceKey;
      const bare = key.startsWith("ws_") ? key.slice(3) : key;
      const scopeId = `wscope-legacy-${bare}`;
      // Insert the scope (ignore if already present).
      await queryRunner.query(
        `INSERT OR IGNORE INTO "ai_workspace_memory_scopes"
         ("scopeId", "displayName", "portableEnabled", "defaultStorageMode", "importPolicy")
         VALUES (?, ?, 0, 'private-only', 'review-new')`,
        [scopeId, bare]
      );
      // Backfill memory rows onto the scope.
      await queryRunner.query(
        `UPDATE "ai_workspace_memories" SET "scopeId" = ?
         WHERE "workspaceKey" = ? AND "scopeId" IS NULL`,
        [scopeId, key]
      );
    }

    // 4. Swap the global memoryId unique index for the composite. The old
    //    index idx_ai_workspace_memories_memory_id was unique; drop + recreate
    //    as non-unique, then add the composite unique index. SQLite supports
    //    DROP INDEX IF EXISTS.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_workspace_memories_memory_id"`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_memories_memory_id"
       ON "ai_workspace_memories" ("memoryId")`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_workspace_memories_scope_memory"
       ON "ai_workspace_memories" ("scopeId", "memoryId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_memories_scope"
       ON "ai_workspace_memories" ("scopeId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_memories_scope_status"
       ON "ai_workspace_memories" ("scopeId", "status")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_workspace_memories_scope_type"
       ON "ai_workspace_memories" ("scopeId", "type")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // A fully lossless down is impossible if two scopes share a memoryId
    // (design §9.3). Refuse rather than silently dropping data.
    const dupes = (await queryRunner.query(
      `SELECT "memoryId", COUNT(*) as c FROM "ai_workspace_memories"
       WHERE "scopeId" IS NOT NULL
       GROUP BY "memoryId" HAVING c > 1 LIMIT 1`
    )) as { c: number }[];
    if (dupes.length > 0) {
      throw new Error(
        "portable-workspace-memory down migration aborted: duplicate memoryId across scopes; refusing to drop scoped uniqueness"
      );
    }
    // Restore the global unique index (safe — no duplicates).
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_ai_workspace_memories_scope_memory"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_workspace_memories_scope_type"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_workspace_memories_scope_status"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_workspace_memories_scope"`
    );
    // SQLite cannot easily DROP COLUMN before 3.35; leave scopeId in place
    // (nullable, unused) on down. The global unique index is restored.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_workspace_memories_memory_id_unique"
       ON "ai_workspace_memories" ("memoryId")`
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ai_workspace_memory_sync_audits"`
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ai_workspace_memory_portable_states"`
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ai_workspace_memory_scope_paths"`
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ai_workspace_memory_scopes"`
    );
  }
}
