---
phase: 17
slug: hooks
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-10
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Requirement→test anchors lifted from `17-RESEARCH.md` § Validation Architecture (authoritative). Per-task rows map to the actual task IDs in the plans (17-01-T1/T2/T3, 17-02-T1/T2a/T2b, 17-03-T1/T2).

> **Wave 0 note:** every task in Phase 17 is TDD (`tdd="true"`). There is no separate Wave 0 — each task creates its own test scaffold as the RED step (see the Test Scaffolds section below). `wave_0_complete: true` reflects that Wave 0 work is folded into the TDD tasks, not that a separate wave ran.

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

> Task IDs lifted from the plans. Anchors below are the requirement→test contract from RESEARCH § Validation Architecture. "File Exists" reflects that new test scaffolds are created within the corresponding TDD task's RED step (no separate Wave 0).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-02-T1 | 02 | 2 | HOK-01 (parse) | T-hooks-inject | valid hooks.json -> scoped HookDefinition[]; invalid/oversized/too-many -> diagnostics | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts -x` | TDD in 17-02-T1 | ⬜ pending |
| 17-01-T2 | 01 | 1 | HOK-01 (replaceSource) | — | atomic add/change/delete/rename; stale entries never survive | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/hooks/HookRegistry.test.ts -x` | ✅ extend | ⬜ pending |
| 17-02-T2a | 02 | 2 | HOK-01 (trust filter) | T-trust-bypass | `trust.hooks=false` drops hooks BEFORE registry mutation | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts -x` | TDD in 17-02-T2a | ⬜ pending |
| 17-03-T2 | 03 | 2 | HOK-02 (no main shell) | T-cmd-injection | dispatch sends IPC to worker; NO `spawn` on main command path | unit + grep | vitest (worker IPC mock) + `grep -n "spawn" src/service/hooks/HookDispatcher.ts` empty | ✅ extend | ⬜ pending |
| 17-03-T1 | 03 | 2 | HOK-02 (worker executes) | T-worker-compromise | worker receives `execute-hook`, runs worker-local spawn-core (shell:false, no trust gate), returns validated `hook-result` | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/hooks/HookExecutionWorker.test.ts -x` | TDD in 17-03-T1 | ⬜ pending |
| 17-03-T2 | 03 | 2 | HOK-02 (non-fatal) | — | failure/timeout -> aggregator `hookErrors[]`, no throw | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/hooks/HookDispatcher.test.ts -x` | ✅ extend | ⬜ pending |
| 17-02-T1 | 02 | 2 | HOK-02 (unsupported event) | — | unsupported event -> `unsupported-event` diagnostic, hook skipped | unit | same file as HOK-01 (parse): `AIFetchlyConfigLoader.hooks.test.ts` | TDD in 17-02-T1 | ⬜ pending |
| 17-03-T2 | 03 | 2 | HOK-02 (skill-ref no-op) | — | `"skill":"foo"` registers; fires `skill-registry-not-available` diagnostic, no exec | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/hooks/HookDispatcher.test.ts -x` | ✅ extend | ⬜ pending |
| 17-01-T1 | 01 | 1 | TRS-02 (entity) | — | 5 boolean flags + unique workspaceRootHash; Model upsert/get; Module wraps | unit (mocha) | `yarn test test/modules/AIFetchlyWorkspaceTrustModule.test.ts` | TDD in 17-01-T1 | ⬜ pending |
| 17-01-T1 | 01 | 1 | TRS-02 (migration seed) | — | `ensureMigrationSeed()` seeds all-true for existing approved workspaces; idempotent | unit (mocha) | `yarn test test/modules/AIFetchlyWorkspaceTrustModule.test.ts -g "migration"` | TDD in 17-01-T1 | ⬜ pending |
| 17-02-T2b | 02 | 2 | TRS-02 (replaces cache) | T-stale-trust | `trustResolver` reads entity-backed map, not `approvalCache`; revoke immediate | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts -x` | TDD in 17-02-T2b | ⬜ pending |
| 17-03-T1/T2 | 03 | 2 | SC2 (grep: no main shell) | T-cmd-injection | `spawn` for config hooks only in worker | grep | `grep -rn "spawn" src/service/hooks/ src/childprocess/hook-execution/` only in worker | - | ⬜ pending |
| 17-03-T2 | 03 | 2 | TRS-05 (AI gating) | T-ai-bypass | ZERO `registerAiValidatedHandler` for hook channels | grep | `grep -c "registerAiValidatedHandler" src/main-process/communication/*hook*` returns 0 | - | ⬜ pending |
| 17-03-T1 | 03 | 2 | WAT-02 (worker-no-DB + no-trust-gate) | T-worker-compromise | hook-execution worker imports NO DB/TypeORM/Electron/modules AND no HookCommandTrustService | grep | `grep -rn "typeorm\|better-sqlite3\|SqliteDb\|@/modules\|@/model\|electron\|HookCommandTrustService" src/childprocess/hook-execution/` empty | - | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity check (post Plan 02 split):** execution order 17-01-T1 → 17-01-T2 → 17-01-T3 → 17-02-T1 → 17-02-T2a → 17-02-T2b → 17-03-T1 → 17-03-T2 — EVERY task has `<automated>` verify. No 3 consecutive tasks without automated verify. Rule holds.

---

## Test Scaffolds (created within TDD tasks — no separate Wave 0)

> Every Phase 17 task is `tdd="true"`: each task writes its test scaffold first (RED), implements to pass (GREEN), then refactors. The files below are therefore created DURING execution of the task that owns them, not in a pre-execution Wave 0.

- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts` — HOK-01 parse + CFG-04/CFG-06 caps + unsupported-event diagnostic → created in **17-02-T1** RED step
- [ ] `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts` — HOK-01 trust filter + replaceSource wiring (SC1) → created in **17-02-T2a** RED step
- [ ] `test/vitest/utilitycode/hooks/HookExecutionWorker.test.ts` — HOK-02 worker execute-hook/hook-result (mock fork) → created in **17-03-T1** RED step
- [ ] `test/vitest/utilitycode/hooks/HookRegistry.test.ts` — EXTEND with replaceSource/unregisterSource tests → extended in **17-01-T2**
- [ ] `test/modules/AIFetchlyWorkspaceTrustModule.test.ts` — TRS-02 entity + Model + Module + migration seed (SC3) → created in **17-01-T1** RED step
- [ ] `test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts` — TRS-02 cache replacement + revoke-reflects → created in **17-02-T2b** RED step
- [ ] `src/childprocess/hook-execution/workerProtocol.ts` — zod schemas (shared by worker + dispatcher tests) → created in **17-03-T1**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC1 live update | HOK-01 / SC1 | requires real watcher rescan + live dispatch in running app | Edit trusted `<ws>/.aifetchly/hooks/hooks.json`, observe a PreToolUse/PostToolUse hook dispatch behavior change without restart |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (every task is TDD with automated verify — no Wave 0 dependency)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (verified post Plan 02 split)
- [x] Wave 0 covers all MISSING references (folded into TDD tasks — each task creates its own scaffold)
- [x] No watch-mode flags (no `--watch`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
