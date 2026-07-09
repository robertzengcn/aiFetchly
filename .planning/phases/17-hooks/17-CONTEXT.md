# Phase 17: Hooks - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate the **existing** `src/service/hooks/` subsystem with the local-extensibility pipeline: parse `hooks/hooks.json` from user-global and trusted-workspace config, add source-aware `replaceSource`/`unregisterSource` to the existing `HookRegistry`, gate workspace hooks behind trust inside `applyWorkspaceSnapshot`, enforce that workspace hook actions **never execute shell in the main process**, and evolve Phase 14's binary workspace trust into the persisted per-capability `AIFetchlyWorkspaceTrust` entity (TRS-02) — ready for Phase 18 skills/plugins.

This is an **integration + trust-evolution** phase, NOT greenfield hook construction. The hook runtime (`HookRegistry`, `HookDispatcher`, `HookMatcher`, `HookOutputValidator`, `HookResultAggregator`, `HookAuditService`, `CommandHookExecutor`, `CallbackHookExecutor`, `ClaudeHooksAdapter`, `builtinHooks`) already exists. Phase 17 wires it into the snapshot→trust→registry pipeline that Phases 13–16 established for commands/agents, and persists per-capability trust.

In scope (delivers TRS-02, HOK-01, HOK-02):

- **`hooks/hooks.json` parsing** (user-global `~/.aifetchly/hooks/` + trusted-workspace `<ws>/.aifetchly/hooks/`) → `HookDefinitionView`s with scoped source IDs, mirroring the Phase 15/16 command/agent loader. Reuses the restricted frontmatter/JSON parser + size/count caps (CFG-04/CFG-06).
- **`HookRegistry.replaceSource(sourceId, hooks)` / `unregisterSource(sourceId)`** (HOK-01, tech-design §7.5) — atomic add/change/delete/rename reconciliation mirroring `CommandRegistry.replaceSource` / `AgentDefinitionRegistry.replaceSource`. If the existing `HookRegistry` runtime types differ, add an adapter in `AIFetchlyRuntimeRegistrySync` (tech-design §7.5 caveat).
- **Trust filter widening** — `applyWorkspaceSnapshot` gains a `hooks:` line mirroring Phase 16's `agents:` line (`hooks: trust.hooks ? snapshot.hooks : []`), so untrusted-workspace hooks are dropped BEFORE registry mutation (TRS-01/TRS-02).
- **Per-capability trust entity `AIFetchlyWorkspaceTrust`** (TRS-02) — new TypeORM entity + Model + Module persisting per-capability flags (`instructions`/`commands`/`agents`/`hooks`/`skills`). Replaces the in-memory binary approval cache that Phase 14's `WorkspaceWatchManager` bridges today.
- **No-main-process-shell enforcement** (HOK-02) — workspace/user hook **command** actions route through a worker/sandbox boundary (NOT the Electron main process). The existing `CommandHookExecutor` uses `spawn` (`shell:false`) — Phase 17 ensures its invocation path for config-sourced hooks goes through the boundary worker.
- **Diagnostics** — hook failures non-fatal (surface as diagnostics); unsupported events produce diagnostics (HOK-02 SC4). Mirror the Phase 13–16 diagnostic shape.

**Out of scope (locked boundaries — do NOT pull in):**
- Skills and plugins (Phase 18). `skill:` references in hooks.json are PARSED this phase but resolve to a non-fatal "skill not yet available" diagnostic until the Phase 18 skill registry exists.
- Plugin-sourced hooks (`plugin:<name>:hook:`) — Phase 18 (SKL-02). The trust rank/flags reserve `skills`/`plugin` now.
- Hook input MODIFY/rewrite semantics (PreToolUse can DENY or PASS only this phase — see D-Blocking).
- Granular per-capability trust approval UX (checkboxes) — the entity ships with per-capability flags, but v2.0 approval stays binary (see D-TrustUX). Granular UX is deferred.
- Rewriting the existing hook runtime loop (`HookDispatcher` dispatch, `HookResultAggregator` aggregation) — Phase 17 feeds config-sourced hooks INTO the existing dispatcher; it does not rewrite the dispatch loop.

</domain>

<decisions>
## Implementation Decisions

### Workspace Hook Action Vocabulary
- **D-Vocabulary: Command + skill-reference.** A workspace `hooks.json` entry may declare EITHER a sandboxed command string (e.g. `"command": "node .aifetchly/hooks/format.js"`) OR a `"skill": "<name>"` reference. Commands route through the execution-boundary worker (never the main process — HOK-02). `skill:` references are parsed and stored but resolve to a **non-fatal "skill registry not yet available" diagnostic** until Phase 18 ships the skill registry; the hook is registered but its skill action is a documented no-op until then. This is the PRD §7.6 direction ("worker or registered skill"). User-global (`~/.aifetchly/hooks/`) uses the SAME vocabulary (mirror prior phases: same parser/format for global + workspace, trust is the only difference).
- **Side-effect — execution-boundary direction LOCKED:** because command hooks are allowed and HOK-02 forbids main-process execution, config-sourced command hooks MUST execute in the worker/sandbox boundary. The EXACT mechanism (reuse the Phase 14 watcher worker vs a new dedicated hook-execution worker vs a sandboxed child_process) is a research item (see Claude's Discretion), but the constraint is fixed: no `spawn` of config-sourced hook commands from the main process. The existing `CommandHookExecutor` (which today calls `spawn` with `shell:false`) becomes the worker-side executor or is invoked via a worker round-trip.

### PreToolUse Blocking Power
- **D-Blocking: PreToolUse can DENY (gate) or PASS.** A PreToolUse hook returns PASS (allow the tool call) or DENY (block it, with a reason surfaced to the model/user). This mirrors Claude Code's exit-code-2 deny semantics AND AiFetchly's own PreToolUse hook that blocks Write/Edit on `.md` files outside `/docs/` (the live precedent). DENY is the high-value, well-understood case.
- **Other events are observe+inject only:** `PostToolUse` (cannot deny retrospectively), `SessionStart`, `Stop` — these hooks may inject context / observe / log but cannot gate. This mapping mirrors Claude's hook semantics and falls out of D-Blocking naturally (only a pre-event can gate).
- **Modify/rewrite is DEFERRED** — PreToolUse cannot rewrite tool input arguments this phase (deny-or-pass only). Input rewriting is a subtler attack vector and lower value; revisit post-v2.0.
- **Workspace DENY requires trust** — a workspace PreToolUse hook that can DENY tool calls is powerful (could DoS-gate every call), so it is gated behind `trust.hooks` (TRS-02) exactly like other workspace capabilities. Built-in and user-global PreToolUse deny hooks are not workspace-sourced, so they are not subject to workspace trust.

### Per-Capability Trust UX + Migration
- **D-TrustUX: Binary approve = all capabilities.** v2.0 keeps Phase 14's binary workspace approval card (`WorkspaceTrustCard.vue`, 4 TRS-03 options). Approving a workspace sets ALL capability flags (`instructions`/`commands`/`agents`/`hooks`/`skills`) trusted together. The `AIFetchlyWorkspaceTrust` entity STILL ships with independent per-capability columns (TRS-02 satisfied — the deliverable is the persisted per-capability entity), but v2.0 writes them as a block on approval. Granular per-capability approval UX (checkboxes) is deferred — the entity enables it later without a migration.
- **D-Migration: Existing Phase-14-trusted workspaces migrate to all-capabilities-trusted automatically.** When the entity is introduced, any workspace already binary-trusted under Phase 14 is seeded with ALL capability flags = trusted (preserves current behavior, no re-approval friction). Untrusted workspaces stay all-untrusted. STATE.md already foreshadowed this ("per-capability trust entity added in Phase 17").
- **Trust filter stays per-capability in shape** — `AIFetchlyRuntimeRegistrySync` already reads `trust.instructions`/`trust.commands`/`trust.agents`; Phase 17 adds `trust.hooks` (and reserves `trust.skills`). Under D-TrustUX these are all the same boolean (the binary approval), but the per-capability READ path remains so the granular future works without touching the sync code again.
- **The Phase 14 sync approval cache is replaced** — today `WorkspaceWatchManager` bridges async `WorkspaceResolver.resolve` to a sync `trustResolver` via an in-memory approval cache (STATE.md decision `[14-03]`). Phase 17 swaps that cache for reads from the persisted `AIFetchlyWorkspaceTrust` entity (Module/Model), per the three-layer DB architecture.

### Carry-Forward from Prior Phases (locked, do not re-litigate)
- **Source replacement (Phase 13-02 / 15 / 16, locked):** `HookRegistry.replaceSource(sourceId, hooks)` mirrors `CommandRegistry.replaceSource` / `AgentDefinitionRegistry.replaceSource` — atomic delete-then-insert + rebuild index so stale entries never survive. `unregisterSource(sourceId)` is the delete path.
- **Trust filter line (Phase 16, locked):** the new `hooks:` line in `applyWorkspaceSnapshot` is a one-liner mirroring the `agents:` line added in Phase 16 (`AIFetchlyRuntimeRegistrySync.ts:165`).
- **Diagnostic shape (Phase 13–16, locked):** `diagnostic(sourceId, path, kind, message, fatal)` / `ioDiagnostic`. Unsupported event / invalid hooks.json / oversized file / hook failure → diagnostic + skip/non-fatal.
- **Restricted parser + caps (Phase 13-01, locked):** reuse the restricted JSON/frontmatter parser (fails closed, no arbitrary code). CFG-04 size cap + CFG-06 count cap apply to `hooks.json` / hook files.
- **Three-layer DB / worker-no-DB (CLAUDE.md, locked):** the `AIFetchlyWorkspaceTrust` entity lives in `src/entity/` + `src/model/` + `src/modules/` (NEVER in IPC handlers). The workspace-config WORKER (Phase 14) snapshots `hooks/hooks.json` as RAW drafts only — it does NOT validate, mutate registries, execute hooks, or touch the DB. Hook validation + registry mutation + execution coordination happen in the MAIN process (execution itself routes to the worker per D-Vocabulary). WAT-02 grep gate must still pass.
- **i18n (CLAUDE.md, locked):** hook matchers/commands/deny-reasons are author DATA, not app strings. Any new chrome string (e.g. a hook-deny reason prefix surfaced in UI) → all 6 lang files. Reuse Phase 13 source-badge keys where applicable.
- **NEVER use `any`**; immutability (defensive copies on registry accessors — mirror `CommandRegistry.list()`/`getById()`); explicit error handling; zod at boundaries (the existing settings-JSON parsing already uses zod).
- **AI-feature USER_AI_ENABLED gating (TRS-05 Strategy A, locked):** hook list/diagnostic IPC (if any) is NON-AI-serving → `registerValidatedHandler` (not `registerAiValidatedHandler`). Hook DISPATCH that influences an AI tool call (PreToolUse deny) happens inside the existing tool-execution path (already behind the stream IPC's `USER_AI_ENABLED` gate). Verify ZERO `registerAiValidatedHandler` is added for hook channels.

### Claude's Discretion
- **Execution-boundary mechanism (the open research item):** D-Vocabulary locks the CONSTRAINT (config-sourced command hooks never run in main) but not the mechanism. Options the researcher should evaluate against the existing `CommandHookExecutor` (`spawn`, `shell:false`) and the Phase 14 worker (scan-only, worker-no-DB): (a) reuse the Phase 14 watcher worker process for hook command execution (changes its role from scan-only — verify against WAT-02); (b) a NEW dedicated hook-execution worker/sandboxed `child_process` (cleanest separation, new entry point in `src/childprocess/`); (c) a restricted in-process executor with a tight allowlist. Recommend (b) for isolation, but the researcher traces `CommandHookExecutor` + the Phase 14 worker protocol and decides.
- **`hooks.json` schema details** — exact field names/shapes for matchers + command/skill actions. Align with the existing `HookDefinitionView` / `HookMatcher` types and the `ClaudeHooksAdapter` shape (drop-in Claude compat is a bonus, not a hard requirement per D-Vocabulary).
- **`HookRegistry` adapter vs direct method** — tech-design §7.5 says add `replaceSource`/`unregisterSource`, OR add an adapter in `AIFetchlyRuntimeRegistrySync` if the existing registry's runtime types differ. Researcher decides based on the current `HookRegistryImpl` shape (`byEvent` map).
- **`AIFetchlyWorkspaceTrust` entity column design** — boolean column per capability (`instructions`/`commands`/`agents`/`hooks`/`skills`) + workspaceId + (optional) approvedAt. Researcher confirms against existing entity conventions (e.g. `AgentDefinition.entity.ts`).
- **Hook event coverage wiring** — HOK-01 names `PreToolUse`/`PostToolUse`/`SessionStart`/`Stop`. Researcher confirms which are already wired in `builtinHooks.ts`/`HookDispatcher` and what AiFetchly's tool-call lifecycle exposes as hook boundaries (does the AI tool-execution path emit PreToolUse/PostToolUse events the dispatcher can hook?).
- **Hook priority/ordering, timeouts, cancellation** — when multiple hooks match one event, execution order + per-hook timeout + abort semantics. `HookResultAggregator`/`HookOutputValidator` likely already encode parts; researcher confirms.
- **Diagnostic wording** for unsupported-event / skill-not-yet-available / hook-failure — reuse Phase 13–16 diagnostic wording.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked design (authoritative)
- `docs/prd/aifetchly-local-extensibility-prd.md` §7.6 (`hooks/hooks.json` — events, rules: workspace trust, no main-process shell, worker/skill routing, non-fatal diagnostics), UC-8 (Hook file updates), §"Phase 5: Hooks" — **PRIMARY requirements source for HOK-01/HOK-02**.
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §2.5 (Hooks — existing surfaces list), §7.5 (HookRegistry `replaceSource`/`unregisterSource` + the `AIFetchlyRuntimeRegistrySync` adapter caveat), §8 (`AIFetchlyRuntimeRegistrySync.applySnapshot`/`removeSource`, trust filtering), §"Phase 5: Hooks", and the `AIFetchlyWorkspaceTrust` entity/model/module file list (L1221-1223) — **the integration + entity contract**.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — TRS-02 (AIFetchlyWorkspaceTrust per-capability entity), HOK-01 (hooks.json + replaceSource/unregisterSource), HOK-02 (safe-boundary dispatch, no main shell, trust, non-fatal diagnostics); also TRS-01 (workspace trust before registration), CFG-04/CFG-06 (size/count caps), TRS-05 (AI-gating strategy).
- `.planning/ROADMAP.md` §Phase 17 — goal + 4 success criteria.

### Prior-phase surfaces this phase consumes (read the SUMMARYs / CONTEXT)
- `.planning/phases/16-dynamic-agents/16-CONTEXT.md` — **THE analog** (markdown → validated definition → `replaceSource` → trust filter line). D-Vocabulary/D-Blocking/D-TrustUX mirror Phase 16's D-Decisions carry-over. The `agents:` trust-filter line (Phase 16) is the exact template for the `hooks:` line.
- `.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md` — `applyWorkspaceSnapshot(snapshot, trust)` trust filter + the sync approval cache that Phase 17 replaces with the persisted entity.
- `.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md` — `WorkspaceConfigScanner` (does it already scan `hooks/hooks.json` into the snapshot? CFG-06 `hooks[]` slot — verify and add `tryReadHookFiles` if absent, mirroring Phase 16's `tryReadAgentFiles`).
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md` — `CommandRegistry.replaceSource` + `SOURCE_RANK` + `rebuildNameIndex` (the registry pattern to clone for `HookRegistry`).

### Project rules + constants
- `./CLAUDE.md` — three-layer DB, worker-no-DB/WAT-02, i18n (6 langs), no `any`, zod at boundaries, USER_AI_ENABLED gating, child-process file placement, immutability, auto-commit per function.
- `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` — size/count caps (CFG-04/CFG-06) for hook files.

### Core source files (EXISTING — integration targets; NOT greenfield)
- `src/service/hooks/HookRegistry.ts` — `HookRegistryImpl` (class with `byEvent: Map<HookEventName, RegistryEntry[]>`). **Refactor target:** add `replaceSource`/`unregisterSource` (or an adapter). Verify current register/lookup API.
- `src/service/hooks/HookDispatcher.ts` — fires events; the dispatch loop Phase 17 feeds (does NOT rewrite).
- `src/service/hooks/HookMatcher.ts`, `HookOutputValidator.ts`, `HookResultAggregator.ts`, `HookAuditService.ts`, `HookCommandTrustService.ts`, `builtinHooks.ts` — existing hook support services (builtinHooks references `PreToolUse`).
- `src/service/hooks/executors/CommandHookExecutor.ts` — uses `spawn` (`shell:false`, minimal whitespace splitter, never `shell:true`). **The executor whose invocation path must move to the worker boundary for config-sourced hooks (D-Vocabulary).**
- `src/service/hooks/executors/CallbackHookExecutor.ts` — trusted in-process callback executor (for built-in hooks).
- `src/service/pluginCompat/ClaudeHooksAdapter.ts` — existing Claude hooks compat adapter (reference for hooks.json shape).
- `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` — trust filter (L160-165: `instructions`/`commands`/`agents` lines). **Add the `hooks:` line here (mirror Phase 16 `agents:` line at L165).**
- `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` — `tryReadAgentFiles` (Phase 16) is the template for `tryReadHookFiles`.
- `src/service/workspaceWatch/WorkspaceConfigScanner.ts` — worker-side scanner; `tryReadAgentFiles` (Phase 16) template for raw hook drafts (worker-no-DB).
- NEW: `src/entity/AIFetchlyWorkspaceTrust.entity.ts` + `src/model/AIFetchlyWorkspaceTrust.model.ts` + `src/modules/AIFetchlyWorkspaceTrustModule.ts` (tech-design L1221-1223) — the per-capability trust entity.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Existing hook runtime (Phase 17 does NOT rebuild):** `HookRegistry` + `HookDispatcher` + `HookMatcher` + `HookOutputValidator` + `HookResultAggregator` + `HookAuditService` + the two executors. Phase 17's job is to feed config-sourced hooks into this runtime via `replaceSource`, not to rewrite it.
- **`CommandRegistry`/`AgentDefinitionRegistry.replaceSource` (Phase 13/16)** — the structural template for `HookRegistry.replaceSource`/`unregisterSource`. Clone the pattern; the entry type is `HookDefinitionView`.
- **`tryReadAgentFiles` (Phase 16)** — the template for the hook-file scanner (`tryReadHookFiles`), both global (`AIFetchlyConfigLoader`) and workspace (`WorkspaceConfigScanner` raw drafts).
- **`applyWorkspaceSnapshot` trust filter (Phase 14/16)** — the `agents:` line is the exact template for the `hooks:` line.
- **`CommandHookExecutor`** — already `spawn` with `shell:false` + minimal splitter + `HookExecutionError`. The execution logic is reusable; Phase 17 relocates/invokes it across the worker boundary.

### Established Patterns
- **Source-replacement on scan** — every workspace rescan calls `replaceSource("workspace:" + workspaceId, entries)`; renames/deletes reconcile automatically.
- **Scoped-ID convention** — `user:hook:<name>`, `workspace:<workspaceId>:hook:<name>` (paralleling command/agent scoped IDs). Built-in hooks keep their existing identity.
- **Built-in local command / diagnostic shape** — reused for any hook-related chrome.
- **Three-layer DB for the trust entity** — entity + model + module; IPC calls the module, never the repository directly.

### Integration Points
- `WorkspaceConfigScanner.scan()` → snapshot `hooks[]` (raw drafts, worker-side) → `applyWorkspaceSnapshot(snapshot, trust)` filters by `trust.hooks` → trusted hook entries flow into `HookRegistry.replaceSource("workspace:" + workspaceId, ...)`. Global hooks flow from the global loader (`~/.aifetchly/hooks/`) into `replaceSource("user", ...)`.
- `AIFetchlyRuntimeRegistrySync` → reads `AIFetchlyWorkspaceTrust` (Module) to resolve per-capability trust (replaces the Phase 14 sync approval cache).
- `HookDispatcher` dispatch → on PreToolUse, a hook may return DENY (D-Blocking) which the dispatcher/aggregator already surfaces; Phase 17 ensures config-sourced deny hooks are visible on this path and gated by `trust.hooks`.
- Hook command execution → worker/sandbox boundary (D-Vocabulary) — NOT `spawn` from main for config-sourced hooks.

### Open architectural question (flag for researcher — NOT a user-vision call)
The execution-boundary mechanism is locked in CONSTRAINT (no main-process shell for config-sourced command hooks) but open in MECHANISM. The researcher must trace `CommandHookExecutor.executeCommand` → its current caller, and the Phase 14 worker protocol, then recommend: reuse the watcher worker (beware role change + WAT-02), a new dedicated hook-execution worker (`src/childprocess/`), or a restricted in-process executor. This determines the core execution wiring and must be settled in RESEARCH.md before planning. (D-Vocabulary already decided commands ARE allowed, so this is "how/where", not "whether".)

</code_context>

<specifics>
## Specific Ideas

- **D-Blocking precedent (cite in source):** AiFetchly's OWN PreToolUse hook blocks Write/Edit on `.md` files outside `/docs/` — this is the live, in-repo example of PreToolUse DENY semantics. The hook deny path Phase 17 exposes to config-sourced hooks should behave the same way (deny + reason). Cite this when implementing/testing the deny return path.
- **D-Vocabulary skill-ref no-op:** the `"skill": "<name>"` path must fail GRACEFULLY and VISIBLY — a non-fatal diagnostic like `skill-registry-not-available` (DX code), so authors aren't confused why their skill hook didn't fire. It registers the hook (so `/hooks`-style listing shows it) but the action is a documented no-op until Phase 18.
- **D-TrustUX migration seed:** on first run after the entity is introduced, seed `AIFetchlyWorkspaceTrust` rows for already-trusted workspaces with all 5 capability flags = true (one-time backfill, idempotent). Document this as a startup migration step.
- **`/hooks` listing parity (optional):** Phase 16 added `/agents`; a `/hooks` built-in command listing registered hooks (id + event + source badge) would mirror it. Not in HOK-01/02 success criteria — treat as Claude's-discretion nice-to-have, defer if it risks scope creep.

</specifics>

<deferred>
## Deferred Ideas

- **Hook input MODIFY/rewrite** (PreToolUse rewrites tool arguments before execution) — deferred via D-Blocking; deny-or-pass only this phase. Revisit post-v2.0.
- **Granular per-capability trust approval UX** (5 checkboxes on the trust card) — deferred via D-TrustUX; the entity ships with per-capability flags but v2.0 approval stays binary. The entity design enables this later without a schema migration.
- **`skill:` reference resolution** — parsed/stored this phase, resolves to a non-fatal diagnostic until the Phase 18 skill registry exists.
- **Plugin-sourced hooks** (`plugin:<name>:hook:`) — Phase 18 (SKL-02). Reserve the rank/source now.
- **Full Claude-hooks-compat drop-in** (matching Claude's exact hooks.json shape 1:1 via `ClaudeHooksAdapter`) — a bonus, not a v2.0 requirement; D-Vocabulary chose command+skill vocabulary aligned with the existing types, not byte-for-byte Claude compat.
- **`/hooks` built-in command** — optional `/agents` parity; defer if scope risk.

</deferred>

---

*Phase: 17-hooks*
*Context gathered: 2026-07-10*
