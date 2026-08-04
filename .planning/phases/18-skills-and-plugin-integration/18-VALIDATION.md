---
phase: 18
slug: skills-and-plugin-integration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-12
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Requirement→test anchors lifted from `18-RESEARCH.md` § Validation Architecture (authoritative) and § Security Domain.
> **Task-ID columns finalize once PLAN.md files define task IDs** (drafted at plan time against requirement/threat anchors; per-task rows enriched post-planning, mirroring the Phase 17 convention).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (main + utilitycode configs) + Mocha (modules, only if a new Module is added — likely none this phase) |
| **Config file** | `vite.main.config.mjs`, `vite.utilityCode.config.mjs` (both reference `test/vitest/_typecheck/globalSetup.ts` for the `tsc --noEmit` gate) |
| **Quick run command** | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <test-file> -x` (main) / `--config vite.utilityCode.config.mjs` (utilitycode) |
| **Full suite command** | Targeted vitest runs for all new/changed files + standalone `npx tsc --noEmit` (AVOID bare `yarn testmain` — hangs ~20min on a pre-existing Electron/DB test; see RESEARCH Pitfall / STATE.md resume note) |
| **Estimated runtime** | ~30s quick (per file); ~3–5min full targeted suite + tsc |

---

## Sampling Rate

- **After every task commit:** Run the quick vitest command against the task's new/changed test files (<30s)
- **After every plan wave:** Run targeted vitest runs for ALL new + extended skill/plugin/config test files + `npx tsc --noEmit` (0 errors)
- **Before `/gsd-verify-work`:** Full targeted suite green + grep gates (WAT-02 worker-no-DB, no-main-`import()`/`spawn` for skills, TRS-05 AI-gating) + manual UAT for SC1/SC2
- **Max feedback latency:** ~30s

---

## Per-Requirement Verification Map

> Anchors are the requirement→test contract from RESEARCH § Validation Architecture. "Task ID" finalizes once plans define task IDs; the requirement + secure-behavior + command columns are authoritative now.

| Req / Decision | Threat Ref | Secure Behavior | Test Type | Automated Command | Task ID | Status |
|----------------|------------|-----------------|-----------|-------------------|---------|--------|
| SKL-01 (discover) | — | Local skill manifest validated -> registered -> exposed as OpenAI tool | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyConfigLoader.skills.test.ts -x` | TBD | ⬜ pending |
| SKL-01 (execute boundary) | T-arbitrary-exec | Local skill executes via `SkillWorkerClient` utility process (JS) / per-skill venv (Python); NEVER `import()` in main, NEVER shell in main | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/SkillImportService.local.test.ts -x` | TBD | ⬜ pending |
| SKL-01 (permission gate) | T-exfil-args | `SkillPermissionService.checkPermission` fires on local skill execution (per-call gate, D-SkillEnable) | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/SkillPermissionService.local.test.ts -x` | TBD | ⬜ pending |
| SKL-01 (source reconcile) | T-spoof-builtin | `LocalSkillSourceAdapter` unregister-then-register on rescan; built-in name collision -> diagnostic, no crash (SkillRegistry has NO replaceSource) | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/LocalSkillSourceAdapter.test.ts -x` | TBD | ⬜ pending |
| SKL-01 (trust filter) | T-untrusted-workspace | `skills:` trust-filter line drops untrusted-workspace skills BEFORE registry mutation (mirror Phase 17 `hooks:` line) | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyRuntimeRegistrySync.skills.test.ts -x` | TBD | ⬜ pending |
| SKL-01 (rescan cleanup) | — | Rescan unregisters removed local skills (adapter tracks per-source names) | unit | (same as LocalSkillSourceAdapter test) | TBD | ⬜ pending |
| SKL-02 (plugin commands) | T-plugin-poison | Plugin `commands/*.md` promoted into `CommandRegistry` via `replaceSource("plugin:<name>", …)` with `plugin` badge (rank 3, lowest) | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts -x` | TBD | ⬜ pending |
| SKL-02 (plugin agents) | T-plugin-poison | Plugin `agents/*.md` promoted into `AgentDefinitionRegistry` via `replaceSource("plugin:<name>", …)` with `plugin` badge | unit | (same file) | TBD | ⬜ pending |
| SKL-02 (disable/uninstall) | — | Disabled/uninstalled plugin -> `replaceSource("plugin:<name>", [])` reconciles away | unit | (same file) | TBD | ⬜ pending |
| SKL-02 (options path) | — | `~/.aifetchly/plugins/<name>/options.json` does NOT collide with `userData/plugins/installed` (separate roots) | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/pluginPaths.options.test.ts -x` | TBD | ⬜ pending |
| D-SkillRefResolve (invoke) | — | Hook `skill:<name>` invokes the registered skill via `SkillExecutor.execute` (closes Phase 17 loop) | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/HookDispatcher.skillRef.test.ts -x` | TBD | ⬜ pending |
| D-SkillRefResolve (fallback) | — | Unregistered `skill:<name>` -> `skill-registry-not-available` diagnostic (non-fatal no-op) | unit | (same file) | TBD | ⬜ pending |
| WAT-02 (worker scan-only) | T-worker-compromise | Worker scanner has ZERO DB/Electron/registry imports (worker stays scan-only) | grep | `grep -E "SqliteDb|TypeORM|SkillRegistry|CommandRegistry|AgentDefinitionRegistry|electron" src/service/workspaceWatch/WorkspaceConfigScanner.ts && exit 1 || exit 0` | TBD | ⬜ pending |
| SC1 grep (no main import/shell) | T-arbitrary-exec | NO `import()`/`spawn` of skill entry files on the main process path | grep | `grep -rn "import(\|child_process" src/service/aifetchlyConfig/ src/service/LocalSkillSourceAdapter.ts` empty for skill entry execution | TBD | ⬜ pending |
| TRS-05 (AI gating) | T-ai-bypass | Any skill-execution IPC is NON-AI-serving -> `registerValidatedHandler`, ZERO `registerAiValidatedHandler` | grep | `grep -c "registerAiValidatedHandler" src/main-process/communication/*skill*` returns 0 | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (test scaffolds — created during execution)

> These test files do not exist yet (RESEARCH marks "NO Wave 0"). They are created as the first (RED) step of the task that owns each behavior, mirroring the Phase 17 TDD-folded-Wave-0 convention. The planner assigns each scaffold to a task.

- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.skills.test.ts` — SKL-01 global skill discovery (mirror `AIFetchlyConfigLoader.hooks.test.ts`)
- [ ] `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.skills.test.ts` — SKL-01 `skills:` trust-filter line
- [ ] `test/vitest/main/service/LocalSkillSourceAdapter.test.ts` — SKL-01 source reconciliation + built-in collision handling
- [ ] `test/vitest/main/service/SkillImportService.local.test.ts` — SKL-01 local-skill execution boundary (routes through SkillWorkerClient, not main import)
- [ ] `test/vitest/main/service/SkillPermissionService.local.test.ts` — SKL-01 per-call permission gate
- [ ] `test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts` — SKL-02 plugin command/agent promotion + disable reconcile
- [ ] `test/vitest/main/service/pluginPaths.options.test.ts` — SKL-02 options.json path non-collision
- [ ] `test/vitest/main/service/HookDispatcher.skillRef.test.ts` — D-SkillRefResolve invoke + fallback
- [ ] `test/vitest/utilitycode/` workspace-scanner test for skill raw drafts (worker-side, scan-only)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC1 end-to-end skill execution | SKL-01 / SC1 | requires a real `~/.aifetchly/skills/<name>/manifest.json`, running SkillWorkerClient utility process, and live AI tool invocation | Drop a sample skill manifest, restart, invoke the skill as an AI tool, observe execution + permission prompt |
| SC2 plugin command/agent live | SKL-02 / SC2 | requires an installed plugin with `commands/*.md` + `agents/*.md` and a running registry | Install a test plugin, observe its `/command` appears and agent is listable, with `plugin` badge |

---

## Validation Sign-Off

- [x] All requirements (SKL-01, SKL-02) + D-SkillRefResolve have automated verify anchors
- [x] Every threat in RESEARCH § Security Domain has a mitigation test (T-arbitrary-exec, T-spoof-builtin, T-untrusted-workspace, T-plugin-poison, T-exfil-args, T-worker-compromise)
- [x] Sampling continuity: every requirement has a <30s automated command (no 3-task gap — verify post-planning)
- [ ] Wave 0 test scaffolds created (folded into owning tasks during execution)
- [x] No watch-mode flags (no `--watch`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter (design satisfies Nyquist — every req has automated verify)
- [ ] Per-task Task-ID column finalized (post-planning, once PLAN.md task IDs exist)

**Approval:** pending (plan-time draft)
