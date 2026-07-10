---
phase: 17
slug: hooks
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Requirement→test anchors lifted from `17-RESEARCH.md` § Validation Architecture (authoritative). Per-task rows get task IDs assigned during planning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (main + utilitycode configs) + Mocha (modules, for the trust-entity Module test) |
| **Config file** | `vite.main.config.mjs`, `vite.utilityCode.config.mjs` (both reference `test/vitest/_typecheck/globalSetup.ts` for the `tsc --noEmit` gate) |
| **Quick run command** | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <file>` (main) / `--config vite.utilityCode.config.mjs` (utilitycode) |
| **Full suite command** | `npx tsc --noEmit` + targeted vitest runs (AVOID bare `yarn testmain` — hangs ~20min; see RESEARCH Pitfall 6) |
| **Estimated runtime** | ~30s quick (per file); ~3–5min full targeted suite + tsc |

---

## Sampling Rate

- **After every task commit:** Run the quick vitest command against new/changed test files (<30s)
- **After every plan wave:** Run targeted vitest runs for ALL new + extended hook/config test files + `npx tsc --noEmit` (0 errors)
- **Before `/gsd-verify-work`:** Full targeted suite green + grep gates (SC2, TRS-05, WAT-02) + manual UAT for SC1
- **Max feedback latency:** ~30s

---

## Per-Task Verification Map

> Task IDs assigned during planning. Anchors below are the requirement→test contract from RESEARCH § Validation Architecture.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-XX | TBD | 1 | HOK-01 (parse) | T-hooks-inject | valid hooks.json -> scoped HookDefinition[]; invalid/oversized/too-many -> diagnostics | unit | `vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts` | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 1 | HOK-01 (replaceSource) | — | atomic add/change/delete/rename; stale entries never survive | unit | `vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/hooks/HookRegistry.test.ts` | ✅ extend | ⬜ pending |
| 17-XX | TBD | 1 | HOK-01 (trust filter) | T-trust-bypass | `trust.hooks=false` drops hooks BEFORE registry mutation | unit | `vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts` | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 2 | HOK-02 (no main shell) | T-cmd-injection | dispatch sends IPC to worker; NO `spawn` on main command path | unit + grep | vitest (worker IPC mock) + `grep -n "spawn" src/service/hooks/HookDispatcher.ts` empty | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 2 | HOK-02 (worker executes) | T-worker-compromise | worker receives `execute-hook`, spawns `shell:false`, returns validated `hook-result` | unit | `vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/hooks/HookExecutionWorker.test.ts` | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 2 | HOK-02 (non-fatal) | — | failure/timeout -> aggregator `hookErrors[]`, no throw | unit | extend `HookResultAggregator.test.ts` | ✅ extend | ⬜ pending |
| 17-XX | TBD | 1 | HOK-02 (unsupported event) | — | unsupported event -> `unsupported-event` diagnostic, hook skipped | unit | `AIFetchlyConfigLoader.hooks.test.ts` | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 1 | HOK-02 (skill-ref no-op) | — | `"skill":"foo"` registers; fires `skill-registry-not-available` diagnostic, no exec | unit | extend `HookDispatcher.test.ts` | ✅ extend | ⬜ pending |
| 17-XX | TBD | 1 | TRS-02 (entity) | — | 5 boolean flags + unique workspaceRootHash; Model upsert/get; Module wraps | unit (mocha) | `yarn test test/modules/AIFetchlyWorkspaceTrustModule.test.ts` | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 1 | TRS-02 (migration seed) | — | `ensureMigrationSeed()` seeds all-true for existing approved workspaces; idempotent | unit (mocha) | `yarn test test/modules/AIFetchlyWorkspaceTrustModule.test.ts -g "migration"` | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 1 | TRS-02 (replaces cache) | T-stale-trust | `trustResolver` reads entity-backed map, not `approvalCache`; revoke immediate | unit | `test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts` | ❌ W0 | ⬜ pending |
| 17-XX | TBD | 1 | SC2 (grep: no main shell) | T-cmd-injection | `spawn` for config hooks only in worker | grep | `grep -rn "spawn" src/service/hooks/ src/childprocess/hook-execution/` only in worker | - | ⬜ pending |
| 17-XX | TBD | 1 | TRS-05 (AI gating) | T-ai-bypass | ZERO `registerAiValidatedHandler` for hook channels | grep | `grep -c "registerAiValidatedHandler" src/main-process/communication/*hook*` returns 0 | - | ⬜ pending |
| 17-XX | TBD | 2 | WAT-02 (worker-no-DB) | T-worker-compromise | hook-execution worker imports NO DB/TypeORM/Electron/modules | grep | `grep -rn "typeorm\|better-sqlite3\|SqliteDb\|@/modules\|@/model\|electron" src/childprocess/hook-execution/` empty | - | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts` — HOK-01 parse + CFG-04/CFG-06 caps + unsupported-event diagnostic
- [ ] `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts` — HOK-01 trust filter + replaceSource wiring (SC1)
- [ ] `test/vitest/utilitycode/hooks/HookExecutionWorker.test.ts` — HOK-02 worker execute-hook/hook-result (mock fork)
- [ ] `test/vitest/utilitycode/hooks/HookRegistry.test.ts` — EXTEND with replaceSource/unregisterSource tests
- [ ] `test/modules/AIFetchlyWorkspaceTrustModule.test.ts` — TRS-02 entity + Model + Module + migration seed (SC3)
- [ ] `test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts` — TRS-02 cache replacement + revoke-reflects
- [ ] `src/childprocess/hook-execution/workerProtocol.ts` — zod schemas (shared by worker + dispatcher tests)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC1 live update | HOK-01 / SC1 | requires real watcher rescan + live dispatch in running app | Edit trusted `<ws>/.aifetchly/hooks/hooks.json`, observe a PreToolUse/PostToolUse hook dispatch behavior change without restart |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (no `--watch`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
