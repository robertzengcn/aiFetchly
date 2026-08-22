# ADR-0007: TypeORM migrations over `synchronize` in production

- **Status:** Accepted — infrastructure + self-correcting gate shipped; baseline migration pending
- **Workstream:** WS-3 (R3.1)
- **Date:** 2026-07-11

## Context

`SqliteDb` configured the DataSource with `synchronize: true`, so TypeORM
re-derived the live schema from entity metadata on every boot. Any entity change
silently mutated users' `scraper.db` — a data-loss risk with no migration path
and no rollback (review finding §4.2).

## Decision

Replace `synchronize` in production with explicit, reviewable TypeORM migrations.

**Shipped now (safe, no behavior change):**

1. A **self-correcting gate** in `SqliteDb`:
   - `synchronize = !isPackagedBuild() || DB_MIGRATIONS.length === 0`
   - `migrationsRun = isPackagedBuild() && DB_MIGRATIONS.length > 0`
   - `app.isPackaged` is the production signal (NODE_ENV is not reliably
     `"production"` in packaged Electron).
   - While `DB_MIGRATIONS` is empty, behavior is unchanged (synchronize on
     everywhere). The moment a baseline migration is registered, packaged builds
     flip to migrations automatically — no risky manual cutover.
2. A **pre-migration backup**: before `initialize()` can run migrations, copy
   `scraper.db` → `scraper.db.premigrate-<timestamp>` (packaged builds, with
   migrations registered, best-effort). A bad migration is recoverable.
3. `src/migrations/` directory + `DB_MIGRATIONS` registry.

**Deferred (needs a real dev env + a copy of a real user DB):**

- The baseline migration (generate via `migration:generate` against a clean DB,
  make `CREATE TABLE IF NOT EXISTS`, register in `DB_MIGRATIONS`).
- `yarn migration:generate` / `migration:run` CLI wiring (needs the entity list
  shared with a CLI DataSource config).

This sequence honors the review's risk mitigation: *"gate synchronize off only
after the baseline migration is verified; back up the DB file pre-migration."*

## Consequences

- + Production schema changes become reviewable and reversible.
- + Zero behavior change today (gate inert until baseline lands) — no user risk.
- + Automatic, backup-protected cutover when the baseline is ready.
- − Until the baseline is generated + verified, production still uses
  `synchronize` (the data-loss risk persists but is unchanged, not worsened).
- − Migrations must be idempotent for existing DBs (the baseline uses
  `IF NOT EXISTS`).

## Alternatives considered

- **Flip `synchronize` off in production immediately:** rejected — without a
  baseline migration, users with stale DBs would crash on missing tables, and
  the PRD flags this as the highest-risk item.
- **Keep `synchronize` forever:** rejected — silent schema mutation is the
  problem being fixed.
