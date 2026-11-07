import type { DataSource, QueryRunner } from "typeorm";
import type Database from "better-sqlite3";
import { EmailServiceTagRelationEntity } from "@/entity/EmailServiceTagRelation.entity";
import { incrementEmailServiceMetric } from "@/modules/lib/EmailServiceMetrics";

/**
 * One-time migration from the legacy single-tag schema (EmailServiceEntity.tagId
 * FK column) to the many-to-many junction table (email_service_tag_relation).
 *
 * Why this exists: the project runs TypeORM with `synchronize: true` and no
 * migration runner. When the `tagId` column is removed from the entity,
 * `synchronize` will DROP that column on the next `initialize()` — silently
 * losing every existing service→tag assignment. This migration backfills the
 * junction table from the old column and then drops the column, so existing
 * users keep their tags.
 *
 * Strategy (handles the synchronize race):
 *  1. BEFORE TypeORM initializes the DataSource, open a raw better-sqlite3
 *     handle to the scraper.db and snapshot any existing (serviceId, tagId)
 *     pairs from the legacy column into memory.
 *  2. Let TypeORM initialize (synchronize creates the junction table and drops
 *     the old tagId column).
 *  3. Replay the snapshot into the junction table.
 *
 * Each step is idempotent — running against an already-migrated DB is a no-op.
 */

interface LegacyRow {
  id: number;
  tagId: number;
}

interface PragmaColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

/**
 * Column definition for a rebuilt email_service table.
 * `id` must stay `INTEGER PRIMARY KEY` so child foreign keys
 * (email_service_task_relation, email_service_tag_relation) can reference it.
 * A rebuild that copies only the declared type leaves `id` as a plain INTEGER,
 * and SQLite then rejects those inserts.
 */
function columnDefinition(
  column: PragmaColumnInfo,
  ensureIdPrimaryKey: boolean
): string {
  const declaredType = column.type?.trim() ? column.type.trim() : "TEXT";
  const isIdPrimary =
    column.name === "id" && (column.pk > 0 || ensureIdPrimaryKey);
  const parts = [
    quoteIdent(column.name),
    isIdPrimary ? "INTEGER" : declaredType,
  ];
  if (isIdPrimary) {
    parts.push("PRIMARY KEY AUTOINCREMENT");
  } else if (column.notnull === 1) {
    parts.push("NOT NULL");
  }
  if (!isIdPrimary && column.dflt_value != null) {
    parts.push(`DEFAULT ${column.dflt_value}`);
  }
  return parts.join(" ");
}

async function readEmailServiceColumns(
  queryRunner: QueryRunner
): Promise<PragmaColumnInfo[]> {
  // manager.query returns the row array. query(..., [], true) returns a
  // QueryResult object, and calling .filter on that throws before the rebuild.
  const columns = (await queryRunner.manager.query(
    `PRAGMA table_info(email_service)`
  )) as PragmaColumnInfo[];
  return Array.isArray(columns) ? columns : [];
}

/**
 * Copy email_service into a new table and swap the names.
 * Foreign keys are off only for the swap; they are turned back on before return.
 */
async function rebuildEmailServiceTable(
  queryRunner: QueryRunner,
  options: { dropColumn?: string; ensureIdPrimaryKey: boolean }
): Promise<void> {
  const columns = await readEmailServiceColumns(queryRunner);
  const kept = columns.filter((column) => column.name !== options.dropColumn);
  if (!kept.some((column) => column.name === "id")) {
    throw new Error("email_service is missing an id column");
  }
  const colList = kept.map((column) => quoteIdent(column.name)).join(", ");
  const colDefs = kept
    .map((column) => columnDefinition(column, options.ensureIdPrimaryKey))
    .join(", ");

  await queryRunner.query(`PRAGMA foreign_keys = OFF`);
  try {
    await queryRunner.query(`DROP TABLE IF EXISTS email_service_new`);
    await queryRunner.query(`BEGIN`);
    await queryRunner.query(`CREATE TABLE email_service_new (${colDefs})`);
    await queryRunner.query(
      `INSERT INTO email_service_new (${colList}) SELECT ${colList} FROM email_service`
    );
    await queryRunner.query(`DROP TABLE email_service`);
    await queryRunner.query(
      `ALTER TABLE email_service_new RENAME TO email_service`
    );
    await queryRunner.query(`COMMIT`);
  } catch (rebuildError) {
    await queryRunner.query(`ROLLBACK`).catch(() => undefined);
    throw rebuildError;
  } finally {
    await queryRunner.query(`PRAGMA foreign_keys = ON`).catch(() => undefined);
  }
}

/**
 * Step 1: snapshot legacy tag assignments from the raw DB file BEFORE TypeORM
 * synchronize runs. Returns [] if the old column is already gone (already
 * migrated) or no rows have a tag. Caller passes the raw better-sqlite3
 * handle; this is intentionally a plain function over the raw DB so it does
 * not depend on TypeORM metadata.
 */
export function snapshotLegacyServiceTags(
  rawDb: Database.Database
): LegacyRow[] {
  const tableInfo = rawDb
    .prepare(`PRAGMA table_info(email_service)`)
    .all() as PragmaColumnInfo[];
  const hasLegacyColumn = tableInfo.some((c) => c.name === "tagId");
  if (!hasLegacyColumn) {
    return [];
  }
  return rawDb
    .prepare(`SELECT id, tagId FROM email_service WHERE tagId IS NOT NULL`)
    .all() as LegacyRow[];
}

/**
 * Step 3: replay a legacy snapshot into the junction table. Called AFTER the
 * DataSource has initialized (so the junction table exists). Idempotent —
 * uses INSERT with a subquery that skips pairs already present, guarded by
 * the unique index on (emailServiceId, tagId).
 */
export async function replayLegacyServiceTags(
  connection: DataSource,
  snapshot: LegacyRow[]
): Promise<number> {
  if (snapshot.length === 0) {
    return 0;
  }
  const queryRunner = connection.createQueryRunner();
  let inserted = 0;
  try {
    const relationTable =
      connection.getMetadata(EmailServiceTagRelationEntity).tableName;
    for (const row of snapshot) {
      // Idempotent: skip pairs that already exist (re-runs, or rows that were
      // already migrated by a prior partial run). The unique constraint also
      // protects at the DB level.
      // useStructuredResult=true: for INSERTs the plain query() returns only
      // lastInsertRowid, which has no `changes` — the structured result
      // exposes `.affected` (raw.changes) so the counter is accurate.
      const result = await queryRunner.query(
        `INSERT INTO "${relationTable}" ("emailServiceId", "tagId", "createdAt", "updatedAt")
         SELECT ?, ?, datetime('now'), datetime('now')
         WHERE NOT EXISTS (
           SELECT 1 FROM "${relationTable}" r WHERE r."emailServiceId" = ? AND r."tagId" = ?
         )`,
        [row.id, row.tagId, row.id, row.tagId],
        true
      );
      const changed = result.affected ?? 0;
      if (changed && changed > 0) {
        inserted += 1;
      }
    }
  } finally {
    await queryRunner.release();
  }
  if (inserted > 0) {
    incrementEmailServiceMetric("tag_migration_backfill");
  }
  return inserted;
}

/**
 * Drop the legacy tagId column from email_service, if it still exists.
 *
 * Plain `ALTER TABLE ... DROP COLUMN` fails whenever the column appears in the
 * table's FOREIGN KEY definition ("unknown column in foreign key definition") —
 * which is exactly how legacy email_service tables declared it. Rebuild the
 * table instead: create the new shape (no tagId), copy rows over, swap names.
 * SQLite 3.35+ DROP COLUMN is tried first (cheapest path) and the rebuild is
 * the fallback. Re-runs are a no-op once the column is gone.
 *
 * Called AFTER the DataSource initializes, after the replay, so the snapshot
 * is safely persisted first.
 */
export async function dropLegacyServiceTagColumn(
  connection: DataSource
): Promise<boolean> {
  const queryRunner = connection.createQueryRunner();
  try {
    const tableInfo = await readEmailServiceColumns(queryRunner);
    const hasLegacyColumn = tableInfo.some((c) => c.name === "tagId");
    if (!hasLegacyColumn) {
      return false;
    }
    try {
      await queryRunner.query(`ALTER TABLE email_service DROP COLUMN tagId`);
      return true;
    } catch {
      // DROP COLUMN unsupported (old SQLite) or blocked by the FK definition.
      // Rebuild without tagId and keep id as INTEGER PRIMARY KEY so child
      // foreign keys can still reference email_service(id).
      await rebuildEmailServiceTable(queryRunner, {
        dropColumn: "tagId",
        ensureIdPrimaryKey: true,
      });
      return true;
    }
  } finally {
    await queryRunner.release();
  }
}

/**
 * Run the full multi-tag migration against an initialized DataSource.
 * Re-snapshots from any surviving legacy column (handles the case where
 * TypeORM synchronize did NOT drop it — e.g. older SQLite), replays, then
 * drops the column. Safe to call on every startup: every step is idempotent.
 *
 * Returns a summary for logging/observability.
 */
export async function migrateEmailServiceTagsToManyToMany(
  connection: DataSource
): Promise<{
  backfilled: number;
  columnDropped: boolean;
  primaryKeyRepaired: boolean;
}> {
  // Re-snapshot from the live DB: if synchronize left the column intact (older
  // SQLite), we can still read+replay+drop here. If synchronize already dropped
  // it, snapshot is empty and this is a no-op.
  const queryRunner = connection.createQueryRunner();
  let snapshot: LegacyRow[] = [];
  try {
    const tableInfo = (await queryRunner.manager.query(
      `PRAGMA table_info(email_service)`
    )) as PragmaColumnInfo[];
    const hasLegacyColumn = tableInfo.some((c) => c.name === "tagId");
    if (hasLegacyColumn) {
      snapshot = (await queryRunner.manager.query(
        `SELECT id, tagId FROM email_service WHERE tagId IS NOT NULL`
      )) as LegacyRow[];
    }
  } finally {
    await queryRunner.release();
  }

  const backfilled = await replayLegacyServiceTags(connection, snapshot);
  const columnDropped = await dropLegacyServiceTagColumn(connection);
  const primaryKeyRepaired = await repairEmailServicePrimaryKey(connection);
  return { backfilled, columnDropped, primaryKeyRepaired };
}

/**
 * Restore email_service.id as INTEGER PRIMARY KEY when a previous rebuild
 * left it as a plain INTEGER. Child inserts then fail the foreign key.
 * No-op when the table is missing or id is already the primary key.
 */
export async function repairEmailServicePrimaryKey(
  connection: DataSource
): Promise<boolean> {
  const queryRunner = connection.createQueryRunner();
  try {
    const columns = await readEmailServiceColumns(queryRunner);
    if (columns.length === 0) {
      return false;
    }
    const idColumn = columns.find((column) => column.name === "id");
    if (!idColumn || idColumn.pk > 0) {
      return false;
    }
    await rebuildEmailServiceTable(queryRunner, { ensureIdPrimaryKey: true });
    return true;
  } finally {
    await queryRunner.release();
  }
}
