---
phase: 14-workspace-watcher-worker
plan: 14-01-worker-foundation
subsystem: worker
tags: [electron, typescript, childprocess, chokidar, zod, filesystem, fork-ipc]

requires: []
provides:
  - WorkspaceConfigWatchWorker — pure-Node child_process.fork worker entry (D-02). Watches files, parses bounded input, returns typed snapshots. Cannot import electron/typeorm (WAT-02 by construction).
  - WorkspaceChokidarWatcher — chokidar wrapper with 500ms debounce + scan-generation reconciler that self-heals missed file events (WAT-05). ignoreInitial + awaitWriteFinish + atomic, scoped to .aifetchly/** + AGENTS.md.
  - WorkspaceConfigScanner — workspace-rooted variant of Phase 13's AIFetchlyConfigLoader (reuses restricted frontmatter parser + size limits + path safety + snapshot types). CFG-02.
  - WorkspaceWatchProtocol — zod discriminated unions for command (main→worker) and event (worker→main) messages. WAT-06. Malformed worker→main message → terminate + restart (never applied).
  - workerScanner — the in-worker scan routine (debounced rescan → snapshot → process.send).
  - aifetchlyWorkspaceWatchTypes — workspace-watch shared types (consumer IDs, snapshot shape, trust filter input).
affects: [14-02-manager-trust-filter, 14-03-main-ipc-integration, 14-04-renderer-trust-card, 14-05-i18n-boundary-tests]

tech-stack:
  added: [chokidar ^3.6.0]   # NEW direct production dependency (D-01). 4.x/5.x deferred (ESM-first; worker uses cjs).
  patterns: [child_process.fork for pure-Node worker (WAT-02 structural), chokidar + debounce + scan-generations reconciliation, zod-at-boundary for IPC, WAT-02 grep-gate prohibition test]

key-files:
  created:
    - src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts
    - src/childprocess/aifetchly-config/WorkspaceChokidarWatcher.ts
    - src/childprocess/aifetchly-config/workerScanner.ts
    - src/service/workspaceWatch/WorkspaceConfigScanner.ts
    - src/service/workspaceWatch/WorkspaceWatchProtocol.ts
    - src/entityTypes/aifetchlyWorkspaceWatchTypes.ts
    - vite.aifetchlyConfigWorker.config.mjs
    - test/vitest/main/childprocess/WorkerNoDbBoundary.test.ts
    - test/vitest/main/childprocess/WorkspaceChokidarWatcher.debounce.test.ts
    - test/vitest/main/childprocess/rescanSla.test.ts
    - test/vitest/main/childprocess/_fixtures/workspaceTmpdir.ts
    - test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts
    - test/vitest/main/service/workspaceWatch/WorkspaceWatchProtocol.test.ts
  modified:
    - src/entityTypes/aifetchlyConfigTypes.ts   # workspace-watch shared exports
    - forge.config.js                            # WorkspaceConfigWatchWorker.ts registered in build section (§9.2)
    - package.json                               # chokidar ^3.6.0
    - yarn.lock

decisions:
  - "[14-01 D-01]: chokidar ^3.6.0 pinned (not 4.x/5.x — ESM-first incompatible with worker cjs build). Options: ignoreInitial:true, awaitWriteFinish:{stabilityThreshold:500,pollInterval:100}, atomic:true, depth:5, scoped globs. picomatch already in tree."
  - "[14-01 D-02]: child_process.fork (not utilityProcess.fork) — pure-Node worker physically cannot import electron/typeorm, making WAT-02 structural. Modeled on ContactExtractionWorker.ts fork-IPC pattern."
  - "[14-01 WAT-02]: enforced TWO ways — (a) structurally via fork (pure-Node), (b) grep-gate test (WorkerNoDbBoundary.test.ts) scanning src/childprocess/aifetchly-config/ for electron/typeorm/@/modules/@/model/getRepository|DataSource|SqliteDb."
  - "[14-01 SC5]: SLA clock window = scan-start → snapshot-applied, EXCLUDING the 500ms debounce + awaitWriteFinish coalescing. Typical workspace = ≤10 files / ≤512KB. rescanSla.test.ts logs elapsed on every run + asserts the typical case."

test-results:
  command: "yarn testmain run test/vitest/main/childprocess test/vitest/main/service/workspaceWatch"
  total: 42 passed (42)
  files:
    - WorkerNoDbBoundary.test.ts (3) — WAT-02 grep gate, GREEN
    - WorkspaceWatchProtocol.test.ts (23) — WAT-06 zod protocol discriminated unions, GREEN
    - WorkspaceChokidarWatcher.debounce.test.ts (6) — WAT-05 debounce + generations, GREEN
    - rescanSla.test.ts (2) — SC5 SLA; measured 6.1ms for 9 files (~132KB), well under 500ms budget, GREEN
    - WorkspaceConfigScanner.test.ts (8) — CFG-02 scanner + snapshot, GREEN
  tsc-gate: clean (tsc --noEmit via vite.main.config.mjs globalSetup)

verification:
  must_haves_status: all GREEN
  - "Worker is pure-Node fork (no electron/typeorm imports)": GREEN (WorkerNoDbBoundary grep gate)
  - "chokidar ^3.6.0 with ignoreInitial + awaitWriteFinish": GREEN
  - "zod protocol validates worker↔main messages; malformed → terminate": GREEN
  - "SC5 <500ms rescan for typical .aifetchly": GREEN (6.1ms measured)

handoff:
  next-plan: 14-02-manager-trust-filter
  next-plan-needs: WorkspaceWatchProtocol (zod schemas), worker entry + scanner, the worker-no-DB invariant. 14-02 adds the main-side WorkspaceWatchManager (ref-counted acquire/release) + applyWorkspaceSnapshot(snapshot, trust) trust filter on the Phase 13-03a registry-sync module.

note: |
  This plan was executed by a parallel session (commits 499b8271 → ff73146e, 2026-07-05 21:07–21:24) and finalized here after verifying all 42 tests GREEN and the tsc gate clean.
