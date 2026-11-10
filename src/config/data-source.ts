import "reflect-metadata";
import { DataSource } from "typeorm";
import path from "node:path";
import { DB_ENTITIES } from "@/config/dbEntities";
import { DB_MIGRATIONS } from "@/config/dbMigrations";

/**
 * WS-3: DataSource for the TypeORM CLI (`migration:generate` / `migration:run` /
 * `migration:show`). Electron-free so it runs under plain node / ts-node.
 *
 * Point it at the DB to diff or apply against via `AIFETCHLY_DB_PATH` (absolute
 * path to a `.db` file). For the one-time baseline, generate against an EMPTY db
 * so every entity becomes a `CREATE TABLE`:
 *
 *   AIFETCHLY_DB_PATH=/tmp/empty.db yarn migration:generate src/migrations/0000-initial-schema
 *
 * Then make every `CREATE TABLE` idempotent (`IF NOT EXISTS`) so existing user
 * DBs (already at this schema) don't error when the baseline runs, and register
 * the class in `DB_MIGRATIONS` (`src/config/dbMigrations.ts`).
 *
 * This DataSource deliberately does NOT load the sqlite-vec extension —
 * migrations operate on the relational schema only.
 */
const databasePath =
  process.env.AIFETCHLY_DB_PATH ??
  path.join(process.cwd(), ".migration-work.db");

export default new DataSource({
  type: "better-sqlite3",
  database: databasePath,
  entities: DB_ENTITIES,
  migrations: DB_MIGRATIONS,
  synchronize: false,
  migrationsRun: false,
  logging: process.env.AIFETCHLY_MIGRATION_LOG === "1",
});
