---
phase: 16-dynamic-agents
plan: 02
name: loaders-trust-scanner
type: execute
wave: 2
depends_on:
  - 16-01-registry-validator-frontmatter
files_modified:
  - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
  - src/service/workspaceWatch/WorkspaceConfigScanner.ts
  - src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts
  - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
  - test/vitest/main/service/AIFetchlyConfigLoader.agents.test.ts
  - test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts
  - test/vitest/main/service/workspaceWatch/buildWorkspaceAgentDefinitions.test.ts
  - test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts
  - test/vitest/main/service/WorkerNoDbBoundary.test.ts
requirements: [AGT-02]
autonomous: true
user_setup: []
tags: [agent-loaders, trust-filter, workspace-scanner, worker-no-db]

must_haves:
  truths:
    - "The global config loader reads ~/.aifetchly/agents/*.md on every scan, parses each with the restricted frontmatter parser (CFG-07), validates via buildAgentDefinition (Plan 01), and fills snapshot.agents with the resulting AgentDefinitionView[] (source 'user', sourceId 'user') — invalid files produce diagnostics and are skipped (AGT-02 global)."
    - "AIFetchlyConfigManager owns the AgentDefinitionRegistry (instantiated alongside the existing CommandRegistry), registers built-ins at startup, and exposes it via getAgentRegistry(); the status result's agentCount is wired to agentRegistry.list().length (no longer hardcoded 0)."
    - "WorkspaceConfigScanner.tryReadAgentFiles runs in the WORKER and produces RAW WorkspaceAgentDraft objects (frontmatter bytes + body + contentHash) ONLY — NO validation, NO registry mutation, NO DB/Electron/Module imports (CLAUDE.md worker-no-DB, WAT-02 grep gate stays GREEN)."
    - "Workspace agent drafts are converted to validated AgentDefinitionView[] in the MAIN process via buildWorkspaceAgentDefinitions (which calls buildAgentDefinition from Plan 01) BEFORE any registry mutation — scoped IDs take the form workspace:<workspaceId>:agent:<name> (AGT-02 workspace)."
    - "applyWorkspaceSnapshot drops workspace agents when trust.agents is false and routes them through to the registry when trust.agents is true — untrusted workspace agents NEVER reach replaceSource (TRS-01, AGT-02)."
    - "On every workspace rescan, agentRegistry.replaceSource('workspace:' + workspaceId, entries) atomically reconciles add/change/delete/rename — no stale agent entries survive a rescan (mirrors the command source-replacement contract)."
    - "Agent files are size-capped at AIFETCHLY_CONFIG_LIMITS.agentMdBytes (128 * 1024 per CFG-04) and per-source count-capped at maxAgentsPerSource (100) — oversized/over-count files produce a diagnostic and are skipped."
  artifacts:
    - "src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts — gains private tryReadAgentFiles mirroring tryReadCommandFiles; agents accumulator threaded into scanGlobalRoot and returned in snapshot.agents."
    - "src/service/aifetchlyConfig/AIFetchlyConfigManager.ts — owns AgentDefinitionRegistry + getAgentRegistry(); agentCount wired; registerBuiltIns() called at startup."
    - "src/service/workspaceWatch/WorkspaceConfigScanner.ts — gains private tryReadAgentFiles (worker-side, raw drafts) + WorkspaceAgentDraft type; populates snapshot.agents instead of hardcoding empty."
    - "src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts — NEW main-process converter: WorkspaceAgentDraft[] → validated AgentDefinitionView[] + diagnostics via buildAgentDefinition."
    - "src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts — constructor widened to accept AgentDefinitionRegistry; applyWorkspaceSnapshot filter adds the agents key; applySnapshot calls agentRegistry.replaceSource."
    - "test/vitest/main/service/AIFetchlyConfigLoader.agents.test.ts — NEW (mirrors AIFetchlyConfigLoader.commands.test.ts)."
    - "test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts — EXTEND with agent scan cases mirroring command cases."
    - "test/vitest/main/service/workspaceWatch/buildWorkspaceAgentDefinitions.test.ts — NEW (mirrors buildWorkspaceCommandDefinitions.test.ts)."
    - "test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts — EXTEND with agents:true/agents:false cases a–d (TRS-01)."
    - "test/vitest/main/service/WorkerNoDbBoundary.test.ts — EXTEND/re-run: worker-no-DB grep gate stays GREEN after tryReadAgentFiles addition."
  key_links:
    - "buildAgentDefinition (Plan 01) ← consumed by BOTH tryReadAgentFiles (global, main) and buildWorkspaceAgentDefinitions (workspace, main) — single schema owner."
    - "WorkspaceConfigScanner.tryReadAgentFiles (worker) → snapshot.agents → buildWorkspaceAgentDefinitions (main) → applyWorkspaceSnapshot trust filter → agentRegistry.replaceSource — the workspace pipeline."
    - "AIFetchlyConfigManager.getAgentRegistry() → consumed by Plan 03 (dispatch resolution + /agents command + context block)."
    - "AgentToolPolicyService (UNCHANGED) — dynamic definitions flow through it at dispatch; this plan does not touch it (verified-only in Plan 03)."
---

<objective>
Plan 02 (Wave 2) attaches the two file sources — global (`~/.aifetchly/agents/*.md`) and workspace (`<workspace>/.aifetchly/agents/*.md`) — to the pure-logic core from Plan 01, and widens the Phase-14 trust filter so untrusted workspace agents are dropped before registry mutation. The global loader and the manager-owned registry are main-process pure-logic + file I/O; the workspace scanner stays in the worker and produces RAW drafts (worker-no-DB invariant preserved); draft→definition conversion + trust filtering + registry mutation happen in the main process.

Purpose: Make a real `agents/*.md` file produce a registered, precedence-aware, dispatchable agent definition — for both the user-global and trusted-workspace sources — while keeping the worker scan-only. After this plan, `agentRegistry.list()` returns built-in + user + trusted-workspace agents; Plan 03 wires the dispatch path + `/agents` command + model-discovery context block.

Output: AIFetchlyConfigLoader + AIFetchlyConfigManager + WorkspaceConfigScanner + AIFetchlyRuntimeRegistrySync edited, NEW buildWorkspaceAgentDefinitions.ts, five test files (two NEW, three EXTENDED) GREEN; `yarn testmain` clean; `npx tsc --noEmit` clean; WorkerNoDbBoundary grep gate GREEN.
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

# Plan 01 outputs this plan consumes
@.planning/phases/16-dynamic-agents/16-01-SUMMARY.md

# Prior-phase surfaces this plan extends (read the SUMMARYs before editing)
@.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md
@.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md
@.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md
@.planning/phases/15-prompt-command-files/15-02-SUMMARY.md

# Source files being modified — read BEFORE editing
@src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
@src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
@src/service/workspaceWatch/WorkspaceConfigScanner.ts
@src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
@src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
@src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts
@src/service/slashCommands/agentFrontmatter.ts
@src/service/AgentDefinitionRegistry.ts
@src/entityTypes/aifetchlyConfigTypes.ts
@src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts
</context>

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: Global agent loader + manager-owned registry (AGT-02 user source)</name>
  <files>src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts, src/service/aifetchlyConfig/AIFetchlyConfigManager.ts, test/vitest/main/service/AIFetchlyConfigLoader.agents.test.ts</files>
  <read_first>
    - src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts (the template — clone tryReadCommandFiles at lines 270-408 for the new tryReadAgentFiles; note scanGlobalRoot threading)
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts (the owner — see getCommandRegistry at ~line 225 and the hardcoded agentCount at ~line 162; this plan adds a sibling agentRegistry + getAgentRegistry)
    - src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts (AIFETCHLY_CONFIG_LIMITS.agentMdBytes, maxAgentsPerSource, COMMAND_NAME_REGEX, AGENTS_DIR/COMMANDS_DIR — verify AGENTS_DIR exists, define if absent mirroring COMMANDS_DIR)
    - src/service/slashCommands/agentFrontmatter.ts (Plan 01 buildAgentDefinition + detectUnknownTools — this loader calls them; the loader owns emitting detectUnknownTools diagnostics since the validator stays pure)
    - src/service/AgentDefinitionRegistry.ts (Plan 01 class — getAgentRegistry returns this; registerBuiltIns called at startup)
    - test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts (the test template — clone for agents)
    - src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts (parseRestrictedFrontmatter output — scalars/arrays/body; the loader converts these to the draft shape buildAgentDefinition expects)
    - src/entityTypes/aifetchlyConfigTypes.ts lines 96-110 (snapshot.agents slot + agentsChanged — already exist; the loader fills them)
  </read_first>
  <behavior>
    Global scan (~/.aifetchly/agents/*.md):
    - A tmpdir-backed test with <root>/agents/lead-researcher.md (valid frontmatter: name lead-researcher, description, body) → scanGlobalRoot returns snapshot.agents with ONE AgentDefinitionView whose id is user:agent:lead-researcher and source is user.
    - Two valid agent files → snapshot.agents has two entries, both scoped user:agent:<name>.
    - An agent file whose frontmatter is invalid (bad name pattern) → excluded from snapshot.agents AND a diagnostic produced (agent-name-invalid or frontmatter-invalid).
    - An agent file exceeding agentMdBytes (128 * 1024) → excluded + diagnostic (CFG-04); not validated.
    - More than maxAgentsPerSource agent files → only the cap is loaded; remainder produce diagnostics (mirror the commands cap behavior).
    - An agent file listing a tool not in the registered set → the agent IS still in snapshot.agents (non-fatal) AND an agent-tool-invalid diagnostic is emitted via detectUnknownTools (D-ToolDiagnostic).
    - Missing agents dir (ENOENT) → snapshot.agents is empty, NO diagnostic (happy path — mirrors commands).
    Manager ownership:
    - new AIFetchlyConfigManager() exposes getAgentRegistry() returning an AgentDefinitionRegistry whose built-ins are registered (listBuiltIns non-empty); agentCount in getStatus() reflects the registry size (not hardcoded 0).
  </behavior>
  <action>
    In `AIFetchlyConfigLoader.ts`, add a private `tryReadAgentFiles(files, agents, diagnostics)` mirroring `tryReadCommandFiles` (lines ~270-408): source "user", sourceId "user", agentsDir = path.join(rootPath, AGENTS_DIR) (define AGENTS_DIR constant alongside COMMANDS_DIR if missing). Per file: path-safety via resolveConfigRelativePath (CFG-05); count cap maxAgentsPerSource; size cap agentMdBytes (CFG-04); parseRestrictedFrontmatter; build the draft record (scalars + arrays merged) and call buildAgentDefinition(draft, sourceMeta, relativePath) from Plan 01; on ok push definition into the agents accumulator and call detectUnknownTools(definition, registeredToolNames) pushing each returned diagnostic; on not-ok push result.diagnostic. Obtain registeredToolNames from SkillRegistry.getAllToolFunctions() (or the existing helper the command path uses for tool-name awareness) at the call site — if no ergonomic source exists, pass the current tool-name set via a parameter so the loader can be unit-tested with a stub set. ENOENT on the agents dir is a happy path (empty agents, no diagnostic). Thread the agents accumulator through scanGlobalRoot and return it in snapshot.agents (the snapshot type already carries readonly agents: unknown[] at aifetchlyConfigTypes.ts:99 — populate instead of hardcoding empty). In `AIFetchlyConfigManager.ts`, add a private agentRegistry field instantiated alongside the existing command registry, call agentRegistry.registerBuiltIns() during initialize() (before/alongside ensureBuiltIns so the DB seed still works), expose getAgentRegistry(), and wire getStatus()'s agentCount to this.agentRegistry.list().length. Keep all DB logic in Model/Module layers (CLAUDE.md three-layer) — no DB calls in the loader. NEVER use any. Write the test file FIRST (RED), confirm failure, implement (GREEN).
  </action>
  <verify>
    <automated>AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AIFetchlyConfigLoader.agents</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "getRepository|new AgentDefinitionModule|from ['\"]electron['\"]" src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "tryReadAgentFiles" src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` returns at least one match.
    - `grep -E "getAgentRegistry" src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` returns a match.
    - A passing test asserts a valid global agent file produces a definition whose id matches the pattern user-colon-agent-colon-name.
    - A passing test asserts an oversized agent file (above the CFG-04 cap) is excluded with a diagnostic.
    - A passing test asserts an agent file referencing an unknown tool is STILL registered AND produces an agent-tool-invalid diagnostic (D-ToolDiagnostic non-fatal).
    - getStatus().agentCount is no longer hardcoded 0 — a passing test or grep confirms it reads from the registry.
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>Global ~/.aifetchly/agents/*.md files scan into snapshot.agents as validated user:agent:* definitions with diagnostics for invalid/oversized/unknown-tool cases; manager owns the registry and exposes it; agentCount wired; test GREEN; tsc clean.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: Workspace scanner raw drafts + worker-no-DB gate (AGT-02 workspace source, WAT-02)</name>
  <files>src/service/workspaceWatch/WorkspaceConfigScanner.ts, test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts, test/vitest/main/service/WorkerNoDbBoundary.test.ts</files>
  <read_first>
    - src/service/workspaceWatch/WorkspaceConfigScanner.ts (the template — clone tryReadCommandFiles at lines ~410-521 for tryReadAgentFiles; note the WorkspaceCommandDraft shape at ~506-515 and the snapshot.agents slot at ~166)
    - .planning/phases/16-dynamic-agents/16-PATTERNS.md §"WorkspaceConfigScanner.ts (MODIFY)" — the WorkspaceAgentDraft shape + worker-no-DB guard
    - .planning/phases/16-dynamic-agents/16-RESEARCH.md §Common Pitfalls Pitfall 6 + §Project Constraints (worker-no-DB)
    - src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts (parseRestrictedFrontmatter — the ONLY parser the worker calls; already pure)
    - src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts (the main-process converter pattern — Task 3 builds the agent analog)
    - test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts (the scanner test — extend with agent cases mirroring command cases)
    - test/vitest/main/service/WorkerNoDbBoundary.test.ts (the WAT-02 grep gate — extend/re-run so the new worker code stays clean)
    - src/entityTypes/aifetchlyConfigTypes.ts (snapshot.agents readonly unknown[] — populate instead of empty)
  </read_first>
  <behavior>
    Workspace scan (worker-side, RAW drafts only):
    - A trusted-or-any workspace with <ws>/.aifetchly/agents/foo.md (valid frontmatter + body) → snapshot.agents contains ONE WorkspaceAgentDraft carrying frontmatter (scalars+arrays), body, relativePath, contentHash, sourceId "workspace:<id>"; NO validation has run (the draft may even carry an invalid name — validation is main-process).
    - Two agent files → two drafts.
    - Oversized agent file (above agentMdBytes) → excluded from drafts + an ioDiagnostic (size cap, CFG-04).
    - Over-count (above maxAgentsPerSource) → only the cap loaded + diagnostics.
    - Missing agents dir → snapshot.agents empty, no diagnostic.
    Worker-no-DB (WAT-02):
    - The WorkerNoDbBoundary grep gate stays GREEN after adding tryReadAgentFiles — the scanner file imports ONLY pure helpers (parseRestrictedFrontmatter, resolveConfigRelativePath, constants, diagnostic/ioDiagnostic); it does NOT import any Module/Model/registry/Electron symbol.
  </behavior>
  <action>
    In `WorkspaceConfigScanner.ts`, add a `WorkspaceAgentDraft` type mirroring `WorkspaceCommandDraft` (frontmatter: Record<string, string | readonly string[]>, body: string, relativePath: string, contentHash: string, source: "workspace", sourceId: string) and a private `tryReadAgentFiles(entries, agents, diagnostics)` mirroring `tryReadCommandFiles` (lines ~410-521). Per file: path-safety via resolveConfigRelativePath (CFG-05); count cap maxAgentsPerSource; size cap agentMdBytes (CFG-04); parseRestrictedFrontmatter; push a RAW draft (frontmatter scalars+arrays merged, body, relativePath, contentHash) into the agents accumulator — DO NOT call buildAgentDefinition here (worker produces drafts only; main-process validation is Task 3). Populate snapshot.agents (currently hardcoded empty at ~line 166). CRITICAL worker-no-DB guard: import ONLY parseRestrictedFrontmatter, resolveConfigRelativePath, AIFETCHLY_CONFIG_LIMITS, and the diagnostic/ioDiagnostic helpers — do NOT import @/modules, @/model, @/service/AgentDefinitionRegistry, @/service/slashCommands/agentFrontmatter, or anything Electron/TypeORM (CLAUDE.md worker-no-DB; WAT-02 grep gate). Thread an agents accumulator through scanAifetchlyRoot. Extend WorkspaceConfigScanner.test.ts with agent cases mirroring the command cases (valid draft, oversized→diagnostic, count cap, missing dir). Extend/re-run WorkerNoDbBoundary.test.ts so the grep gate covers the scanner file after the change (add the scanner file to the gate's scanned paths if not already, and assert the forbidden import patterns are absent). NEVER use any. Write/extend tests FIRST (RED), confirm failure, implement (GREEN).
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs WorkspaceConfigScanner WorkerNoDbBoundary</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "from ['\"]@/modules|from ['\"]@/model|getRepository|from ['\"]electron['\"]|typeorm" src/service/workspaceWatch/WorkspaceConfigScanner.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "WorkspaceAgentDraft|tryReadAgentFiles" src/service/workspaceWatch/WorkspaceConfigScanner.ts` returns matches.
    - A passing test asserts a workspace agent file produces a RAW draft (frontmatter + body + hash) in snapshot.agents — NOT a validated AgentDefinitionView (validation is Task 3).
    - A passing test asserts an oversized workspace agent file is excluded with a diagnostic.
    - The WorkerNoDbBoundary test passes (grep gate GREEN) — the scanner imports no Module/Model/registry/Electron/TypeORM symbols.
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>WorkspaceConfigScanner.tryReadAgentFiles produces raw WorkspaceAgentDrafts in the worker (no validation, no registry, no DB); WorkerNoDbBoundary grep gate GREEN; scanner tests extended and passing; tsc clean.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 3: Workspace draft→definition converter + trust filter wiring (AGT-02, TRS-01)</name>
  <files>src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts, src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts, test/vitest/main/service/workspaceWatch/buildWorkspaceAgentDefinitions.test.ts, test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts</files>
  <read_first>
    - src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts (the template — clone for buildWorkspaceAgentDefinitions; it converts WorkspaceCommandDraft → SlashCommandDefinition via buildPromptCommandDefinition)
    - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts (the apply choke point — applyWorkspaceSnapshot at ~103-116 currently filters instructions + commands ONLY; this plan adds the agents key; the constructor must accept AgentDefinitionRegistry; applySnapshot must call agentRegistry.replaceSource)
    - .planning/phases/16-dynamic-agents/16-PATTERNS.md §"AIFetchlyRuntimeRegistrySync.ts (MODIFY)" — the one-line filter widening + constructor widening + applySnapshot replaceSource addition
    - src/service/slashCommands/agentFrontmatter.ts (Plan 01 buildAgentDefinition + detectUnknownTools — the converter calls them)
    - src/service/AgentDefinitionRegistry.ts (Plan 01 replaceSource — applySnapshot calls it with the validated workspace agents)
    - src/entityTypes/aifetchlyConfigTypes.ts lines 96-144 (snapshot.agents, agentsChanged, AIFetchlySourceTrust.agents — all already exist)
    - test/vitest/main/service/workspaceWatch/buildWorkspaceCommandDefinitions.test.ts (the converter test template)
    - test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts (the trust test — extend with agents true/false cases mirroring commands cases a–d)
  </read_first>
  <behavior>
    Draft→definition conversion (main process):
    - buildWorkspaceAgentDefinitions(drafts, workspaceId, registeredToolNames) converts each WorkspaceAgentDraft into a validated AgentDefinitionView via buildAgentDefinition with sourceMeta {source:"workspace", sourceId:"workspace:<workspaceId>", sourceLabel:"Workspace", requiresTrust:true}; returns {definitions, diagnostics}. A draft with an invalid name → excluded from definitions + an agent-name-invalid diagnostic. A draft with an unknown tool → STILL included + an agent-tool-invalid diagnostic (non-fatal, D-ToolDiagnostic). The produced ids are workspace:<workspaceId>:agent:<name>.
    Trust filter (applyWorkspaceSnapshot):
    - Snapshot with agents + trust.agents true → the filtered snapshot carries the agents through to applySnapshot, which calls agentRegistry.replaceSource(snapshot.sourceId, <validated agents>) — agents appear in the registry.
    - Snapshot with agents + trust.agents false → filtered snapshot has agents: []; replaceSource runs with an empty array — NO workspace agents in the registry (TRS-01). The other capabilities (instructions, commands) are unaffected.
    - applySnapshot result.agentsChanged is true when the registry contents changed and false when replaceSource was a no-op.
  </behavior>
  <action>
    Create `src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts` mirroring `buildWorkspaceCommandDefinitions.ts`: export `buildWorkspaceAgentDefinitions(drafts, workspaceId, registeredToolNames)` returning `{definitions: AgentDefinitionView[], diagnostics: AIFetchlyConfigDiagnostic[]}`. For each WorkspaceAgentDraft, call buildAgentDefinition(draft.frontmatter, sourceMeta, draft.relativePath) with sourceMeta {source:"workspace", sourceId: "workspace:" + workspaceId, sourceLabel:"Workspace", requiresTrust:true}; on ok push definition and emit detectUnknownTools diagnostics; on not-ok push the diagnostic. Pure module (no fs/Electron/TypeORM). In `AIFetchlyRuntimeRegistrySync.ts`: widen the constructor to accept an AgentDefinitionRegistry alongside the existing CommandRegistry; add the `agents: trust.agents ? snapshot.agents : []` line to the applyWorkspaceSnapshot filter object (PATTERNS Pattern 4 — one line, atomic, BEFORE applySnapshot mutates anything); in applySnapshot, convert snapshot.agents via buildWorkspaceAgentDefinitions when the source is workspace (cast through unknown to readonly WorkspaceAgentDraft[] mirroring how commands are cast) OR — if the global loader already produced validated AgentDefinitionView[] in snapshot.agents — cast directly to readonly AgentDefinitionView[] and call this.agentRegistry.replaceSource(snapshot.sourceId, agents). Decide the cast at the snapshot boundary by what Task 1 puts in snapshot.agents for the global path (validated views) vs what Task 2 puts for workspace (raw drafts); applySnapshot is where workspace drafts get converted via buildWorkspaceAgentDefinitions. The existing AIFetchlySnapshotApplyResult.agentsChanged (aifetchlyConfigTypes.ts:110) reflects whether replaceSource changed contents. Extend AIFetchlyRuntimeRegistrySync.trust.test.ts with agents:true (routes agents to registry) and agents:false (drops agents, instructions/commands unaffected) cases mirroring the command trust cases a–d (TRS-01). Keep all DB logic in Model/Module (three-layer). NEVER use any. Write/extend tests FIRST (RED), confirm failure, implement (GREEN).
  </action>
  <verify>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs buildWorkspaceAgentDefinitions AIFetchlyRuntimeRegistrySync.trust</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && npx tsc --noEmit</automated>
    <automated>cd /home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll && ! grep -E "from ['\"]@/modules|from ['\"]@/model|getRepository|typeorm" src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "export function buildWorkspaceAgentDefinitions|export const buildWorkspaceAgentDefinitions" src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts` returns a match.
    - `grep -E "trust.agents \? snapshot.agents" src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` returns a match (the one-line filter widening).
    - `grep -E "agentRegistry.replaceSource" src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` returns a match.
    - A passing test asserts trust.agents=true routes workspace agents into the registry and trust.agents=false drops them (TRS-01), while instructions/commands behave unchanged.
    - A passing test asserts buildWorkspaceAgentDefinitions produces workspace-scoped ids (workspace-colon-id-colon-agent-colon-name) and emits agent-tool-invalid diagnostics for unknown tools without dropping the definition.
    - `npx tsc --noEmit` reports 0 errors.
    - RED commit then GREEN commit both exist in git history.
  </acceptance_criteria>
  <done>Workspace drafts convert to validated workspace:<id>:agent:* definitions in main process; applyWorkspaceSnapshot drops untrusted workspace agents (TRS-01) and replaceSource reconciles trusted ones; trust + converter tests GREEN; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Worker → main (snapshot) | Workspace agent file bytes cross the worker/main boundary as RAW drafts; the main process is the first trust/validation point. |
| Workspace filesystem → registry | Untrusted workspace agents must be dropped here (applyWorkspaceSnapshot is the choke point). |
| Author markdown → dispatch surface | Global + workspace agent frontmatter becomes dispatchable definitions — the validator (Plan 01) + this plan's converter are the schema gates. |

## STRIDE Threat Register (ASVS L1, block-on-high)

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-16-02-EL | Elevation | applyWorkspaceSnapshot trust filter | high | mitigate | One-line `agents: trust.agents ? snapshot.agents : []` widening drops untrusted workspace agents BEFORE any replaceSource call (TRS-01); a test asserts trust.agents=false yields zero workspace agents in the registry (AGT-02 workspace trust). |
| T-16-02-RCE | RCE | parseRestrictedFrontmatter (agent files) | high | mitigate | Reuse the existing restricted parser (CFG-07) — it rejects YAML tag directives and nested maps and fails closed; NO parser change is made for the tools field (the arrays Map already handles it). Verified by the existing parser tests + the new agent scan tests not introducing any parser import beyond parseRestrictedFrontmatter. |
| T-16-02-TA | Tampering | resolveConfigRelativePath (agent filenames) | medium | mitigate | Path-safety reused from Phase 14 (CFG-05) for every agent file — absolute paths and parent-traversal are rejected before read; oversized files (CFG-04, 128KB) are skipped with a diagnostic. |
| T-16-02-WS | Elevation | WorkspaceConfigScanner (worker) | high | mitigate | Worker produces RAW drafts only — no validation, no registry mutation, no DB/Electron/Module imports (WAT-02). The WorkerNoDbBoundary grep gate is EXTENDED/re-run and stays GREEN; conversion + trust happen main-side. |
| T-16-02-SC | Tampering | npm/pip/cargo installs | low | accept | Phase 16 installs ZERO packages — no supply-surface. |
</threat_model>

## Artifacts this phase produces (Plan 02)

- `AIFetchlyConfigLoader.tryReadAgentFiles` (private) — global ~/.aifetchly/agents scan → validated user:agent:* views + diagnostics.
- `AIFetchlyConfigManager.getAgentRegistry()` — owner accessor; `agentCount` wired to registry size; built-ins registered at startup.
- `WorkspaceAgentDraft` type + `WorkspaceConfigScanner.tryReadAgentFiles` — worker-side RAW drafts (snapshot.agents populated).
- `buildWorkspaceAgentDefinitions` (NEW) — main-process WorkspaceAgentDraft[] → validated workspace:<id>:agent:* views + diagnostics.
- `AIFetchlyRuntimeRegistrySync` — constructor owns AgentDefinitionRegistry; applyWorkspaceSnapshot filters agents (TRS-01); applySnapshot calls agentRegistry.replaceSource.
- Extended WorkerNoDbBoundary grep gate coverage.

<verification>
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs AIFetchlyConfigLoader.agents WorkspaceConfigScanner buildWorkspaceAgentDefinitions AIFetchlyRuntimeRegistrySync.trust WorkerNoDbBoundary` → all GREEN.
- `npx tsc --noEmit` → 0 errors.
- `yarn testmain` → no regressions.
- Worker-no-DB: `grep -E "from '@/modules|from '@/model|getRepository|typeorm|from 'electron'" src/service/workspaceWatch/WorkspaceConfigScanner.ts` returns nothing.
- Global agent file → user:agent:* in snapshot.agents; workspace agent file → raw draft → validated workspace:<id>:agent:* in registry (trusted) / dropped (untrusted).
</verification>

<success_criteria>
- AGT-02 (agents/*.md parsed with scoped IDs; runtime tool-allowlist intersection path is UNCHANGED — AgentToolPolicyService is fed dynamic definitions at dispatch in Plan 03; workspace agents require trust TRS-01) delivered for BOTH user-global and workspace sources.
- A real ~/.aifetchly/agents/<name>.md file produces a user:agent:<name> definition visible in agentRegistry.list(); a trusted-workspace file produces workspace:<id>:agent:<name>; an untrusted-workspace file produces nothing.
- Worker stays scan-only (WAT-02 GREEN); no DB logic in the loader/IPC (three-layer preserved).
</success_criteria>

<output>
Create `.planning/phases/16-dynamic-agents/16-02-SUMMARY.md` when done.
</output>
