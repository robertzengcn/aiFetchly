# Phase 16: Dynamic Agents - Research

**Researched:** 2026-07-08
**Domain:** Agent subsystem refactor — source-aware registry + markdown frontmatter parsing + dispatch wiring (mirrors Phase 15)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-Precedence:** User wins over workspace (follow AGT-01 literally). Lookup order is `built-in > user > trusted workspace > plugin`. Built-in IDs cannot be shadowed. **Intentionally diverges from commands** (commands are `built-in > workspace > user > plugin`); document the divergence in a source comment on the agent rank map so a future reader does not "fix" it. Silent shadowing (no conflict diagnostic); the `/agents` source badge disambiguates.

**D-Discovery:** Context injection (not a dynamic tool description). The model discovers agents via an "Available agents" block injected into the AiChatV2 system message through `AIChatContextAssembler` (the Phase 13-03a path AGENTS.md uses). Block = ID + one-line description + source, scoped, rebuilt on registry mutation. `run_subagent`'s tool description stays generic (does NOT enumerate agents).

**D-AgentIDs:** Exact IDs only — no bare-name fuzzy resolution. `run_subagent` takes `agentId` verbatim: bare built-in (`agent-lead-researcher`) or scoped dynamic (`user:agent:lead-researcher`, `workspace:<id>:agent:lead-researcher`). Resolution via precedence-aware `getById`. Unknown ID → clear "unknown agent" error (do NOT fuzzy-resolve). Update the `agentId` parameter description (drop "Built-in agent ID" wording).

**D-AgentsList:** `/agents` is a new built-in local slash command returning `action: "show_result"` (mirrors `/status`). Row: `<id> — <name>: <description> [<source badge>]`, sorted built-in → user → workspace → plugin. Source badges reuse Phase 13 `slashCommands` i18n keys. Any new chrome string → all 6 lang files (en, zh, es, fr, de, ja) under `aifetchlyConfig`/`slashCommands`. Untrusted workspace agents absent (not registered) — no "disabled" row.

**D-ToolDiagnostic:** Parse-time warning for unknown tool names (non-fatal). An agent's `tools:` list referencing an unregistered tool → DX-01 `agent-tool-invalid` diagnostic (does NOT block registration). Runtime intersection in `AgentToolPolicyService` still runs at dispatch. Accepted: a late-loaded tool (MCP/skill registered after parse) can produce a stale warning until next rescan.

### Carry-Forward (locked, do not re-litigate)

- **Frontmatter parser (Phase 13-01):** reuse the restricted markdown frontmatter parser; agent frontmatter adds only a `tools` string-array field.
- **Size cap (CFG-04):** `agentMdBytes = 128 * 1024` in `AIFetchlyConfigConstants`.
- **Source replacement (Phase 13-02):** `replaceSource(sourceId, entries)` atomically reconciles add/change/delete/rename.
- **Trust gating (Phase 14-02):** workspace agents pass through `applyWorkspaceSnapshot(snapshot, trust)` before registry mutation. Binary trust (per-capability entity is Phase 17).
- **Three-layer DB / worker-no-DB (CLAUDE.md):** worker only snapshots; agent frontmatter validation + registry mutation in MAIN process. Worker-no-DB grep gate (WAT-02) must cover any new worker-side agent fields.
- **AI-feature IPC checks `USER_AI_ENABLED` first (TRS-05 Strategy A):** `/agents` + agent-list/status IPC use `registerValidatedHandler` (non-AI-gated). The actual agent *run* flows through existing `run_subagent` → `AgentRuntimeRegistry.runSync` which is already behind the stream IPC's `USER_AI_ENABLED` gate.
- **i18n (CLAUDE.md):** agent `name`/`description`/prompt body are author-supplied DATA, not app strings.
- **Preload dual whitelists:** `/agents` reuses `SLASH_COMMAND_DISPATCH`. Agent-list context block flows through existing context-assembly path. Verify no new preload whitelist needed; if a new channel is added, dual-whitelist it.
- **NEVER use `any`; immutability; explicit error handling; zod at boundaries.**

### Claude's Discretion

- Custom-agent frontmatter schema details. Default to PRD §7.4 fields as author-settable: `name` (`^[a-z][a-z0-9_-]*$`), `description` (≤500 chars), `tools` (string array), `maxToolCalls` (int), `maxRuntimeMs` (int), non-empty prompt body. System-default the rest: `mode` → `"specialist"`, `version` → `1`, `status` → `"active"`, `maxContinueCalls` → sane default (built-in uses 8), `outputSchema` → **none** (structured-output authoring deferred).
- Exact `replaceSource`/rank-map data structure — mirror `CommandRegistry`'s `SOURCE_RANK` + `rebuildNameIndex`, with the D-Precedence rank order.
- Where the "Available agents" context block assembles (small pure assembler fed by `AgentDefinitionRegistry.list()`, injected alongside AGENTS.md blocks in `AIChatContextAssembler`).
- Diagnostic wording for `agent-tool-invalid` / `agent-name-invalid` / oversized-agent — reuse the Phase 13/14 `diagnostic(sourceId, path, kind, message, fatal)` shape.
- Whether to unit-test precedence at registry level, dispatch level, or both (recommend both).

### Deferred Ideas (OUT OF SCOPE)

- `outputSchema` authoring in `agents/*.md` (structured JSON via fenced block) — deferred; Phase 16 dynamic agents default to freeform text output.
- Plugin-sourced agents (`plugin:<name>:agent:<name>`) — Phase 18 (PRD §7.4 "plugin agents only after dynamic registration is stable"). Registry rank map should RESERVE the `plugin` rank so Phase 18 fills it in.
- Bare-name fuzzy resolution in `run_subagent` — rejected via D-AgentIDs; revisit only if UX feedback shows bare-name typing is common.
- Per-capability workspace trust (agents flag on `AIFetchlyWorkspaceTrust`) — Phase 17 (TRS-02). Phase 16 reuses Phase 14's binary trust.
- Conflict diagnostic for same-name user-vs-workspace collisions — deferred (D-Precedence makes shadowing silent).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGT-01 | `AgentDefinitionRegistry` refactored for source-aware dynamic registration (`listBuiltIns`/`list`/`getById`/`replaceSource`); lookup order built-in > user > trusted workspace > plugin; built-ins cannot be shadowed | Clone `CommandRegistry` (src/service/slashCommands/CommandRegistry.ts) shape with the divergent D-Precedence rank order. Current registry is a 70-line object literal (src/service/AgentDefinitionRegistry.ts) — only one prod consumer (`AgentDefinitionModule.ensureBuiltIns`), so refactor is low-risk. |
| AGT-02 | `agents/*.md` parsed (name, description, tools, maxToolCalls, maxRuntimeMs, prompt body) and registered with scoped IDs; tool allowlists intersected with registered+permitted tools at runtime; workspace agents require trust | `parseRestrictedFrontmatter` already handles string arrays (the `tools` field needs NO parser change). New `buildAgentDefinition` validator mirrors `buildPromptCommandDefinition`. Trust filter extends `applyWorkspaceSnapshot` to also filter `agents: trust.agents ? snapshot.agents : []`. Runtime intersection in `AgentToolPolicyService.filterExposedToolNames` is unchanged — just feed it dynamic definitions. |
| AGT-03 | `run_subagent` validation + description updated to dispatch by dynamic agent ID; `/agents` lists built-in + dynamic agents | One-line resolution change at AgentRuntime.ts:71 (registry-first) + update `RUN_SUBAGENT_TOOL.parameters.properties.agentId.description` + new `/agents` branch in `SlashCommandDispatcher.dispatchLocal` mirroring the `/status` branch. |
| DX-01 (used) | Reserve `agent-tool-invalid` code (already in `AIFETCHLY_DIAGNOSTIC_CODES`) | `AIFetchlyConfigConstants.ts:96` already lists the code. `agent-name-invalid` also reserved (line 95). Phase 16 emits these — no constant additions. |
| CFG-04 (used) | Agent file 128KB cap | `AIFetchlyConfigConstants.ts:36` — `agentMdBytes: 128 * 1024` already defined. Reference, do not re-create. |
| TRS-01 (used) | Workspace trust before registration | `AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot` is the choke point; extend its filter object to include `agents`. |
| TRS-05 (used) | AI-gating strategy | `/agents` uses `registerValidatedHandler` (non-AI); agent-run flows through existing `run_subagent` (already AI-gated upstream). Verify zero `registerAiValidatedHandler` on new channels. |
</phase_requirements>

## Summary

Phase 16 is a near-exact structural clone of Phase 15 (prompt commands) applied to agents. Every hard subproblem — source-aware registry with atomic `replaceSource`, restricted-frontmatter parsing, single-owner validator, trust filtering, source replacement on rescan, built-in local slash command — already has a battle-tested analog in Phase 13/14/15. **No new packages. No new architectural surfaces.** The work is pattern-cloning plus one focused dispatch-path wiring change.

The single open architectural question — how dynamic agents become visible on the `run_subagent` dispatch path — has a clear, evidence-backed answer:

**RECOMMENDATION (Option a): the refactored `AgentDefinitionRegistry` becomes the single source of truth for definition lookup at dispatch time. `AgentRuntime.runSync` (line 71) currently calls `this.defModule.getActiveById(request.agentId)` (DB-backed). The minimal change is to resolve from the registry FIRST (registry knows built-in + user + trusted-workspace + scoped IDs), with the existing DB lookup preserved as the source of built-in execution metadata (the DB continues to be seeded by `ensureBuiltIns()` at startup and backs agent *task/execution history*). Dynamic agents (scoped IDs) are NEVER upserted into the DB — they live only in the in-memory registry, which mirrors how `CommandRegistry` works for commands.**

This is grounded in three concrete facts observed in the code: (1) the current registry's only production consumer is `AgentDefinitionModule.ensureBuiltIns()` — a one-time startup seed — so widening the registry's responsibilities is low-risk; (2) `AgentRuntime.runSync` consumes the definition object through a narrow interface (`definition.allowedTools`, `definition.maxToolCalls`, `definition.maxRuntimeMs`, `definition.systemPrompt`, etc.) — swapping the source of that object does not require touching the runtime loop; (3) the DB's role is agent *task* persistence (transcripts, results, tool-call audit), not definition identity — `agentId`/`agentVersion` are stored as plain strings on `AgentTaskEntity`, so a registry-only dynamic agent still produces DB-backed task history.

**Primary recommendation:** Plan the phase as 3 waves mirroring Phase 15's structure — (1) registry + validator + frontmatter parsing (pure logic, no I/O, no dispatch), (2) global + workspace agent loaders + trust filter + RuntimeRegistrySync wiring, (3) dispatch path + `/agents` command + context-injection block + i18n chrome. Coarse granularity — do not over-decompose.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Agent markdown frontmatter parsing (global) | API / Backend (main) | — | Restricted parser is main-process pure logic; runs in `AIFetchlyConfigLoader` |
| Agent markdown snapshotting (workspace) | Worker (child_process) | — | `WorkspaceConfigScanner` snapshots bytes only; main process validates + registers (worker-no-DB) |
| Agent definition validation | API / Backend (main) | — | `buildAgentDefinition` pure validator, main-process only |
| Source-aware agent registry | API / Backend (main, in-memory) | — | `AgentDefinitionRegistry` — in-memory, atomic `replaceSource` (mirrors `CommandRegistry`) |
| Built-in agent seeding | API / Backend (DB) | — | `ensureBuiltIns()` upserts built-ins to `agent_definitions` table at startup; unchanged |
| Agent task/execution persistence | Database / Storage | API / Backend | `AgentTaskModule` — transcripts, results, tool-call audit; keyed by string `agentId` |
| `run_subagent` dispatch resolution | API / Backend (registry) | Database (built-in execution metadata) | Registry-first; DB seeded for built-ins |
| Runtime tool-allowlist intersection | API / Backend (main) | — | `AgentToolPolicyService` — unchanged; fed dynamic definitions |
| `/agents` slash command | API / Backend (local command) | — | `show_result` via Phase 13 dispatcher |
| Available-agents context block | API / Backend (main) | — | `AIChatContextAssembler` — system-message injection |
| Agent discovery by the model | AI Chat (system message) | — | Static `run_subagent` tool def + dynamic context block (D-Discovery) |

## The Critical Resolution-Path Decision (Answers the CONTEXT open question)

### Evidence trace — `run_subagent` → definition lookup (current state)

```
runSubagentTool.execute (src/service/agentTools/runSubagentTool.ts:126-160)
  → AgentRuntimeRegistry.getRuntime().runSync(request)         (runSubagentTool.ts:146-147)
  → AgentRuntime.runSync                                      (src/service/AgentRuntime.ts:67)
     → this.defModule.getActiveById(request.agentId)          (AgentRuntime.ts:71)  ← DB LOOKUP
        → this.defModule = new AgentDefinitionModule()        (AgentRuntime.ts:63)
           → AgentDefinitionModel.getActiveById               (src/model/AgentDefinition.model.ts:60-65)
              → repository.findOne({ where: { agentId, status: "active" } })  ← SQLite
```

`AgentDefinitionRegistry` (src/service/AgentDefinitionRegistry.ts) is **NOT on the dispatch path today**. It is a 70-line object literal over a `BUILT_INS` array. Its only production consumer is:

```
AgentDefinitionModule.ensureBuiltIns() (src/modules/AgentDefinitionModule.ts:15-20)
  → for (const view of AgentDefinitionRegistry.listBuiltIns())
      → this.model.upsert(view)                  ← seeds DB at startup
```

Called once at startup from `src/background.ts:676-677`. There is one other resolution surface: `agent-runtime-ipc.ts:38` exposes `AGENT_DEFINITION_LIST` → `module.listActive()` for an agent-management UI (DB-backed, AI-gated). This is separate from the `/agents` slash command and is OUT OF SCOPE for Phase 16.

### The three options

| Option | Description | Verdict |
|--------|-------------|---------|
| (a) | Dynamic agents resolved from the in-memory registry; built-ins stay DB-seeded for task/execution history; dispatch resolves registry-first | **RECOMMENDED** |
| (b) | Dynamic agents also upserted into the DB with scoped IDs | REJECTED — file-defined agents change/rname/delete on rescan; DB upsert churn + stale-row risk; violates "in-memory with `replaceSource`" (tech-design §7.4) |
| (c) | Both — registry AND DB | REJECTED — same DB-churn problem as (b); the `replaceSource` contract is atomic in-memory reconciliation |

### Recommendation: Option (a), implemented as a one-line resolution swap

**The minimal change** that makes dynamic IDs visible on the dispatch path without rewriting the runtime loop:

1. Refactor `AgentDefinitionRegistry` from object literal to a class with `listBuiltIns()`/`list()`/`getById(id)`/`replaceSource(sourceId, agents)` (mirrors `CommandRegistry`). Built-ins are registered into the registry at construction (or via a `registerBuiltIns()` method) so `listBuiltIns()` still returns them for `ensureBuiltIns()` DB seeding.
2. **`AgentRuntime.runSync` line 71 changes from** `const definition = await this.defModule.getActiveById(request.agentId);` **to a registry-first lookup.** The registry's `getById(id)` is precedence-aware and knows scoped IDs; if it returns null AND the id looks built-in-shaped (or as a uniform fallback), consult `this.defModule.getActiveById(id)` so DB-seeded built-ins still resolve. This preserves backward compatibility for the built-in path during the transition and requires NO change to the runtime loop (the `definition` object flows through unchanged).
3. Dynamic agents (scoped IDs `user:agent:*`, `workspace:*:agent:*`) are NEVER written to the DB. The DB continues to back: built-in execution metadata (via `ensureBuiltIns()` seeding) and agent *task* persistence (transcripts/results/audit — these reference `agentId` as a plain string, so a registry-only dynamic agent still produces DB-backed task history).
4. `AgentTaskModule.createTask({ agentId: definition.id, agentVersion: definition.version, ... })` continues to work — it stores the string ID verbatim whether that ID came from a built-in or a dynamic agent. No schema change.

### Why this is the minimal, lowest-risk change

- **The `definition` object is consumed through a narrow interface** in `AgentRuntime.runSync`: `definition.id`, `definition.version`, `definition.allowedTools`, `definition.maxToolCalls`, `definition.maxRuntimeMs`, `definition.maxContinueCalls`, `definition.systemPrompt`, `definition.defaultModel`, `definition.outputSchema`, `definition.mode`. All of these are fields on `AgentDefinitionView` (src/entityTypes/agentTypes.ts:32-46), which the registry already returns for built-ins. A dynamic `AgentDefinitionView` produced by `buildAgentDefinition` is structurally identical. The runtime loop is insulated.
- **The registry's only existing consumer is `ensureBuiltIns()`** — a startup seed loop. Widening the registry does not cascade.
- **`AgentToolPolicyService` is unchanged** — it already intersects `definition.allowedTools` with registered skills at runtime (src/service/AgentToolPolicyService.ts:136-153). Dynamic definitions flow through it identically.
- **Task persistence is agentId-string-keyed** — `AgentTaskEntity` stores `agentId: varchar` and `agentVersion: int` as denormalized columns (not FKs). A registry-only dynamic agent still produces full task audit trail.

### Risks flagged for the planner

- **R1 (test impact):** Tests that mock `AgentDefinitionModule.getActiveById` to return a built-in (e.g. `test/vitest/main/service/AgentRuntime.test.ts`) will still pass IF the registry-first lookup falls back to the module for built-in IDs. If the planner chooses "registry-only, no fallback" the existing DB-mock tests need updating to registry-mocks. Recommend the fallback form for a smooth migration.
- **R2 (AGENT_DEFINITION_LIST surface):** The existing `AGENT_DEFINITION_LIST` IPC (agent-runtime-ipc.ts:34) returns DB-backed agents only. After Phase 16, it will NOT list dynamic agents. This is OUT OF SCOPE per CONTEXT (the `/agents` slash command is the SC1 listing surface) but the planner should document this as a known divergence — the agent-management UI page (whatever consumes `AGENT_DEFINITION_LIST`) won't see dynamic agents until a later phase wires it to the registry.
- **R3 (caching):** `AgentRuntime` constructs `new AgentDefinitionModule()` once per runtime instance (field initializer, line 63). The module holds no definition cache — every `getActiveById` hits the DB. The registry is in-memory and fast. No perf regression; if anything, dispatch gets faster for built-ins after the swap.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (no new packages) | — | — | Phase 16 reuses Phase 13/14/15 infrastructure entirely |

**This phase installs zero packages.** All work is in-tree pattern-cloning. zod, TypeORM, better-sqlite3, the restricted frontmatter parser, and all registry/dispatcher/context-assembly machinery already exist from prior phases.

### Existing in-tree dependencies Phase 16 reuses
| Module | Path | Role |
|--------|------|------|
| `CommandRegistry` | `src/service/slashCommands/CommandRegistry.ts` | Structural template for the refactored `AgentDefinitionRegistry` (SOURCE_RANK + rebuildNameIndex + replaceSource) |
| `buildPromptCommandDefinition` | `src/service/slashCommands/promptCommandFrontmatter.ts` | Validator pattern to mirror for `buildAgentDefinition` |
| `parseRestrictedFrontmatter` | `src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts` | Frontmatter parser — already supports the `tools` string-array field via its `arrays` map (NO parser change) |
| `AIFetchlyConfigLoader` | `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` | Global scan loop; add `tryReadAgentFiles` mirroring `tryReadCommandFiles` (line 270) |
| `WorkspaceConfigScanner` | `src/service/workspaceWatch/WorkspaceConfigScanner.ts` | Workspace scan loop; add `tryReadAgentFiles` mirroring `tryReadCommandFiles` (line 410) |
| `AIFetchlyRuntimeRegistrySync` | `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` | Trust-filter choke point; widen constructor + `applyWorkspaceSnapshot` filter |
| `AIChatContextAssembler` | `src/service/AIChatContextAssembler.ts` | Injection point for the "Available agents" block (after line 179) |
| `SlashCommandDispatcher` | `src/service/slashCommands/SlashCommandDispatcher.ts` | Add `/agents` branch in `dispatchLocal` (mirrors `/status` branch at line 174) |
| `builtinSlashCommands` | `src/service/slashCommands/builtinSlashCommands.ts` | Register the `/agents` built-in (mirrors `/status` at line 52) |
| `AgentToolPolicyService` | `src/service/AgentToolPolicyService.ts` | Runtime tool-allowlist intersection — UNCHANGED, dynamic definitions flow through it |
| `AIFetchlyConfigConstants` | `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` | `agentMdBytes`, `maxAgentsPerSource`, `COMMAND_NAME_REGEX`, `AIFETCHLY_DIAGNOSTIC_CODES` all already defined |

**Installation:**
```bash
# No installation. Zero new packages.
```

**Version verification:** Not applicable — no new packages.

## Package Legitimacy Audit

> This phase installs no external packages. The audit is therefore vacuous.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | No new packages |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────┐
                         │  User authors markdown           │
                         │  ~/.aifetchly/agents/x.md         │
                         │  <workspace>/.aifetchly/agents/y.md│
                         └──────────────┬───────────────────┘
                                        │ (files on disk)
                                        ▼
   ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
   │  Worker (Phase 14) │    │  Main: GlobalLoader │    │  Main: resolveTrust  │
   │  WorkspaceConfig   │    │  tryReadAgentFiles  │    │  (Phase 14 binary)   │
   │  Scanner snapshots │    │  parseRestrictedFM  │    │                      │
   │  agents/*.md bytes │    │  buildAgentDefinition│   │                      │
   └─────────┬──────────┘    └──────────┬──────────┘    └──────────┬───────────┘
             │                          │                          │
             │   snapshot.agents[]      │   snapshot.agents[]      │
             │   (drafts, raw bytes)    │   (validated views)      │
             ▼                          ▼                          ▼
             └──────────────────────────┴──────────────────────────┘
                                        │
                                        ▼
                  ┌─────────────────────────────────────────┐
                  │  AIFetchlyRuntimeRegistrySync            │
                  │  applyWorkspaceSnapshot(snap, trust)     │  ← TRS-01 filter:
                  │    agents: trust.agents ? snap.agents : []│     untrusted → drop
                  │  applySnapshot(snap)                     │
                  │    agentRegistry.replaceSource(sourceId, …)│  ← atomic reconcile
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │  AgentDefinitionRegistry (in-memory)     │
                  │  built-in > user > workspace > plugin    │  ← D-Precedence
                  │  getById(id) precedence-aware            │
                  │  list() → all visible agents             │
                  └────────┬──────────────────┬─────────────┘
                           │                  │
            ┌──────────────┘                  └──────────────┐
            ▼                                                 ▼
  ┌──────────────────────┐                       ┌────────────────────────┐
  │  run_subagent execute│                       │  AIChatContextAssembler│
  │  agentId verbatim    │                       │  "Available agents"    │
  │  ↓                   │                       │  block in system msg   │
  │  AgentRuntime.runSync│                       │  (D-Discovery)         │
  │  registry-first (a)  │                       └────────────────────────┘
  │  ↓                   │
  │  AgentToolPolicy     │  ← runtime intersection with registered+permitted tools
  │  ↓                   │
  │  AIChatQueryLoop     │
  └──────────────────────┘
```

The diagram shows the primary use case: author writes markdown → scanned + validated → trust-filtered → registry → (a) `run_subagent` dispatches by scoped ID, (b) the model discovers agents via the context block. The built-in seeding path (DB → ensureBuiltIns at startup) is omitted for clarity — it stays unchanged.

### Recommended Project Structure

Phase 16 touches these locations (all already established by Phase 13/14/15 — no new directories):

```
src/
├── service/
│   ├── AgentDefinitionRegistry.ts        # REFACTOR: object literal → class (mirror CommandRegistry)
│   ├── agentTools/
│   │   └── runSubagentTool.ts            # EDIT: agentId description + (optionally) validator
│   ├── aifetchlyConfig/
│   │   ├── AIFetchlyConfigLoader.ts      # EDIT: add tryReadAgentFiles (mirror tryReadCommandFiles)
│   │   ├── AIFetchlyRuntimeRegistrySync.ts # EDIT: widen constructor + applyWorkspaceSnapshot
│   │   └── AIFetchlyConfigManager.ts     # EDIT: own AgentDefinitionRegistry; expose via getter
│   ├── slashCommands/
│   │   ├── builtinSlashCommands.ts       # EDIT: register /agents (mirror /status)
│   │   ├── SlashCommandDispatcher.ts     # EDIT: add built-in:command:agents branch (mirror /status)
│   │   └── agentFrontmatter.ts           # NEW: buildAgentDefinition (mirror promptCommandFrontmatter.ts)
│   ├── workspaceWatch/
│   │   └── WorkspaceConfigScanner.ts     # EDIT: add tryReadAgentFiles (mirror tryReadCommandFiles)
│   ├── AIChatContextAssembler.ts         # EDIT: inject "Available agents" block
│   └── AgentRuntime.ts                   # EDIT: line 71 — registry-first definition lookup
├── service/aifetchlyConfig/
│   └── availableAgentsBlock.ts           # NEW (optional): pure assembler for the context block
└── views/lang/
    └── {en,zh,es,fr,de,ja}.ts             # EDIT: add any new chrome strings to all 6
```

### Pattern 1: Source-aware registry with atomic replaceSource (mirror CommandRegistry)

**What:** A class with three indexes (`byId`, `byName`/`byId`, `sourceIndex`), where every mutator ends with `rebuildNameIndex()` and `replaceSource(sourceId, entries)` atomically reconciles add/change/delete/rename.

**When to use:** For any capability that loads from markdown files and must reconcile rescans without stale entries.

**Example:** Source: `src/service/slashCommands/CommandRegistry.ts:26-158` (the canonical implementation). Clone verbatim with two changes:
1. `SOURCE_RANK` order: `built-in=0, user=1, workspace=2, plugin=3` (D-Precedence — diverges from commands).
2. Entry type: `AgentDefinitionView` instead of `SlashCommandDefinition`.

```typescript
// Clone CommandRegistry.SOURCE_RANK with the divergent agent order.
// DO NOT "normalize" this to match CommandRegistry — AGT-01 / tech-design §7.4
// explicitly mandate built-in > user > workspace > plugin for agents.
const SOURCE_RANK: Readonly<Record<AgentSource, number>> = Object.freeze({
  "built-in": 0,
  user: 1,       // agents: user wins over workspace (D-Precedence)
  workspace: 2,  // commands: workspace wins over user — different!
  plugin: 3,     // reserved for Phase 18
});
```

### Pattern 2: Single-owner validator (mirror buildPromptCommandDefinition)

**What:** A pure function consuming already-parsed frontmatter, returning `{ok:true, definition}` or `{ok:false, diagnostic}`, with a fixed validation order where the first violation wins.

**When to use:** For any markdown-defined capability where the schema must be encoded exactly once and consumed by both global + workspace loaders.

**Example:** Source: `src/service/slashCommands/promptCommandFrontmatter.ts:97-242`. The validation order for `buildAgentDefinition` should be (mirroring Phase 15 + CONTEXT "Claude's Discretion"):

1. `name` present + matches `COMMAND_NAME_REGEX` → else `agent-name-invalid`
2. `description` present + non-empty → else `frontmatter-missing` (or `agent-name-invalid`-style code)
3. `description` length ≤ `commandDescriptionLength` (reuse 500-char bound) → else `frontmatter-invalid`
4. `tools` (optional, default `[]`) is a string array → else `frontmatter-invalid`; each entry is a non-empty string → else `frontmatter-invalid`
5. `maxToolCalls` (optional) parses as positive int → else `frontmatter-invalid`
6. `maxRuntimeMs` (optional) parses as positive int → else `frontmatter-invalid`
7. body non-empty after trim → else `frontmatter-invalid`

On success, the definition has:
- `id` = `${sourceMeta.sourceId}:agent:${name}` (stable per source+name; mirrors `${sourceMeta.sourceId}:command:${name}`)
- System defaults: `mode: "specialist"`, `version: 1`, `status: "active"`, `maxContinueCalls: 8` (built-in value), `outputSchema: {}` (none — deferred)
- All fields sourced verbatim from `draft`/`sourceMeta`

**D-ToolDiagnostic integration:** BEFORE returning `{ok:true}`, iterate `tools` and check each name against `SkillRegistry.getAllToolFunctions()` (or pass a `registeredToolNames: ReadonlySet<string>` parameter to keep the validator pure). For each unknown name, emit an `agent-tool-invalid` diagnostic (severity: warning, recoverable: true) and continue — the definition is still registered. The diagnostic and the definition can BOTH be returned: change the result union to `{ok:true, definition, warnings: AIFetchlyConfigDiagnostic[]}` OR have the loader emit the diagnostics separately. Recommend the latter (keeps the validator's return shape aligned with Phase 15).

```typescript
// Pure validator — same shape as buildPromptCommandDefinition
export type AgentDefinitionBuildResult =
  | { readonly ok: true; readonly definition: AgentDefinitionView }
  | { readonly ok: false; readonly diagnostic: AIFetchlyConfigDiagnostic };

// Loader emits tool warnings separately (D-ToolDiagnostic non-fatal):
const result = buildAgentDefinition(draft, sourceMeta);
if (result.ok) {
  definitions.push(result.definition);
  for (const warn of detectUnknownTools(result.definition, registeredToolNames)) {
    diagnostics.push(warn);  // agent-tool-invalid, recoverable: true
  }
} else {
  diagnostics.push(result.diagnostic);
}
```

### Pattern 3: Built-in local slash command (mirror /status)

**What:** A `type: "local"` slash command returning `action: "show_result"` from the dispatcher.

**When to use:** For any listing/status command that lives entirely in the main process with no AI call.

**Example:** Source: `src/service/slashCommands/SlashCommandDispatcher.ts:174-182` (the `/status` branch). The `/agents` branch mirrors it exactly:

```typescript
case "built-in:command:agents": {
  const agents = this.agentRegistry.list();  // or this.manager.getAgentRegistry().list()
  return {
    status: true,
    action: "show_result",
    commandId,
    content: renderAgentsList(agents),
  };
}
```

### Pattern 4: Trust-filtered snapshot application (extend applyWorkspaceSnapshot)

**What:** A single chokepoint that drops untrusted capabilities BEFORE registry mutation.

**When to use:** For any workspace-sourced capability (agents/hooks/skills).

**Example:** Source: `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:103-116`. Today the filter object contains only `instructions` and `commands`. Phase 16 adds `agents`:

```typescript
const filtered: AIFetchlyConfigSnapshot = {
  ...snapshot,
  instructions: trust.instructions ? snapshot.instructions : [],
  commands: trust.commands ? snapshot.commands : [],
  agents: trust.agents ? snapshot.agents : [],   // ← Phase 16 adds this line
};
```

The constructor must also widen to accept an `AgentDefinitionRegistry`:

```typescript
constructor(
  private readonly commandRegistry: CommandRegistry,
  private readonly agentRegistry: AgentDefinitionRegistry,  // ← new
  private readonly contextStore: AIFetchlyContextStore
) {}
```

And `applySnapshot` gains:

```typescript
const agents = snapshot.agents as readonly AgentDefinitionView[];  // cast like commands
this.agentRegistry.replaceSource(snapshot.sourceId, agents);
```

### Pattern 5: Context-injection block with graceful degradation (mirror AGENTS.md injection)

**What:** A try/catch-wrapped system-message injection that degrades to no-op + `console.error` on failure.

**When to use:** For any dynamic content the model needs to discover.

**Example:** Source: `src/service/AIChatContextAssembler.ts:163-179` (the AGENTS.md injection). The "Available agents" block injects right after it (before durable memory):

```typescript
try {
  const agents = this.agentRegistry.list();  // or singleton accessor
  if (agents.length > 0) {
    messages.push({
      role: "system",
      content: buildAvailableAgentsBlock(agents),  // pure fn: "Available agents:\n<id> — <desc> [<source>]"
    });
  }
} catch (err) {
  console.error("[ai-chat-context] available agents injection failed:", err);
}
```

### Anti-Patterns to Avoid

- **Upserting dynamic agents into the DB.** Option (b)/(c) from the open question. File-defined agents change/rname/delete on rescan; the DB upsert churn and stale-row risk violate the in-memory `replaceSource` contract (tech-design §7.4). Dynamic agents live ONLY in the registry.
- **Fuzzy bare-name resolution in `run_subagent`.** D-AgentIDs explicitly rejects this — it masks D-Precedence and produces silent precedence-dependent resolution. The `agentId` is taken verbatim.
- **Using `AGENT_DEFINITION_LIST` IPC for `/agents`.** That channel is DB-backed, AI-gated, and returns only built-ins. `/agents` is a local slash command, non-AI-gated, sourced from the registry. Different surfaces.
- **Tightening the frontmatter parser for the `tools` field.** `parseRestrictedFrontmatter` already returns a `arrays: Map<string, readonly string[]>` (src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts:90, 137) — the `tools` field needs NO parser change. Validator does the type checking.
- **Skipping the rank-map divergence comment.** A future reader WILL try to "normalize" the agent rank to match commands. The D-Precedence comment is load-bearing.
- **Renderer-side agent-file reads.** TRS-07: renderer reads only typed state from main. `/agents` content is computed in main and returned as `show_result.content` (a string).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Source-aware registry with atomic reconcile | New registry from scratch | `CommandRegistry` shape (clone) | Phase 13-02 already debugged lookup order, defensive copies, `replaceSource` semantics |
| Frontmatter parser | New YAML parser / `js-yaml` | `parseRestrictedFrontmatter` | CFG-07 security: YAML libs execute tags; the restricted parser fails closed on anything but scalars + string arrays |
| Frontmatter validator | Inline validation in loader | `buildPromptCommandDefinition` pattern (clone as `buildAgentDefinition`) | Single-owner schema = one place to update when rules change; first-violation-wins is the established UX |
| Runtime tool-allowlist intersection | New intersection in dispatcher | `AgentToolPolicyService.filterExposedToolNames` | Already handles mandatory-infrastructure-tools auto-injection + v1 denylist + blockedTools |
| Trust filter | Per-capability trust entity | `applyWorkspaceSnapshot(snapshot, trust)` | Phase 14 already established the binary-apply-boundary pattern; per-capability is Phase 17 |
| Built-in slash command dispatch | New IPC channel | `SlashCommandDispatcher.dispatchLocal` `show_result` branch | Phase 13-03b already established local-command shape |
| Diagnostic shape | New diagnostic format | `AIFetchlyConfigDiagnostic` + `AIFETCHLY_DIAGNOSTIC_CODES` | DX-01 reserves `agent-tool-invalid`, `agent-name-invalid` already |

**Key insight:** Every deceptively complex problem in this phase (atomic source replacement, restricted frontmatter, trust filtering, tool intersection, diagnostic codes, built-in command dispatch) already has a battle-tested owner from Phase 13/14/15. The work is identifying the analog and mirroring it — not designing new infrastructure.

## Common Pitfalls

### Pitfall 1: Breaking the existing built-in dispatch during the resolution swap
**What goes wrong:** After changing `AgentRuntime.runSync:71` to registry-first, built-ins (`agent-lead-researcher`) stop resolving because the registry isn't populated at the moment of dispatch.
**Why it happens:** The registry is populated by `AIFetchlyRuntimeRegistrySync.applySnapshot`, which runs at startup via `AIFetchlyConfigManager.initialize()`. Built-ins must ALSO be registered into the agent registry (in addition to the existing DB seed), or the registry-first lookup misses them.
**How to avoid:** The refactored `AgentDefinitionRegistry` must register built-ins into itself at construction (or via a `registerBuiltIns()` called from the manager before/alongside `ensureBuiltIns()`). Keep the DB fallback in `runSync` for belt-and-suspenders during the transition.
**Warning signs:** Existing `AgentRuntime.test.ts` tests fail with "Unknown or disabled agent: agent-lead-researcher".

### Pitfall 2: Circular import between the registry and the loader
**What goes wrong:** `AgentDefinitionRegistry` imports `AgentDefinitionView` from `@/entityTypes/agentTypes` (existing). If `buildAgentDefinition` is placed in `src/service/agentTools/` and imports the registry, and the registry imports the validator, a cycle can form.
**Why it happens:** Phase 15 put the validator in `src/service/slashCommands/promptCommandFrontmatter.ts` next to its consumer (the loader). The agent validator should similarly live next to its consumer, NOT inside the registry.
**How to avoid:** Place `buildAgentDefinition` in a sibling file (recommend `src/service/slashCommands/agentFrontmatter.ts` to mirror Phase 15's `promptCommandFrontmatter.ts`, OR `src/service/aifetchlyConfig/agentFrontmatter.ts`). The registry imports only types; the loader imports both.
**Warning signs:** `tsc --noEmit` reports "Module circularly imports itself" or runtime initialization-order bugs.

### Pitfall 3: `applyWorkspaceSnapshot` filter missing the `agents` key
**What goes wrong:** Workspace agents from trusted workspaces silently never reach the registry.
**Why it happens:** The current filter (line 107-114) only spreads `instructions` and `commands`. A planner copying the existing shape verbatim forgets to add `agents`.
**How to avoid:** Explicit test case (mirror `AIFetchlyRuntimeRegistrySync.trust.test.ts` cases a–d) for `agents: true` routing agents into the registry and `agents: false` dropping them.
**Warning signs:** Trusted-workspace agent files are discovered by the scanner but never appear in `/agents` output.

### Pitfall 4: `AgentDefinitionView.outputSchema` is `Record<string, unknown>` (NOT optional)
**What goes wrong:** Dynamic agents with no authored schema crash at runtime when the output parser tries to validate output against `{}`.
**Why it happens:** `AgentDefinitionView.outputSchema: Record<string, unknown>` (src/entityTypes/agentTypes.ts:44) is required-typed. The built-in lead-researcher has a real schema. Dynamic agents default to none.
**How to avoid:** System-default `outputSchema: {}` (empty object — no `required` fields). Verify `AgentOutputParser.parse` handles an empty/shapeless schema gracefully (it already does — it only validates `required` fields when present). Add a test.
**Warning signs:** Dynamic agent runs fail with "missing required field" errors despite the agent producing freeform text.

### Pitfall 5: Forgetting to update the `agentId` parameter description on `run_subagent`
**What goes wrong:** The model keeps passing bare names like `lead-researcher` (without `agent-` prefix or scoped ID), hitting the "unknown agent" error.
**Why it happens:** D-AgentIDs requires updating `RUN_SUBAGENT_TOOL.parameters.properties.agentId.description` (currently says "Built-in agent ID to run, e.g. 'agent-lead-researcher'. Must be active."). The model reads this description.
**How to avoid:** Update the description to describe BOTH ID forms (bare built-in `agent-*` + scoped dynamic) and point to the "Available agents" context block. Add a test asserting the description mentions scoped IDs.
**Warning signs:** Model calls `run_subagent` with unqualified names from the available-agents block.

### Pitfall 6: Worker-no-DB grep gate (WAT-02) fails after scanner change
**What goes wrong:** Adding `tryReadAgentFiles` to `WorkspaceConfigScanner` accidentally pulls in a DB/Electron import via a new helper.
**Why it happens:** `WorkspaceConfigScanner` is imported from BOTH the worker (via `workerScanner.ts`) and the main process. CLAUDE.md / WAT-02 forbids DB/Electron/Module imports in worker-reachable code.
**How to avoid:** Reuse the existing `parseRestrictedFrontmatter` + `resolveConfigRelativePath` + constants — they are pure. Keep the new `tryReadAgentFiles` self-contained in the scanner file (no `@/modules` or `@/model` imports). The worker-side scanner produces RAW drafts (frontmatter + body); the main-process loader does validation via `buildAgentDefinition`. Mirror Phase 14's `WorkspaceCommandDraft` split — produce a `WorkspaceAgentDraft` in the worker, validate in main.
**Warning signs:** `WorkerNoDbBoundary.test.ts` grep gate fails.

### Pitfall 7: `agent-tool-invalid` diagnostic fires for tools loaded late
**What goes wrong:** An agent file referencing an MCP/skill tool that hasn't registered yet produces a stale `agent-tool-invalid` warning until the next rescan.
**Why it happens:** Tools can be registered at runtime (MCP servers, skill installs) AFTER the agent file is parsed. D-ToolDiagnostic explicitly accepts this tradeoff.
**How to avoid:** Document in the diagnostic message that the warning reflects the registered-tool set at scan time and will clear on the next `/reload-config`. Do NOT block registration. The runtime intersection in `AgentToolPolicyService` is the source of truth at dispatch.
**Warning signs:** (None — this is accepted behavior.)

### Pitfall 8: Dual-source built-in collision
**What goes wrong:** After Phase 16, the registry contains built-ins (registered at startup) AND the DB contains built-ins (seeded via `ensureBuiltIns`). If `/agents` lists from the registry and `AGENT_DEFINITION_LIST` lists from the DB, the counts/divergence can confuse users.
**Why it happens:** The two listing surfaces have different sources of truth.
**How to avoid:** Document this as a known divergence (R2). `/agents` is the SC1 surface for Phase 16. The agent-management UI (whatever consumes `AGENT_DEFINITION_LIST`) is out of scope — it continues to show DB-backed (built-in) agents only. The planner should add a code comment on `AGENT_DEFINITION_LIST` noting it doesn't see dynamic agents yet.
**Warning signs:** User reports "my custom agent shows in `/agents` but not in the agent management page".

## Code Examples

Verified patterns from the codebase to clone:

### Current dispatch resolution (the line to change)

```typescript
// Source: src/service/AgentRuntime.ts:63-77
private readonly defModule = new AgentDefinitionModule();   // existing DB module

async runSync(request: RunAgentRequest, deps?: AgentRuntimeDeps): Promise<AgentResult> {
  const definition = await this.defModule.getActiveById(request.agentId);  // ← LINE 71, DB lookup
  if (!definition) {
    return this.fail(request, `Unknown or disabled agent: ${request.agentId}`);
  }
  // ... runtime loop consumes `definition` via narrow interface ...
}
```

### Recommended resolution swap (registry-first with DB fallback)

```typescript
// Source: NEW — modeled on AgentRuntime.ts:71
// Option (a) minimal change. The registry holds built-ins (registered at startup)
// + user + trusted-workspace dynamic agents. DB seeded built-ins still back
// task persistence; the fallback preserves any test mocks unchanged.
async runSync(request: RunAgentRequest, deps?: AgentRuntimeDeps): Promise<AgentResult> {
  let definition: AgentDefinitionView | null =
    this.agentRegistry.getById(request.agentId);  // in-memory, precedence-aware
  if (!definition) {
    // Built-in execution metadata path or test-mock path.
    definition = await this.defModule.getActiveById(request.agentId);
  }
  if (!definition) {
    return this.fail(request, `Unknown or disabled agent: ${request.agentId}`);
  }
  // ... rest unchanged ...
}
```

### Restricted frontmatter parser output (already supports `tools`)

```typescript
// Source: src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts:90-145
// NO PARSER CHANGE — the `arrays` Map already carries string-array fields.
const parsed = parseRestrictedFrontmatter(text);
// parsed.scalars: Map<string, string>   → name, description, maxToolCalls, maxRuntimeMs
// parsed.arrays:  Map<string, readonly string[]>  → tools (the agent allowlist)
// parsed.body:    string                → the prompt body

const scalars: Record<string, string> = {};
const arrays: Record<string, readonly string[]> = {};
for (const [k, v] of parsed.scalars) scalars[k] = v;
for (const [k, v] of parsed.arrays) arrays[k] = v;
// → frontmatter: { ...scalars, ...arrays }
```

### Built-in local command definition (mirror /status)

```typescript
// Source: src/service/slashCommands/builtinSlashCommands.ts:52-63 (the /status template)
{
  id: "built-in:command:agents",       // ← new stable id
  name: "agents",
  description: "List available AiFetchly agents (built-in and dynamic).",
  aliases: [],
  type: "local",                        // ← local = show_result, no AI call
  source: "built-in",
  sourceId: "built-in",
  sourceLabel: "Built-in",
  requiresTrust: false,
  enabled: true,
},
```

### Dispatcher branch (mirror /status)

```typescript
// Source: src/service/slashCommands/SlashCommandDispatcher.ts:174-182 (the /status template)
case "built-in:command:agents": {
  const agents = this.manager.getAgentRegistry().list();
  return {
    status: true,
    action: "show_result",
    commandId,
    content: renderAgentsList(agents),
  };
}

function renderAgentsList(agents: readonly AgentDefinitionView[]): string {
  // Sort by precedence: built-in → user → workspace (→ plugin in Phase 18)
  // Row: "<id> — <name>: <description> [<source badge>]"
  // Source badge reuses Phase 13 slashCommands i18n keys.
  // ...
}
```

### Trust filter extension (one line)

```typescript
// Source: src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:107-114 (extend)
const filtered: AIFetchlyConfigSnapshot = {
  ...snapshot,
  instructions: trust.instructions ? snapshot.instructions : [],
  commands: trust.commands ? snapshot.commands : [],
  agents: trust.agents ? snapshot.agents : [],   // ← Phase 16 adds this line
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `AgentDefinitionRegistry` object literal | Source-aware class with `replaceSource` (mirror `CommandRegistry`) | Phase 16 | Built-ins + user + trusted-workspace agents all in one precedence-aware registry |
| `runSync` resolves definition from DB only | Registry-first with DB fallback | Phase 16 | Dynamic scoped IDs become dispatchable; built-ins still DB-backed for execution metadata |
| `applyWorkspaceSnapshot` filters instructions + commands | Also filters agents | Phase 16 | Untrusted workspace agents dropped before registry mutation (TRS-01) |
| `run_subagent` agentId = "Built-in agent ID" | agentId = bare built-in OR scoped dynamic ID | Phase 16 | Model can dispatch `user:agent:lead-researcher` |

**Deprecated/outdated:**
- The comment at `src/service/AgentDefinitionRegistry.ts:46-48` ("Stale 'google_search' reference removed — no such skill…") is the motivating case for D-ToolDiagnostic. Leave the comment; it documents why the diagnostic exists.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `AgentDefinitionView` is the correct type for dynamic-agent definitions (the validator produces it, the registry stores it, the runtime consumes it) | Architecture Patterns / Pattern 2 | LOW — verified at src/entityTypes/agentTypes.ts:32-46; all 12 fields match what `AgentRuntime.runSync` consumes |
| A2 | `parseRestrictedFrontmatter` requires NO change for the `tools` field | Code Examples | LOW — verified at AIFetchlyConfigMarkdown.ts:90,137 (arrays Map handles string arrays) |
| A3 | `ensureBuiltIns()` continues to upsert the single built-in to the DB unchanged after the registry refactor | Resolution-Path Decision | LOW — `AgentDefinitionModule.ts:15-20` calls `AgentDefinitionRegistry.listBuiltIns()`; the refactored class must preserve this method name and return shape |
| A4 | The DB-backed `agent_definitions` table needs NO schema migration for Phase 16 | Resolution-Path Decision | LOW — dynamic agents are never upserted; built-ins stay as today |
| A5 | `AgentOutputParser.parse` gracefully handles an empty `outputSchema` (`{}` with no `required` field) for dynamic freeform-text agents | Pitfall 4 | MEDIUM — needs a test; if it doesn't, dynamic agents fail output validation. Mitigation: verify with a unit test in Wave 1 |
| A6 | The model discovers and uses the "Available agents" context block reliably | D-Discovery | MEDIUM — context injection is proven for AGENTS.md (CTX-01) but agents are a new signal; needs live-app validation. Mitigation: Phase 16 verify task includes a manual check that the model actually calls `run_subagent` with a scoped ID from the block |
| A7 | The rank-map divergence comment is sufficient to prevent a future "normalization" regression | Pattern 1 | LOW — documentation-only; if a future engineer ignores it, agents break D-Precedence but the existing tests (recommended) catch it |
| A8 | Phase 14's `WorkspaceConfigScanner` worker-side wrapper (`workerScanner.ts`) needs NO change for agents | Pattern 2 / Pitfall 6 | LOW — the worker scanner calls `WorkspaceConfigScanner.scan()`; adding `tryReadAgentFiles` to the scanner automatically flows agents through the worker. But the worker-no-DB grep gate must re-pass — flag for Wave 0 |

**If this table is empty:** Not applicable — 8 assumptions flagged. A5, A6, A8 warrant explicit verification tasks in the plan.

## Open Questions

1. **Where does the "Available agents" block assemble?**
   - What we know: it injects in `AIChatContextAssembler.assemble()` alongside the AGENTS.md blocks, fed by `AgentDefinitionRegistry.list()`.
   - What's unclear: whether to put the pure assembler in `src/service/aifetchlyConfig/availableAgentsBlock.ts` (recommended — keeps context-assembly helpers together) or inline in the assembler.
   - Recommendation: standalone pure function — easier to unit-test in isolation (mirror `formatInstructionBlock`).

2. **Should `run_subagent`'s `agentId` parameter carry a runtime validator (zod)?**
   - What we know: today `runSubagentTool.execute` does a loose `args.agentId as string` cast (line 127). D-AgentIDs says "reject unknown IDs" — that happens at dispatch (`getById` returns null → fail). A zod regex on the parameter would be defense-in-depth.
   - What's unclear: whether the cost (tighter coupling to ID format) is worth the benefit.
   - Recommendation: NO parameter-level zod regex — let the dispatch-time `getById` reject unknown IDs. Keep the validator pure-lookup-based.

3. **Does `/agents` need a separate diagnostic-listing surface (e.g. untrusted-agent warnings)?**
   - What we know: D-AgentsList says untrusted workspace agents are simply absent (not registered). DX-02 (`/status`) surfaces diagnostic counts.
   - What's unclear: whether `/agents` should also list parse failures (e.g. "3 agent files failed validation").
   - Recommendation: NO — keep `/agents` purely a listing of registered agents. Parse failures surface via `/status` diagnostic count and the existing diagnostic pipeline. Mirrors `/help` (lists commands only) vs `/status` (counts + diagnostics).

4. **Does `WorkspaceWatchManager` need a code change for agents?**
   - What we know: `WorkspaceWatchManager` (Phase 14-02) routes workspace snapshots through `applyWorkspaceSnapshot(snapshot, trust)` via its injected `applySnapshotCallback`. The trust filter is where agents get dropped/gated — NOT the manager.
   - What's unclear: whether the manager's worker-event union (`WorkspaceWatchManagerEvent`) needs an `agentsChanged` flag.
   - Recommendation: NO manager change. The existing `changed` event already fires on any capability change; the renderer's `AIFETCHLY_CONFIG_CHANGED` payload carries summary counts. Phase 16 just widens what `applyWorkspaceSnapshot` filters.

## Environment Availability

> This phase has no new external dependencies — it is pure code/config on top of existing Phase 13/14/15 infrastructure. Step 2.6 is largely SKIPPED, but the in-tree prerequisites are verified below.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | (existing) | — |
| TypeScript | Type checking | ✓ | 5.x | — |
| zod | Frontmatter schema validation (settings.json) | ✓ | (in package.json) | — |
| TypeORM | AgentDefinition entity (built-in seeding path) | ✓ | (existing) | — |
| better-sqlite3 | agent_definitions table | ✓ | (existing) | — |
| chokidar | Workspace watcher (Phase 14, unchanged) | ✓ | ^3.6.0 | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (main-process + utilitycode configs) + Mocha (modules) |
| Config file | `vite.main.config.mjs`, `vite.utilityCode.config.mjs` |
| Quick run command | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <filter>` |
| Full suite command | `yarn testmain` |

The tsc gate runs via `test/vitest/_typecheck/globalSetup.ts` at every vitest invocation (per CLAUDE.md). Do NOT commit code that needs `AIFETCHLY_SKIP_TSC=1`.

### Existing Test Files to Mirror (the planner's template library)

| Test File | Mirrors | Why Relevant |
|-----------|---------|--------------|
| `test/vitest/main/service/CommandRegistry.test.ts` | `AgentDefinitionRegistry.test.ts` | 33 tests covering lookup order, replaceSource atomic reconciliation, defensive copies, listViews — clone with agent fixtures and D-Precedence rank |
| `test/vitest/main/service/promptCommandFrontmatter.test.ts` | `agentFrontmatter.test.ts` | Tests for buildPromptCommandDefinition validation order — clone for buildAgentDefinition |
| `test/vitest/main/service/AIFetchlyConfigLoader.commands.test.ts` | `AIFetchlyConfigLoader.agents.test.ts` | Global loader command scan tests — clone for agent scan |
| `test/vitest/main/service/workspaceWatch/WorkspaceConfigScanner.test.ts` | extend in-place | Workspace scanner — add agent cases mirroring command cases |
| `test/vitest/main/service/workspaceWatch/buildWorkspaceCommandDefinitions.test.ts` | `buildWorkspaceAgentDefinitions.test.ts` | Workspace command draft → definition conversion — clone for agents |
| `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts` | extend in-place | TRS-01 trust filter — add agent cases (trusted agents route, untrusted dropped) |
| `test/vitest/main/service/SlashCommandDispatcher.test.ts` | extend in-place | Dispatcher — add `/agents` show_result branch test |
| `test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts` | extend in-place | Assembler — add "Available agents" block injection + ordinal test |
| `test/vitest/utilitycode/agentDefinitionRegistry.test.ts` | rewrite | Current tests for the object-literal registry — update for class API (listBuiltIns stays) |
| `test/vitest/utilitycode/agentToolPolicyService.test.ts` | extend | Verify dynamic definitions flow through policy service unchanged |
| `test/vitest/main/service/runSubagentTool.test.ts` | extend | Verify updated agentId description + (optionally) dispatch via registry-first path |
| `test/vitest/main/service/AgentRuntime.test.ts` | extend | Verify registry-first resolution falls back to DB for built-ins (existing tests stay green) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGT-01 | Registry enforces built-in > user > workspace > plugin lookup order | unit | `npx vitest run --config vite.main.config.mjs AgentDefinitionRegistry` | ❌ Wave 0 (rewrite existing utilitycode test) |
| AGT-01 | Built-ins cannot be shadowed by any source | unit | (same) | ❌ Wave 0 |
| AGT-01 | `replaceSource` atomically reconciles add/change/delete/rename | unit | (same) | ❌ Wave 0 |
| AGT-02 | `agents/*.md` parsed with scoped IDs `user:agent:` / `workspace:<id>:agent:` | unit | `npx vitest run --config vite.main.config.mjs agentFrontmatter AIFetchlyConfigLoader.agents` | ❌ Wave 0 |
| AGT-02 | Tool allowlist intersected with registered tools at runtime | unit | `npx vitest run --config vite.main.config.mjs agentToolPolicyService` | ✅ (existing — extend) |
| AGT-02 | Untrusted workspace agents NOT registered (TRS-01) | unit | `npx vitest run --config vite.main.config.mjs AIFetchlyRuntimeRegistrySync.trust` | ✅ (existing — extend) |
| AGT-02 | `agent-tool-invalid` diagnostic emitted for unknown tools (non-fatal) | unit | `npx vitest run --config vite.main.config.mjs agentFrontmatter` | ❌ Wave 0 |
| AGT-03 | `run_subagent` resolves dynamic scoped IDs via registry | unit | `npx vitest run --config vite.main.config.mjs AgentRuntime runSubagentTool` | ✅ (existing — extend) |
| AGT-03 | Unknown agentId returns clear error (no fuzzy) | unit | (same) | ✅ (existing — extend) |
| AGT-03 | `/agents` lists built-in + dynamic agents sorted by precedence | unit | `npx vitest run --config vite.main.config.mjs SlashCommandDispatcher` | ✅ (existing — extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run --config vite.main.config.mjs <touched-test-filter>` + `npx tsc --noEmit`
- **Per wave merge:** `yarn testmain` (full vitest main suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`. Plus manual live-app verification that (1) `~/.aifetchly/agents/foo.md` appears in `/agents` output, (2) the model dispatches `run_subagent` with the scoped ID from the available-agents block.

### Wave 0 Gaps
- [ ] `test/vitest/main/service/AgentDefinitionRegistry.test.ts` — covers AGT-01 (replaces the existing utilitycode test; built-ins stay testable via `listBuiltIns()`)
- [ ] `test/vitest/main/service/agentFrontmatter.test.ts` — covers AGT-02 (validation order + D-ToolDiagnostic)
- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.agents.test.ts` — covers AGT-02 global scan (mirror AIFetchlyConfigLoader.commands.test.ts)
- [ ] Extend `AIFetchlyRuntimeRegistrySync.trust.test.ts` — agent trust cases (TRS-01)
- [ ] Extend `WorkspaceConfigScanner.test.ts` — agent scan cases
- [ ] Extend `SlashCommandDispatcher.test.ts` — `/agents` branch
- [ ] Extend `AIChatContextAssembler.aifetchly.test.ts` — available-agents block
- [ ] Extend `runSubagentTool.test.ts` — updated agentId description + (optional) registry-first dispatch
- [ ] Extend `AgentRuntime.test.ts` — registry-first resolution with DB fallback
- [ ] Extend `WorkerNoDbBoundary.test.ts` — verify worker-no-DB grep gate still passes after `WorkspaceConfigScanner.tryReadAgentFiles` addition

*(Framework install: none — Vitest + Mocha already configured)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | (no auth surface in this phase) |
| V3 Session Management | no | (no session surface) |
| V4 Access Control | yes | Trust filter at apply boundary (`applyWorkspaceSnapshot`) — untrusted workspace agents dropped before registry mutation (TRS-01) |
| V5 Input Validation | yes | `buildAgentDefinition` validates frontmatter (zod-equivalent fixed-order checks); `parseRestrictedFrontmatter` fails closed on ambiguous YAML; path-safety via `resolveConfigRelativePath` |
| V6 Cryptography | no | (no crypto in this phase) |
| V12 Files & Resources | yes | CFG-04 size cap (128KB agentMdBytes); CFG-05 path safety; ≤100 agents per source; WAT-02 worker-no-DB structural boundary |

### Known Threat Patterns for the Agent Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via agent `systemPrompt` body | Spoofing / Elevation | Agent system prompts are author-supplied DATA injected into the inner agent's loop, NOT the outer chat; `AgentRuntime` already enforces its own policy (denylist, allowlist intersection). Outer-chat system prompt is unaffected. |
| Tool-allowlist bypass via dynamic agent | Elevation | `AgentToolPolicyService.filterExposedToolNames` intersects `definition.allowedTools` with actually-registered tools at dispatch — dynamic agents cannot name a privileged tool into existence. V1_BLOCKED_PATTERNS denylist still applies. |
| Untrusted workspace agent auto-registration | Elevation | `applyWorkspaceSnapshot(snapshot, trust)` drops `agents` when `trust.agents === false` (TRS-01). Phase 14 binary trust = workspace-approved. |
| YAML tag execution from agent frontmatter | RCE | `parseRestrictedFrontmatter` rejects any line starting with `!` (tag directives) and fails closed on nested maps / quoted multiline / stray list items. CFG-07. |
| Path traversal via agent filename | Tampering / Info disclosure | `resolveConfigRelativePath` rejects absolute paths, `..` traversal, escaping symlinks (CFG-05). |
| Renderer reads raw agent files | Info disclosure | `/agents` returns a computed string (`show_result.content`); no file bytes cross to the renderer. TRS-07. |
| Stale-tool warning masks a real typo | (non-security) | D-ToolDiagnostic explicitly accepts false positives for late-loaded tools; the runtime intersection is authoritative at dispatch. |

## Project Constraints (from CLAUDE.md)

The following CLAUDE.md directives are LOAD-BEARING for this phase. The planner MUST verify compliance:

- **Three-layer DB architecture:** All DB logic in Model + Module, NEVER in IPC handlers. Phase 16 changes nothing about DB shape — `AgentDefinitionModel`/`AgentDefinitionModule` stay as-is.
- **Worker-no-DB:** Worker processes MUST NOT access DB/registries. Phase 16's `WorkspaceConfigScanner.tryReadAgentFiles` runs in the worker → it produces RAW drafts only (frontmatter bytes), NO validation, NO registry mutation. Validation happens in the main-process loader via `buildAgentDefinition`. WAT-02 grep gate (`WorkerNoDbBoundary.test.ts`) must still pass.
- **i18n (6 langs):** Any new chrome string (e.g. `/agents` list header if added) → all 6 lang files under `aifetchlyConfig`/`slashCommands`. Agent `name`/`description`/prompt body are author DATA, not app strings.
- **NEVER use `any`:** Use proper types or `unknown`. The cast `args.agentId as string` in `runSubagentTool.ts:127` predates this rule — leave it (it's guarded by the `if (!agentId ...)` check on line 130) but don't add new `any`.
- **zod at boundaries:** Settings JSON parsing already uses zod (`AIFetchlyConfigLoader.ts:63-73`). Agent frontmatter validation uses fixed-order checks (mirror Phase 15) — no new zod surface needed unless the planner opts for a zod schema for agent frontmatter (allowed but not required).
- **AI-feature USER_AI_ENABLED gating:** `/agents` is a local slash command (non-AI) → uses the existing `SLASH_COMMAND_DISPATCH` channel (already `registerValidatedHandler`, non-AI-gated). The actual agent *run* flows through `run_subagent` → `AgentRuntimeRegistry.runSync`, which is called from inside an AI tool execution — already behind the stream IPC's `USER_AI_ENABLED` gate. Verify ZERO `registerAiValidatedHandler` is added for the new `/agents`/list channels.
- **Child-process file placement:** Any new worker-reachable scanner code goes in `src/service/workspaceWatch/` (where `WorkspaceConfigScanner` already lives) — NOT in `src/modules/` or `src/childprocess/` unless it's a new worker entry point (it isn't).
- **Immutability:** Registry returns defensive copies (mirror `CommandRegistry.list()` / `getById()`). The existing `AgentDefinitionRegistry.listBuiltIns().map(d => ({...d}))` pattern is preserved.
- **Auto-commit after each function:** (process convention — each committed unit gets its own commit).
- **Console.log prohibition:** No `console.log` in production code. Use `console.error` in graceful-degradation paths (mirrors `AIChatContextAssembler.ts:174-178`).

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `src/service/AgentRuntime.ts:63-77` — current dispatch resolution path (defModule.getActiveById)
- `src/service/AgentDefinitionRegistry.ts:1-69` — refactor target (object literal, only 1 prod consumer)
- `src/modules/AgentDefinitionModule.ts:15-30` — ensureBuiltIns / listActive / getActiveById
- `src/model/AgentDefinition.model.ts:60-75` — DB-backed getActiveById / listActive
- `src/service/AgentRuntimeRegistry.ts:14-23` — singleton getRuntime
- `src/service/agentTools/runSubagentTool.ts:49-161` — RUN_SUBAGENT_TOOL definition + execute path
- `src/service/AgentToolPolicyService.ts:136-153` — filterExposedToolNames (unchanged)
- `src/service/slashCommands/CommandRegistry.ts:26-158` — registry template (SOURCE_RANK, replaceSource, rebuildNameIndex)
- `src/service/slashCommands/promptCommandFrontmatter.ts:97-242` — validator template
- `src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts:56-146` — restricted frontmatter parser (already supports tools array)
- `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts:270-408` — tryReadCommandFiles template for tryReadAgentFiles
- `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:103-116` — applyWorkspaceSnapshot trust filter (extend with `agents`)
- `src/service/aifetchlyConfig/AIFetchlyConfigManager.ts:111-120,159-170` — manager owns CommandRegistry; widen to also own AgentDefinitionRegistry
- `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts:30-51,89-106` — agentMdBytes, maxAgentsPerSource, COMMAND_NAME_REGEX, AIFETCHLY_DIAGNOSTIC_CODES (agent-name-invalid + agent-tool-invalid reserved)
- `src/service/workspaceWatch/WorkspaceConfigScanner.ts:107-171,410-521` — scanner returns `agents: []` today; add tryReadAgentFiles
- `src/service/slashCommands/builtinSlashCommands.ts:27-76` — /status template for /agents
- `src/service/slashCommands/SlashCommandDispatcher.ts:152-202` — dispatchLocal show_result branch template
- `src/service/AIChatContextAssembler.ts:163-179` — AGENTS.md injection template for available-agents block
- `src/entityTypes/aifetchlyConfigTypes.ts:81-103,138-144` — snapshot type (agents: readonly unknown[]) + AIFetchlySourceTrust (agents flag exists)
- `src/entityTypes/agentTypes.ts:32-46` — AgentDefinitionView field set
- `src/main-process/communication/agent-runtime-ipc.ts:33-40` — AGENT_DEFINITION_LIST (DB-backed, separate from /agents)
- `src/background.ts:673-677` — ensureBuiltIns startup call (unchanged)

### Secondary (MEDIUM confidence — prior-phase SUMMARYs)
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md` — CommandRegistry pattern provenance
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md` — AIChatContextAssembler injection pattern
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-03b-SUMMARY.md` — built-in local command + show_result branch + TRS-05 Strategy A
- `.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md` — WorkspaceConfigScanner (returns agents: [] today)
- `.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md` — applyWorkspaceSnapshot trust filter (extend with agents)
- `.planning/phases/15-prompt-command-files/15-CONTEXT.md` — the direct analog (D-01..D-04 carry over)

### Tertiary (LOW confidence — none)
- (All claims verified against the codebase or prior-phase artifacts.)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all infrastructure verified in-tree
- Architecture: HIGH — dispatch path traced end-to-end with file:line evidence; open question settled with a concrete minimal change
- Pitfalls: HIGH — 8 pitfalls identified from codebase inspection + prior-phase lessons (Phase 13-02 deviation log, Phase 14-02 trust filter)
- Test layout: HIGH — 12 existing test files identified as direct mirrors

**Research method:** Pure codebase forensics. No external library/docs research required (the phase installs zero packages and clones only in-tree patterns). The `<tool_strategy>` research-plan seam was not invoked because there are no docs/library questions to answer — every claim is verified against source files or prior-phase SUMMARYs in this repository.

**Research date:** 2026-07-08
**Valid until:** 2026-08-07 (30 days — stable; phase is a pure refactor with no moving-target dependencies)
