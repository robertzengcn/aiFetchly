---
phase: 16-dynamic-agents
plan: 01
name: registry-validator-frontmatter
type: execute
wave: 1
depends_on: []
files_modified:
  - src/service/AgentDefinitionRegistry.ts
  - src/service/slashCommands/agentFrontmatter.ts
  - src/entityTypes/agentTypes.ts
  - test/vitest/main/service/AgentDefinitionRegistry.test.ts
  - test/vitest/utilitycode/agentDefinitionRegistry.test.ts
  - test/vitest/main/service/agentFrontmatter.test.ts
requirements: [AGT-01, AGT-02]
autonomous: true
user_setup: []
tags: [agent-registry, frontmatter-validator, dynamic-agents]

must_haves:
  truths:
    - "AgentDefinitionRegistry is a class exposing listBuiltIns(), list(), getById(id), and replaceSource(sourceId, agents) — object-literal shape is GONE (AGT-01, tech-design §7.4)."
    - "Lookup order is built-in (rank 0) > user (1) > workspace (2) > plugin (3, reserved for Phase 18); built-in IDs CANNOT be shadowed by any source (AGT-01, D-Precedence)."
    - "The agent rank order DELIBERATELY DIVERGES from CommandRegistry (commands are built-in > workspace > user); a load-bearing comment citing AGT-01 / tech-design §7.4 sits on the SOURCE_RANK map so a future reader does not 'normalize' it (D-Precedence)."
    - "replaceSource(sourceId, entries) atomically reconciles add/change/delete/rename — after any replaceSource call, the registry holds EXACTLY the entries for that sourceId and no stale IDs survive (mirrors CommandRegistry.replaceSource)."
    - "Every accessor (listBuiltIns, list, getById) returns defensive copies — callers can never mutate internal state (CLAUDE.md immutability)."
    - "Built-ins are registered into the registry itself at construction (or via registerBuiltIns()), so a registry-first getById finds agent-lead-researcher WITHOUT hitting the DB (RESEARCH Pitfall 1)."
    - "buildAgentDefinition is a PURE function (no fs/Electron/TypeORM imports) that consumes already-parsed frontmatter + a sourceMeta + body and returns {ok:true, definition: AgentDefinitionView} or {ok:false, diagnostic} — first validation violation wins (mirrors buildPromptCommandDefinition)."
    - "The validator produces scoped IDs in the form `${sourceMeta.sourceId}:agent:${name}` (e.g. user:agent:lead-researcher, workspace:<id>:agent:lead-researcher); built-ins keep their existing bare agent-* form via the registry's built-in seeding path (D-AgentIDs precursor, PRD §7.4)."
    - "Unknown tool names in an agent's tools list produce an agent-tool-invalid diagnostic (DX-01) that is NON-FATAL — the definition is still registered; the warning is emitted by the LOADER (not the pure validator) via a detectUnknownTools helper that takes a ReadonlySet<string> of registered tool names (D-ToolDiagnostic)."
  artifacts:
    - "src/service/AgentDefinitionRegistry.ts — refactored from object literal to AgentDefinitionRegistryImpl class (or renamed class) with SOURCE_RANK + byId + sourceIndex + rebuildNameIndex + replaceSource + registerBuiltIns."
    - "src/service/slashCommands/agentFrontmatter.ts — NEW pure validator buildAgentDefinition + AgentDefinitionBuildResult discriminated union + detectUnknownTools warning helper."
    - "src/entityTypes/agentTypes.ts — adds the AgentSource union type (built-in | user | workspace | plugin)."
    - "test/vitest/main/service/AgentDefinitionRegistry.test.ts — NEW (mirrors CommandRegistry.test.ts with agent fixtures + D-Precedence rank)."
    - "test/vitest/utilitycode/agentDefinitionRegistry.test.ts — REWRITTEN for the class API (listBuiltIns preserved)."
    - "test/vitest/main/service/agentFrontmatter.test.ts — NEW (mirrors promptCommandFrontmatter.test.ts)."
  key_links:
    - "AgentDefinitionModule.ensureBuiltIns() → AgentDefinitionRegistry.listBuiltIns() (startup DB seed path PRESERVED — listBuiltIns return shape must stay compatible)."
    - "buildAgentDefinition → consumed by both the global loader (Plan 02) and the workspace draft→definition converter (Plan 02) — single schema owner."
    - "SOURCE_RANK comment → cites AGT-01/tech-design §7.4 so the divergence from CommandRegistry is not 'fixed' later."
---

<objective>
Plan 01 (Wave 1) delivers the pure-logic core of AGT-01 and the AGT-02 validator: the source-aware `AgentDefinitionRegistry` class (a structural clone of Phase 13-02 `CommandRegistry` with the divergent D-Precedence rank order) and the single-owner `buildAgentDefinition` frontmatter validator (a structural clone of Phase 15-01 `buildPromptCommandDefinition` with agent-specific fields + the non-fatal `agent-tool-invalid` diagnostic). Both are pure logic with zero Electron/TypeORM/Vue/fs dependencies. No file sources, no dispatch wiring, no DB changes land here — Plan 02 attaches global + workspace file sources and Plan 03 wires the dispatch path + `/agents` command + context block.

Purpose: Land the two reusable pure assets and the registry BEFORE Plan 02 attaches file I/O. This keeps the precedence rule and the agent schema in one testable place and lets Plan 02 focus purely on scanning + trust + source replacement. The registry refactor is low-risk: RESEARCH §"Resolution-Path Decision" verified the current object-literal registry has exactly ONE production consumer (`AgentDefinitionModule.ensureBuiltIns`), so widening its responsibilities does not cascade.

Output: Refactored AgentDefinitionRegistry.ts, NEW agentFrontmatter.ts, extended agentTypes.ts (AgentSource), three unit-test files GREEN; `yarn testmain` clean; `npx tsc --noEmit` clean.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/16-dynamic-agents/16-CONTEXT.md
@.planning/phases/16-dynamic-agents/16-RESEARCH.md
@.planning/phases/16-dynamic-agents/16-PATTERNS.md
@.planning/REQUIREMENTS.md
@docs/prd/aifetchly-local-extensibility-technical-design.md

# Phase-13/15 surfaces this plan clones (read the SUMMARYs before editing)
@.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md
@.planning/phases/15-prompt-command-files/15-01-SUMMARY.md

# Source files being modified/refactored — read BEFORE editing
@src/service/AgentDefinitionRegistry.ts
@src/service/slashCommands/CommandRegistry.ts
@src/service/slashCommands/promptCommandFrontmatter.ts
@src/entityTypes/agentTypes.ts
@src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
@src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts
@src/modules/AgentDefinitionModule.ts
</context>

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: Refactor AgentDefinitionRegistry → source-aware class with D-Precedence rank (AGT-01)</name>
  <files>src/service/AgentDefinitionRegistry.ts, src/entityTypes/agentTypes.ts, test/vitest/main/service/AgentDefinitionRegistry.test.ts, test/vitest/utilitycode/agentDefinitionRegistry.test.ts</files>
  <read_first>
    - .planning/phases/16-dynamic-agents/16-CONTEXT.md (D-Precedence: user wins over workspace — INTENTIONALLY diverges from commands; document in source)
    - .planning/phases/16-dynamic-agents/16-PATTERNS.md §"AgentDefinitionRegistry.ts (REFACTOR)" — the exact SOURCE_RANK map, replaceSource shape, and listBuiltIns preservation rule
    - src/service/slashCommands/CommandRegistry.ts (the structural template — clone the three-index + rebuildNameIndex + replaceSource shape; NOTE the divergent rank order this plan requires)
    - src/service/AgentDefinitionRegistry.ts (the refactor target — current 69-line object literal + the BUILT_INS array + the lead-researcher google_search comment that motivates D-ToolDiagnostic)
    - src/entityTypes/agentTypes.ts (AgentDefinitionView fields — the entry type; AgentMode exists, AgentSource does NOT yet exist and must be added here)
    - src/modules/AgentDefinitionModule.ts lines 15-30 (ensureBuiltIns calls listBuiltIns() — the method name + return shape MUST stay compatible)
    - test/vitest/main/service/CommandRegistry.test.ts (the test template — clone for agent fixtures + the divergent rank assertions)
  </read_first>
  <behavior>
    Registry construction + built-ins:
    - A fresh registry (or one with registerBuiltIns() called) returns the existing built-in(s) from listBuiltIns() with the SAME shape AgentDefinitionModule.ensureBuiltIns consumes today — the startup DB seed path stays green.
    - list() on a fresh registry returns the built-in(s) sorted by precedence; getById("agent-lead-researcher") returns a copy of the built-in.
    Precedence (D-Precedence — user wins over workspace, OPPOSITE of commands):
    - Register a user agent "user:agent:dup" and a workspace agent "workspace:ws1:agent:dup" (same name, different scoped IDs). getById on the name resolves to the USER entry (rank 1 beats rank 2). A test MUST assert this user-wins order and cite AGT-01 in a comment.
    - Register a built-in-named agent under source "user"; the built-in still wins (built-ins cannot be shadowed by ANY source).
    replaceSource atomic reconciliation (mirror CommandRegistry.replaceSource):
    - replaceSource("user", [A, B]) then replaceSource("user", [B, C]) → registry lists only B and C for source "user" (A deleted; no stale IDs).
    - replaceSource("user", []) after a non-empty populate → all user agents gone (full delete by source).
    - Rename within a source: replaceSource("user", [X-name-old]) then replaceSource("user", [X-name-new]) → old ID gone, new ID present.
    Immutability:
    - Mutating the object returned by list()/listBuiltIns()/getById() does NOT change subsequent returns (defensive copies on every accessor — `{...entry}` / `.map(d => ({...d}))`).
  </behavior>
  <action>
    Add the `AgentSource` union (literal set: built-in, user, workspace, plugin) to `src/entityTypes/agentTypes.ts` alongside the existing AgentMode type. Refactor `src/service/AgentDefinitionRegistry.ts` from the object literal into an exported class (keep the existing module export name so `AgentDefinitionModule.ensureBuiltIns` and any other importer continue to compile; if renaming to AgentDefinitionRegistryImpl, re-export an instance or the class under the existing symbol the consumers import — verify with grep before deciding). Clone the `CommandRegistry` shape (src/service/slashCommands/CommandRegistry.ts:26-158): a `SOURCE_RANK` map keyed by AgentSource, internal indexes `byId: Map<string, AgentDefinitionView>` and `sourceIndex: Map<string, Set<string>>`, a private `rebuildNameIndex()` invoked at the end of every mutator, and the four public methods listBuiltIns/list/getById/replaceSource. The SOURCE_RANK map MUST carry the D-Precedence order (built-in=0, user=1, workspace=2, plugin=3) with a multi-line comment citing AGT-01 / tech-design §7.4 and explicitly noting this DIVERGES from CommandRegistry (commands are built-in > workspace > user) so a future reader does not normalize it — per D-Precedence this comment is load-bearing. Reserve the plugin rank (comment: reserved for Phase 18). Implement `replaceSource(sourceId, agents)` to atomically reconcile: delete every prior ID recorded in sourceIndex for that sourceId, insert defensive copies of the new entries, update sourceIndex, then rebuildNameIndex. Built-ins must be present in the registry itself — either register the existing BUILT_INS array in the constructor or expose a `registerBuiltIns()` method; preserve the existing `listBuiltIns()` method returning `.map(d => ({...d}))` so the Phase-13 ensureBuiltIns DB-seed call at src/background.ts stays unchanged (RESEARCH Pitfall 1). Precedence-aware getById resolves by scoped ID first, then by bare name across sources using SOURCE_RANK (lowest rank wins; built-in always wins on name collision). Every accessor returns a defensive copy (CLAUDE.md immutability). Keep the existing lead-researcher google_search comment (it documents why D-ToolDiagnostic exists). NEVER use the any type. Write the two test files FIRST (RED), confirm failure, then implement (GREEN). The new main test mirrors CommandRegistry.test.ts with agent fixtures and the divergent D-Precedence assertions; the utilitycode test is rewritten for the class API (listBuiltIns still covered).
  </action>
  <verify>
    <automated>AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AgentDefinitionRegistry</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs agentDefinitionRegistry</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "from ['\"]typeorm['\"]|getRepository|from ['\"]electron['\"]" src/service/AgentDefinitionRegistry.ts</automated>
  </verify>
  <acceptance_criteria>
    - `AgentDefinitionRegistry.ts` exports a class (not an object literal) with public methods listBuiltIns, list, getById, replaceSource — confirmed by `grep -E "listBuiltIns\(|list\(|getById\(|replaceSource\(" src/service/AgentDefinitionRegistry.ts`.
    - The SOURCE_RANK map in AgentDefinitionRegistry.ts ranks user (1) ABOVE workspace (2) and includes a comment mentioning AGT-01 — `grep -c "AGT-01" src/service/AgentDefinitionRegistry.ts` returns at least 1.
    - `AgentSource` is exported from agentTypes.ts — `grep -E "export type AgentSource" src/entityTypes/agentTypes.ts` returns a match.
    - The D-Precedence user-wins-over-workspace test passes (a test whose name or comment references D-Precedence or AGT-01 asserts user rank < workspace rank).
    - `npx tsc --noEmit` reports 0 errors (including src/modules/AgentDefinitionModule.ts which still imports listBuiltIns).
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>AgentDefinitionRegistry is a class with D-Precedence SOURCE_RANK, atomic replaceSource, defensive-copy accessors, and built-ins registered in-memory; listBuiltIns() shape preserved for ensureBuiltIns; both test files GREEN; tsc clean.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: buildAgentDefinition pure validator + agent-tool-invalid diagnostic (AGT-02, D-ToolDiagnostic, DX-01)</name>
  <files>src/service/slashCommands/agentFrontmatter.ts, test/vitest/main/service/agentFrontmatter.test.ts</files>
  <read_first>
    - .planning/phases/16-dynamic-agents/16-CONTEXT.md (Claude's Discretion — custom-agent frontmatter fields: name, description, tools array, maxToolCalls, maxRuntimeMs, non-empty body; system-default the rest; D-ToolDiagnostic non-fatal warning)
    - .planning/phases/16-dynamic-agents/16-PATTERNS.md §"agentFrontmatter.ts (NEW)" — the validation order, the success-shape AgentDefinitionView, and the loader-side detectUnknownTools integration
    - src/service/slashCommands/promptCommandFrontmatter.ts lines 97-242 (the validator template — clone the fail() helper, the fixed-order checks, the discriminated-union return, the first-violation-wins flow)
    - src/entityTypes/agentTypes.ts lines 32-46 (AgentDefinitionView field set — the produced type; note outputSchema is required-typed Record<string, unknown>, default to {} per RESEARCH Pitfall 4)
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts (AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength, COMMAND_NAME_REGEX, maxAgentsPerSource, AIFETCHLY_DIAGNOSTIC_CODES — all already defined; agent-name-invalid + agent-tool-invalid codes reserved)
    - src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts lines 56-146 (the restricted frontmatter parser output — scalars Map, arrays Map, body string; the validator consumes this shape, it does NOT re-parse bytes; NO parser change is needed for the tools array)
  </read_first>
  <behavior>
    Valid drafts (return {ok:true, definition: AgentDefinitionView}):
    - Minimal valid: name "lead-researcher", description "Research leads", body "You are a lead researcher." → definition.id equals sourceMeta.sourceId + ":agent:lead-researcher", mode "specialist", version 1, status "active", outputSchema {} (empty — structured authoring deferred), allowedTools [] when tools absent, maxToolCalls 8, maxRuntimeMs 180000, maxContinueCalls 8, systemPrompt equals body.
    - With tools + bounds: name, description, tools ["web_search","read_file"], maxToolCalls "12", maxRuntimeMs "60000", body non-empty → allowedTools carries both tool names verbatim (defensive copy), numeric bounds parsed as ints.
    - Name with allowed chars: "lead-researcher", "lead_researcher", "lead2" all accepted (pattern allows lowercase letters, digits, hyphens, underscores after a leading lowercase letter).
    Invalid drafts (return {ok:false, diagnostic}, first violation wins):
    - name missing / starts uppercase / starts digit / contains invalid char ("Lead", "2lead", "le ad", "le.ad") → agent-name-invalid diagnostic.
    - description missing or empty → diagnostic (frontmatter-missing-style code).
    - description over commandDescriptionLength (501 chars at cap 500) → frontmatter-invalid diagnostic.
    - tools present but not a string array, or any entry empty/non-string → frontmatter-invalid diagnostic.
    - maxToolCalls / maxRuntimeMs present but not a positive integer → frontmatter-invalid diagnostic.
    - body empty after trim → frontmatter-invalid diagnostic.
    D-ToolDiagnostic (detectUnknownTools — separate pure helper, NON-FATAL):
    - Given a valid definition with allowedTools ["web_search","ghost_tool"] and a registeredToolNames set containing only "web_search", detectUnknownTools returns ONE agent-tool-invalid diagnostic for "ghost_tool" (severity warning, recoverable true). The definition itself is still registrable.
    - Empty allowedTools → detectUnknownTools returns an empty array.
  </behavior>
  <action>
    Create `src/service/slashCommands/agentFrontmatter.ts` exporting: (1) the `AgentDefinitionBuildResult` discriminated union ({ok:true, definition: AgentDefinitionView} | {ok:false, diagnostic: AIFetchlyConfigDiagnostic}); (2) the pure function `buildAgentDefinition(draft, sourceMeta, filePath)` mirroring buildPromptCommandDefinition's shape (never throws, fixed validation order, first violation wins). Validation order per PATTERNS.md §agentFrontmatter: name present + matches COMMAND_NAME_REGEX (else agent-name-invalid); description present + non-empty; description length at most AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength (else frontmatter-invalid); tools optional-default-empty-array, must be string array with each entry a non-empty string (else frontmatter-invalid); maxToolCalls optional must parse as positive int (else frontmatter-invalid); maxRuntimeMs optional must parse as positive int (else frontmatter-invalid); body non-empty after trim (else frontmatter-invalid). On success produce an AgentDefinitionView with id `${sourceMeta.sourceId}:agent:${name}` (stable scoped ID mirroring the command convention), systemPrompt = body, allowedTools = Array.from(tools) (defensive copy), and the system defaults from CONTEXT Claude's Discretion (mode specialist, version 1, status active, maxContinueCalls 8, maxToolCalls default 8, maxRuntimeMs default 180000, outputSchema {} — empty object per RESEARCH Pitfall 4, NEVER omit the field since AgentDefinitionView.outputSchema is required-typed). (3) Export a separate pure helper `detectUnknownTools(definition, registeredToolNames: ReadonlySet<string>): AIFetchlyConfigDiagnostic[]` that returns one non-fatal agent-tool-invalid diagnostic (severity warning, recoverable true, code AIFETCHLY_DIAGNOSTIC_CODES agent-tool-invalid) per allowedTools entry not in the set — keep this OUTSIDE the validator so the validator stays single-purpose and the loader (Plan 02) owns emitting the warnings (per D-ToolDiagnostic + RESEARCH Pattern 2 recommendation). Reuse the existing fail()/diagnostic shape from promptCommandFrontmatter.ts — do NOT invent a new diagnostic format. The validator and helper are pure: no fs, no Electron, no TypeORM imports. NEVER use the any type. Write the test file FIRST (RED), confirm failure, then implement (GREEN).
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs agentFrontmatter</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "from ['\"]fs['\"]|from ['\"]electron['\"]|typeorm|getRepository" src/service/slashCommands/agentFrontmatter.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/service/slashCommands/agentFrontmatter.ts` exports buildAgentDefinition, detectUnknownTools, and AgentDefinitionBuildResult — confirmed by `grep -E "export (function|const|type) (buildAgentDefinition|detectUnknownTools|AgentDefinitionBuildResult)" src/service/slashCommands/agentFrontmatter.ts` (3 matches).
    - A passing test asserts the produced definition.id for a user-source draft equals the form sourceId-colon-agent-colon-name.
    - A passing test asserts a valid definition's outputSchema is an empty object (no required fields) and mode is specialist.
    - A passing test asserts detectUnknownTools emits exactly one agent-tool-invalid diagnostic per unknown tool and ZERO for known tools, and that the diagnostic is marked recoverable/non-fatal.
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>buildAgentDefinition is a pure single-owner validator producing scoped-ID AgentDefinitionViews with system defaults; detectUnknownTools emits non-fatal DX-01 warnings; all behavior cases pass; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Author markdown → in-memory registry | Agent frontmatter crosses from user-authored file into the agent dispatch surface here (the validator is the schema gate). |
| Validator ↔ SkillRegistry | detectUnknownTools compares authored tool names against the registered-tool set (the set is passed in, not imported — validator stays pure). |

## STRIDE Threat Register (ASVS L1, block-on-high)

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-16-01-TA | Tampering | AgentDefinitionRegistry.replaceSource | medium | mitigate | Atomic per-source reconciliation (delete-then-insert + rebuildNameIndex) guarantees no stale IDs survive a malformed/incomplete replaceSource call — verified by the rename/delete test cases. |
| T-16-01-EL | Elevation | SOURCE_RANK precedence map | high | mitigate | Built-in rank (0) always wins over user/workspace; a test asserts a user/source entry registering a built-in-named agent CANNOT shadow the built-in (AGT-01). The D-Precedence comment is load-bearing against a future "normalize to match commands" regression. |
| T-16-01-IM | Information disclosure | Registry accessors | low | mitigate | Every accessor returns defensive copies (CLAUDE.md immutability) — callers cannot mutate internal state or hold stale references. |
| T-16-01-IV | Input validation | buildAgentDefinition | high | mitigate | Fixed-order schema validation (name regex, description cap, tools array type, numeric bounds, non-empty body) with first-violation-wins; rejects malformed frontmatter before it becomes a dispatchable definition (ASVS V5). |
| T-16-01-SC | Tampering | npm/pip/cargo installs | low | accept | Phase 16 installs ZERO packages (RESEARCH §Standard Stack) — no supply-surface in this plan. |
</threat_model>

## Artifacts this phase produces (Plan 01)

- `AgentDefinitionRegistry` class (or `AgentDefinitionRegistryImpl`) — source-aware registry with `listBuiltIns`/`list`/`getById`/`replaceSource`/`registerBuiltIns`.
- `AgentSource` union type (agentTypes.ts) — `"built-in" | "user" | "workspace" | "plugin"`.
- `SOURCE_RANK` map (AgentDefinitionRegistry.ts) — D-Precedence order with load-bearing AGT-01 comment.
- `buildAgentDefinition` pure validator (agentFrontmatter.ts) — single owner of the agent frontmatter schema.
- `AgentDefinitionBuildResult` discriminated union (agentFrontmatter.ts).
- `detectUnknownTools` helper (agentFrontmatter.ts) — emits non-fatal `agent-tool-invalid` (DX-01) diagnostics.
- Scoped-ID format `${sourceMeta.sourceId}:agent:${name}` (e.g. `user:agent:lead-researcher`).

<verification>
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AgentDefinitionRegistry agentFrontmatter` → all GREEN.
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs agentDefinitionRegistry` → GREEN.
- `npx tsc --noEmit` → 0 errors (including AgentDefinitionModule.ensureBuiltIns which still consumes listBuiltIns).
- `yarn testmain` → no regressions across the existing main-process suite.
- No DB/Electron/fs imports leaked into AgentDefinitionRegistry.ts or agentFrontmatter.ts.
</verification>

<success_criteria>
- AGT-01 (registry refactor + precedence + built-ins unshadowable + replaceSource) delivered and unit-tested.
- AGT-02 (validator portion: schema + scoped IDs + non-fatal agent-tool-invalid diagnostic) delivered and unit-tested; the global/workspace loaders that consume the validator land in Plan 02.
- No existing test regresses; the Phase-13 ensureBuiltIns startup path stays green.
</success_criteria>

<output>
Create `.planning/phases/16-dynamic-agents/16-01-SUMMARY.md` when done.
</output>
