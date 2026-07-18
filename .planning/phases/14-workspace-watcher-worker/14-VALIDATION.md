---
phase: 14
slug: workspace-watcher-worker
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-05
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution of the Workspace Watcher Worker.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (main-process / worker-logic unit tests) + Mocha (module-level, CommonJS) |
| **Config file** | `vite.main.config.mjs` (runs `tsc --noEmit` gate via `test/vitest/_typecheck/globalSetup.ts`); `vite.utilityCode.config.mjs` for utility code |
| **Quick run command** | `AIFETCHLY_SKIP_TSC=1 yarn testmain -- test/vitest/main/aifetchlyConfig` |
| **Full suite command** | `yarn testmain` |
| **Estimated runtime** | ~20–40 seconds (worker + manager + trust-card + IPC subset) |

> Worker logic (`WorkspaceConfigScanner`, debounce/generation reconciler, protocol zod schemas) is pure-Node and unit-tested without spawning a real child process. `WorkspaceWatchManager` lifecycle/crash-restart tests stub `child_process.fork`. Renderer trust-card + subscriber tests run under vitest with Vue test utils.

---

## Sampling Rate

- **After every task commit:** Run the quick command scoped to the touched area.
- **After every plan wave:** Run `yarn testmain` (full main-process suite).
- **Before `/gsd-verify-work`:** Full suite must be green AND `yarn tsc` clean.
- **Max feedback latency:** ~40 seconds.

---

## Per-Task Verification Map

> Rows are illustrative key verifications — the planner fills the complete per-task map in each PLAN.md's `<verify>` blocks. Status is updated during execution.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-WAT02-grep | worker | 1 | WAT-02 | T-14-02 | No `electron`/`typeorm`/`@/modules`/`@/model`/`getRepository|DataSource|SqliteDb` imports under `src/childprocess/aifetchly-config/` | grep-gate | `grep -rE "require\\(['\"]electron['\"]\\)|from ['\"]typeorm['\"]|@/modules|@/model|getRepository|DataSource|SqliteDb" src/childprocess/aifetchly-config/ && exit 1 || exit 0` | ❌ W0 | ⬜ pending |
| 14-SC5-perf | scanner | 2 | WAT-05 (SC5) | — | Typical `.aifetchly` rescan (≤10 files / ≤512KB) completes scan-start→snapshot-applied in <500ms (excludes debounce/awaitWriteFinish) | perf-log+assert | `yarn testmain -- test/vitest/main/aifetchlyConfig/scanner-perf.test.ts` | ❌ W0 | ⬜ pending |
| 14-TRS01-filter | registry-sync | 2 | TRS-01 | T-14-01 | `applyWorkspaceSnapshot(snapshot, trust)` drops untrusted instructions/commands before delegating to runtime registry | unit | `yarn testmain -- test/vitest/main/aifetchlyConfig/applyWorkspaceSnapshot.test.ts` | ❌ W0 | ⬜ pending |
| 14-WAT04-restart | manager | 3 | WAT-04 (SC4) | T-14-04 | Worker crash → restart + full rescan within cap (max 3 / 60s); resets on quiet window | unit (stubbed fork) | `yarn testmain -- test/vitest/main/aifetchlyConfig/watch-manager-restart.test.ts` | ❌ W0 | ⬜ pending |
| 14-WAT06-protocol | worker/main | 1 | WAT-06 | T-14-06 | Malformed worker→main zod message → terminate + restart worker (never applied) | unit | `yarn testmain -- test/vitest/main/aifetchlyConfig/worker-protocol.test.ts` | ❌ W0 | ⬜ pending |
| 14-WAT01-refcount | manager | 2 | WAT-01 (SC1/SC2) | — | acquire/release reference-counts per-workspace consumers; 0 consumers → worker stops; switch = stop old + start new + immediate snapshot | unit | `yarn testmain -- test/vitest/main/aifetchlyConfig/watch-manager-refcount.test.ts` | ❌ W0 | ⬜ pending |
| 14-CTX02-live | renderer | 4 | CTX-02 (SC3) | — | Editing trusted `<ws>/.aifetchly/AGENTS.md` raises `AIFETCHLY_CONFIG_CHANGED{source:"workspace",workspaceId}` → AiChatV2 subscriber refreshes context | unit (Vue) | `yarn testmain -- test/vitest/main/aifetchlyConfig/workspace-config-changed.test.ts` | ❌ W0 | ⬜ pending |
| 14-TRS03-card | renderer | 4 | TRS-03 | T-14-03 | Trust card shows 4 options; Preview shows main-process-supplied AGENTS.md (renderer never reads file — TRS-07) | unit (Vue) | `yarn testmain -- test/vitest/main/aifetchlyConfig/WorkspaceTrustCard.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/vitest/main/aifetchlyConfig/` directory + shared fixtures (tmp workspace roots, sample `.aifetchly/AGENTS.md` + `commands/*.md`).
- [ ] Stub helper for `child_process.fork` (fake worker that emits scripted protocol events) — used by `WorkspaceWatchManager` lifecycle/restart tests.
- [ ] `tsconfig` already covers `src/childprocess/aifetchly-config/` — verify the new worker entry is included (no separate tsconfig needed).

*If the test dir already exists from Phase 13, extend it rather than recreating.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real chokidar file events across Linux/macOS/Windows | WAT-05 | Cross-platform FS event semantics differ; CI runs one OS | On each OS: run app, open chat with approved workspace, edit `<ws>/.aifetchly/AGENTS.md`, confirm AiChatV2 context refreshes without restart |
| Trust prompt end-to-end flow | TRS-03 / TRS-04 | Involves real Electron renderer + IPC + persistence | Open chat with untrusted-`.aifetchly` workspace → card appears → exercise all 4 options → confirm persistence across restart |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (use `yarn testmain` run mode, not watch)
- [ ] Feedback latency < 40s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
