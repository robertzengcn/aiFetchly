/**
 * Migration tests (TODO 2 / design §14.3): the registered baseline + skill
 * feature migration produce the full schema on a clean DB, are idempotent
 * on re-run (existing synchronize-created DBs), and the runtime gate flips
 * packaged builds off synchronize once migrations are registered.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DataSource } from "typeorm";
import { DB_MIGRATIONS } from "@/config/dbMigrations";
import { DB_ENTITIES } from "@/config/dbEntities";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-migrations-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function freshDataSource(dbPath: string): DataSource {
  return new DataSource({
    type: "better-sqlite3",
    database: dbPath,
    entities: DB_ENTITIES,
    synchronize: false,
    migrations: DB_MIGRATIONS,
    migrationsRun: true,
  });
}

const SKILL_TABLES = [
  "prompt_skill_invocations",
  "skill_installations",
  "skill_installation_sessions",
  "skill_installation_events",
  "skill_credential_bindings",
];

describe("DB baseline + feature migration (TODO 2)", () => {
  it("DB_MIGRATIONS is non-empty — the packaged-build gate is armed", () => {
    // The SqliteDb gate flips packaged builds to migrations iff length > 0;
    // this is the precondition for "persistence ships through a baseline
    // and feature migration" (design DoD).
    expect(DB_MIGRATIONS.length).toBeGreaterThanOrEqual(2);
  });

  it("a CLEAN database reaches the full schema including the skill tables", async () => {
    const ds = freshDataSource(path.join(tmpDir, "clean.db"));
    await ds.initialize();
    expect(ds.isInitialized).toBe(true);
    const tables: Set<string> = new Set(
      (
        (await ds.query(
          "SELECT name FROM sqlite_master WHERE type='table'"
        )) as { name: string }[]
      ).map((r) => r.name)
    );
    for (const table of SKILL_TABLES) {
      expect(tables.has(table), `missing ${table}`).toBe(true);
    }
    // Pre-feature core tables exist too (baseline ran).
    expect(tables.has("system_setting")).toBe(true);
    expect(tables.has("ai_chat_messages")).toBe(true);
    expect(tables.size).toBeGreaterThan(90);
    await ds.destroy();
  }, 60_000);

  it("re-running against an already-migrated database is a no-op", async () => {
    const dbPath = path.join(tmpDir, "twice.db");
    const first = freshDataSource(dbPath);
    await first.initialize();
    await first.destroy();
    // Second boot with migrationsRun: no pending migrations, no error.
    const second = new DataSource({
      type: "better-sqlite3",
      database: dbPath,
      entities: DB_ENTITIES,
      synchronize: false,
      migrations: DB_MIGRATIONS,
      migrationsRun: true,
    });
    await second.initialize();
    const executed = (await second.query(
      "SELECT COUNT(*) AS c FROM migrations"
    )) as { c: number }[];
    expect(executed[0].c).toBe(DB_MIGRATIONS.length);
    await second.destroy();
  }, 60_000);

  it("the feature migration's CREATE statements tolerate pre-existing skill tables (idempotent SQL)", async () => {
    // Simulate a dev DB where synchronize already created the skill tables,
    // then run the migration SQL directly — IF NOT EXISTS must not throw.
    const ds = new DataSource({
      type: "better-sqlite3",
      database: path.join(tmpDir, "dev.db"),
      entities: DB_ENTITIES,
      synchronize: true, // dev behavior
    });
    await ds.initialize();
    await ds.destroy();

    const migration = new DB_MIGRATIONS[DB_MIGRATIONS.length - 1]();
    const ds2 = new DataSource({
      type: "better-sqlite3",
      database: path.join(tmpDir, "dev.db"),
      synchronize: false,
    });
    await ds2.initialize();
    const runner = ds2.createQueryBuilder().connection.createQueryRunner();
    await migration.up(runner);
    await runner.release();
    await ds2.destroy();
    // Reaching here without throwing IS the assertion.
    expect(true).toBe(true);
  }, 60_000);
});
