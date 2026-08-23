# Database Migrations (WS-3)

Schema migrations for the local SQLite (`scraper.db`) database. See
`docs/adr/0007-migrations-over-synchronize.md` for the decision and cutover plan.

## Current state

The DataSource (`src/config/SqliteDb.ts`) currently uses TypeORM `synchronize: true`
to auto-derive the schema from entity metadata. This is convenient but risky in
production — any entity change mutates the live schema on boot, with no rollback.

A **self-correcting gate** is in place:

- `synchronize` stays ON until a baseline migration exists.
- Once `DB_MIGRATIONS` (in `SqliteDb.ts`) is non-empty, packaged builds:
  - stop using `synchronize`, and
  - run pending migrations on boot (`migrationsRun`), after taking a
    `.premigrate-<timestamp>` backup of `scraper.db`.

So the cutover is automatic and safe — it only happens once a baseline migration
is generated and registered.

## Adding a migration (cutover sequence)

1. **Generate the baseline** (one-time). Point the CLI at an *empty* DB so every
   entity becomes a `CREATE TABLE`:
   ```
   AIFETCHLY_DB_PATH=/tmp/empty.db yarn migration:generate src/migrations/0000-initial-schema
   ```
   (The CLI runs via `tsx`, which resolves the `@/` alias — verified to produce a
   ~103-table baseline.) Review the output. Make every `CREATE TABLE` idempotent
   (`CREATE TABLE IF NOT EXISTS`) so existing user DBs (already at this schema)
   don't error when the baseline runs.
2. **Register** the new migration class in `DB_MIGRATIONS`
   (`src/config/dbMigrations.ts`). This is the switch that turns off `synchronize`
   in packaged builds and enables `migrationsRun` (SqliteDb's self-correcting gate).
3. **Verify** up + down on a copy of a real user DB:
   ```
   AIFETCHLY_DB_PATH=/path/to/user-copy.db yarn migration:run   # apply
   # confirm app boots + data intact; a .premigrate backup is taken first
   ```
4. Future schema changes: generate an incremental migration, register it, ship.
   Never edit a shipped migration — add a new one.

## Notes

- The DB is backed up automatically before migrations run (packaged builds only,
  best-effort) — a `.premigrate-<timestamp>` file next to `scraper.db`.
- In development (`!app.isPackaged`), `synchronize` stays on for ergonomics; you
  do not need a migration for local schema iteration.
