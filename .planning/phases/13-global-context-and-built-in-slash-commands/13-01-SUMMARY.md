---
phase: 13-global-context-and-built-in-slash-commands
plan: 13-01-config-loader-stack
subsystem: infra
tags: [electron, typescript, config, filesystem, sha-256, zod, frontmatter]

requires: []
provides:
  - AIFetchlyConfigLoader — async bounded scanner for ~/.aifetchly (AGENTS.md, settings.json, commands/*.md)
  - Hand-rolled restricted frontmatter parser (no js-yaml; scalars + string arrays only, fail-closed)
  - resolveConfigRelativePath — path-safety helper (rejects absolute, .., escaping symlinks)
  - AIFetchlyConfigSnapshotDiff — SHA-256 content hashing + added/changed/removed diff
  - Pure shared types (aifetchlyConfigTypes.ts) and size/path constants
affects: [13-03a-context-pipeline, 13-03b-commands-dispatcher-ipc, 13-05-i18n-boundary-tests]

tech-stack:
  added: []
  patterns: [hand-rolled safe frontmatter parser, bounded async fs reads, SHA-256 snapshot integrity, path-safety mirroring FilePathGuard]

key-files:
  created:
    - src/entityTypes/aifetchlyConfigTypes.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts
    - src/service/aifetchlyConfig/resolveConfigRelativePath.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
    - src/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff.ts
    - test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts
    - test/vitest/main/service/AIFetchlyConfigLoader.test.ts
    - test/vitest/main/service/AIFetchlyConfigSnapshotDiff.test.ts
  modified: []

key-decisions:
  - "Hand-rolled restricted frontmatter parser; js-yaml NOT imported anywhere under src/service/aifetchlyConfig/ (CFG-07 security gate)."
  - "SHA-256 content hashing for snapshot integrity and accurate change detection."
  - "Path safety mirrors src/service/FilePathGuard.ts — rejects absolute, .., and escaping symlinks; returns {ok:false,reason}."
  - "Async bounded reads with fs.stat size check before fs.readFile; oversized files produce diagnostics, not crashes."

patterns-established:
  - "Pattern 1: ~/.aifetchly config files are parsed by a restricted, fail-closed parser — never a general YAML/JSON evaluator."
  - "Pattern 2: All config-relative path resolution goes through resolveConfigRelativePath; raw path joining is forbidden."

requirements-completed: [CFG-01, CFG-03, CFG-04, CFG-05, CFG-06, CFG-07, DX-01]

coverage:
  - id: D1
    description: "Global loader resolves ~/.aifetchly (os.homedir, NOT userData) with async bounded reads; missing folder yields empty snapshot"
    requirement: CFG-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigLoader.test.ts#loader resolves ~/.aifetchly"
        status: pass
    human_judgment: false
  - id: D2
    description: "settings.json parsed via zod; unknown fields ignored; invalid field → default + warning diagnostic"
    requirement: CFG-03
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigLoader.test.ts#settings.json cases"
        status: pass
    human_judgment: false
  - id: D3
    description: "Oversized files rejected with file-too-large diagnostic before readFile"
    requirement: CFG-04
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigLoader.test.ts#size cases"
        status: pass
    human_judgment: false
  - id: D4
    description: "resolveConfigRelativePath rejects absolute, .., escaping symlinks; returns {ok:false,reason}"
    requirement: CFG-05
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigLoader.test.ts#path-safety cases"
        status: pass
    human_judgment: false
  - id: D5
    description: "Snapshot carries SHA-256 hashes; diff computes added/changed/removed correctly"
    requirement: CFG-06
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigSnapshotDiff.test.ts (9 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Restricted frontmatter parser: scalars + string arrays only; rejects YAML tags; preserves body; fails closed"
    requirement: CFG-07
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts (28 tests)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Stable diagnostic codes emitted for frontmatter/size/path failures"
    requirement: DX-01
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigLoader.test.ts + AIFetchlyConfigMarkdown.test.ts diagnostic cases"
        status: pass
    human_judgment: false

duration: ~25min (split across a quota-blocked pause)
completed: 2026-07-05
status: complete
---

# Plan 13-01: Config Loader Stack Summary

**Restricted frontmatter parser, path-safe async loader, and SHA-256 snapshot diff for `~/.aifetchly` — the foundation Plan 03's orchestrator and context loader consume**

## Performance

- **Tasks:** 2
- **Files created:** 9 (6 source + 3 test)
- **Tests:** 59 passing (3 files)

## Accomplishments
- Hand-rolled restricted frontmatter parser with no js-yaml dependency (CFG-07 security gate enforced via grep)
- Async bounded config loader resolving `~/.aifetchly` via `os.homedir()` with size guards and graceful missing-folder handling
- SHA-256 snapshot + diff for add/change/remove detection (foundation for live-reload reconciliation in later phases)
- Path-safety helper mirroring `FilePathGuard` (rejects absolute / `..` / escaping symlinks)
- 59 unit tests covering CFG-01/03/04/05/06/07 and DX-01 diagnostic codes

## Task Commits

1. **Task 1 — Types, constants, restricted frontmatter parser** — `dd48ebb1` (test RED) → `b9eef6d4` (feat GREEN)
2. **Task 2 — Path safety, loader, snapshot diff** — `ad5b652b` (test RED) → `5601ffed` (feat GREEN)

## Decisions Made
- No js-yaml anywhere under `src/service/aifetchlyConfig/` — the repo's js-yaml dep is deliberately unused because its default schema executes YAML tags (unsafe for untrusted workspace files).
- `fs.promises.readdir(rootPath)` returns `string[]`; entries are joined via `path.join` rather than treated as `Dirent`.

## Deviations from Plan

### Auto-fixed Issues

**1. readdir return-type (TypeScript)**
- **Found during:** Task 2 (loader implementation)
- **Issue:** `fs.promises.readdir` without `{ withFileTypes: true }` returns `string[]`, not a `Dirent` union — the tsc gate caught the mismatch.
- **Fix:** Treat entries as strings and `path.join` each.
- **Verification:** `npx tsc --noEmit` clean (0 errors).
- **Committed in:** `5601ffed`

**Total deviations:** 1 auto-fixed (TypeScript type)
**Impact on plan:** Minimal — implementation conforms to the locked design.

## Issues Encountered
- Provider 429 ("Usage limit reached for 5 hour") killed the executor mid-Task-2; Task 2 impl was committed as WIP and verified GREEN on resume after the quota window reset.
- Initial post-resume test runs appeared to hang — root cause: the `testmain` script (`vitest --config vite.main.config.mjs`) runs in **watch mode** (no `run` subcommand). Use `npx vitest run --config vite.main.config.mjs <filter>` or `AIFETCHLY_SKIP_TSC=1` for one-shot inner loops. Final verification: `AIFETCHLY_SKIP_TSC=1 npx vitest run ... AIFetchlyConfig` → 59/59 pass (tsc independently verified clean).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Loader stack ready for Plan 13-03a (context pipeline + assembler injection) and 13-03b (dispatcher/IPC).
- Pattern established: future config-consuming code reads via `AIFetchlyConfigLoader`, never directly via fs/path in the renderer (TRS-07 enforced in Plan 13-05).

---
*Phase: 13-global-context-and-built-in-slash-commands*
*Completed: 2026-07-05*
