# Test Coverage Baseline (WS-2)

- **Date:** 2026-07-10
- **Purpose:** Establish the measured baseline referenced in ADR-0004 (graduated
  diff-coverage gate). The global floor ratchets from these numbers.

## Tooling

- `@vitest/coverage-v8@1.6.1` (matches `vitest@1.6.1`).
- Coverage configured in `vite.main.config.mjs`, `vite.utilityCode.config.mjs`,
  `vite.taskCode.config.mjs` (v8 provider; `text`/`html`/`lcov` reporters; per-config
  `coverage/<area>` directory). Emitted on `yarn test:coverage` / `yarn test:ci`.

## Suite shape (measured)

| Suite | Command | Files | Result |
|---|---|---|---|
| Mocha (modules) | `yarn test` | 37 `.test.ts` | Not run to completion locally (some tests touch a live DB / network — see “Known issues”). |
| Vitest main (incl. IPC) | `yarn testmain` | 125 `.test.ts` | **IPC subset: 27/28 files pass, 61/78 tests pass.** The 17 failures are all in `task-ipc.test.ts` (pre-existing — see below). Full run hung under the test env on an integration test. |
| Vitest service | `vitest --config vitest.service.config.mjs` | few | Not run locally. |
| Vitest utilitycode (puppeteer) | `yarn vitest-puppeteer` | 77 `.test.ts` | Out of scope for the headless CI gate (browser/network). |
| Vitest taskcode | `yarn vitest-getyoutubeurl` etc. | 0 (dir absent) | N/A. |

## Component coverage (new WS-1 code, single-file runs)

| File | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `src/modules/SecureStore.ts` | 96.6% | 96.2% | 100% | 96.6% |
| `src/main-process/security/navigationGuard.ts` | — | — | — | (10 unit tests, all passing) |
| `src/controller/searchProcessKill.ts` | — | — | — | (8 unit tests, all passing) |

## Known issues (pre-existing, surfaced by the new gate)

These are **not** caused by the WS-0/WS-1 changes (verified: no import
relationship). They are the “CI goes red on day 1” cases the PRD risk row
anticipates; the CI test job ships with `continue-on-error: true` until they are
quarantined/fixed.

1. **`task-ipc.test.ts` (17 failures).** `EntityMetadataNotFoundError: No metadata
   for "SystemSettingEntity"` → `Cannot read properties of undefined (reading
   'handle')` at `task-ipc.ts:28`. A TypeORM entity-registration / test-isolation
   issue in the vitest environment. **Action:** register `SystemSettingEntity` in
   the test DataSource (or mock `ipcMain`) so the handler registrar resolves.
2. **Full main-suite run hangs.** Under the test environment an integration test
   does not return (likely a DB/network/electron-API await). **Action:** identify
   and quarantine the hanging test; add per-test timeouts.

## Graduated gate (per ADR-0004)

- **Diff coverage:** ≥ 80% on new/changed lines (diff-aware reporter to be wired
  as the next step; the `lcov` artifact is produced now).
- **Global floor:** set to `baseline − 2%` once the full-suite baseline completes
  cleanly in CI; ratchet quarterly.
- **Type-check gate:** `tsc --noEmit` (via `globalSetup`) is preserved and must
  NOT be bypassed with `AIFETCHLY_SKIP_TSC` in CI. Baseline `yarn tsc-result` is
  green on this branch.
