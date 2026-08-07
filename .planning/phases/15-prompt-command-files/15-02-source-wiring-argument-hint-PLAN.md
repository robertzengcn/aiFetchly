---
phase: 15-prompt-command-files
plan: 02
name: source-wiring-argument-hint
type: execute
wave: 2
depends_on:
  - 15-01-expansion-validator-dispatcher
files_modified:
  - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
  - src/service/workspaceWatch/WorkspaceWatchManager.ts
  - src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts
  - src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
  - test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts
  - test/vitest/main/service/workspaceWatch/buildWorkspaceCommandDefinitions.test.ts
  - test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts
  - test/vitest/main/components/AiChatV2SlashSuggestions.test.ts
requirements: [CMD-06]
autonomous: true
user_setup: []

must_haves:
  truths:
    - "The global loader reads ~/.aifetchly/commands/*.md on every scan, parses each with the restricted frontmatter parser (CFG-07), validates via buildPromptCommandDefinition (Plan 01), and fills snapshot.commands with the resulting SlashCommandDefinition[] (source 'user', sourceId 'user') — invalid files produce diagnostics and are skipped (SC1, SC4)."
    - "Workspace command drafts produced by the Phase-14 scanner are converted in the MAIN process via buildPromptCommandDefinition into SlashCommandDefinition[] (source 'workspace', sourceId 'workspace:<id>') BEFORE applyWorkspaceSnapshot mutates the registry — untrusted workspaces still drop commands at the Phase-14 trust filter (TRS-01 reused, not rebuilt) (SC4)."
    - "When ~/.aifetchly/commands/review.md (global) and <workspace>/.aifetchly/commands/review.md (workspace, trusted) both define 'review', the workspace entry wins — the registry's SOURCE_RANK (workspace < user, lower wins) enforces D-03 automatically via replaceSource per-source."
    - "Adding a command file makes the command appear in the next scan's replaceSource; deleting or renaming a file makes it disappear via the same source replacement — no stale entries survive (SC1, SC3)."
    - "AiChatV2SlashSuggestions renders the argumentHint INLINE with the command name (/<name> <argumentHint>) when argumentHint is non-empty, and renders NOTHING in its place when argumentHint is empty/absent — no generic placeholder (D-04)."
  prohibitions:
    - "Phase 15 MUST NOT add a per-capability trust entity (Phase 17) — reuse Phase-14 binary trust (applyWorkspaceSnapshot trust filter) unchanged."
    - "Phase 15 MUST NOT re-scan workspace files — it consumes the Phase-14 WorkspaceConfigScanner output (drafts); no new watcher, no duplicate scanner."
    - "Phase 15 MUST NOT add new IPC channels or preload whitelist entries (Phase 13 SLASH_COMMAND_LIST / SLASH_COMMAND_DISPATCH / AIFETCHLY_CONFIG_CHANGED are reused)."
    - "The renderer MUST NOT gain any fs/path/os import (TRS-07) — argumentHint is already carried in the SlashCommandView projection from Phase 13."
  artifacts:
    - "AIFetchlyConfigLoader gains a private command-scan method (mirroring Phase-14 WorkspaceConfigScanner.tryReadCommandFiles) that reads ~/.aifetchly/commands/*.md with CFG-04 size cap + CFG-05 path safety + CFG-07 restricted frontmatter parse, then validates via buildPromptCommandDefinition."
    - "buildWorkspaceCommandDefinitions(drafts, sourceMeta) — pure main-process helper converting WorkspaceCommandDraft[] -> { definitions: SlashCommandDefinition[], diagnostics }, reusing buildPromptCommandDefinition (single schema owner)."
    - "WorkspaceWatchManager calls buildWorkspaceCommandDefinitions on the snapshot's drafts BEFORE invoking the applyWorkspaceSnapshotCallback, merging diagnostics into the snapshot."
    - "AiChatV2SlashSuggestions.vue row restructured: argumentHint span moves from the meta row into the name row, rendered immediately after /<name> (D-04 inline)."
  key_links:
    - "Global: AIFetchlyConfigLoader.scan -> snapshot.commands (SlashCommandDefinition[], source 'user') -> AIFetchlyConfigManager -> applySnapshot -> CommandRegistry.replaceSource('user', defs)."
    - "Workspace: scanner (Phase 14) -> WorkspaceCommandDraft[] in snapshot -> WorkspaceWatchManager -> buildWorkspaceCommandDefinitions -> applyWorkspaceSnapshot(snapshot with SlashCommandDefinition[], trust) -> replaceSource('workspace:<id>', trusted defs)."
    - "D-03 shadow: CommandRegistry SOURCE_RANK workspace=1 < user=2 (lower wins) — replaceSource per-sourceId + rebuildNameIndex enforces workspace-over-user automatically; built-ins still win (rank 0)."
---

<objective>
Plan 02 (Wave 2) attaches real file sources to the pure logic shipped in Plan 01. It wires CMD-06 frontmatter validation into BOTH command-file sources: (a) the global loader reading `~/.aifetchly/commands/*.md` (currently produces an empty commands array — Phase 13 left this as a forward-compat stub), and (b) the workspace path where the Phase-14 WorkspaceConfigScanner already snapshots `commands/*.md` into raw WorkspaceCommandDraft entries that Phase 15 must now convert into validated SlashCommandDefinition objects in the main process. The D-03 workspace-shadows-global precedence is enforced automatically by the registry's existing SOURCE_RANK (no new precedence code). Finally, the plan surfaces `argumentHint` inline in the suggestions dropdown (D-04).

Purpose: Make user-defined prompt commands actually appear, dispatch, and reconcile live — covering SC1 (add/delete), SC3 (rename/edit via source replacement), SC4 (workspace trust + invalid frontmatter diagnostic), and the D-04 inline hint. Plan 01 already proved the substitution + validation + dispatcher return; this plan is pure wiring + reconciliation + renderer polish.

Output: Extended AIFetchlyConfigLoader + WorkspaceWatchManager + a pure workspace-definitions helper + updated AiChatV2SlashSuggestions.vue; integration tests for shadow/reconciliation/diagnostic + updated component tests; tsc clean.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/15-prompt-command-files/15-CONTEXT.md
@.planning/REQUIREMENTS.md

# Plan 01 surfaces this plan consumes (MUST be complete first)
@.planning/phases/15-prompt-command-files/15-01-EXPANSION-VALIDATOR-DISPATCHER-PLAN.md

# Phase-13 + Phase-14 surfaces this plan consumes
@.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-04-SUMMARY.md
@.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md
@.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md

# Source files being modified — read BEFORE editing
@src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
@src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
@src/service/workspaceWatch/WorkspaceWatchManager.ts
@src/service/workspaceWatch/WorkspaceConfigScanner.ts
@src/service/slashCommands/promptCommandFrontmatter.ts
@src/service/slashCommands/CommandRegistry.ts
@src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
</context>

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: Global loader + workspace draft wiring through buildPromptCommandDefinition (SC1, SC3, SC4, D-03)</name>
  <files>src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts, src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts, src/service/workspaceWatch/WorkspaceWatchManager.ts, test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts, test/vitest/main/service/workspaceWatch/buildWorkspaceCommandDefinitions.test.ts, test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts</files>
  <read_first>
    - .planning/phases/15-prompt-command-files/15-CONTEXT.md (D-03 workspace shadows global silently; Carry-Forward: reuse Phase 13-01 frontmatter parser + CFG-04 size cap + Phase 14-02 trust filter)
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (the global loader — find buildSnapshot where commands: [] is currently returned ~line 270; mirror how AGENTS.md is read for the command-scan structure)
    - src/service/workspaceWatch/WorkspaceConfigScanner.ts lines 402-522 (tryReadCommandFiles — the Phase-14 workspace command scanner producing WorkspaceCommandDraft; Phase 15 consumes its output, does NOT re-scan)
    - src/service/workspaceWatch/WorkspaceWatchManager.ts (find where the worker snapshot is received and applyWorkspaceSnapshotCallback is invoked — that is where buildWorkspaceCommandDefinitions inserts)
    - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts (applySnapshot + applyWorkspaceSnapshot — confirm the cast at applySnapshot and that trust filtering happens at applyWorkspaceSnapshot)
    - src/service/slashCommands/promptCommandFrontmatter.ts (the Plan-01 validator — call it from both sources)
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts (AIFETCHLY_CONFIG_LIMITS.commandMdBytes, maxCommandsPerSource — reuse; the CMD-06 caps from Plan 01)
    - src/service/aifetchlyConfig/resolveConfigRelativePath.ts (CFG-05 path safety — reuse for the global command scan)
    - src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts (parseRestrictedFrontmatter — reuse for the global command scan)
    - src/service/slashCommands/CommandRegistry.ts (replaceSource + SOURCE_RANK — D-03 is enforced HERE; verify workspace rank < user rank)
  </read_first>
  <behavior>
    Global loader (AIFetchlyConfigLoader):
    - A tmpdir ~/.aifetchly/commands/review.md with valid frontmatter (name review, description, type prompt, non-empty body) -> the loader's snapshot.commands contains ONE SlashCommandDefinition with source 'user', sourceId 'user', name 'review', type 'prompt'.
    - A tmpdir with TWO valid command files -> snapshot.commands has two definitions.
    - A command file exceeding commandMdBytes -> file-too-large diagnostic + the command is NOT in snapshot.commands (CFG-04).
    - A command file with frontmatter failing the restricted parse -> frontmatter-invalid diagnostic + skipped.
    - A command file with valid frontmatter but failing CMD-06 (e.g. name 'Review' uppercase) -> command-name-invalid diagnostic + skipped (SC4 global path).
    - Missing commands/ dir -> snapshot.commands is empty, NO diagnostic (happy path).
    - More than maxCommandsPerSource files -> excess files skipped with a diagnostic (CFG-04 count cap).
    Workspace conversion (buildWorkspaceCommandDefinitions):
    - Two WorkspaceCommandDraft entries with valid frontmatter + bodies -> returns two SlashCommandDefinition objects with source 'workspace', the correct workspace sourceId, type 'prompt', and defensive copies.
    - One valid + one invalid draft (bad name) -> returns one definition + one diagnostic for the invalid draft.
    - Zero drafts -> returns empty definitions + empty diagnostics.
    - Pure: no fs/Electron/TypeORM imports; does not mutate the input drafts.
    Workspace manager wiring:
    - WorkspaceWatchManager receiving a snapshot whose commands are WorkspaceCommandDraft[] invokes buildWorkspaceCommandDefinitions BEFORE applyWorkspaceSnapshotCallback, passing definitions + merged diagnostics forward.
    D-03 shadow (registry-level integration):
    - A CommandRegistry with replaceSource('user', [review-global]) then replaceSource('workspace:ws1', [review-workspace]) -> registry.getByName('review') returns the workspace entry (SOURCE_RANK workspace < user). Built-in 'help' registered first is NOT shadowed by either.
  </behavior>
  <action>
    Part A — Global loader (src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts): add a private async command-scan method modeled on Phase-14 WorkspaceConfigScanner.tryReadCommandFiles. It reads `<globalDir>/commands/*.md`, applies CFG-05 path safety (resolveConfigRelativePath), CFG-04 size cap (stat before read; AIFETCHLY_CONFIG_LIMITS.commandMdBytes) and the maxCommandsPerSource count cap, calls parseRestrictedFrontmatter on the text, then calls buildPromptCommandDefinition (Plan 01) with sourceMeta {source:'user', sourceId:'user', sourceLabel:'User', requiresTrust:false}. Collect successful definitions into the commands array and failures into diagnostics (reuse the diagnostic shape — severity 'warning', recoverable true, the DX-01 code from the validator result). Wire the resulting array into buildSnapshot's commands field (replacing the current empty array). Snapshot.commands MUST contain SlashCommandDefinition objects (validated), not raw drafts. Do NOT change the sourceId ('user') or the global-always-trusted path (applySnapshot is still called directly for the global snapshot — applyWorkspaceSnapshot is NOT used for global).

    Part B — Workspace conversion helper (src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts): a PURE module exporting `buildWorkspaceCommandDefinitions(drafts: readonly WorkspaceCommandDraft[], sourceMeta): { definitions: SlashCommandDefinition[]; diagnostics: AIFetchlyConfigDiagnostic[] }`. Iterate drafts; for each, read frontmatter + body + relativePath, call buildPromptCommandDefinition (Plan 01), and partition results into definitions (ok branch) and diagnostics (not-ok branch, forwarding the diagnostic). Construct each definition's id as `${sourceMeta.sourceId}:command:${name}` (mirrors the Phase-14 draft id scheme but is now derived from the VALIDATED name, not the filename — so a file named review.md with frontmatter name 'review' produces a stable id; if frontmatter name differs from filename, the frontmatter name wins). NEVER mutate drafts; NEVER throw (wrap any unexpected error as a scanner-io-error-style diagnostic). Pure module: import only types + buildPromptCommandDefinition + the diagnostic helper shape; no fs/Electron/TypeORM.

    Part C — Workspace manager wiring (src/service/workspaceWatch/WorkspaceWatchManager.ts): at the point where a worker snapshot is received and BEFORE applyWorkspaceSnapshotCallback is invoked, call buildWorkspaceCommandDefinitions on snapshot.commands (cast as readonly WorkspaceCommandDraft[]) with sourceMeta derived from the workspace sourceId, then construct a new snapshot carrying commands: definitions and diagnostics: [...snapshot.diagnostics, ...newDiagnostics]. Pass THAT snapshot to applyWorkspaceSnapshotCallback. Do NOT change the trust filter (it still runs inside applyWorkspaceSnapshot, unchanged) — Phase 15 adds validation, not a new trust surface.

    Write all three test files FIRST (RED), then implement (GREEN). The D-03 shadow test lives in WorkspaceWatchManager.commands.test.ts OR a dedicated integration test (executor's discretion) but MUST assert both registry-level shadow and built-in non-shadow. RED then GREEN commits.
  </action>
  <verify>
    <automated>AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AIFetchlyConfigLoader.commands buildWorkspaceCommandDefinitions WorkspaceWatchManager.commands</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -rE "from ['\"]fs['\"]|from ['\"]electron['\"]|typeorm" src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts</automated>
  </verify>
  <acceptance_criteria>
    - AIFetchlyConfigLoader.scan on a tmpdir with a valid commands/review.md returns a snapshot whose commands array contains exactly one SlashCommandDefinition (source 'user', type 'prompt', name 'review') — verified by reading snapshot.commands.length and the first entry's fields.
    - AIFetchlyConfigLoader.scan on a tmpdir with an oversized command file produces a file-too-large diagnostic and an EMPTY commands array.
    - AIFetchlyConfigLoader.scan on a tmpdir with a CMD-06-invalid command file (bad name) produces a command-name-invalid (or frontmatter-invalid) diagnostic and skips the command (SC4 global path).
    - buildWorkspaceCommandDefinitions is pure — the negative grep in `<verify>` returns 0 hits.
    - buildWorkspaceCommandDefinitions on one-valid + one-invalid drafts returns one definition + one diagnostic; on zero drafts returns empty/empty.
    - WorkspaceWatchManager.commands.test.ts asserts that a snapshot carrying drafts results in the manager calling applyWorkspaceSnapshotCallback with a snapshot whose commands are SlashCommandDefinition objects (not raw drafts) and whose diagnostics include any validation failures.
    - The D-03 shadow test asserts registry.getByName('review') returns the workspace entry when both 'user' and 'workspace:ws1' sources define 'review', AND that a built-in 'help' is NOT shadowed.
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history for this task.
  </acceptance_criteria>
  <done>Both command-file sources flow validated SlashCommandDefinition objects into CommandRegistry.replaceSource; D-03 shadow is enforced by the existing SOURCE_RANK; invalid files produce diagnostics and are skipped (SC1, SC3, SC4 supported at the source layer).</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: argumentHint inline in AiChatV2SlashSuggestions (D-04)</name>
  <files>src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue, test/vitest/main/components/AiChatV2SlashSuggestions.test.ts</files>
  <read_first>
    - .planning/phases/15-prompt-command-files/15-CONTEXT.md (D-04: render argumentHint inline with the name when present; nothing when empty; NO generic placeholder)
    - src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue (current template: name + badge in slash-suggestions__row; description + argumentHint in slash-suggestions__meta. The argumentHint span at lines 48-52 must MOVE into the name row.)
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-04-SUMMARY.md (the existing component test structure — extend it)
    - test/vitest/main/components/AiChatV2SlashSuggestions.test.ts (existing 6 tests — add argumentHint-inline assertions)
  </read_first>
  <behavior>
    - A command view with name 'review', argumentHint '<path>', description 'Review code', source 'user' renders the name row as: /review  <path>  [USER badge] — the argumentHint appears immediately after the name, before/around the badge.
    - A command view with name 'status', NO argumentHint (undefined/empty), description 'Show status' renders the name row as: /status  [BUILT-IN badge] — NO placeholder text appears where the hint would be.
    - A command view with an empty argumentHint ('') behaves identically to undefined argumentHint (no placeholder).
    - The description still renders in the meta row (unchanged).
    - The badge still renders in the name row (unchanged).
    - No v-html is used for argumentHint (T-13-Inject mitigation preserved — Vue template escaping).
  </behavior>
  <action>
    Modify `src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue`: move the argumentHint span OUT of the `slash-suggestions__meta` block and INTO the `slash-suggestions__row` block, positioned immediately after the `slash-suggestions__name` span (before the badge, OR after the badge — pick whichever reads as `/<name> <argumentHint>` most naturally; the D-04 example `/review <path> — Review code` places hint right after the name). Keep the existing `v-if="cmd.argumentHint"` guard so an empty/absent hint renders NOTHING (no generic `<args>` or placeholder text — D-04 locked rationale). Remove the now-duplicate argumentHint span from the meta row (the description span remains there alone). Keep the existing scoped CSS class `slash-suggestions__arg-hint` (adjust its layout only if needed to sit inline with the monospace name). Do NOT change the component's props, emits, ARIA roles, keyboard navigation, or source-badge logic — this is a template restructure only. Do NOT add any fs/path/os import (TRS-07 — the component stays pure UI).

    Extend `test/vitest/main/components/AiChatV2SlashSuggestions.test.ts` with assertions that: (a) when argumentHint is provided, the rendered name row text includes the hint inline with the name; (b) when argumentHint is absent, the name row contains NO placeholder and the hint does not appear. Write/extend tests FIRST (RED), then make the template change (GREEN). RED then GREEN commits.
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AiChatV2SlashSuggestions</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -rE "from ['\"]fs['\"]|from ['\"]path['\"]|from ['\"]os['\"]" src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue</automated>
  </verify>
  <acceptance_criteria>
    - The argumentHint span renders INSIDE the `slash-suggestions__row` block (the name row), positioned after the name span — verified by the component test asserting the hint text appears in the same row as `/review`.
    - When argumentHint is undefined or empty, NO placeholder text appears in the rendered row — verified by the component test.
    - The description span remains in the `slash-suggestions__meta` block (unchanged).
    - The existing 6 Phase-13 component tests still pass (no regression) plus the new argumentHint-inline assertions pass.
    - `npx tsc --noEmit` reports 0 errors.
    - No fs/path/os import added (TRS-07 boundary preserved).
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>The suggestions dropdown renders argumentHint inline with the command name when present and nothing when absent (D-04); Phase-13 component behavior preserved; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| ~/.aifetchly/commands/*.md -> global loader -> registry | User-owned files (user can already type anything into the AI); no trust gate needed for global — the user is the author |
| <workspace>/.aifetchly/commands/*.md -> worker -> main -> registry | Untrusted until Phase-14 binary trust accepts the workspace; trust enforced at applyWorkspaceSnapshot (reused, NOT rebuilt) |
| registry -> renderer SlashCommandView | Body stays main-process (Phase 13 listViews strips body); argumentHint/description are author-supplied data, rendered with Vue escaping (no v-html) |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-15-04 | Spoofing / Bypass | workspace command registration (untrusted workspace) | high | mitigate | Workspace drafts pass through applyWorkspaceSnapshot(snapshot, trust) which DROPS commands when trust.commands is false (Phase-14 TRS-01 filter, reused unchanged). Plan 15 adds validation BEFORE the filter, not instead of it. Verified by WorkspaceWatchManager.commands.test.ts asserting untrusted workspaces still produce zero registered commands. |
| T-15-02 | Denial of Service | oversized / malformed command files | low | mitigate | CFG-04 size cap (commandMdBytes=64KB, maxCommandsPerSource=200) enforced by stat-before-read in the global loader (mirroring Phase-14 scanner). Malformed frontmatter -> diagnostic + skip (SC4). The validator never throws. |
| T-15-05 | Information Disclosure | command body leakage to renderer | medium | mitigate | Phase-13 CommandRegistry.listViews already strips body + metadata (T-13-Leak). Plan 15 does NOT change the view projection — argumentHint/description are renderer-safe metadata by design (CMD-07). Vue template escaping for argumentHint (no v-html). |
| T-15-06 | Tampering | global loader path traversal | medium | mitigate | CFG-05 resolveConfigRelativePath rejects absolute paths, .. traversal, and symlink escapes; reused for the global command scan (same helper Phase-13 uses for AGENTS.md). |
| T-15-08 | Repudiation | silent shadow (workspace overrides global) | low | accept | D-03 locked: workspace shadowing is silent and intentional. The source badge in the suggestions dropdown already disambiguates which source is active (User vs Workspace). A diagnostic would add noise without changing behavior; deferred per CONTEXT.md. |
| T-15-SC | Supply Chain | package installs | low | accept | Phase 15 adds ZERO new packages — reuses Phase 13/14 stack (chokidar, zod already in tree). |
</threat_model>

<verification>
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AIFetchlyConfigLoader.commands buildWorkspaceCommandDefinitions WorkspaceWatchManager.commands AiChatV2SlashSuggestions` -> all GREEN.
- `npx tsc --noEmit` -> 0 errors.
- End-to-end (manual or integration): dropping a valid `~/.aifetchly/commands/review.md` and running `/reload-config` makes `/review` appear; deleting it removes it (SC1) — covered by the loader test; live-update is the Phase-14 watcher path already wired.
</verification>

<success_criteria>
- Adding `~/.aifetchly/commands/review.md` makes `/review` appear in suggestions; deleting removes it without restart (SC1).
- `/review src/service` expands the body with the argument substitution and returns submit_prompt (SC2 — end-to-end via Plan 01 dispatcher + Plan 02 sources).
- Renaming/editing a command file reconciles via replaceSource — no stale entries (SC3).
- Workspace commands require trust; invalid frontmatter produces a diagnostic and the command is ignored (SC4).
- argumentHint renders inline with the name when present, nothing when absent (D-04).
- D-03 workspace-shadows-global enforced by the existing registry SOURCE_RANK.
</success_criteria>

<output>
Create `.planning/phases/15-prompt-command-files/15-02-SUMMARY.md` when done.
</output>

## Artifacts this plan produces

- **AIFetchlyConfigLoader command-scan path** — reads `~/.aifetchly/commands/*.md`, validates via buildPromptCommandDefinition, fills snapshot.commands with SlashCommandDefinition[] (source 'user'). Was an empty stub in Phase 13.
- **buildWorkspaceCommandDefinitions(drafts, sourceMeta)** — pure main-process helper converting Phase-14 WorkspaceCommandDraft entries into validated SlashCommandDefinition objects + diagnostics. Reuses buildPromptCommandDefinition (single CMD-06 schema owner).
- **WorkspaceWatchManager draft->definition wiring** — the manager now converts drafts BEFORE applyWorkspaceSnapshotCallback; trust filter unchanged.
- **AiChatV2SlashSuggestions.vue argumentHint-inline template** — hint moves from the meta row into the name row (D-04); no placeholder when absent.
- **Integration test coverage** for SC1 (add/delete), SC3 (rename/edit via replaceSource), SC4 (invalid frontmatter diagnostic), D-03 (workspace shadows global; built-in not shadowed).
