---
phase: 16-dynamic-agents
verified: 2026-07-09T11:33:00Z
status: human_needed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
human_verification:
  - test: "Live-app SC1 roundtrip — create ~/.aifetchly/agents/lead-researcher.md (valid frontmatter: name lead-researcher, description, body), open AiChatV2, run /agents, confirm a 'user:agent:lead-researcher' row appears with the User source badge."
    expected: "Row appears in /agents output AND in the 'Available agents' system block visible to the model. Removing/deleting the file removes the row on the next reload (no app restart)."
    why_human: "Requires the running Electron app + real ~/.aifetchly filesystem outside the vitest tmpdir. Unit tests cover the loader→registry→/agents pipeline against a tmpdir fixture (AIFetchlyConfigLoader.agents.test.ts #reads one valid agents/lead-researcher.md; SlashCommandDispatcher.test.ts #returns show_result for /agents) but cannot exercise the live ~/.aifetchly path."
  - test: "Live-AI SC2 roundtrip — with a dynamic agent registered, prompt the model to delegate to it; observe the run_subagent tool call."
    expected: "The model emits run_subagent with the exact scoped id copied from the 'Available agents' context block (user:agent:<name> or workspace:<id>:agent:<name>); the agent runs; its tool allowlist is intersected with the live SkillRegistry at dispatch (an authored tool not in the registry is blocked, matching the agent-tool-invalid warning)."
    why_human: "Requires a real OpenAI round-trip with the run_subagent tool exposed. Unit tests cover AgentRuntime.runSync registry-first resolution (AgentRuntime.test.ts) and the runtime tool-intersection path (AgentRuntime.ts:137-145 policy.filterExposedToolNames) but cannot drive a live model."
---

# Phase 16: Dynamic Agents — Verification Report

**Phase Goal:** Refactor `AgentDefinitionRegistry` for source-aware dynamic registration, parse `agents/*.md`, and enable `run_subagent` dispatch by scoped dynamic ID.
**Verified:** 2026-07-09T11:33:00Z
**Status:** human_needed — all automated must-haves verified; 2 live-app/live-AI manual checks owed (per `16-VALIDATION.md` Manual-Only table).
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                                                                                                                                                                                                          | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **SC1:** Adding `~/.aifetchly/agents/lead-researcher.md` registers `user:agent:lead-researcher`; `/agents` lists it.                                                                                                                                                                                                          | ✓ VERIFIED | `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` `tryReadAgentFiles` (L466+) reads `agents/*.md`, validates via `buildAgentDefinition`, pushes `AgentDefinitionView` with id `${sourceMeta.sourceId}:agent:${name}`. `src/service/slashCommands/SlashCommandDispatcher.ts:185-199` `case "built-in:command:agents"` calls `manager.getAgentRegistry().list()` and returns `renderAgentsList(...)` as `show_result`. Tests: `AIFetchlyConfigLoader.agents.test.ts #reads one valid agents/lead-researcher.md into a user:agent:* AgentDefinitionView`; `SlashCommandDispatcher.test.ts #returns show_result for /agents`. |
| 2   | **SC2:** `run_subagent` dispatches the dynamic agent; its tool allowlist is intersected with registered/permitted tools at runtime.                                                                                                                                                                                            | ✓ VERIFIED | `src/service/AgentRuntime.ts:88-99` resolves REGISTRY-FIRST (`agentRegistry.getById`) with DB fallback (`defModule.getActiveById`); L137-145 `policy.filterExposedToolNames({allowedTools: definition.allowedTools, availableToolNames, blockedTools})` intersects the dynamic definition's allowlist with the live `SkillRegistry.getAllToolFunctions()`. Tests: `AgentRuntime.test.ts #resolves a dynamic scoped id via the registry REGISTRY-FIRST` (DB not consulted); `#falls back to the DB when the registry misses`.                                                                       |
| 3   | **SC3:** Built-in agent IDs cannot be shadowed by dynamic ones; workspace agents require trust before registration.                                                                                                                                                                                                            | ✓ VERIFIED | `src/service/AgentDefinitionRegistry.ts:102-107` `SOURCE_RANK` (built-in=0 > user=1 > workspace=2 > plugin=3) with load-bearing AGT-01 comment; `rebuildNameIndex` (L251-269) keeps lowest-rank entry per name. Built-ins registered into the registry at construction (`registerBuiltIns()` in ctor L156). `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:165` `agents: trust.agents ? snapshot.agents : []` drops untrusted workspace agents BEFORE `applySnapshot`. Tests: trust filter cases (e)/(f)/(g) in `AIFetchlyRuntimeRegistrySync.trust.test.ts`.        |
| 4   | **AGT-01:** `AgentDefinitionRegistry` refactored to source-aware class with `listBuiltIns`/`list`/`getById`/`replaceSource`; lookup order built-in > user > trusted workspace > plugin.                                                                                                                                        | ✓ VERIFIED | `src/service/AgentDefinitionRegistry.ts:145-270` exports `AgentDefinitionRegistryImpl` class with 4 indexes (`byId`/`idToSource`/`byName`/`sourceIndex`), atomic `replaceSource` (L219-243: delete-then-insert + rebuildNameIndex), defensive-copy accessors (`.map(d => ({...d}))`). `src/entityTypes/agentTypes.ts:23` `export type AgentSource = "built-in" \| "user" \| "workspace" \| "plugin"`. Tests: 21 tests in `AgentDefinitionRegistry.test.ts` cover D-Precedence, replaceSource reconciliation, defensive copies, singleton backward-compat.                          |
| 5   | **AGT-02:** `agents/*.md` parsed (name, description, tools, maxToolCalls, maxRuntimeMs, body) with scoped IDs; workspace agents require trust; tool allowlists intersected with registered/permitted tools at runtime.                                                                                                         | ✓ VERIFIED | `src/service/slashCommands/agentFrontmatter.ts:123-262` `buildAgentDefinition` — fixed-order first-violation-wins validator producing scoped-id `AgentDefinitionView`. `detectUnknownTools` (L316-336) emits non-fatal `agent-tool-invalid` warnings. Consumed by BOTH the global loader (`AIFetchlyConfigLoader.tryReadAgentFiles`) and the workspace converter (`buildWorkspaceAgentDefinitions.ts`). Runtime intersection at `AgentRuntime.ts:139-145`. Tests: 38 tests in `agentFrontmatter.test.ts`; 8 in `buildWorkspaceAgentDefinitions.test.ts`.                       |
| 6   | **AGT-03 + WAT-02 + TRS-05A:** `run_subagent` description covers both ID forms + dispatch by dynamic ID; `/agents` lists built-in + dynamic; worker scanner stays scan-only (worker-no-DB); new surfaces add NO `registerAiValidatedHandler` (TRS-05 Strategy A).                                                              | ✓ VERIFIED | `src/service/agentTools/runSubagentTool.ts:54-60` description rewritten with both bare built-in + scoped dynamic ID forms + pointer to Available agents block (old "Built-in agent ID" wording gone). `src/service/workspaceWatch/WorkspaceConfigScanner.ts` imports ONLY `crypto`/`fs`/`path`/types/constants/`resolveConfigRelativePath`/`parseRestrictedFrontmatter` — no Module/Model/registry/Electron/typeorm. Tests: `runSubagentTool.test.ts #description documents BOTH forms`; `WorkerNoDbBoundary.test.ts:144` grep gate; `SlashCommandDispatcher.test.ts #non-AI-gated`.   |

**Score:** 6/6 truths verified (0 present-behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/service/AgentDefinitionRegistry.ts` | Source-aware class + D-Precedence + replaceSource | ✓ VERIFIED | 285 lines; class + 4 indexes + load-bearing AGT-01 comment; legacy singleton preserved |
| `src/service/slashCommands/agentFrontmatter.ts` | Pure validator + scoped IDs + non-fatal unknown-tool warning | ✓ VERIFIED | 360 lines; exports `buildAgentDefinition`, `detectUnknownTools`, `AgentDefinitionBuildResult`; purity grep clean |
| `src/entityTypes/agentTypes.ts` | `AgentSource` union | ✓ VERIFIED | L23 `"built-in" \| "user" \| "workspace" \| "plugin"` |
| `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` | `tryReadAgentFiles` + `AGENTS_DIR` + size/count caps | ✓ VERIFIED | L466+ mirrors `tryReadCommandFiles`; CFG-04 size cap + count cap; non-fatal unknown-tool path |
| `src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` | `getAgentRegistry()` + `agentCount` wired + built-ins seeded | ✓ VERIFIED | L103/125-126/178-180/252-253 |
| `src/service/workspaceWatch/WorkspaceConfigScanner.ts` | `WorkspaceAgentDraft` + `tryReadAgentFiles` (RAW drafts, no DB) | ✓ VERIFIED | L69 type; L596 worker-side raw-draft producer; worker-no-DB grep gate green |
| `src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts` | NEW main-process converter | ✓ VERIFIED | Pure module; consumes `buildAgentDefinition`; produces `workspace:<id>:agent:*` ids |
| `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` | Trust filter widening + `replaceSource` on apply + `removeSource` | ✓ VERIFIED | L67 agentRegistry ctor param; L99-115 source-aware applySnapshot; L165 trust filter; L177 removeSource |
| `src/service/AgentRuntime.ts` | Registry-first dispatch + DB fallback | ✓ VERIFIED | L88-99 resolution swap; both lookups preserved |
| `src/service/agentTools/runSubagentTool.ts` | `agentId` description both forms + pointer to block | ✓ VERIFIED | L54-60 rewritten; old "Built-in agent ID" wording gone |
| `src/service/slashCommands/builtinSlashCommands.ts` | `built-in:command:agents` definition | ✓ VERIFIED | L77-94 new entry; clones `/status` shape |
| `src/service/slashCommands/SlashCommandDispatcher.ts` | `case "built-in:command:agents"` + `renderAgentsList` | ✓ VERIFIED | L185-199 case; L288-316 pure helpers |
| `src/service/aifetchlyConfig/availableAgentsBlock.ts` | NEW pure assembler for D-Discovery block | ✓ VERIFIED | L66 `buildAvailableAgentsBlock`; L43 `agentSourceBadgeFromId`; purity grep clean |
| `src/service/AIChatContextAssembler.ts` | Available-agents block injection + graceful degradation | ✓ VERIFIED | L15 import; L183-206 try/catch injection after AGENTS.md blocks, before durable memory; `console.error` on failure |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | `agents` i18n key in all 6 files | ✓ VERIFIED | en.ts:1943 `agents: "Agents"`; zh:1875, es:1943, fr:1926, de:1938, ja:1898 — all 6 files carry the key |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `AgentRuntime.runSync` | `agentRegistry.getById` | direct call (`getAIFetchlyConfigManager().getAgentRegistry()`) | ✓ WIRED | `AgentRuntime.ts:88-90`; tested by `AgentRuntime.test.ts` |
| `AgentRuntime.runSync` | `defModule.getActiveById` (DB fallback) | direct call | ✓ WIRED | `AgentRuntime.ts:91-93`; existing built-in DB-mock tests stay GREEN |
| `/agents` dispatcher branch | `manager.getAgentRegistry().list()` | `this.manager.getAgentRegistry()` | ✓ WIRED | `SlashCommandDispatcher.ts:192` |
| `AIChatContextAssembler` | `buildAvailableAgentsBlock` + `manager.getAgentRegistry().list()` | direct import + manager accessor | ✓ WIRED | `AIChatContextAssembler.ts:15,196-197` |
| Global loader | `buildAgentDefinition` / `detectUnknownTools` | import + call | ✓ WIRED | `AIFetchlyConfigLoader.ts:46-47,586,599` |
| Workspace converter | `buildAgentDefinition` / `detectUnknownTools` | import + call | ✓ WIRED | `buildWorkspaceAgentDefinitions.ts:24-25,76,105` |
| `applySnapshot` workspace path | `buildWorkspaceAgentDefinitions` | import + source-aware branch | ✓ WIRED | `AIFetchlyRuntimeRegistrySync.ts:31,100-110` |
| `applySnapshot` | `agentRegistry.replaceSource` | direct call | ✓ WIRED | `AIFetchlyRuntimeRegistrySync.ts:115` |
| `applyWorkspaceSnapshot` trust filter | `agents: trust.agents ? ... : []` | spread + conditional | ✓ WIRED | `AIFetchlyRuntimeRegistrySync.ts:165` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `/agents` dispatcher | `agents` (`AgentDefinitionView[]`) | `manager.getAgentRegistry().list()` | Yes — registry populated by loader + sync.replaceSource | ✓ FLOWING |
| Available-agents block | `agents` | `getAIFetchlyConfigManager().getAgentRegistry().list()` | Yes — same live registry | ✓ FLOWING |
| Global loader `snapshot.agents` | `agents` accumulator | `tryReadAgentFiles` (reads real `agents/*.md` bytes; size-cap + parse + validate per file) | Yes — tmpdir-fixture tests prove the end-to-end parse→validate→push path | ✓ FLOWING |
| `AgentRuntime.runSync` definition | `definition` | `agentRegistry.getById` then `defModule.getActiveById` | Yes — both paths produce full `AgentDefinitionView` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| AgentRuntime + runSubagentTool suite (registry-first dispatch + agentId description) | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AgentRuntime runSubagentTool` | 14/14 pass | ✓ PASS |
| AIFetchlyRuntimeRegistrySync.trust + AIChatContextAssembler.aifetchly (trust filter + D-Discovery block ordinal/empty/throw) | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AIFetchlyRuntimeRegistrySync.trust AIChatContextAssembler.aifetchly` | 17/17 pass (the `ERR_DLOPEN_FAILED` stderr is the documented pre-existing better-sqlite3 graceful-degradation noise; tests still pass) | ✓ PASS |
| Phase-16 suite (cross-plan, run by orchestrator before this verification) | 11 phase-16 test files | 157/157 pass; `npx tsc --noEmit` 0 errors | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared for this phase (Phase 16 is pure-logic + Electron-service work; verification uses vitest, not shell probes). Step 7c: N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| **AGT-01** | 16-01 | `AgentDefinitionRegistry` refactored for source-aware dynamic registration; lookup order built-in > user > trusted workspace > plugin; built-ins cannot be shadowed | ✓ SATISFIED | Truth #4 + Truth #3 (built-in unshadowable via SOURCE_RANK + rebuildNameIndex). Note: REQUIREMENTS.md traceability table still marks AGT-01 status as "Pending" — stale; implementation verified complete. Recommend updating the table to "Complete". |
| **AGT-02** | 16-01, 16-02, 16-03 | `agents/*.md` parsed (name, description, tools, maxToolCalls, maxRuntimeMs, body) + scoped IDs + runtime tool-allowlist intersection + workspace trust | ✓ SATISFIED | Truth #5 + Truth #1 (global scan) + Truth #2 (runtime intersection) + Truth #3 (workspace trust). |
| **AGT-03** | 16-03 | `run_subagent` validation + description updated to dispatch by dynamic agent ID; `/agents` lists built-in + dynamic | ✓ SATISFIED | Truth #6 (description) + Truth #2 (dispatch) + Truth #1 (/agents lists). |

No orphaned requirements — every AGT-* ID claimed by the 3 plans is mapped to verified evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | — | — | None. All 13 modified source files scanned for `TBD`/`FIXME`/`XXX`/`PLACEHOLDER`/`not yet implemented` — all CLEAN. No debt markers without follow-up reference. |

### TDD Gate Compliance

All 9 tasks (3 plans × 3 tasks) carry RED test commit → GREEN feat commit pairs in git history (verified):
- 16-01: `6ce02901`→`4aa2474f`, `74de331c`→`541c2025`
- 16-02: `97d9ebeb`→`a3ba0cda`, `ef6ed756`→`b24f8be0`, `755a9ed4`→`d84befdb`
- 16-03: `2a8a8237`→`da5483a7`, `a62bafef`→`d72e8f62`, `924e5efb`→`92d1a1b7`

### Human Verification Required

Two items, both drawn from `16-VALIDATION.md` Manual-Only table. These are full live-app/live-AI round-trips that by design cannot be automated; they are NOT `behavior_unverified` truths (every behavior-dependent truth HAS a passing behavioral test at the unit level) — they are additional end-to-end confidence checks beyond the unit-test evidence.

### 1. Live-app SC1 roundtrip

**Test:** Create `~/.aifetchly/agents/lead-researcher.md` (valid frontmatter: `name: lead-researcher`, `description: <text>`, non-empty body), open AiChatV2, run `/agents`.
**Expected:** A `user:agent:lead-researcher` row appears in `/agents` output AND in the "Available agents" system block. Editing/deleting the file removes/updates the row on the next `/reload-config` (no app restart).
**Why human:** Requires the running Electron app + the real `~/.aifetchly` filesystem outside the vitest tmpdir. The pipeline is covered end-to-end against a tmpdir fixture by `AIFetchlyConfigLoader.agents.test.ts #reads one valid agents/lead-researcher.md` + `SlashCommandDispatcher.test.ts #returns show_result for /agents`, but the live `~/.aifetchly` path is manual-only by design.

### 2. Live-AI SC2 roundtrip

**Test:** With a dynamic agent registered, prompt the model to delegate the task to it; observe the emitted `run_subagent` tool call.
**Expected:** The model copies the exact scoped id (`user:agent:<name>` or `workspace:<workspaceId>:agent:<name>`) from the "Available agents" context block into `run_subagent`. The dynamic agent runs to completion; its authored tool allowlist is intersected with the live `SkillRegistry` at dispatch (an authored tool not in the registry is blocked, consistent with the `agent-tool-invalid` warning).
**Why human:** Requires a real OpenAI round-trip with `run_subagent` exposed. `AgentRuntime.test.ts #resolves a dynamic scoped id via the registry REGISTRY-FIRST` + `AgentRuntime.ts:139-145` (`policy.filterExposedToolNames`) cover the resolution + intersection at the unit level; the live model dispatch loop is manual-only.

### Gaps Summary

No automated gaps. All 6 must-have truths are VERIFIED against the actual source code with passing behavioral tests, full TDD RED→GREEN chains in git history, 0 type errors, 157/157 phase-16 tests green, and zero debt markers. The worker-no-DB invariant (WAT-02) and the no-AI-gate-regression invariant (TRS-05 Strategy A) both hold.

The phase routes to `human_needed` solely because `16-VALIDATION.md` declares two live-app/live-AI end-to-end checks (SC1 filesystem roundtrip + SC2 AI dispatch round-trip) that by design require the running Electron app and a live OpenAI model — these are not automatable in vitest. Closing them requires a developer to run the app once with a real `~/.aifetchly/agents/*.md` file.

**Tracking note:** REQUIREMENTS.md traceability table currently shows AGT-01 status as "Pending" while AGT-02 and AGT-03 are "Complete". This is a stale tracking entry — the AGT-01 implementation is fully verified (Truth #4). Recommend updating REQUIREMENTS.md to mark AGT-01 "Complete" during the human-verification sweep. This is informational, not a gap.

---

_Verified: 2026-07-09T11:33:00Z_
_Verifier: Claude (gsd-verifier)_
