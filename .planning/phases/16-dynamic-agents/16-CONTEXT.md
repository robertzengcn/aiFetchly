# Phase 16: Dynamic Agents - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor `AgentDefinitionRegistry` for **source-aware dynamic registration**, parse `agents/*.md` into `AgentDefinitionView`s with scoped IDs, and wire `run_subagent` + a new `/agents` built-in command to dispatch/list them. This mirrors the Phase 15 (prompt commands) pipeline almost exactly — markdown -> validated definition -> registry `replaceSource` -> dispatch — but for agents.

In scope (delivers AGT-01, AGT-02, AGT-03):

- **Refactor `AgentDefinitionRegistry`** from its current static `BUILT_INS` object literal into a class with `listBuiltIns()` / `list()` / `getById(id)` / `replaceSource(sourceId, agents)` (AGT-01, tech-design §7.4). Lookup order **built-in > user > trusted workspace > plugin**; built-ins cannot be shadowed.
- **Parse `agents/*.md`** frontmatter (name, description, tools allowlist, maxToolCalls, maxRuntimeMs, prompt body) -> `AgentDefinitionView` -> register with scoped IDs `user:agent:<name>` and `workspace:<workspaceId>:agent:<name>` (AGT-02).
- **Source-replacement reconciliation** via the new `replaceSource` (add/change/delete/rename, live — no restart), exactly as `CommandRegistry.replaceSource` does for commands.
- **Workspace-agent trust gating** via the Phase 14 `applyWorkspaceSnapshot(snapshot, trust)` filter — untrusted workspace agents are NOT registered (AGT-02, TRS-01).
- **`run_subagent` validation + description update** to dispatch by dynamic scoped ID (AGT-03).
- **`/agents` built-in command** (the CMD-03 "future item") listing built-in + dynamic agents.
- **Tool-allowlist runtime intersection** with actually-registered + permitted tools (AGT-02) — the existing `AgentToolPolicyService` already does this; dynamic agents must flow through it.

**Out of scope (locked boundaries — do NOT pull in):**
- Hooks (Phase 17), per-capability trust entity `AIFetchlyWorkspaceTrust` (Phase 17), skills/plugins (Phase 18).
- Plugin-sourced agents (`plugin:<name>:agent:`) — PRD §7.4 rule: "Plugin agents should be enabled only after dynamic agent registration is stable." Phase 16 ships built-in + user + trusted-workspace sources only; plugin is Phase 18.
- Replacing the existing agent runtime (`AgentRuntimeRegistry` / `AgentRuntime` / `AgentToolPolicyService`) — this phase feeds dynamic definitions INTO the existing runtime; it does not rewrite the runtime loop.
- `outputSchema` authoring in markdown, positional/context tokens, fuzzy agent search — not in this phase (see Claude's Discretion / Deferred).

</domain>

<decisions>
## Implementation Decisions

### Name Precedence
- **D-Precedence: User wins over workspace (follow AGT-01 literally).** Lookup order is `built-in > user > trusted workspace > plugin`. Built-in IDs still cannot be shadowed by any source. **This intentionally diverges from commands**, where Phase 15 D-03 + Phase 13 `CommandRegistry.SOURCE_RANK` made *workspace* win over user/global. Rationale: AGT-01 and tech-design §7.4 state the agent order explicitly and it is the locked requirement for THIS phase; agents follow their own spec rather than inheriting the command registry's ordering. The divergence is accepted and must be documented in source (a comment on the agent registry's rank map) so a future reader does not "fix" it to match commands. No conflict diagnostic for same-name-across-sources in Phase 16 — shadowing is silent (the `/agents` source badge disambiguates which entry is active), mirroring Phase 15 D-03's silent-shadow choice.

### AI Discovery & Dispatch IDs
- **D-Discovery: Context injection (not a dynamic tool description).** The AI model discovers available agents via an **"Available agents" block injected into the AiChatV2 system message** through the existing `AIChatContextAssembler` pipeline — the same path `AGENTS.md` instructions use (Phase 13-03a `AIFetchlyContextStore` / context loader). The block lists agent IDs + one-line descriptions, scoped by source, rebuilt when the registry mutates (on `AIFETCHLY_CONFIG_CHANGED`). `run_subagent`'s tool description stays **generic** and points to the context block + the scoped-ID format; it does NOT enumerate agents. Rationale: reuses Phase 13/14 injection infra, keeps the tool def static (no skillsRegistry churn), and decouples agent discovery from the tool-serialization path. The context block is the single source of truth for "what can I call."
- **D-AgentIDs: Exact IDs only — no bare-name fuzzy resolution.** `run_subagent` takes the `agentId` **verbatim** as it appears in the available-agents block: a bare built-in ID (`agent-lead-researcher`) or a scoped dynamic ID (`user:agent:lead-researcher`, `workspace:<id>:agent:lead-researcher`). Resolution is via `getById` (precedence-aware). The dispatcher does **not** guess a bare name like `lead-researcher` across sources — if the ID is not in the registry, dispatch returns a clear "unknown agent" error. This sharpens AGT-03's "validation updated": reject unknown IDs rather than silently fuzzy-resolving (which would mask D-Precedence). Update the `agentId` parameter description accordingly (drop "Built-in agent ID" wording; describe both ID forms + point to the available-agents block).

### `/agents` Command & Diagnostics
- **D-AgentsList: id + name + short description + source badge, sorted by precedence.** `/agents` is a new **built-in local slash command** (returns `action: "show_result"`, like `/status`). One row per agent: `<id> — <name>: <description> [<source badge>]`, sorted built-in -> user -> workspace -> plugin. Source badges (Built-in / User / Workspace) **reuse the existing Phase 13 `slashCommands` i18n keys** (no new badge strings). If any new chrome string is needed (e.g. a list header), add it to all 6 lang files (en, zh, es, fr, de, ja) under the `aifetchlyConfig`/`slashCommands` group. Untrusted workspace agents are simply absent (not registered) — no distinct "disabled" row.
- **D-ToolDiagnostic: Parse-time warning for unknown tool names (non-fatal).** When an agent's `tools:` list references a tool name not currently registered, emit a **DX-01 `agent-tool-invalid` diagnostic** (non-fatal — does NOT block registration). The runtime intersection (`AgentToolPolicyService`) still runs at dispatch and grants the agent only the intersection; the diagnostic is purely author-facing early feedback. Rationale: the built-in lead-researcher shipped with a stale `google_search` tool ref that had to be removed by hand — silent typos cost real debugging time, and DX-01 already reserves the `agent-tool-invalid` code. Accepted tradeoff: a tool loaded late (MCP/skill registered after the agent file is parsed) can produce a stale warning until the next rescan; this is acceptable for a non-fatal diagnostic.

### Carry-Forward from Prior Phases (locked, do not re-litigate)
- **Frontmatter parser (Phase 13-01, locked):** reuse the restricted markdown frontmatter parser (initial `---` block only, scalars + string arrays, no YAML tag execution, fails closed, body preserved). Agent frontmatter adds a `tools` string-array field on top of the same parser.
- **Size cap (CFG-04, locked):** `agentMdBytes = 128 * 1024` in `AIFetchlyConfigConstants`. Oversized agent file -> diagnostic + skipped. Already enforced by the scanner shape; verify the agent-file path uses this constant.
- **Source replacement (Phase 13-02, locked):** `replaceSource(sourceId, entries)` atomically reconciles add/change/delete/rename so stale entries never survive. Phase 16's `AgentDefinitionRegistry.replaceSource` mirrors `CommandRegistry.replaceSource` exactly.
- **Trust gating (Phase 14-02, locked):** workspace agent entries pass through `applyWorkspaceSnapshot(snapshot, trust)` before registry mutation. Untrusted workspace -> agents dropped (TRS-01). Phase 16 adds NO new trust surface and reuses Phase 14's binary trust (per-capability entity is Phase 17).
- **Three-layer DB / worker-no-DB (CLAUDE.md, locked):** the workspace-config WORKER (Phase 14) only snapshots files and returns them — it does NOT parse-validate agents, mutate registries, or touch the DB. Agent frontmatter validation + registry mutation happen in the MAIN process. Worker-no-DB grep gate (WAT-02 pattern) must cover any new worker-side agent fields.
- **AI-feature IPC checks `USER_AI_ENABLED` first (CLAUDE.md + Phase 13 TRS-05 Strategy A, locked):** `/agents` listing and agent-list/status IPC are NOT AI-serving -> use `registerValidatedHandler` (non-AI-gated), like `slash-command-ipc.ts`. The actual agent *run* flows through the existing `run_subagent` -> `AgentRuntimeRegistry.runSync` path which is already behind the stream IPC's `USER_AI_ENABLED` gate. Verify ZERO `registerAiValidatedHandler` is needed for the new `/agents`/list channels.
- **i18n (CLAUDE.md, locked):** agent `name`/`description`/prompt body are author-supplied DATA, not app strings. Reuse Phase 13 source-badge keys; add any new chrome string to all 6 lang files.
- **Preload dual whitelists (Phase 13, locked):** `/agents` reuses the existing `SLASH_COMMAND_DISPATCH` channel (it's a built-in local command). The agent-list context block flows through the existing context-assembly path, not a new IPC channel. Verify no new preload whitelist is needed; if an agent-list IPC is added for `/agents` or diagnostics, add it to both preload whitelists.
- **NEVER use `any`**; immutability (return copies, never hand out internal array refs — current `listBuiltIns` already `.map(d => ({...d}))`); explicit error handling; zod at boundaries.

### Claude's Discretion
- **Custom-agent frontmatter schema details (the area the user deferred).** Default to the PRD §7.4 example fields as author-settable: `name` (`^[a-z][a-z0-9_-]*$`, same regex as commands), `description` (<=500 chars, reuse CMD-06 bound), `tools` (string array of registered tool names), `maxToolCalls` (int), `maxRuntimeMs` (int), and the non-empty prompt body. System-default the remaining `AgentDefinitionView` fields: `mode` -> `"specialist"` (dynamic agents are specialists), `version` -> `1`, `status` -> `"active"`, `maxContinueCalls` -> a sane default (built-in uses 8; reuse or cap it), `outputSchema` -> **none** (dynamic agents return freeform text; structured `outputSchema` authoring via fenced JSON is deferred — see Deferred). The researcher should confirm the exact field set against `AgentDefinitionView` and the validator order (mirror Phase 15 `buildPromptCommandDefinition`: name -> description -> tools -> numeric bounds -> body non-empty; first violation wins).
- Exact `replaceSource`/rank-map data structure inside `AgentDefinitionRegistryImpl` — mirror `CommandRegistry`'s `SOURCE_RANK` + `rebuildNameIndex` pattern (Phase 13-02), but with the agent rank order from D-Precedence.
- Where the "Available agents" context block assembles (a small pure assembler fed by `AgentDefinitionRegistry.list()`, injected alongside the AGENTS.md blocks in `AIChatContextAssembler`) — planner picks, reusing the Phase 13-03a context-store pattern.
- Diagnostic wording for `agent-tool-invalid` / `agent-name-invalid` / oversized-agent — reuse the Phase 13/14 `diagnostic(sourceId, path, kind, message, fatal)` shape.
- Whether to unit-test precedence at the registry level, the dispatch level, or both (recommend both — registry invariant + end-to-end `run_subagent` resolution).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked design (authoritative)
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §7.4 (Dynamic AgentDefinitionRegistry — the class shape + lookup order), §2.4 (Agent runtime — how `runSync` resolves an agent), §8 (Runtime Registry Sync — `applySnapshot`/`removeSource`, trust filtering), §16.1 (data flow), §21 (Testing) — **the registry refactor contract**.
- `docs/prd/aifetchly-local-extensibility-prd.md` §7.4 `agents/*.md` (frontmatter example, scoped-ID rules, runtime behavior, "plugin agents later"), UC-7 (Dynamic agent can be invoked) — **PRIMARY requirements source for AGT-01/02/03**.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — AGT-01, AGT-02, AGT-03 (Phase 16, Pending); DX-01 (reserve `agent-tool-invalid` code — used by D-ToolDiagnostic); CFG-04 (agent file 128KB cap); TRS-01 (workspace trust before registration); TRS-05 (AI-gating strategy).
- `.planning/ROADMAP.md` §Phase 16 — goal + 3 success criteria.

### Prior-phase surfaces this phase consumes (read the SUMMARYs / CONTEXT)
- `.planning/phases/15-prompt-command-files/15-CONTEXT.md` — **THE analog.** The markdown -> validated definition -> `replaceSource` -> dispatch pipeline Phase 16 copies; D-01..D-04 (silent shadow, diagnostics, source badges) carry over.
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md` — `CommandRegistry.replaceSource` + `SOURCE_RANK` + `rebuildNameIndex` (the registry pattern to clone for `AgentDefinitionRegistryImpl`).
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md` — `AIChatContextAssembler` + `AIFetchlyContextStore` + context loader (where the "Available agents" block injects per D-Discovery).
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-03b-SUMMARY.md` — built-in local command shape + `SLASH_COMMAND_DISPATCH` returning `show_result` (the `/agents` command mirrors `/status`).
- `.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md` — `applyWorkspaceSnapshot(snapshot, trust)` trust filter (workspace-agent gating happens here).
- `.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md` — `WorkspaceConfigScanner` (verify whether it already scans `agents/*.md` into the snapshot or whether Phase 16 adds agent parsing to the scan; the snapshot type already has an `agents[]` slot per CFG-06).

### Project rules + constants
- `./CLAUDE.md` — three-layer DB, worker-no-DB, i18n (6 langs), no `any`, zod at boundaries, AI-feature `USER_AI_ENABLED` gating, child-process file placement.
- `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` — `AIFETCHLY_CONFIG_LIMITS.agentMdBytes = 128 * 1024` (CFG-04 agent-file size cap).

### Core source files (current state — refactor/integration targets)
- `src/service/AgentDefinitionRegistry.ts` — **refactor target.** Today an object literal over a `BUILT_INS` array with only `listBuiltIns()` + `getById()`. Becomes `AgentDefinitionRegistryImpl` class with `listBuiltIns`/`list`/`getById`/`replaceSource` (AGT-01).
- `src/service/agentTools/runSubagentTool.ts` — `RUN_SUBAGENT_TOOL`. Update `agentId` description + validation per D-AgentIDs / AGT-03 (accept bare built-in + scoped dynamic IDs; reject unknown). Resolves via `AgentRuntimeRegistry.getRuntime().runSync()`.
- `src/modules/AgentDefinitionModule.ts` — `ensureBuiltIns()` / `listActive()` / `getActiveById()` (DB layer via `AgentDefinition.model.ts`).
- `src/service/AgentToolPolicyService.ts` — runtime tool-allowlist intersection (+ `MANDATORY_INFRASTRUCTURE_TOOLS` auto-injection). Dynamic agents MUST flow through this (AGT-02). Source of the intersection D-ToolDiagnostic complements.
- `src/service/AgentRuntimeRegistry.ts` (+ `AgentRuntime.ts`) — the runtime resolution path. **See open question in `<code_context>`.**
- `src/config/skillsRegistry.ts` — where `RUN_SUBAGENT_TOOL` is registered (line ~67); stays static per D-Discovery.
- `src/entityTypes/agentTypes.ts` — `AgentDefinitionView`, `RunAgentRequest`, `AgentTaskPacket` (the types the validator produces / dispatcher consumes).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`CommandRegistry` (Phase 13-02)** — the structural template for `AgentDefinitionRegistryImpl`: `SOURCE_RANK` map + `rebuildNameIndex` on every mutation + `replaceSource` atomic reconciliation. Clone the pattern; change only the rank order (D-Precedence) and the entry type.
- **`buildPromptCommandDefinition` (Phase 15-01)** — the single-owner validator pattern. Phase 16 writes a `buildAgentDefinition`/`buildDynamicAgentView` analog: fixed validation order, first violation wins, stable scoped-ID format.
- **`AIFetchlyConfigLoader` / restricted frontmatter parser (Phase 13-01)** — already parses `commands/*.md`; the same parser handles `agents/*.md` (adds the `tools` array field).
- **`applyWorkspaceSnapshot(snapshot, trust)` (Phase 14-02)** — the trust gate workspace agents pass through before reaching the registry.
- **`AIChatContextAssembler` + `AIFetchlyContextStore` (Phase 13-03a)** — the injection point for the "Available agents" context block (D-Discovery); reuse the labeled-block + in-memory-cache + graceful-degradation shape.
- **`AgentToolPolicyService`** — already intersects agent allowlists with registered+permitted tools at runtime and auto-injects infrastructure tools. Dynamic agents reuse it unchanged; D-ToolDiagnostic adds an author-facing parse-time warning on top.

### Established Patterns
- **Source-replacement on scan** — every workspace rescan calls `replaceSource("workspace:" + workspaceId, entries)`; renames/deletes reconcile automatically (SC3 for commands; same applies to agents).
- **Diagnostic shape** — `diagnostic(sourceId, path, kind, message, fatal)` / `ioDiagnostic`; invalid frontmatter / oversized file / unknown tool / duplicate name -> diagnostic + skip (SC for agents).
- **Built-in local command** — `/agents` returns `{action: "show_result", ...}` via the existing dispatcher (the Phase 13 "show_result" branch), mirroring `/status`.
- **Scoped-ID convention** — `user:agent:<name>`, `workspace:<workspaceId>:agent:<name>` (PRD §7.4), paralleling `user:command:<name>` / `workspace:<id>:command:<name>` from Phase 15.

### Integration Points
- `WorkspaceConfigScanner.scan()` (Phase 14) -> snapshot `agents[]` -> `applyWorkspaceSnapshot(snapshot, trust)` filters by trust -> for trusted workspaces, agent entries flow into `AgentDefinitionRegistry.replaceSource("workspace:" + workspaceId, ...)`. Global agents flow from the global loader (`~/.aifetchly/agents/*.md`) into `replaceSource("user", ...)`.
- `SLASH_COMMAND_DISPATCH` IPC — `/agents` is a built-in local command resolved by the Phase 13 dispatcher's `show_result` branch (no new dispatch channel).
- Context assembly — `AIChatContextAssembler.assemble()` gains an "Available agents" block sourced from `AgentDefinitionRegistry.list()`, emitted on every chat request (cached, rebuilt on `AIFETCHLY_CONFIG_CHANGED`).
- `run_subagent` execute path — `agentId` -> registry `getById` -> `AgentRuntimeRegistry.runSync`; dynamic definitions must be visible on this path.

### Open architectural question (flag for researcher — NOT a user-vision call)
The refactored registry is **in-memory with `replaceSource`** (tech-design §7.4, like `CommandRegistry` — commands are NOT persisted). But the **current agent runtime resolves definitions from the `AgentDefinition` DB table** (`AgentDefinitionModule.getActiveById` <- `AgentDefinition.model.ts`), and built-ins are seeded into that table at startup via `ensureBuiltIns()`. Dynamic agents therefore need a defined resolution path. Likely resolution (researcher to confirm): `AgentDefinitionRegistry.list()`/`getById()` becomes the single source of truth for *which agents exist* (built-ins + user + workspace), `run_subagent`/dispatch resolves dynamic IDs from the **registry**, and the DB continues to back the agent *task/execution* runtime + built-in seeding. The researcher must trace `AgentRuntimeRegistry.runSync` -> definition lookup and decide whether dynamic agents are (a) resolved from the in-memory registry, (b) also upserted into the DB with scoped IDs, or (c) both. This determines the core wiring and must be settled in RESEARCH.md before planning.

</code_context>

<specifics>
## Specific Ideas

- **D-Precedence rationale to record in source:** the agent rank order (`built-in > user > workspace > plugin`) deliberately differs from commands (`built-in > workspace > user`). Add a comment on the agent registry's rank map citing AGT-01/tech-design §7.4 so a future reader does not "normalize" it to match `CommandRegistry.SOURCE_RANK`.
- **D-Discovery shape:** the "Available agents" block should read like the slash-suggestions metadata — ID + one-line description + source — so the model can copy the exact ID straight into `run_subagent` (ties to D-AgentIDs "exact IDs only").
- **D-ToolDiagnostic motivation:** the built-in lead-researcher shipped referencing `google_search` (no such skill) and it was removed by hand (see the comment block in `AgentDefinitionRegistry.ts`). A parse-time `agent-tool-invalid` warning would have caught it immediately — this is the concrete case the diagnostic exists to prevent.
- **Scoped-ID examples (PRD §7.4):** `user:agent:lead-researcher`, `workspace:<workspaceId>:agent:lead-researcher`. Built-ins keep their existing bare form (`agent-lead-researcher`).

</specifics>

<deferred>
## Deferred Ideas

- **`outputSchema` authoring in `agents/*.md`** (structured JSON output schemas via a fenced block, like the built-in lead-researcher's `LEAD_RESEARCHER_OUTPUT_SCHEMA`) — deferred; Phase 16 dynamic agents default to freeform text output. Structured-output authoring needs its own schema-validation + trust story. (This was the "Custom-agent schema" gray area the user declined to discuss.)
- **Plugin-sourced agents** (`plugin:<name>:agent:<name>`) — explicitly Phase 18 (PRD §7.4 "plugin agents only after dynamic registration is stable"; SKL-02). Phase 16 ships built-in + user + trusted-workspace only, but the registry rank map should reserve the `plugin` rank so Phase 18 just fills it in.
- **Bare-name fuzzy resolution** in `run_subagent` (e.g. resolve `lead-researcher` across sources by precedence) — rejected for Phase 16 via D-AgentIDs; revisit only if UX feedback shows model/users routinely type bare names.
- **Per-capability workspace trust** (agents capability flag on `AIFetchlyWorkspaceTrust`) — Phase 17 (TRS-02). Phase 16 reuses Phase 14's binary trust.
- **Conflict diagnostic** for same-name user-vs-workspace collisions — deferred (D-Precedence makes shadowing silent; the `/agents` source badge disambiguates).

</deferred>

---

*Phase: 16-dynamic-agents*
*Context gathered: 2026-07-07*
