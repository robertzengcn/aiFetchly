import type { MigrationInterface } from "typeorm";

/**
 * WS-3 (R3.1): registered schema migrations (TypeORM MigrationInterface classes).
 *
 * While this is empty, the app DataSource keeps using `synchronize` (current
 * behavior — safe). Once the baseline migration is added here, packaged builds
 * stop auto-mutating the schema and run pending migrations on boot instead
 * (see SqliteDb's self-correcting gate + docs/adr/0007-migrations-over-synchronize.md).
 *
 * This module is electron-free so the CLI migration DataSource
 * (src/config/data-source.ts) can import it without pulling in Electron.
 *
 * To add a migration: generate it under src/migrations/, import the class here,
 * and append it to the array. Never edit a shipped migration — add a new one.
 */
import { Baseline00001788088086796 } from "../migrations/1788088086796-0000-baseline";
import { SkillInstallation00011788088148864 } from "../migrations/1788088148864-0001-skill-installation";

export const DB_MIGRATIONS: Array<new () => MigrationInterface> = [
  Baseline00001788088086796,
  SkillInstallation00011788088148864,
];
