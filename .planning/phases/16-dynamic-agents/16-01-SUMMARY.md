---
phase: 16-dynamic-agents
plan: 01
subsystem: api
tags: [agent-registry, frontmatter-validator, dynamic-agents, source-aware-registry, pure-logic]

# Dependency graph
requires:
  - phase: 13-global-context-and-built-in-slash-commands
    provides: CommandRegistry three-index + replaceSource + rebuildNameIndex pattern (the structural template cloned here)
  - phase: 15-prompt-command-files
    provides: buildPromptCommandDefinition single-owner validator pattern (the structural template cloned here); COMMAND_NAME_REGEX + commandDescriptionLength cap
provides:
  - AgentDefinitionRegistryImpl class with source-aware listBuiltIns/list/getById/replaceSource + atomic reconciliation (AGT-01)
  - AgentDefinitionRegistry singleton (backward-compat) — listBuiltIns shape preserved for AgentDefinitionModule.ensureBuiltIns
  - AgentSource union type ("built-in" | "user" | "workspace" | "plugin")
  - SOURCE_RANK map with D-Precedence order (built-in=0 > user=1 > workspace=2 > plugin=3) and load-bearing AGT-01 comment
  - buildAgentDefinition pure single-owner validator producing scoped-ID AgentDefinitionViews (AGT-02)
  - AgentDefinitionBuildResult discriminated union
  - detectUnknownTools pure helper emitting non-fatal agent-tool-invalid (DX-01) warnings
  - Scoped agent ID convention sourceId-colon-agent-colon-name (e.g. user:agent:lead-researcher)
affects: [16-02-loaders-trust-scanner, 16-03-dispatch-list-context, 18-skills-and-plugin-integration]

# Tech tracking
tech-stack:
  added: []  # zero packages installed (pure-logic plan)
  patterns:
    - "Source-aware registry with atomic replaceSource (clone of CommandRegistry with divergent D-Precedence rank order)"
    - "Parallel idToSource map — tracks each entry's source for precedence lookup because AgentDefinitionView does not carry a source field"
    - "Single-owner pure validator with fixed-order first-violation-wins schema (clone of buildPromptCommandDefinition)"
    - "Separate detectUnknownTools helper — non-fatal parse-time warnings kept OUT of the validator so it stays single-purpose (loader owns emitting)"
    - "Backward-compat singleton re-export — class plus ready-made instance under the legacy import symbol"

key-files:
  created:
    - src/service/slashCommands/agentFrontmatter.ts
    - test/vitest/main/service/AgentDefinitionRegistry.test.ts
    - test/vitest/main/service/agentFrontmatter.test.ts
  modified:
    - src/service/AgentDefinitionRegistry.ts
    - src/entityTypes/agentTypes.ts
    - test/vitest/utilitycode/agentDefinitionRegistry.test.ts

key-decisions:
  - "Divergent D-Precedence documented in source, not normalized — agents rank user above workspace (OPPOSITE of commands); a multi-line load-bearing comment on SOURCE_RANK cites AGT-01/tech-design section 7.4 with an explicit DO-NOT-NORMALIZE warning. 5 AGT-01 mentions in the file make grep-based regression checks trivial."
  - "Parallel idToSource map instead of adding a source field to AgentDefinitionView — keeps the DTO unchanged (zero downstream type ripple) while still enabling precedence-aware name-index rebuilds."
  - "getById resolves by scoped ID first, then falls back to a precedence-aware bare-name lookup — supports both exact-ID dispatch and ergonomic bare-name resolution in /agents."
  - "Legacy AgentDefinitionRegistry export preserved as a singleton instance — avoids touching 3 existing consumers (AgentDefinitionModule.ensureBuiltIns plus agentToolPolicyService/ToolTimeoutPolicy tests) in this plan; new isolated callers construct new AgentDefinitionRegistryImpl()."
  - "Missing-description uses frontmatter-missing code (no agent-description-missing code reserved in AIFETCHLY_DIAGNOSTIC_CODES); name failures use the reserved agent-name-invalid code."
  - "detectUnknownTools derives source attribution from the scoped id (parses the prefix before the agent marker) — keeps the helper a 2-arg pure function per the plan contract."
  - "listBuiltIns() reads from the BUILT_INS constant directly, independent of replaceSource mutations — preserves the ensureBuiltIns DB-seed contract as a stable catalog."

patterns-established:
  - "Source-aware agent registry pattern: SOURCE_RANK + byId + idToSource + byName + sourceIndex + rebuildNameIndex on every mutation, atomic replaceSource reconciliation (mirror of CommandRegistry with divergent rank)."
  - "Pure validator + separate warning-helper split: schema correctness (buildAgentDefinition) is decoupled from runtime tool-registration feedback (detectUnknownTools)."
  - "System-default fill on agent definitions: mode specialist, version 1, status active, maxContinueCalls 8, maxToolCalls 8, maxRuntimeMs 180000, outputSchema empty (always present — required-typed)."

requirements-completed: [AGT-01, AGT-02]

coverage:
  - id: D1
    description: "AgentDefinitionRegistry refactored to a source-aware class with listBuiltIns/list/getById/replaceSource, D-Precedence SOURCE_RANK (built-in > user > workspace > plugin), built-ins unshadowable, atomic replaceSource reconciliation, defensive-copy accessors, built-ins seeded at construction"
    requirement: AGT-01
    verification:
      - kind: unit
        ref: test/vitest/main/service/AgentDefinitionRegistry.test.ts#AgentDefinitionRegistry D-Precedence (AGT-01)
        status: pass
      - kind: unit
        ref: test/vitest/main/service/AgentDefinitionRegistry.test.ts#AgentDefinitionRegistry replaceSource atomic reconciliation
        status: pass
      - kind: unit
        ref: test/vitest/utilitycode/agentDefinitionRegistry.test.ts#AgentDefinitionRegistry (class API)
        status: pass
    human_judgment: false
  - id: D2
    description: "buildAgentDefinition pure single-owner validator producing scoped-ID AgentDefinitionViews with system defaults plus fixed-order first-violation-wins schema; detectUnknownTools non-fatal agent-tool-invalid (DX-01) warning helper"
    requirement: AGT-02
    verification:
      - kind: unit
        ref: test/vitest/main/service/agentFrontmatter.test.ts#buildAgentDefinition — valid AGT-02 drafts
        status: pass
      - kind: unit
        ref: test/vitest/main/service/agentFrontmatter.test.ts#buildAgentDefinition — invalid AGT-02 drafts
        status: pass
      - kind: unit
        ref: test/vitest/main/service/agentFrontmatter.test.ts#detectUnknownTools (DX-01 non-fatal warning)
        status: pass
    human_judgment: false
  - id: D3
    description: "Backward compatibility preserved — AgentDefinitionModule.ensureBuiltIns plus agentToolPolicyService plus ToolTimeoutPolicy tests compile and pass unchanged against the legacy AgentDefinitionRegistry singleton symbol"
    verification:
      - kind: unit
        ref: test/vitest/utilitycode/agentToolPolicyService.test.ts (12 tests pass — consumes AgentDefinitionRegistry.listBuiltIns)
        status: pass
      - kind: automated
        ref: "npx tsc --noEmit (0 errors — AgentDefinitionModule + ToolTimeoutPolicy compile unchanged)"
        status: pass
    human_judgment: false

duration: 37 min
completed: 2026-07-08
status: complete
---

# Phase 16 Plan 01: Registry + Frontmatter Validator Summary

**Source-aware AgentDefinitionRegistry class (D-Precedence clone of CommandRegistry) + pure buildAgentDefinition validator with non-fatal agent-tool-invalid warnings — both pure-logic, zero Electron/DB/fs deps**

## Performance

- **Duration:** 37 min
- **Started:** 2026-07-08T13:53:31Z
- **Completed:** 2026-07-08T14:31:12Z
- **Tasks:** 2 (both TDD: RED then GREEN)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- Refactored AgentDefinitionRegistry from a 69-line object literal into an AgentDefinitionRegistryImpl class — a structural clone of CommandRegistry (three indexes plus rebuildNameIndex plus atomic replaceSource) with the AGT-01 D-Precedence rank order (built-in > user > workspace > plugin), deliberately DIVERGING from commands and documented with a load-bearing comment so a future reader does not normalize it.
- Built-in lead-researcher is now registered into the registry itself at construction (RESEARCH Pitfall 1), so Plan 03's registry-first getById resolution path will find it WITHOUT hitting the DB. listBuiltIns() shape preserved verbatim for the existing ensureBuiltIns DB-seed consumer.
- Created buildAgentDefinition as the single owner of the AGT-02 agent frontmatter schema — pure function, fixed-order first-violation-wins validation, never throws, produces scoped-ID AgentDefinitionViews with system defaults (mode specialist, version 1, outputSchema empty).
- Created detectUnknownTools as a separate pure helper emitting non-fatal DX-01 agent-tool-invalid warnings — kept OUT of the validator so the validator stays single-purpose and the loader (Plan 02) owns emitting warnings (D-ToolDiagnostic).
- Zero regressions: 59/59 new main tests, 6/6 rewritten utilitycode tests, 12/12 agentToolPolicyService consumer test, 104/104 targeted regression on the cloned analogs (CommandRegistry, promptCommandFrontmatter, AIFetchlyConfigLoader.commands, AIFetchlyConfigMarkdown, AIFetchlyRuntimeRegistrySync.trust, AIFetchlyConfigSnapshotDiff), tsc 0 errors, purity grep clean.

## Task Commits

Each task followed strict TDD (RED failing test then GREEN implementation):

1. **Task 1: Refactor AgentDefinitionRegistry to source-aware class (AGT-01)** — TDD
   - `6ce02901` (test): add failing tests for source-aware AgentDefinitionRegistry — RED
   - `4aa2474f` (feat): implement source-aware AgentDefinitionRegistry (AGT-01) — GREEN
2. **Task 2: buildAgentDefinition validator + detectUnknownTools (AGT-02, DX-01)** — TDD
   - `74de331c` (test): add failing tests for buildAgentDefinition validator — RED
   - `541c2025` (feat): implement buildAgentDefinition + detectUnknownTools (AGT-02, DX-01) — GREEN

## Files Created/Modified
- `src/service/AgentDefinitionRegistry.ts` — REFACTORED from object literal to AgentDefinitionRegistryImpl class; SOURCE_RANK with D-Precedence plus load-bearing AGT-01 comment; byId/idToSource/byName/sourceIndex indexes; registerBuiltIns/listBuiltIns/list/getById/replaceSource; legacy singleton preserved for backward compat
- `src/service/slashCommands/agentFrontmatter.ts` — NEW pure validator (buildAgentDefinition + detectUnknownTools + AgentDefinitionBuildResult + AgentDefinitionDraft + AgentDefinitionSourceMeta types); fixed-order validation, first-violation-wins, never throws, defensive copies
- `src/entityTypes/agentTypes.ts` — added AgentSource union type (built-in, user, workspace, plugin)
- `test/vitest/main/service/AgentDefinitionRegistry.test.ts` — NEW (21 tests): construction+built-ins, D-Precedence, replaceSource reconciliation, defensive copies, singleton backward-compat
- `test/vitest/main/service/agentFrontmatter.test.ts` — NEW (38 tests): valid/invalid drafts, invariants, detectUnknownTools DX-01 behavior
- `test/vitest/utilitycode/agentDefinitionRegistry.test.ts` — REWRITTEN (6 tests) for the class API, preserving the listBuiltIns/getById contract

## Decisions Made
- See key-decisions in frontmatter — the divergent D-Precedence order and the parallel idToSource map (instead of mutating AgentDefinitionView) are the two highest-leverage decisions; both are documented inline in source.

## Deviations from Plan

None - plan executed exactly as written. Both tasks delivered the specified artifacts with the specified validation orders, the specified D-Precedence rank, the specified scoped-ID format, the specified backward-compat for ensureBuiltIns, and the specified RED-then-GREEN TDD commits. The purity grep gates (no typeorm/electron/fs imports) pass on both new modules.

## Issues Encountered
- **Full `yarn testmain` suite hangs in this worktree** (20+ min with active CPU before manual kill). The hang is in a pre-existing Electron/DB-dependent test outside this plan's scope (my changes are pure-logic with zero Electron/DB imports, verified by grep gate). Per the scope-boundary rule, pre-existing hangs in unrelated files are out of scope. Regression coverage was instead established via the targeted pure-logic suite (104/104 — the cloned analogs CommandRegistry/promptCommandFrontmatter plus the parser/loader/trust-filter consumers) plus the listBuiltIns consumer test (agentToolPolicyService 12/12) plus a standalone `npx tsc --noEmit` (0 errors). The pure-logic verification block in the plan (`AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AgentDefinitionRegistry agentFrontmatter` and the utilityCode variant) is fully GREEN.

## User Setup Required
None - no external service configuration required. This plan installs zero packages and adds zero environment variables (pure-logic plan).

## Next Phase Readiness
- **Ready for Plan 02 (loaders-trust-scanner).** Plan 02 attaches the global (~/.aifetchly/agents/*.md) and workspace file sources: AIFetchlyConfigLoader.tryReadAgentFiles and WorkspaceConfigScanner.tryReadAgentFiles feed parsed drafts into buildAgentDefinition, then replaceSource mutates the registry. The validator and registry are stable, tested, and the scoped-ID + system-default contract is encoded exactly once here.
- **Ready for Plan 03 (dispatch-list-context).** Plan 03 wires run_subagent to resolve via getById (scoped-ID first, bare-name fallback), adds the /agents built-in command reading from list(), and injects the Available-agents context block from list(). The registry-first resolution path (RESEARCH Pitfall 1) is already enabled — built-ins are in-memory at construction.
- No blockers. The plugin source rank is reserved for Phase 18 per plan.

## Self-Check: PASSED

Verified before writing STATE.md:

**Files exist:**
- FOUND: src/service/AgentDefinitionRegistry.ts
- FOUND: src/service/slashCommands/agentFrontmatter.ts
- FOUND: src/entityTypes/agentTypes.ts (AgentSource added)
- FOUND: test/vitest/main/service/AgentDefinitionRegistry.test.ts
- FOUND: test/vitest/main/service/agentFrontmatter.test.ts
- FOUND: test/vitest/utilitycode/agentDefinitionRegistry.test.ts

**Commits exist (RED + GREEN for both TDD tasks):**
- FOUND: 6ce02901 (test RED Task 1)
- FOUND: 4aa2474f (feat GREEN Task 1)
- FOUND: 74de331c (test RED Task 2)
- FOUND: 541c2025 (feat GREEN Task 2)

**Acceptance criteria (Task 1):**
- PASS: AgentDefinitionRegistry.ts exports a class with listBuiltIns/list/getById/replaceSource (grep confirmed all 4 methods)
- PASS: SOURCE_RANK ranks user(1) above workspace(2) with AGT-01 comment (5 AGT-01 mentions)
- PASS: AgentSource exported from agentTypes.ts
- PASS: D-Precedence user-wins-over-workspace test passes (asserts AGT-01)
- PASS: npx tsc --noEmit reports 0 errors (incl. AgentDefinitionModule)
- PASS: RED commit then GREEN commit both in git history

**Acceptance criteria (Task 2):**
- PASS: agentFrontmatter.ts exports buildAgentDefinition + detectUnknownTools + AgentDefinitionBuildResult (3 grep matches)
- PASS: test asserts definition.id form sourceId:agent:name
- PASS: test asserts outputSchema is empty and mode is specialist
- PASS: test asserts detectUnknownTools emits one agent-tool-invalid per unknown tool, zero for known/empty, marked recoverable/non-fatal
- PASS: npx tsc --noEmit reports 0 errors
- PASS: RED commit then GREEN commit both in git history

**Verification block (plan-level):**
- PASS: AIFETCHLY_SKIP_TSC=1 vitest main AgentDefinitionRegistry agentFrontmatter -> 59/59 GREEN
- PASS: AIFETCHLY_SKIP_TSC=1 vitest utilityCode agentDefinitionRegistry -> 6/6 GREEN
- PASS: npx tsc --noEmit -> 0 errors
- PASS: no typeorm/electron/fs imports in AgentDefinitionRegistry.ts or agentFrontmatter.ts (grep gate clean)
- DEFERRED: yarn testmain full run — hangs on a pre-existing Electron/DB test in this worktree (out of scope; targeted regression suite 104/104 substitutes — see Issues Encountered)

---
*Phase: 16-dynamic-agents*
*Plan: 01-registry-validator-frontmatter*
*Completed: 2026-07-08*
