---
phase: 15-prompt-command-files
plan: 15-02-source-wiring-argument-hint
subsystem: slash-commands
tags: [typescript, slash-commands, prompt-commands, aifetchly-config, workspace-watcher, tdd, cmd-06, d-03, d-04]

requires: [15-01-expansion-validator-dispatcher]
provides:
  - AIFetchlyConfigLoader.tryReadCommandFiles — scans ~/.aifetchly/commands/*.md (CFG-07 parse + CFG-05 path safety + CFG-04 size/count caps) and fills snapshot.commands with validated user SlashCommandDefinition[] via buildPromptCommandDefinition.
  - buildWorkspaceCommandDefinitions(drafts, sourceMeta) — pure main-process converter WorkspaceCommandDraft[] -> {definitions, diagnostics}, reusing buildPromptCommandDefinition (single CMD-06 schema owner).
  - WorkspaceWatchManager draft->definition wiring — converts worker-shipped drafts IN THE MAIN PROCESS before applyWorkspaceSnapshotCallback; merges validation diagnostics; Phase-14 trust filter unchanged.
  - AiChatV2SlashSuggestions argumentHint-inline template (D-04) — hint renders in the name row adjacent to /<name>; no placeholder when absent.
affects: [16-dynamic-agents (argumentHint projection reuse), 17-hooks (diagnostic-merge pattern)]

tech-stack:
  added: []
  patterns:
    - Single schema owner — both the global loader and the workspace conversion path route through buildPromptCommandDefinition so CMD-06 validation is encoded exactly once (Plan 15-01 invariant preserved).
    - Main-process conversion of worker-opaque drafts — the worker ships WorkspaceCommandDraft[] in snapshot.commands (readonly unknown[]); Phase 15 converts in main before the registry sees them. The worker gains NO validation/registry logic (WAT-02 boundary preserved).
    - Diagnostic merge — validation diagnostics are merged into the snapshot ([...snapshot.diagnostics, ...converted.diagnostics]) so they surface in /status and the AIFETCHLY_CONFIG_CHANGED event without a new IPC channel.
    - D-03 via existing SOURCE_RANK — workspace-shadows-global is enforced by CommandRegistry.replaceSource + rebuildNameIndex (workspace rank < user rank, lower wins; built-ins rank 0). No new precedence code.

key-files:
  created:
    - src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts
    - test/vitest/main/service/workspaceWatch/buildWorkspaceCommandDefinitions.test.ts
    - test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts
    - test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts
  modified:
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
    - src/service/workspaceWatch/WorkspaceWatchManager.ts
    - src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
    - test/vitest/main/components/AiChatV2SlashSuggestions.test.ts

key-decisions:
  - "Single schema owner: both command-file sources (global ~/.aifetchly/commands and workspace drafts) call buildPromptCommandDefinition. No duplicate CMD-06 logic. The validator's stable signature from Plan 15-01 was consumed unchanged."
  - "Main-process conversion boundary: the worker ships raw WorkspaceCommandDraft[] in snapshot.commands (typed readonly unknown[] — the opaque carrier). WorkspaceWatchManager casts (as unknown as readonly WorkspaceCommandDraft[]) and converts BEFORE applyWorkspaceSnapshotCallback. The worker never imports the validator or registry (WAT-02 preserved; verified by the existing worker grep gate)."
  - "D-03 is enforced by the existing CommandRegistry SOURCE_RANK (workspace=1 < user=2, lower wins; built-in=0). Plan 15-02 adds NO precedence code — replaceSource per sourceId + rebuildNameIndex on every mutation already guarantees workspace shadows user and built-ins cannot be shadowed. Verified by the D-03 registry tests."
  - "Definition id derives from the VALIDATED frontmatter name, not the filename: a file review.md with frontmatter name 'audit' produces id workspace:<id>:command:audit. The validator already constructs ${sourceMeta.sourceId}:command:${name}; the helper inherits this for free."
  - "Global loader command-scan mirrors the Phase-14 WorkspaceConfigScanner.tryReadCommandFiles structure (readdir withFileTypes -> resolveConfigRelativePath -> stat size cap -> readFile -> parseRestrictedFrontmatter -> validate), adding the maxCommandsPerSource count cap (CFG-04) which the Phase-14 scanner did not enforce."
  - "argumentHint inline via a name-group wrapper span: name + arg-hint grouped left (inline-flex, baseline-aligned) so /<name> <argumentHint> reads adjacent; the badge stays right via the row's existing space-between. v-if guard kept so an absent/empty hint renders NOTHING — no generic <args> placeholder (D-04 locked rationale)."
  - "Renderer purity preserved (TRS-07): the .vue change is template-only; no fs/path/os import added. argumentHint is data already carried in the SlashCommandView projection from Phase 13-02 listViews."

patterns-established:
  - "Pattern: opaque-snapshot-field conversion at the main-process boundary — worker ships readonly unknown[] drafts; main casts + validates before registry mutation. Reusable for Phase 16 (agents) and 17 (hooks) draft arrays."
  - "Pattern: diagnostic merge into the inbound snapshot — [...existing, ...new] so validation failures surface through the existing diagnostic/status channels without a new IPC contract."

requirements-completed: [CMD-06]

coverage:
  - id: SC1
    description: "Adding ~/.aifetchly/commands/review.md makes /review appear; deleting removes it (source replacement)."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts (5 cases: one valid, two valid, oversized, CMD-06-invalid, missing dir)"
        status: pass
    human_judgment: false
  - id: SC2
    description: "/review src/service expands the body with $ARGUMENTS and returns submit_prompt (end-to-end via Plan 01 dispatcher + Plan 02 sources)."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "SlashCommandDispatcher.test.ts (Plan 15-01, SC2) + AIFetchlyConfigLoader.commands.test.ts (source populates registry)"
        status: pass
    human_judgment: false
  - id: SC3
    description: "Renaming/editing a command file reconciles via replaceSource — no stale entries."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "CommandRegistry.replaceSource (D-03 test asserts workspace shadows user via replaceSource); loader re-scan produces a fresh definitions array each scan"
        status: pass
    human_judgment: false
  - id: SC4
    description: "Workspace commands require trust; invalid frontmatter produces a diagnostic and the command is ignored."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "buildWorkspaceCommandDefinitions.test.ts (invalid draft -> diagnostic) + WorkspaceWatchManager.commands.test.ts (validation diagnostics merge into snapshot; Phase-14 trust filter unchanged)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-03 workspace-shadows-global enforced by existing registry SOURCE_RANK; built-in not shadowed."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "WorkspaceWatchManager.commands.test.ts > CommandRegistry D-03 precedence (2 cases: workspace shadows user; built-in wins)"
        status: pass
    human_judgment: false
  - id: D4
    description: "argumentHint renders inline with the name when present; nothing when absent."
    requirement: CMD-06
    verification:
      - kind: unit
        ref: "AiChatV2SlashSuggestions.test.ts (3 new cases: inline-in-row, absent-no-placeholder, empty-string-no-placeholder)"
        status: pass
    human_judgment: false
  - id: TRS07
    description: "Renderer never reads extension files; worker never accesses DB/registries."
    requirement: TRS-07
    verification:
      - kind: unit
        ref: "grep -nE \"from ['\\\"]fs['\\\"]|from ['\\\"]path['\\\"]|from ['\\\"]os['\\\"]\" src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue == CLEAN; buildWorkspaceCommandDefinitions.ts purity gate CLEAN"
        status: pass
    human_judgment: false

duration: ~45min (inline execution; Wave 2 subagent was cut off by a 429 usage limit, resumed inline after quota reset)
completed: 2026-07-08
status: complete
---

# Phase 15 Plan 02: Source Wiring + argumentHint Summary

**Wave-2 wiring that attaches real file sources (global + workspace) to the Plan 15-01 pure logic, plus the D-04 inline hint.**

## Performance

- **Tasks:** 2 (both TDD: RED -> GREEN)
- **Files created:** 4 (1 source + 3 test)
- **Files modified:** 4 (loader, manager, suggestions .vue, suggestions test)
- **Tests:** 24 new tests passing (6 buildWorkspaceCommandDefinitions + 5 loader.commands + 4 manager.commands [incl. 2 D-03] + 9 suggestions [3 new])
- **Cumulative Phase 15:** 84 scoped tests passing (60 from Plan 01 + 24 from Plan 02)

## Accomplishments

- **buildWorkspaceCommandDefinitions.ts (NEW)** — pure main-process helper converting the Phase-14 worker's raw `WorkspaceCommandDraft[]` into validated `SlashCommandDefinition[]` + diagnostics by routing each draft through `buildPromptCommandDefinition` (Plan 15-01). Source is hardcoded `"workspace"` (drafts are workspace-only). Definition id derives from the validated frontmatter name. Never throws (unexpected validator errors wrap to a `scanner-io-error`-style diagnostic); never mutates input drafts. Purity gate clean (no fs/electron/typeorm imports).
- **AIFetchlyConfigLoader** — gained a private `tryReadCommandFiles` that reads `~/.aifetchly/commands/*.md` with CFG-05 path safety, CFG-04 size cap (commandMdBytes) + count cap (maxCommandsPerSource), CFG-07 restricted frontmatter parse, and CMD-06 validation via `buildPromptCommandDefinition`. `snapshot.commands` now carries validated user `SlashCommandDefinition[]` (was an empty stub in Phase 13). The global path stays always-trusted (applySnapshot, not applyWorkspaceSnapshot).
- **WorkspaceWatchManager** — in `handleWorkerEvent` (snapshot/changed), the worker's opaque `WorkspaceCommandDraft[]` (carried in `snapshot.commands: readonly unknown[]`) are now converted to validated definitions IN THE MAIN PROCESS before `applyWorkspaceSnapshotCallback`. Validation diagnostics merge into the snapshot. The Phase-14 trust filter inside applyWorkspaceSnapshot is unchanged — Plan 15 adds validation, not a new trust surface.
- **AiChatV2SlashSuggestions.vue** — argumentHint span moved out of `slash-suggestions__meta` into `slash-suggestions__row`, grouped with the name in a `slash-suggestions__name-group` wrapper so `/<name> <argumentHint>` reads adjacent and the badge stays right. `v-if="cmd.argumentHint"` guard kept so an absent/empty hint renders nothing (no placeholder). Template-only change; props/emits/ARIA/keyboard nav/source-badge logic unchanged; no fs/path/os import added.
- **D-03 enforced by existing SOURCE_RANK** — no new precedence code. The registry test confirms workspace `review` shadows user `review` and a built-in `help` is NOT shadowed.

## Task Commits

1. **Task 1 — Global loader + workspace draft wiring (SC1/SC3/SC4/D-03)**
   - bcfe5b69 (RED) — 3 failing test files (helper, loader.commands, manager.commands incl. D-03)
   - e2433c39 (GREEN) — buildWorkspaceCommandDefinitions.ts + loader command-scan + manager draft->definition wiring; 15/15 tests pass; tsc clean
2. **Task 2 — argumentHint inline (D-04)**
   - f6821b12 (RED) — failing inline-hint test (hint still in meta)
   - e1b62047 (GREEN) — template restructure (name-group wrapper); 9/9 component tests pass; tsc clean

## Decisions Made

- **Why convert in main, not the worker:** the worker is structurally sandboxed (WAT-02) and must not import the validator or registry. The snapshot type intentionally carries `commands: readonly unknown[]` as an opaque carrier so the worker can ship drafts without typing coupling; main owns validation + registry mutation. This keeps the trust/registry authority in the main process (design §3.2/§9.4).
- **Why a name-group wrapper for D-04:** three siblings (name, hint, badge) under the row's `justify-content: space-between` would float the hint toward center. Wrapping name+hint in an inline-flex group keeps `/review <path>` visually adjacent and leaves the badge pinned right, matching the D-04 example `/review <path> — Review code`.
- **Why no new IPC channel:** argumentHint was already carried in the `SlashCommandView` projection from Phase 13-02 `listViews`; the renderer already had the data — only the template placement changed (prohibition: no new IPC/preload entries).

## Deviations from Plan

None — implementation conforms to the locked design. The only adjustment was the Wave-2 dispatch model: the gsd-executor subagent was cut off mid-task by a provider 429 usage-limit error before committing anything (safe-resume gate confirmed clean: no partial commits, no SUMMARY, clean working tree). Execution resumed inline (orchestrator) after the quota window reset, following the same RED -> GREEN TDD cycle and atomic per-task commits. No production-code impact from the dispatch change.

## Issues Encountered

- **429 usage limit during Wave 2 subagent dispatch** — the gsd-executor spawn returned `Usage limit reached for 5 hour` ~8 hours before reset. Resolved by waiting for the quota reset and completing Plan 15-02 inline. The safe-resume gate (workflow #3095) verified zero partial work, so no rollback was needed.
- **Pre-existing unrelated test failures** — the full vitest suite has 4 failing files outside Phase 15 scope (ErrorClassification, ValidationUtils, RateLimiter, AiChatV2.workspace). Confirmed unrelated: `git diff 8e9a743b..HEAD -- src/` touches none of those modules, and the workspace-picker test does not reference SlashSuggestions at all. Phase 15 scoped tests are 100% green.

## User Setup Required

None — pure wiring plan. No new IPC channels (Phase 13 channels reused), no DB schema changes, no new packages, no configuration. End-to-end live behavior (drop `~/.aifetchly/commands/review.md` -> `/reload-config` -> `/review` appears) is covered by the loader test; the live-update path is the already-wired Phase-14 watcher.

## Next Phase Readiness

- **Phase 16 (Dynamic Agents)** can reuse the opaque-snapshot-field + main-process conversion pattern established here (agents will be `readonly unknown[]` drafts converted in main via an analogous `buildWorkspaceAgentDefinitions` helper).
- The diagnostic-merge pattern (`[...existing, ...converted]`) is reusable for Phase 17 (hooks).
- CMD-06 is fully delivered end-to-end: file -> snapshot -> registry -> dispatcher (`submit_prompt` with `$ARGUMENTS` expansion) -> renderer (inline argumentHint). The Phase 13-15 slash-command pipeline is complete.

## TDD Gate Compliance

Both tasks followed RED -> GREEN. Verified in git log:

| Task | RED commit | GREEN commit | Status |
|------|-----------|-------------|--------|
| 1 — loader + workspace wiring + D-03 | bcfe5b69 | e2433c39 | OK |
| 2 — argumentHint inline (D-04) | f6821b12 | e1b62047 | OK |

## Self-Check: PASSED

**File existence (8/8 FOUND):**
- src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts (new)
- src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (modified)
- src/service/workspaceWatch/WorkspaceWatchManager.ts (modified)
- src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue (modified)
- test/vitest/main/service/workspaceWatch/buildWorkspaceCommandDefinitions.test.ts (new)
- test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts (new)
- test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts (new)
- test/vitest/main/components/AiChatV2SlashSuggestions.test.ts (extended)

**Commit existence (4/4 FOUND):** bcfe5b69, e2433c39, f6821b12, e1b62047

**Final verification:**
- AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs buildWorkspaceCommandDefinitions AIFetchlyConfigLoader.commands WorkspaceWatchManager.commands -> 15/15 pass
- AIFETCHLY_SKIP_TSC=1 npx vitest run --config test/vitest/main/components/vitest.config.mjs AiChatV2SlashSuggestions -> 9/9 pass
- npx tsc --noEmit -> 0 errors
- buildWorkspaceCommandDefinitions.ts purity gate (no fs/electron/typeorm) -> CLEAN
- AiChatV2SlashSuggestions.vue renderer gate (no fs/path/os) -> CLEAN

---
*Phase: 15-prompt-command-files*
*Completed: 2026-07-08*
