---
phase: 16-dynamic-agents
plan: 03
name: dispatch-list-context
type: execute
wave: 3
depends_on:
  - 16-02-loaders-trust-scanner
files_modified:
  - src/service/AgentRuntime.ts
  - src/service/agentTools/runSubagentTool.ts
  - src/service/slashCommands/builtinSlashCommands.ts
  - src/service/slashCommands/SlashCommandDispatcher.ts
  - src/service/aifetchlyConfig/availableAgentsBlock.ts
  - src/service/AIChatContextAssembler.ts
  - src/views/lang/en.ts
  - src/views/lang/zh.ts
  - src/views/lang/es.ts
  - src/views/lang/fr.ts
  - src/views/lang/de.ts
  - src/views/lang/ja.ts
  - test/vitest/main/service/AgentRuntime.test.ts
  - test/vitest/main/service/runSubagentTool.test.ts
  - test/vitest/main/service/SlashCommandDispatcher.test.ts
  - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts
requirements: [AGT-03, AGT-02]
autonomous: true
user_setup: []
tags: [dispatch-resolution, agents-command, context-block, i18n]

must_haves:
  truths:
    - "AgentRuntime.runSync resolves the agent definition REGISTRY-FIRST (in-memory, precedence-aware, scoped IDs) and falls back to the existing DB lookup (defModule.getActiveById) only when the registry misses — dynamic scoped IDs become dispatchable and existing built-in DB-mock tests stay green (RESEARCH Resolution-Path Decision Option a; AGT-03)."
    - "run_subagent takes the agentId VERBATIM (D-AgentIDs): a bare built-in ID (agent-lead-researcher) or a scoped dynamic ID (user:agent:<name>, workspace:<id>:agent:<name>) exactly as it appears in the 'Available agents' context block; an unknown ID returns a clear 'unknown agent' error and the dispatcher does NOT fuzzy-resolve bare names across sources (AGT-03)."
    - "The run_subagent tool's agentId parameter description describes BOTH ID forms and points to the 'Available agents' context block (D-AgentIDs) — the old 'Built-in agent ID' wording is gone (RESEARCH Pitfall 5)."
    - "/agents is a new built-in local slash command returning {action:'show_result'} with one row per agent '<id> — <name>: <description> [<source badge>]', sorted built-in → user → workspace → (plugin Phase 18); source badges reuse Phase 13 slashCommands i18n keys (D-AgentsList)."
    - "Untrusted workspace agents are absent from /agents output (they were never registered — Plan 02 trust filter); there is no 'disabled' row (D-AgentsList)."
    - "AIChatContextAssembler injects an 'Available agents' system-message block (ID + one-line description + source) sourced from agentRegistry.list(), rebuilt on AIFETCHLY_CONFIG_CHANGED; failure to assemble degrades to no-injection + console.error and NEVER breaks the chat (D-Discovery, mirrors the AGENTS.md injection pattern)."
    - "The agent run path is already AI-gated downstream (run_subagent executes inside the stream IPC's USER_AI_ENABLED gate); /agents is a non-AI local command using the existing SLASH_COMMAND_DISPATCH channel (registerValidatedHandler) — ZERO registerAiValidatedHandler added for the new surfaces (TRS-05 Strategy A)."
    - "Dynamic agent definitions flow UNCHANGED through AgentToolPolicyService.filterExposedToolNames at dispatch — their authored tool allowlist is intersected with actually-registered + permitted tools, so a dynamic agent cannot name a privileged tool into existence (AGT-02 runtime intersection)."
  artifacts:
    - "src/service/AgentRuntime.ts — line ~71 resolution swap: registry-first getById with DB fallback."
    - "src/service/agentTools/runSubagentTool.ts — updated agentId parameter description (both ID forms + pointer to context block)."
    - "src/service/slashCommands/builtinSlashCommands.ts — new built-in:command:agents definition (mirrors /status)."
    - "src/service/slashCommands/SlashCommandDispatcher.ts — new 'built-in:command:agents' case returning show_result + renderAgentsList helper."
    - "src/service/aifetchlyConfig/availableAgentsBlock.ts — NEW pure assembler: registry list → 'Available agents' system-message block."
    - "src/service/AIChatContextAssembler.ts — inject the block alongside the AGENTS.md blocks with graceful degradation."
    - "src/views/lang/{en,zh,es,fr,de,ja}.ts — any new chrome string (e.g. /agents list header) added to ALL 6 files under aifetchlyConfig/slashCommands; source badges REUSE Phase 13 keys (no new badge strings)."
    - "test/vitest/main/service/AgentRuntime.test.ts — EXTEND: registry-first resolution with DB fallback (existing built-in DB-mock tests stay green)."
    - "test/vitest/main/service/runSubagentTool.test.ts — EXTEND: updated agentId description mentions scoped IDs; unknown-ID rejection."
    - "test/vitest/main/service/SlashCommandDispatcher.test.ts — EXTEND: /agents show_result branch, sorted by precedence."
    - "test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts — EXTEND: available-agents block injection + ordinal (after AGENTS.md, before durable memory)."
  key_links:
    - "agentRegistry.getById (Plan 01) ← consumed by AgentRuntime.runSync — the dispatch resolution link (the single most breakage-prone point; RESEARCH Pitfall 1)."
    - "/agents (this plan) ← reads agentRegistry.list() (Plans 01+02 populate it) — the SC1 listing surface."
    - "Available-agents block (this plan) ← reads agentRegistry.list() — the SC2 model-discovery surface that feeds D-AgentIDs verbatim copy-paste."
    - "AgentToolPolicyService (UNCHANGED) — fed dynamic definition.allowedTools at dispatch; the authoritative tool gate."
---

<objective>
Plan 03 (Wave 3) closes the loop: makes dynamic scoped agent IDs dispatchable via run_subagent, exposes the registered agents to the user via a new /agents built-in slash command, and exposes them to the MODEL via a D-Discovery "Available agents" system-message block so the model can copy the exact scoped ID into run_subagent. The single most load-bearing change is the one-line resolution swap at AgentRuntime.runSync (~line 71) from DB-only to registry-first-with-DB-fallback — every other change reads from agentRegistry.list() (populated by Plans 01+02).

Purpose: Satisfy the three ROADMAP success criteria end-to-end. After this plan: (SC1) adding ~/.aifetchly/agents/lead-researcher.md registers user:agent:lead-researcher and /agents lists it; (SC2) run_subagent dispatches it with its tool allowlist intersected at runtime; (SC3) built-ins cannot be shadowed and workspace agents require trust (enforced by Plans 01+02; this plan surfaces the result).

Output: AgentRuntime.ts + runSubagentTool.ts + builtinSlashCommands.ts + SlashCommandDispatcher.ts + AIChatContextAssembler.ts edited, NEW availableAgentsBlock.ts, 6 lang files, four test files EXTENDED and GREEN; `yarn testmain` clean; `npx tsc --noEmit` clean.
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

# Plan 01/02 outputs this plan consumes
@.planning/phases/16-dynamic-agents/16-01-SUMMARY.md
@.planning/phases/16-dynamic-agents/16-02-SUMMARY.md

# Prior-phase surfaces this plan extends (read the SUMMARYs before editing)
@.planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-03b-SUMMARY.md
@.planning/phases/15-prompt-command-files/15-01-SUMMARY.md

# Source files being modified — read BEFORE editing
@src/service/AgentRuntime.ts
@src/service/agentTools/runSubagentTool.ts
@src/service/slashCommands/builtinSlashCommands.ts
@src/service/slashCommands/SlashCommandDispatcher.ts
@src/service/AIChatContextAssembler.ts
@src/service/AgentDefinitionRegistry.ts
@src/service/AgentToolPolicyService.ts
@src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
@src/entityTypes/agentTypes.ts
@src/views/lang/en.ts
</context>

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: Dispatch resolution swap (registry-first + DB fallback) + run_subagent description (AGT-03, D-AgentIDs)</name>
  <files>src/service/AgentRuntime.ts, src/service/agentTools/runSubagentTool.ts, test/vitest/main/service/AgentRuntime.test.ts, test/vitest/main/service/runSubagentTool.test.ts</files>
  <read_first>
    - .planning/phases/16-dynamic-agents/16-RESEARCH.md §"The Critical Resolution-Path Decision" + §Code Examples (the recommended registry-first-with-fallback block) + §Common Pitfalls Pitfall 1 (registry MUST contain built-ins) and Pitfall 5 (update the agentId description)
    - src/service/AgentRuntime.ts lines 60-80 (the current defModule.getActiveById at ~line 71 — the exact line to swap; the defModule field initializer at line 63; the fail() path)
    - src/service/agentTools/runSubagentTool.ts lines 49-161 (PARAMETERS.properties.agentId at ~52-56 — the description text to replace; execute at ~126-160 — the agentId cast and the AgentRuntimeRegistry.runSync call)
    - src/service/AgentDefinitionRegistry.ts (Plan 01 getById — precedence-aware, scoped IDs; the registry MUST contain built-ins per Pitfall 1)
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts (Plan 02 getAgentRegistry — how AgentRuntime obtains the registry singleton)
    - src/service/AgentRuntimeRegistry.ts (the singleton getRuntime — the wiring point; decide whether the registry is injected here or read from the manager)
    - test/vitest/main/service/AgentRuntime.test.ts (existing built-in DB-mock tests — these MUST stay green after the fallback is added)
    - test/vitest/main/service/runSubagentTool.test.ts (extend with updated-description assertion + unknown-ID rejection)
  </read_first>
  <behavior>
    Resolution (registry-first + DB fallback):
    - runSync with a dynamic scoped id present in the registry (e.g. user:agent:lead-researcher) → resolves via agentRegistry.getById (in-memory), proceeds; the DB module is NOT consulted for scoped dynamic IDs.
    - runSync with a bare built-in id (agent-lead-researcher) present in the registry → resolves via the registry; the DB fallback is NOT needed but remains available.
    - runSync with a bare built-in id NOT in the registry but present in the DB (legacy/test-mock path) → registry miss, then defModule.getActiveById resolves it → proceeds (existing AgentRuntime DB-mock tests stay GREEN).
    - runSync with an unknown id (neither registry nor DB) → returns the existing fail() "Unknown or disabled agent: <id>" — NO fuzzy resolution across sources (D-AgentIDs).
    run_subagent tool def:
    - The agentId parameter description mentions BOTH bare built-in IDs and scoped dynamic IDs (user:agent:*, workspace:*:agent:*) and points to the 'Available agents' context block; the old single-form 'Built-in agent ID' wording is GONE. A test asserts the description references scoped dynamic IDs.
  </behavior>
  <action>
    In `src/service/AgentRuntime.ts`, inject the AgentDefinitionRegistry into the runtime (via the AgentRuntimeRegistry singleton wiring or by reading it from AIFetchlyConfigManager.getAgentRegistry() — choose the path consistent with how defModule is obtained; do NOT add a per-run constructor param that breaks callers). Change the resolution at ~line 71 from `const definition = await this.defModule.getActiveById(request.agentId)` to registry-first: attempt `this.agentRegistry.getById(request.agentId)` (in-memory, precedence-aware, scoped-ID-aware); if null, fall back to `await this.defModule.getActiveById(request.agentId)` (DB — preserves built-in execution-metadata path + existing test mocks); if still null, return the existing fail() "Unknown or disabled agent: <id>". The rest of runSync consumes the same AgentDefinitionView shape and is unchanged (RESEARCH verified the narrow consumption interface). Ensure the registry contains built-ins at startup (Plan 01 registerBuiltIns + Plan 02 manager wiring) — if not yet wired into the runtime's registry reference, wire it here. In `src/service/agentTools/runSubagentTool.ts`, replace the PARAMETERS.properties.agentId.description with text describing BOTH ID forms (bare built-in agent-* + scoped dynamic user:agent:* / workspace:*:agent:*) and pointing to the 'Available agents' context block in the system message; drop the 'Built-in agent ID' wording; note that unknown IDs error and must not be guessed/abbreviated (D-AgentIDs, RESEARCH Pitfall 5). Do NOT add a parameter-level zod regex (RESEARCH Open Question 2 resolved NO) — dispatch-time getById returning null is the rejection mechanism. Do NOT change the execute logic beyond what the resolution swap requires. Keep the agent run AI-gated downstream (no gating change here). NEVER use any. Extend the two test files FIRST (RED), confirm failure, implement (GREEN). Ensure existing built-in DB-mock tests still pass via the fallback.
  </action>
  <verify>
    <automated>AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AgentRuntime runSubagentTool</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "Built-in agent ID to run" src/service/agentTools/runSubagentTool.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "agentRegistry.getById|this.agentRegistry" src/service/AgentRuntime.ts` returns a match (registry-first lookup present).
    - `grep -E "defModule.getActiveById" src/service/AgentRuntime.ts` STILL returns a match (DB fallback preserved).
    - The old description literal is GONE — `grep -c "Built-in agent ID to run" src/service/agentTools/runSubagentTool.ts` returns 0.
    - A passing test asserts the agentId description references scoped dynamic IDs.
    - A passing test asserts a dynamic scoped id resolves via the registry and an unknown id returns the fail() error.
    - Existing built-in AgentRuntime DB-mock tests remain GREEN (no regression).
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>run_subagent dispatches dynamic scoped IDs via registry-first resolution with DB fallback for built-ins; agentId description covers both ID forms; unknown IDs rejected without fuzzy resolution; existing tests stay green; tsc clean.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: /agents built-in command + dispatcher show_result branch (AGT-03, D-AgentsList)</name>
  <files>src/service/slashCommands/builtinSlashCommands.ts, src/service/slashCommands/SlashCommandDispatcher.ts, src/views/lang/en.ts, src/views/lang/zh.ts, src/views/lang/es.ts, src/views/lang/fr.ts, src/views/lang/de.ts, src/views/lang/ja.ts, test/vitest/main/service/SlashCommandDispatcher.test.ts</files>
  <read_first>
    - .planning/phases/16-dynamic-agents/16-CONTEXT.md (D-AgentsList: row format, sort order, source-badge i18n reuse, untrusted-absent)
    - .planning/phases/16-dynamic-agents/16-PATTERNS.md §"SlashCommandDispatcher.ts" + §"builtinSlashCommands.ts" — the /status template to clone
    - src/service/slashCommands/builtinSlashCommands.ts lines 27-76 (the /status definition — clone for /agents)
    - src/service/slashCommands/SlashCommandDispatcher.ts lines 152-202 (dispatchLocal + the built-in:command:status show_result branch at ~174-182 — clone the shape for built-in:command:agents)
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts (Plan 02 getAgentRegistry — the dispatcher calls this.manager.getAgentRegistry().list())
    - src/views/lang/en.ts (existing slashCommands/aifetchlyConfig groups — source-badge keys to reuse; add any new chrome string here + mirror to the other 5 lang files)
    - test/vitest/main/service/SlashCommandDispatcher.test.ts (extend with the /agents branch test)
  </read_first>
  <behavior>
    /agents command:
    - Dispatching "built-in:command:agents" returns {status:true, action:"show_result", commandId:"built-in:command:agents", content:<rendered string>}.
    - renderAgentsList sorts built-in → user → workspace (→ plugin Phase 18, empty now) and formats each row as "<id> — <name>: <description> [<source badge>]".
    - With one built-in + one user agent in the registry, content shows the built-in row FIRST, then the user row; source badges come from the reused Phase 13 slashCommands i18n keys (no new badge strings).
    - An empty registry yields an empty/non-crashing result (no throw).
    - Untrusted workspace agents do NOT appear (never registered — Plan 02); there is no "disabled" row.
    - /agents is non-AI-gated: it dispatches via the existing SLASH_COMMAND_DISPATCH channel (registerValidatedHandler) — NO registerAiValidatedHandler is added (TRS-05 Strategy A).
    i18n:
    - Any new chrome string (e.g. a /agents list header) is added to ALL 6 lang files (en, zh, es, fr, de, ja) under aifetchlyConfig/slashCommands.
  </behavior>
  <action>
    In `src/service/slashCommands/builtinSlashCommands.ts`, append a new entry to BUILT_IN_COMMANDS with id "built-in:command:agents", name "agents", type "local", source "built-in", sourceId "built-in", sourceLabel "Built-in", requiresTrust false, enabled true, aliases [], and a description like "List available AiFetchly agents (built-in and dynamic)." — clone the /status entry's shape verbatim. In `src/service/slashCommands/SlashCommandDispatcher.ts`, add a `case "built-in:command:agents":` branch in dispatchLocal (mirrors the /status branch at ~174-182) that calls this.manager.getAgentRegistry().list(), passes it to a new pure helper `renderAgentsList(agents)` (define inline or in the dispatcher file), and returns {status:true, action:"show_result", commandId, content: rendered}. renderAgentsList sorts by the D-Precedence rank (built-in → user → workspace → plugin) and formats each row "<id> — <name>: <description> [<source badge>]"; source badges reuse the existing Phase 13 slashCommands i18n keys (look up the badge label by source via the same keys /status or the config-status surface uses — NO new badge strings). Do NOT read agent file bytes in the dispatcher — content is a computed string only (TRS-07). Add any new chrome string (only if a header is needed — D-AgentsList allows reusing badges without a header) to ALL 6 lang files under the aifetchlyConfig or slashCommands group, keyed identically across files, with accurate translations. Do NOT add an AI-gating wrapper (the command is non-AI). Extend SlashCommandDispatcher.test.ts with the /agents branch: show_result shape, precedence sort, source badge presence, empty-registry safety. NEVER use any. Write/extend tests FIRST (RED), confirm failure, implement (GREEN).
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs SlashCommandDispatcher</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "registerAiValidatedHandler" src/service/slashCommands/SlashCommandDispatcher.ts src/service/slashCommands/builtinSlashCommands.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "built-in:command:agents" src/service/slashCommands/builtinSlashCommands.ts src/service/slashCommands/SlashCommandDispatcher.ts` returns matches in BOTH files.
    - A passing test asserts /agents returns action show_result and the rendered content lists agents sorted built-in → user → workspace.
    - A passing test asserts an empty registry does not crash the dispatcher.
    - Any new i18n key added to en.ts is present in ALL 6 lang files — verify with a grep across the lang dir for the new key.
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>/agents lists built-in + dynamic agents sorted by D-Precedence with source badges; non-AI-gated (registerValidatedHandler only); any new chrome string in all 6 lang files; dispatcher test GREEN; tsc clean.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 3: "Available agents" context block injection (D-Discovery, AGT-02 model discovery)</name>
  <files>src/service/aifetchlyConfig/availableAgentsBlock.ts, src/service/AIChatContextAssembler.ts, test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts</files>
  <read_first>
    - .planning/phases/16-dynamic-agents/16-CONTEXT.md (D-Discovery: inject via AIChatContextAssembler alongside AGENTS.md; block = ID + one-line description + source; rebuilt on AIFETCHLY_CONFIG_CHANGED; run_subagent description stays generic)
    - .planning/phases/16-dynamic-agents/16-PATTERNS.md §"AIChatContextAssembler.ts (MODIFY)" + §"availableAgentsBlock.ts (NEW)" — the AGENTS.md injection try/catch template (lines 163-179) + the pure assembler recommendation
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md (the AIFetchlyContextStore / context-loader / cache-on-AIFETCHLY_CONFIG_CHANGED pattern to reuse)
    - src/service/AIChatContextAssembler.ts lines 163-179 (the AGENTS.md injection try/catch — inject the new block immediately AFTER it, before durable memory; graceful degradation via console.error)
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts (Plan 02 getAgentRegistry — the assembler reads agentRegistry.list(); cache + invalidate on AIFETCHLY_CONFIG_CHANGED)
    - test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts (extend with available-agents block injection + ordinal test)
  </read_first>
  <behavior>
    Context block:
    - With one built-in + one user agent in the registry, assemble() pushes a single system message whose content is the "Available agents" block listing both (ID + one-line description + source), positioned AFTER the AGENTS.md/instruction blocks and BEFORE durable memory (CTX-01 ordinal).
    - With zero agents in the registry, NO block is pushed (skip empty).
    - If assembling the block throws, the chat does NOT break — the catch logs to console.error and continues (graceful degradation, mirrors the AGENTS.md injection).
    - The block is rebuilt when the registry mutates (AIFETCHLY_CONFIG_CHANGED) — a subsequent assemble() reflects add/rename/delete without an app restart.
    - The run_subagent tool description is NOT dynamically rewritten here (it stays generic per D-Discovery) — discovery is via the block only.
  </behavior>
  <action>
    Create `src/service/aifetchlyConfig/availableAgentsBlock.ts` exporting a PURE function `buildAvailableAgentsBlock(agents: readonly AgentDefinitionView[]): string` that formats a header line followed by one row per agent "<id> — <description> [<source>]" (mirror the slash-suggestions metadata shape so the model can copy the exact ID into run_subagent — ties to D-AgentIDs). Empty input returns an empty string (the caller decides whether to push). No fs/Electron/TypeORM imports — pure leaf. In `src/service/AIChatContextAssembler.ts`, immediately AFTER the existing AGENTS.md/instruction injection try/catch (lines ~163-179) and BEFORE durable memory, add a new try/catch that reads this.manager.getAgentRegistry().list() (or the singleton accessor the assembler already uses for manager state), calls buildAvailableAgentsBlock, and — if non-empty — pushes a {role:"system", content:<block>} message; on catch, console.error a "[ai-chat-context] available agents injection failed:" line and continue (NEVER break the chat — mirrors the AGENTS.md graceful-degradation shape). Cache the block in-memory and invalidate/rebuild on AIFETCHLY_CONFIG_CHANGED (mirror the Phase 13-03a instruction-cache pattern). Do NOT modify the run_subagent tool description dynamically (D-Discovery keeps it generic). Extend AIChatContextAssembler.aifetchly.test.ts with: (a) block injected with the right ordinal (after instructions, before durable memory); (b) empty registry → no block; (c) throw in block assembly → chat continues, error logged. NEVER use any. Write/extend tests FIRST (RED), confirm failure, implement (GREEN).
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AIChatContextAssembler.aifetchly</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "from ['\"]fs['\"]|from ['\"]electron['\"]|typeorm" src/service/aifetchlyConfig/availableAgentsBlock.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "export function buildAvailableAgentsBlock|export const buildAvailableAgentsBlock" src/service/aifetchlyConfig/availableAgentsBlock.ts` returns a match.
    - `grep -E "available agents injection failed|buildAvailableAgentsBlock" src/service/AIChatContextAssembler.ts` returns matches (block injected + graceful-degradation error path present).
    - A passing test asserts the block is injected after the instruction blocks and before durable memory (ordinal).
    - A passing test asserts an empty registry produces NO block and a throw in assembly does not break assemble().
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>The model discovers agents via a graceful-degradation "Available agents" system block (ID + description + source), rebuilt on registry mutation, ordered after instructions/before durable memory; run_subagent description stays generic; assembler tests GREEN; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| run_subagent → registry/DB | Untrusted agentId input crosses here; resolution must reject unknown IDs without fuzzy matching. |
| Author agent body → inner agent loop | Agent systemPrompt is author DATA injected into the INNER agent loop (not the outer chat); the outer-chat system prompt is unaffected. |
| Registry → renderer (via /agents) | /agents returns a computed string only — no agent file bytes cross to the renderer (TRS-07). |

## STRIDE Threat Register (ASVS L1, block-on-high)

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-16-03-EL | Elevation | run_subagent dispatch resolution | high | mitigate | Registry-first getById is precedence-aware and scoped-ID-aware; unknown IDs return the existing fail() error with NO fuzzy resolution (D-AgentIDs). Dynamic agents flow UNCHANGED through AgentToolPolicyService.filterExposedToolNames — authored allowedTools intersected with registered+permitted tools, so a dynamic agent cannot name a privileged tool into existence (AGT-02 runtime intersection). |
| T-16-03-SP | Spoofing | Agent systemPrompt body (prompt injection) | high | mitigate | Agent system prompts are author DATA injected into the inner agent loop only; AgentRuntime already enforces its own policy (denylist V1_BLOCKED_PATTERNS + allowlist intersection via AgentToolPolicyService). The outer-chat system prompt is NOT modified by dynamic agents. Verified by: existing AgentToolPolicyService tests stay green + the new dispatch tests route dynamic definitions through the same policy path. |
| T-16-03-ID | Information disclosure | /agents command output | medium | mitigate | /agents returns a computed show_result.content string only — no raw agent file bytes cross to the renderer (TRS-07). Only registered agents (built-in + user + trusted-workspace) appear; untrusted workspace agents are absent. |
| T-16-03-CT | Tampering | Available-agents context block | low | mitigate | Block assembly is wrapped in try/catch with console.error graceful degradation — a failure NEVER breaks the AI chat (mirrors the AGENTS.md injection pattern). The block is read-only system-message content; it cannot mutate state. |
| T-16-03-SC | Tampering | npm/pip/cargo installs | low | accept | Phase 16 installs ZERO packages — no supply-surface. |
</threat_model>

## Artifacts this phase produces (Plan 03)

- `AgentRuntime.runSync` — registry-first getById with DB fallback (the ONE core wiring change; RESEARCH Resolution-Path Decision Option a).
- `run_subagent` updated `agentId` parameter description — both ID forms + pointer to the Available agents block (D-AgentIDs).
- `/agents` built-in local command (built-in:command:agents) + `renderAgentsList` helper — show_result sorted by D-Precedence with source badges.
- `buildAvailableAgentsBlock` pure assembler (availableAgentsBlock.ts) + AIChatContextAssembler injection — D-Discovery model-discovery surface.
- New chrome i18n keys (if any) across all 6 lang files.

<verification>
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AgentRuntime runSubagentTool SlashCommandDispatcher AIChatContextAssembler.aifetchly` → all GREEN.
- `npx tsc --noEmit` → 0 errors.
- `yarn testmain` → no regressions across the full main-process suite.
- End-to-end sanity: a dynamic scoped id resolves via run_subagent; /agents lists it; the Available agents block contains it.
- Manual live-app checks (per 16-VALIDATION.md Manual-Only): create ~/.aifetchly/agents/lead-researcher.md, open AiChatV2, /agents shows user:agent:lead-researcher; prompt the model to use it and confirm run_subagent fires with the exact scoped id.
</verification>

<success_criteria>
- AGT-03 (run_subagent dispatch by dynamic ID + /agents lists built-in + dynamic) delivered end-to-end.
- SC1 (add ~/.aifetchly/agents/lead-researcher.md → /agents lists user:agent:lead-researcher), SC2 (run_subagent dispatches it with runtime tool-allowlist intersection), SC3 (built-ins unshadowable + workspace trust) all satisfied across Plans 01+02+03.
- No AI-gating regression (zero registerAiValidatedHandler on the new surfaces); no DB-schema change; worker stays scan-only; tsc + full suite clean.
</success_criteria>

<output>
Create `.planning/phases/16-dynamic-agents/16-03-SUMMARY.md` when done.
</output>
