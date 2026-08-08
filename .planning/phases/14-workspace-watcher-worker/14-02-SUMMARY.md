---
phase: 14-workspace-watcher-worker
plan: 14-02-manager-trust-filter
subsystem: main-process
tags: [typescript, electron, lifecycle, ref-counting, crash-restart, trust-filter, ipc, zod]

requires: [14-01-worker-foundation]
provides:
  - WorkspaceWatchManager — main-process owner of the watcher worker lifecycle. Reference-counted acquire/release per-workspace consumer-set (WAT-01/03); one worker for ALL acquired workspaces; 0 watched → no worker. switchWorkspace = release(old)+acquire(new)+rescan(new) with unwatch sent BEFORE kill on the old worker (WAT-04 / SC2).
  - WorkspaceWatchRestarter — pure-logic sliding 60s window accountant. recordRestart/canRestart/reset bounded at MAX_RESTARTS=3 within RESTART_WINDOW_MS=60_000 (WAT-07).
  - WorkspaceTrustFilter — single chokepoint mapping workspace approval → AIFetchlySourceTrust. Phase 14 binary gate (approved → instructions+commands trusted; agents/hooks/skills stay false until Phase 16/17/18).
  - AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot(snapshot, trust) — TRS-01 wrapper that drops untrusted instructions/commands BEFORE delegating to the existing blind applySnapshot. The global ~/.aifetchly path still calls applySnapshot directly (always trusted).
  - WorkspaceWatchManagerEvent — discriminated union emitted via configChangedEmitter; Plan 14-03's IPC layer adapts it to the existing AIFETCHLY_CONFIG_CHANGED channel (D-04).
affects: [14-03-main-ipc-integration, 14-04-renderer-trust-card, 14-05-i18n-boundary-tests]

tech-stack:
  added: []
  patterns:
    - Reference-counted worker lifecycle (per-workspace consumer-set Map; 0→1 fork, 1→0 kill)
    - Single restart-accounting point (handleWorkerExit owns the re-fork decision; terminateAndRestart just kills → exit handler drives accounting — no double-counting)
    - Trust filter at the apply boundary (research §Pitfall 8): applyWorkspaceSnapshot(snapshot, trust) drops untrusted capabilities BEFORE the registry/cache mutation
    - Constructor injection of all collaborators (fork, applySnapshotCallback, configChangedEmitter, trustResolver, restarter, now) — manager has NO direct dep on AIFetchlyRuntimeRegistrySync or Electron BrowserWindow
    - Main-side zod safeParse on every worker→main message (WAT-06); malformed → terminateAndRestart

key-files:
  created:
    - src/service/workspaceWatch/WorkspaceWatchManager.ts
    - src/service/workspaceWatch/WorkspaceWatchRestarter.ts
    - src/service/workspaceWatch/WorkspaceTrustFilter.ts
    - test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts
    - test/vitest/main/service/workspaceWatch/WorkspaceTrustFilter.test.ts
    - test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.test.ts
    - test/vitest/main/service/workspaceWatch/WorkspaceWatchRestarter.test.ts
  modified:
    - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts   # +applyWorkspaceSnapshot(snapshot, trust); existing applySnapshot unchanged (TRS-01)

decisions:
  - "[14-02 D-1]: Trust enforced at the APPLY boundary, not inside the worker and not via UI-disabled state (TRS-01). applyWorkspaceSnapshot(snapshot, trust) drops untrusted instructions/commands BEFORE applySnapshot mutates the registry/cache (research §Pitfall 8). The manager ALWAYS routes workspace snapshots through applyWorkspaceSnapshot via the injected applySnapshotCallback — it has no direct dep on AIFetchlyRuntimeRegistrySync."
  - "[14-02 D-2]: Constructor injection of ALL collaborators (fork, applySnapshotCallback, configChangedEmitter, trustResolver, restarter, now, logger). The manager has NO direct dep on AIFetchlyRuntimeRegistrySync, Electron BrowserWindow, or the concrete fork target — all are injected. This makes the manager unit-testable with a stubbed EventEmitter-based fake worker (no real child_process spawn in unit tests)."
  - "[14-02 D-3]: handleWorkerExit is the SOLE restart-accounting + re-fork point. terminateAndRestart() simply kills the worker; the resulting 'exit' event drives recordRestart + spawnWorker + resendAllWatches. This eliminates double-counting between an explicit terminate path and the crash path."
  - "[14-02 D-4]: Restart cap is a hard floor — exceeded → workerState='failed' + error emitted + auto-watch paused. ensureWorker() refuses to spawn while workerState==='failed'. Recovery requires /reload-config (Plan 14-03 IPC) to call restarter.reset() and re-trigger acquires (research §9.8)."
  - "[14-02 D-5]: Trust resolver exception → fail closed (approved=false). applySnapshotCallback exception → log and continue (don't crash the manager). Both are Rule 2 correctness measures per CLAUDE.md explicit-error-handling."
  - "[14-02 D-6]: Phase 14 binary trust derivation is a TEMPORARY chokepoint. derivePhase14Trust(workspaceApproved) maps approval → {instructions, commands} trusted; agents/hooks/skills stay false. Phase 17 swaps the body of this function (same signature) for a per-capability AIFetchlyWorkspaceTrust entity lookup."

test-results:
  command: "npx vitest run --config vite.main.config.mjs AIFetchlyRuntimeRegistrySync.trust WorkspaceTrustFilter WorkspaceWatchManager WorkspaceWatchRestarter"
  total: 23 passed (23)
  files:
    - AIFetchlyRuntimeRegistrySync.trust.test.ts (4) — TRS-01 trust filter: untrusted, instructions-only, fully-trusted, global-path regression. GREEN.
    - WorkspaceTrustFilter.test.ts (2) — derivePhase14Trust(true|false). GREEN.
    - WorkspaceWatchRestarter.test.ts (5) — WAT-07 sliding window: cap (3/60s), prune, reset, constants, defensive copy. GREEN.
    - WorkspaceWatchManager.test.ts (12) — all 7 plan cases (a-g): acquire idempotency, release-to-0, switch ordering (SC2), malformed→restart, crash under cap, crash over cap, shutdown SIGKILL path; plus snapshot/changed trust routing, diagnostic forward, unrecoverable error, getStatus. GREEN.
  tsc-gate: clean (tsc --noEmit via vite.main.config.mjs globalSetup)

verification:
  must_haves_status: all GREEN
  - "applyWorkspaceSnapshot(snapshot, trust) drops untrusted BEFORE applySnapshot": GREEN (4 TRS-01 cases)
  - "One worker for all acquired workspaces; 0 watched → no worker": GREEN (case a + b)
  - "switchWorkspace = release+acquire+rescan; unwatch BEFORE watch (SC2)": GREEN (case c)
  - "Malformed worker message → terminateAndRestart + re-fork": GREEN (case d, WAT-06)
  - "Crash under cap → re-fork + re-send watch-workspace per workspace": GREEN (case e)
  - "Crash over cap (4th/60s) → 'failed' + no re-fork + error emitted": GREEN (case f, WAT-07)
  - "shutdown() → shutdown command + SIGKILL after timeout": GREEN (case g)
  - "tsc --noEmit clean": GREEN
  - "Manager has NO direct dep on AIFetchlyRuntimeRegistrySync or BrowserWindow": GREEN (constructor injection; verified by reading imports — only types imported from aifetchlyConfigTypes)

handoff:
  next-plan: 14-03-main-ipc-integration
  next-plan-needs:
    - WorkspaceWatchManager constructor deps (applySnapshotCallback, configChangedEmitter, trustResolver, fork, workerEntry) — 14-03 supplies the real AIFetchlyRuntimeRegistrySync instance (applyWorkspaceSnapshot), the WorkspaceResolver-backed trustResolver (CFG-02), the BrowserWindow-aware configChangedEmitter (D-04: AIFETCHLY_CONFIG_CHANGED with workspaceId), and the bundled worker entry path.
    - WorkspaceWatchManagerEvent discriminated union (changed/diagnostic/error) — 14-03 adapts it to the AIFETCHLY_CONFIG_CHANGED IPC payload.
    - WorkspaceWatchRestarter.reset() — 14-03's /reload-config handler calls this to recover from the 'failed' state.
    - shutdown() must be wired in background.ts before-quit (no orphan workers — WAT-07).
    - applyWorkspaceSnapshot(snapshot, trust) is now the ONLY correct entry point for workspace snapshots on AIFetchlyRuntimeRegistrySync. The global ~/.aifetchly path still calls applySnapshot directly.

threat-model-mitigations:
  - T-14-01 (TRS-01 trust filter at apply boundary): MITIGATED — applyWorkspaceSnapshot drops untrusted instructions/commands BEFORE applySnapshot. Tested with 4 cases (untrusted, instructions-only, fully-trusted, global regression).
  - T-14-06b (worker→main message validation): MITIGATED — workerEventSchema.safeParse on every worker.on('message'); failure → terminateAndRestart. Tested (case d).
  - T-14-04 (restart-loop DoS): MITIGATED — WorkspaceWatchRestarter bounded at 3/60s; exceeded → 'failed' + error emitted + auto-watch paused. Tested (case f).
  - T-14-Orphan (orphan worker on shutdown): MITIGATED — shutdown() sends shutdown cmd, awaits injected timeout, SIGKILLs if still alive. Tested (case g).
  - T-14-Switch (stale state on switch): MITIGATED — switchWorkspace serializes release(old)+acquire(new)+rescan(new); unwatch sent BEFORE kill on the old worker; immediate rescan produces a fresh snapshot for the renderer (SC2). Tested (case c).

note: |
  Plan executed atomically across 3 commits (0a2fb054 trust filter, 690fb9d2
  restarter, 84314dd5 manager) — each independently green + tsc-clean.

## Self-Check: PASSED

All 9 created/modified files exist on disk; all 3 task commits (0a2fb054, 690fb9d2, 84314dd5) found in git history. 23/23 tests green; tsc gate clean.
