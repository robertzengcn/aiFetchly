---
status: passed
phase: 15-prompt-command-files
goal: "Load markdown prompt commands (commands/*.md) from global and trusted-workspace sources with $ARGUMENTS expansion and source-replacement reconciliation."
requirement: CMD-06
verified_at: 2026-07-08
method: goal-backward (inline); cross-referenced against PLAN must_haves, SUMMARY coverage, and the live test suite
---

# Phase 15 Verification — Prompt Command Files

## Goal-Backward Check

**Goal:** Make user-defined prompt commands actually appear, dispatch, and reconcile live — covering SC1 (add/delete), SC2 ($ARGUMENTS dispatch), SC3 (rename/edit via source replacement), SC4 (workspace trust + invalid-frontmatter diagnostic), D-03 (workspace shadows global), and D-04 (inline argumentHint).

**Verdict:** ADOPTED — every must_have truth is enforced by a passing automated test; every prohibition is honored.

## Requirement Traceability

| Requirement | Status | Evidence |
|-------------|--------|----------|
| CMD-06 | ✓ Complete | 24 new Phase-15-02 tests + 60 Phase-15-01 tests; see SC table below |

## Success-Criteria Verification

| SC | Claim | Verified By | Status |
|----|-------|-------------|--------|
| SC1 | Adding `~/.aifetchly/commands/review.md` makes `/review` appear; deleting removes it | `AIFetchlyConfigLoader.commands.test.ts` (one-valid + two-valid + missing-dir cases); source replacement via `replaceSource` re-runs each scan | ✓ Pass |
| SC2 | `/review src/service` expands body with `$ARGUMENTS` and returns `submit_prompt` | `SlashCommandDispatcher.test.ts` (Plan 15-01 SC2, 5 cases) + loader now populates the registry that the dispatcher reads | ✓ Pass |
| SC3 | Rename/edit reconciles via `replaceSource` — no stale entries | `WorkspaceWatchManager.commands.test.ts` D-03 (replaceSource user then workspace); loader rebuilds a fresh definitions array each scan | ✓ Pass |
| SC4 | Workspace commands require trust; invalid frontmatter -> diagnostic + ignored | `buildWorkspaceCommandDefinitions.test.ts` (invalid draft -> `command-name-invalid` diagnostic); `WorkspaceWatchManager.commands.test.ts` (validation diagnostics merge into snapshot; Phase-14 trust filter unchanged) | ✓ Pass |
| D-03 | Workspace shadows global; built-in not shadowed | `WorkspaceWatchManager.commands.test.ts > CommandRegistry D-03 precedence` (workspace shadows user; built-in wins) | ✓ Pass |
| D-04 | argumentHint inline with name when present; nothing when absent | `AiChatV2SlashSuggestions.test.ts` (inline-in-row, absent-no-placeholder, empty-string-no-placeholder) | ✓ Pass |

## Prohibitions Honored

- ✓ No per-capability trust entity added (Phase 17) — Phase-14 binary trust reused unchanged.
- ✓ No workspace re-scan — consumes Phase-14 `WorkspaceConfigScanner` draft output.
- ✓ No new IPC channels / preload entries — Phase 13 `SLASH_COMMAND_*` / `AIFETCHLY_CONFIG_CHANGED` reused.
- ✓ Renderer gains no fs/path/os import (TRS-07) — `AiChatV2SlashSuggestions.vue` renderer gate CLEAN; `buildWorkspaceCommandDefinitions.ts` purity gate CLEAN (no fs/electron/typeorm).
- ✓ Worker gains no validation/registry logic (WAT-02) — conversion runs in the main process.

## Automated Checks

- `npx vitest run --config vite.main.config.mjs buildWorkspaceCommandDefinitions AIFetchlyConfigLoader.commands WorkspaceWatchManager.commands` -> 15/15 pass
- `npx vitest run --config test/vitest/main/components/vitest.config.mjs AiChatV2SlashSuggestions` -> 9/9 pass
- Phase 15 cumulative: 84 scoped tests pass (60 Plan 01 + 24 Plan 02)
- `npx tsc --noEmit` -> 0 errors
- Purity gates: `buildWorkspaceCommandDefinitions.ts` (no fs/electron/typeorm) CLEAN; `AiChatV2SlashSuggestions.vue` (no fs/path/os) CLEAN

## Regression

Scoped regression: Phase 13 (slash commands, context) + Phase 14 (workspace watcher) suites green. The full vitest suite has 4 pre-existing failing files (ErrorClassification, ValidationUtils, RateLimiter, AiChatV2.workspace) confirmed unrelated to Phase 15 — `git diff 8e9a743b..HEAD -- src/` touches none of those modules, and the workspace-picker test does not reference SlashSuggestions.

## Human Verification

None required — all SCs are covered by automated tests. Optional manual end-to-end (drop `~/.aifetchly/commands/review.md` -> `/reload-config` -> `/review` appears) is covered at the unit level by the loader test; the live-update path is the already-wired Phase-14 watcher.

## Result

**PASSED** — Phase 15 achieves its goal. CMD-06 fully delivered end-to-end: file -> snapshot -> registry -> dispatcher (`submit_prompt` + `$ARGUMENTS`) -> renderer (inline argumentHint). Ready for phase completion.
