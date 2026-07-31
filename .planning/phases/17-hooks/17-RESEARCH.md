# Phase 17: Hooks - Research

**Researched:** 2026-07-10
**Domain:** Local-extensibility hook integration + per-capability workspace trust (Electron main + child_process worker + TypeORM)
**Confidence:** HIGH

## Summary

Phase 17 is an **integration + trust-evolution** phase, NOT greenfield hook construction. The entire hook runtime already exists and is production-shaped: `HookRegistry` (by-event map + source-priority sort), `HookDispatcher` (sequential dispatch, abort-aware, audit-logged), `HookMatcher` (glob-lite), `HookOutputValidator` (size + shape validation), `HookResultAggregator` (deny-wins, shallow-merge), `CommandHookExecutor` (`spawn` `shell:false`, env allowlist, timeout, stdout/stderr caps), `CallbackHookExecutor`, `HookCommandTrustService`, `HookAuditService`, and two built-in demo hooks. The PreToolUse DENY path is **already fully wired end-to-end**: `StreamEventProcessor.runPreToolUseHooks` (L752) -> `HookDispatcher.executeHooks` -> aggregator -> `StreamEventProcessor` reads `permissionDecision === "deny"` OR `blocked` (L504-506) and synthesizes a blocked tool result. `[VERIFIED: codebase - src/service/StreamEventProcessor.ts:494-506, src/service/hooks/HookResultAggregator.ts:47-113]`

Phase 17's job is to (a) parse `hooks/hooks.json` from global + trusted-workspace config and feed config-sourced hooks into the existing dispatcher via a new `HookRegistry.replaceSource`/`unregisterSource`, (b) widen the `applyWorkspaceSnapshot` trust filter with a `hooks:` line, (c) route config-sourced command-hook execution through a worker boundary so no `spawn` happens in the main process (HOK-02), (d) ship the persisted `AIFetchlyWorkspaceTrust` entity (TRS-02) replacing Phase 14's in-memory binary approval cache, and (e) surface non-fatal diagnostics for unsupported events / invalid files / hook failures / not-yet-available skill refs.

**Primary recommendation:** Ship a NEW dedicated hook-execution worker (`src/childprocess/hook-execution/HookExecutionWorker.ts`) and route ALL config-sourced command hooks through it (Option (b) of the open architectural question). This preserves Phase 14's scan-only worker invariant, matches the existing SkillWorker/ContactExtractionWorker pattern, and is the only option that fully satisfies HOK-02 SC2. Reusing the Phase 14 watcher worker conflates two lifecycles; a restricted in-process executor directly violates HOK-02.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `hooks/hooks.json` parsing + size/count caps | Main process (config loader) | Worker (raw draft snapshot) | Validation + registry mutation are main-owned (WAT-02); worker only snapshots raw bytes frontmatter-free |
| `HookRegistry` mutation (`replaceSource`) | Main process (in-memory) | - | Registry mutation is a main-process responsibility (TRS-01: trust before mutation) |
| Trust filtering (drop untrusted hooks) | Main process (`AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot`) | - | TRS-01/TRS-02: drop BEFORE registry mutation |
| Per-capability trust persistence | Database (TypeORM entity) -> Model -> Module | - | Three-layer DB (CLAUDE.md); entity in `src/entity/`, model in `src/model/`, module in `src/modules/` |
| Command-hook execution (`spawn`) | Child process worker (`src/childprocess/hook-execution/`) | - | HOK-02: never `spawn` in main for config-sourced hooks |
| PreToolUse DENY enforcement | Main process (`StreamEventProcessor`) | - | Already wired; deny short-circuits to a synthesized blocked tool result |
| Hook event emission (PreToolUse/PostToolUse) | Main process (`StreamEventProcessor`) | - | Already emits 3 events; SessionStart/Stop have NO emitter today |
| Hook list / diagnostic IPC | Main process IPC handler | Renderer (read-only) | Non-AI-serving -> `registerValidatedHandler` (TRS-05) |
| `skill:`-ref resolution | - (deferred to Phase 18) | - | Parsed + stored + non-fatal diagnostic this phase; no-op action |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-Vocabulary:** A workspace `hooks.json` entry may declare EITHER a sandboxed `command` string OR a `"skill": "<name>"` reference. Commands route through the execution-boundary worker (never the main process - HOK-02). `skill:` refs are parsed + stored but resolve to a non-fatal "skill registry not yet available" diagnostic until Phase 18. User-global uses the SAME vocabulary (trust is the only difference). **Side-effect locked:** config-sourced command hooks MUST execute in the worker/sandbox boundary; the exact mechanism was the research item (settled below -> Option (b)).
- **D-Blocking:** PreToolUse can DENY (gate) or PASS. DENY mirrors Claude exit-code-2 semantics AND AiFetchly's own `builtin-block-dangerous-shell` precedent (`continue:false` + reason). Other events (`PostToolUse`, `SessionStart`, `Stop`) are observe+inject only (cannot gate). Modify/rewrite is DEFERRED (deny-or-pass only this phase). Workspace DENY requires `trust.hooks`.
- **D-TrustUX:** v2.0 keeps Phase 14's binary workspace approval card. Approving sets ALL 5 capability flags together. The entity ships with independent per-capability columns (TRS-02 satisfied), but v2.0 writes them as a block. Granular checkbox UX is deferred.
- **D-Migration:** Already-Phase-14-trusted workspaces migrate to all-capabilities-trusted automatically (one-time idempotent backfill at startup). Untrusted stay all-untrusted.
- **Carry-forward (locked):** source replacement mirrors `CommandRegistry.replaceSource` / `AgentDefinitionRegistry.replaceSource` (atomic delete-then-insert + rebuild index); the `hooks:` trust-filter line mirrors Phase 16's `agents:` line at `AIFetchlyRuntimeRegistrySync.ts:165`; diagnostic shape is the Phase 13-16 `diagnostic(sourceId, path, kind, message, fatal)` / `ioDiagnostic`; restricted parser + CFG-04/CFG-06 caps apply; three-layer DB + WAT-02 worker-no-DB; i18n across 6 langs for any chrome strings; NEVER `any`; immutability; zod at boundaries; USER_AI_ENABLED gating (TRS-05 Strategy A - hook IPC uses `registerValidatedHandler`).

### Claude's Discretion (settled by this research)
- **Execution-boundary mechanism -> SETTLED: Option (b), new dedicated hook-execution worker.** See "Execution-Boundary Mechanism Decision" below for the trace + evidence.
- **`HookRegistry` adapter vs direct method -> SETTLED: add `replaceSource`/`unregisterSource` DIRECTLY to `HookRegistryImpl`.** See "HookRegistry Source-Replacement Design" below.
- **`hooks.json` schema details -> SETTLED:** single JSON file `hooks/hooks.json` (NOT a directory), shape documented below.
- **`AIFetchlyWorkspaceTrust` entity column design -> SETTLED:** follow tech-design §13.2 exactly. See "AIFetchlyWorkspaceTrust Entity Design" below.
- **Hook event coverage -> CONFIRMED:** only PreToolUse/PostToolUse/PostToolUseFailure have emitters today (StreamEventProcessor). SessionStart/Stop/UserPromptSubmit have NO emitter - open question for planner.
- **Hook priority/ordering/timeouts/cancellation -> CONFIRMED:** already encoded in `HookRegistry` (SOURCE_PRIORITY + seq), `CommandHookExecutor` (per-hook timeoutMs, abortSignal), `HookResultAggregator` (first-block-reason-wins, deny-wins). Phase 17 adds nothing here.

### Deferred Ideas (OUT OF SCOPE)
- Hook input MODIFY/rewrite (PreToolUse rewrites tool args) - deferred via D-Blocking.
- Granular per-capability trust approval UX (5 checkboxes) - deferred via D-TrustUX.
- `skill:` reference resolution - parsed/stored, non-fatal diagnostic until Phase 18.
- Plugin-sourced hooks (`plugin:<name>:hook:`) - Phase 18 (SKL-02). Reserve rank/source now.
- Full Claude-hooks byte-for-byte compat via `ClaudeHooksAdapter` - bonus, not v2.0.
- `/hooks` built-in command - optional `/agents` parity; defer if scope risk.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRS-02 | `AIFetchlyWorkspaceTrust` per-capability trust entity (instructions/commands/agents/hooks/skills) via Model/Module | Tech-design §13.2 gives the exact column list; `AgentDefinitionEntity` + `AgentDefinitionModel` + `WorkspaceModule` are the conventions to clone; the entity replaces the in-memory `approvalCache` in `WorkspaceWatchManagerSingleton` |
| HOK-01 | Parse `hooks/hooks.json` (matchers for PreToolUse/PostToolUse/SessionStart/Stop) from user + trusted-workspace config; `HookRegistry` gains `replaceSource`/`unregisterSource` (or adapter) | `AIFetchlyConfigLoader.tryReadAgentFiles` is the template for `tryReadHookFiles` (single JSON file, not a dir); `AgentDefinitionRegistryImpl.replaceSource` is the template for `HookRegistry.replaceSource`; `WorkspaceConfigScanner.tryReadAgentFiles` is the template for the worker-side raw hook draft |
| HOK-02 | Dispatch only through safe boundaries; never execute shell in main; workspace hooks require trust; failures non-fatal + diagnostics; unsupported events produce diagnostics | `CommandHookExecutor` already `spawn` `shell:false` - route it through the new hook-execution worker; trust filter line drops untrusted workspace hooks; `HookResultAggregator` already makes failures non-fatal (`failureMode:"warn"` default); diagnostic shape mirrors Phase 13-16 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Three-layer DB (MANDATORY):** `AIFetchlyWorkspaceTrust` lives in `src/entity/` + `src/model/` + `src/modules/`. IPC handlers call Modules, NEVER repositories directly. Models extend `BaseDb`; Modules extend `BaseModule`.
- **Worker-no-DB (WAT-02, MANDATORY):** the workspace-config worker NEVER touches DB/TypeORM/registries/Electron. The new hook-execution worker ALSO must not import DB/Electron (its own boundary grep gate). Enforced + tested.
- **Child-process file placement (MANDATORY):** the new hook-execution worker entry MUST be in `src/childprocess/` (e.g. `src/childprocess/hook-execution/HookExecutionWorker.ts`), registered in `forge.config.js` under `build`, with a matching `vite.hookExecutionWorker.config.mjs`.
- **i18n (MANDATORY):** any new chrome string (e.g. a hook-deny reason prefix surfaced in UI) -> all 6 lang files (`en/zh/es/fr/de/ja`). Hook matchers/commands/deny-reasons are author DATA, not app strings. Reuse Phase 13 `aifetchlyConfig` / `slashCommands` source-badge keys where applicable.
- **NEVER use `any`**; immutability (defensive copies on registry accessors - mirror `AgentDefinitionRegistryImpl.list()`/`getById()`); explicit error handling; **zod at boundaries** (settings JSON parsing already uses zod ^3.24.0; the worker IPC protocol should use zod mirroring WAT-06).
- **AI-feature USER_AI_ENABLED gating (TRS-05 Strategy A, MANDATORY):** hook list/diagnostic IPC (if any) uses `registerValidatedHandler` (NON-AI). PreToolUse DENY happens inside `StreamEventProcessor` (already behind the stream IPC's USER_AI_ENABLED gate). ZERO `registerAiValidatedHandler` for hook channels.
- **Auto-commit per function (MANDATORY):** commit each completed logical unit (entity, model, module, registry method, loader fn, worker entry) with conventional-commit format.

## Execution-Boundary Mechanism Decision (THE open question - SETTLED)

**Recommendation: Option (b) - a NEW dedicated hook-execution worker.**

### The current call path (traced)
`StreamEventProcessor.runPreToolUseHooks` (main process, `src/service/StreamEventProcessor.ts:752`) -> `HookDispatcher.executeHooks` (`src/service/hooks/HookDispatcher.ts:37`) -> for each matched command hook: `executeCommand({hook, input, abortSignal})` (`src/service/hooks/executors/CommandHookExecutor.ts:76`) -> `spawn(argv[0], argv.slice(1), { cwd, env, stdio, shell:false })` (L121). **This `spawn` runs in the Electron MAIN process today.** `[VERIFIED: codebase]`

Today this is dormant for config-sourced hooks: only two built-in *callback* hooks exist (`builtinHooks.ts`, both `enabled:false`), and `HookCommandTrustService.isTrusted(hook.id)` gates every command hook to "not trusted" until `setTrusted(id, true)` is called (which nothing does today). So the constraint isn't yet violated in production - but the moment Phase 17 registers config-sourced command hooks AND marks them trusted (via the trust filter), the main-process `spawn` would fire. HOK-02 SC2 forbids that.

### Evaluation of the three options

**Option (a) - reuse the Phase 14 watcher worker.** REJECTED.
- The watcher worker (`src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts`) is **scan-only by design** (WAT-02): its protocol is `watch-workspace`/`unwatch-workspace`/`rescan-workspace`/`shutdown` -> `snapshot`/`changed`/`error`. Adding command execution changes its role from passive scanner to active executor, violating the single-responsibility invariant Phase 14 established and that WAT-02/WAT-07 + the `WorkerNoDbBoundary` grep gate enforce. `[VERIFIED: codebase - WorkspaceConfigWatchWorker.ts:122-188]`
- **Lifecycle mismatch:** the watcher worker is long-lived (0->1 transition spawns, serves ALL workspaces, killed on 0 workspaces). Hook execution is request/response per firing (PreToolUse -> execute -> return output within `timeoutMs`). Global (`~/.aifetchly`) hooks fire with NO workspace, so the watcher worker may not even be alive. Mixing the file-watcher event loop with synchronous hook request/response requires correlation by `hookRunId`, concurrent scan+exec scheduling, and complicates the restart-cap accounting (WAT-07). `[VERIFIED: codebase - WorkspaceWatchManager.ts:187-303]`

**Option (b) - NEW dedicated hook-execution worker (`src/childprocess/hook-execution/`).** RECOMMENDED.
- Clean separation: the scan worker stays scan-only; the hook worker is request/response. Independent lifecycle (long-lived singleton spawned lazily on first command-hook dispatch, mirroring `SkillWorker`/`PythonRuntimeWorker`). `[CITED: PRD §7.6 "worker or registered skill"]`
- The `CommandHookExecutor` logic (spawn, `shell:false`, env allowlist, timeout/SIGKILL, stdout/stderr caps, JSON.parse + `validateHookOutput`) is **reusable as-is** - either imported as a pure module by the worker, or the spawn core is extracted into a worker-callable function. No rewrite. `[VERIFIED: codebase - CommandHookExecutor.ts is stdlib-only: `node:child_process` + hookTypes + HookOutputValidator + HookCommandTrustService]`
- HOK-02 SC2 satisfied: no `spawn` of config-sourced hook commands from the main process. The dispatcher in main sends an `execute-hook` IPC message; the worker spawns; the result returns via `hook-result` IPC.
- Matches the mandatory child-process placement rule (new entry in `src/childprocess/`), registered in `forge.config.js` + a new `vite.hookExecutionWorker.config.mjs` (clone of `vite.aifetchlyConfigWorker.config.mjs`). `[VERIFIED: codebase - forge.config.js:401-411 shows the aifetchly-config worker registration pattern]`
- **Spawn-latency mitigation:** the PreToolUse path is latency-sensitive (PRD: <5ms overhead when no hooks match). The no-hooks fast path (`HookDispatcher` returns `EMPTY_AGGREGATE` before any IPC) is preserved. When a command hook DOES match, the worker should be long-lived (spawn once at startup or on first dispatch, not per-firing) so the round-trip is one IPC message, not a fork.

**Option (c) - restricted in-process executor with allowlist.** ELIMINATED.
- Directly violates HOK-02 SC2 ("Hooks never execute shell directly in the main process"). The success criterion is behavioral, not "use an allowlist". Even an allowlisted `node` spawn in main is the forbidden shape.

### Worker protocol (recommended shape - for the planner)
```
main -> worker:  { type: "execute-hook", hookRunId, command, cwd?, envAllowlist?, timeoutMs?, stdinPayload }
worker -> main:  { type: "hook-result", hookRunId, stdout, stderr, durationMs, error?: {message, timedOut?} }
```
Validated both directions with zod (mirror `WorkspaceWatchProtocol.workerEventSchema` - WAT-06). Malformed -> the dispatcher synthesizes a non-fatal failure result (HOK-02 SC4) and never crashes the stream. The `HookCommandTrustService.isTrusted` gate stays in main (it's a main-process trust decision); the worker just executes what main sends. The dispatcher correlates request/response by `hookRunId`, enforces `timeoutMs` (kills the worker-side child via the existing `CommandHookExecutor` timer), and honors `abortSignal`.

### Dispatcher branching (for the planner)
The `HookDispatcher` (main) becomes:
- `hook.type === "callback"` -> existing in-process `CallbackHookExecutor` (built-in/session callbacks stay trusted + in-process - HOK-02 only constrains config-sourced COMMAND hooks).
- `hook.type === "command"` -> worker round-trip (route ALL command hooks through the worker for uniformity + future-proofing; built-in command hooks don't exist today, so no regression).
- `"skill"` action -> registered but no-op + non-fatal `skill-registry-not-available` diagnostic (D-Vocabulary).

## Standard Stack

### Core (all ALREADY in package.json - Phase 17 adds ZERO new packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `typeorm` | ^0.3.20 | `AIFetchlyWorkspaceTrust` entity + repository | Existing ORM; every entity uses it `[VERIFIED: codebase - AgentDefinition.entity.ts]` |
| `better-sqlite3` | ^11.9.1 | SQLite driver backing TypeORM | Local DB; `BaseDb`/`SqliteDb` wrap it `[VERIFIED: package.json]` |
| `zod` | ^3.24.0 | Schema validation for `hooks.json` + worker IPC protocol | Already used for settings.json + worker protocol `[VERIFIED: AIFetchlyConfigLoader.ts:70, WorkspaceWatchProtocol.ts]` |
| `chokidar` | ^3.6.0 | File watching (worker already uses it) | Already used by the watcher worker - NOT needed by the hook-execution worker `[VERIFIED: package.json]` |
| Node `child_process` | stdlib | `spawn` (in worker), `fork` (main spawns worker) | Existing pattern `CommandHookExecutor` + `WorkspaceWatchManager` `[VERIFIED: codebase]` |

**Installation:** NONE. No `npm install` needed. All dependencies verified present.
```bash
# Version verification (all confirmed 2026-07-10)
grep -E '"zod"|"typeorm"|"better-sqlite3"|"chokidar"' package.json
```

### Supporting (existing in-repo modules Phase 17 reuses - NOT packages)
| Module | Purpose | When to Use |
|---------|---------|-------------|
| `src/service/hooks/executors/CommandHookExecutor.ts` | `spawn(shell:false)` + timeout + caps + JSON validate | Import into the new hook-execution worker (pure, stdlib-only) |
| `src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts` (`parseRestrictedFrontmatter`) | Restricted JSON/frontmatter parse | NOT for hooks.json (it's pure JSON) - use `JSON.parse` + zod |
| `src/service/aifetchlyConfig/resolveConfigRelativePath.ts` | CFG-05 path safety | Hook file path validation |
| `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` | Size/count caps + diagnostic codes | `hooksJsonBytes` already defined; add `maxHooksPerSource` |
| `src/service/hooks/HookResultAggregator.ts` | deny-wins + non-fatal error aggregation | Unchanged - the dispatcher feeds it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New hook-execution worker | Reuse Phase 14 watcher worker | Rejected - lifecycle mismatch + breaks scan-only invariant (see Decision above) |
| Direct `HookRegistry.replaceSource` | Adapter in `AIFetchlyRuntimeRegistrySync` | Adapter adds indirection; direct method mirrors `AgentDefinitionRegistryImpl` and the types already fit - direct wins |
| `hooks.json` as a directory of `.md` | Single `hooks/hooks.json` file | Hooks are event-routed JSON rules, not prose; single-file JSON is simpler + matches CFG-04 `hooksJsonBytes` constant `[CITED: PRD §7.6]` |

**Version verification:** Before writing the Standard Stack table, confirmed each package exists in `package.json` (2026-07-10): `zod ^3.24.0`, `typeorm ^0.3.20`, `better-sqlite3 ^11.9.1`, `chokidar ^3.6.0`. No registry lookup needed - Phase 17 installs nothing.

## Package Legitimacy Audit

**Phase 17 installs ZERO external packages.** All required libraries (`typeorm`, `better-sqlite3`, `zod`, `chokidar`, Node stdlib `child_process`) are already in `package.json` and have been used since Phase 13/14. The audit is therefore N/A.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none new) | - | - | - | - | - | N/A - no new packages this phase |

**Packages removed due to [SLOP] verdict:** none (none proposed).
**Packages flagged as suspicious [SUS]:** none.

*All existing dependencies were verified against `package.json` directly (the authoritative source for this project). No `[ASSUMED]` package names are introduced.*

## Architecture Patterns

### System Architecture Diagram

```
                          +------------------------------------------------------+
                          |                  ELECTRON MAIN                       |
                          |                                                      |
   ~/.aifetchly/  ------>|  AIFetchlyConfigLoader.tryReadHookFiles              |
   hooks/hooks.json       |   (JSON.parse + zod + CFG-04 size + CFG-06 count)    |
                          |   -> HookDefinition[] (source="user")                |
                          |                                                      |
   <workspace>/.aifetchly>|  WorkspaceConfigScanner.tryReadHookFiles (WORKER)    |
   hooks/hooks.json       |   -> raw WorkspaceHookDraft[] (bytes + hash ONLY)    |
                          |      [scan-only - WAT-02: no validate/DB/registry]   |
                          |           |                                          |
                          |           v IPC snapshot                            |
                          |  AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot |
                          |   trust filter: hooks: trust.hooks ? snap.hooks : [] |-- trust.hooks=false --> DROP (diagnostic)
                          |           | trust.hooks=true                         |
                          |           v                                          |
                          |  HookRegistry.replaceSource(sourceId, hooks)         |
                          |   (byEvent map + sourceIndex + SOURCE_PRIORITY)      |
                          |           |                                          |
                          |  AIFetchlyWorkspaceTrust entity (TRS-02)             |
                          |   Module reads per-capability flags --> trustResolver|
                          |                                                      |
   AI tool call --------->|  StreamEventProcessor.runPreToolUseHooks             |
                          |   |                                                  |
                          |   v HookDispatcher.executeHooks                      |
                          |     |- callback hook -> CallbackHookExecutor (main)  |
                          |     |- command hook -----------------------+         |
                          |     +- skill-ref hook -> no-op + diag     |         |
                          |                                        |         |
                          +----------------------------------------+----------+
                                                                   | IPC: execute-hook
                                                                   v
                                       +--------------------------------------------+
                                       |      CHILD PROCESS: hook-execution         |
                                       |      src/childprocess/hook-execution/      |
                                       |   HookExecutionWorker                      |
                                       |     +- CommandHookExecutor.executeCommand  |
                                       |         spawn(shell:false, env allowlist,  |
                                       |               timeout, stdout/stderr cap) |
                                       |     +- JSON.parse + validateHookOutput     |
                                       +-------------------+------------------------+
                                                           | IPC: hook-result
                                                           v
                          +-------------------------------------------------------+
                          |  HookResultAggregator (deny-wins, non-fatal errors) |
                          |   blocked? permissionDecision=deny?                  |
                          |           |                                          |
                          |           v                                          |
                          |  StreamEventProcessor:                              |
                          |    denied -> buildHookBlockedToolResult (DENY)       |
                          |    else  -> run SkillExecutor/ToolExecutor           |
                          +------------------------------------------------------+
```

A reader can trace the primary use case: edit a trusted `hooks/hooks.json` -> worker snapshots raw draft -> main trust-filter (entity lookup) -> `HookRegistry.replaceSource` -> next PreToolUse -> dispatcher -> command hook routes to worker -> result -> aggregator -> deny-or-allow.

### Recommended Project Structure (NEW + MODIFIED files)
```
src/
+-- entity/
|   +-- AIFetchlyWorkspaceTrust.entity.ts        # NEW (TRS-02) - tech-design §13.2 columns
+-- model/
|   +-- AIFetchlyWorkspaceTrust.model.ts         # NEW - extends BaseDb, repository pattern
+-- modules/
|   +-- AIFetchlyWorkspaceTrustModule.ts         # NEW - extends BaseModule; migration seed
+-- service/
|   +-- hooks/
|   |   +-- HookRegistry.ts                       # MODIFY - add replaceSource/unregisterSource + sourceIndex
|   |   +-- HookDispatcher.ts                     # MODIFY - command-hook branch -> worker round-trip
|   |   +-- hookExecutionClient.ts                # NEW (main) - IPC client to the hook-execution worker
|   |   +-- hookFileFrontmatter.ts                # NEW - pure buildHookDefinition() validator (zod) + diagnostics
|   +-- aifetchlyConfig/
|   |   +-- AIFetchlyConfigLoader.ts              # MODIFY - add tryReadHookFiles (single JSON file)
|   |   +-- AIFetchlyConfigConstants.ts           # MODIFY - add maxHooksPerSource + hook diagnostic codes
|   |   +-- AIFetchlyRuntimeRegistrySync.ts       # MODIFY - add hooks: trust line + HookRegistry.replaceSource call
|   +-- workspaceWatch/
|       +-- WorkspaceConfigScanner.ts             # MODIFY - add tryReadHookFiles (raw draft, worker-side)
|       +-- WorkspaceTrustFilter.ts               # MODIFY - replace derivePhase14Trust body with entity lookup
|       +-- buildWorkspaceHookDefinitions.ts      # NEW - main-side raw-draft -> CommandHookDefinition converter
|       +-- WorkspaceWatchManagerSingleton.ts     # MODIFY - replace approvalCache with AIFetchlyWorkspaceTrustModule reads
+-- childprocess/
|   +-- hook-execution/                           # NEW directory (mandatory childprocess placement)
|       +-- HookExecutionWorker.ts                # NEW entry point (fork target)
|       +-- workerProtocol.ts                     # NEW - zod schemas for execute-hook/hook-result
+-- entityTypes/
    +-- hookTypes.ts                              # POSSIBLY MODIFY - add HookDefinitionView or skill-ref variant (discretion)
forge.config.js                                    # MODIFY - add hook-execution worker entry
vite.hookExecutionWorker.config.mjs               # NEW - clone of vite.aifetchlyConfigWorker.config.mjs
```

### Pattern 1: Source-aware registry `replaceSource` (clone from AgentDefinitionRegistry)
**What:** Atomic reconcile of an entire source - delete all old entries for `sourceId`, insert defensive copies of the new entries, rebuild the name/priority index.
**When to use:** Every workspace rescan + every global reload.
**Example:**
```typescript
// Source: src/service/AgentDefinitionRegistry.ts:219-243 [VERIFIED: codebase]
// Clone this exact shape into HookRegistryImpl, with byEvent + sourceIndex.
replaceSource(sourceId: string, hooks: readonly HookDefinition[]): void {
  // 1. Remove old entries for this sourceId from byEvent + sourceIndex.
  const existing = this.sourceIndex.get(sourceId);
  if (existing) {
    for (const id of existing) {
      // remove from whichever event list it lives in
      for (const list of this.byEvent.values()) {
        const idx = list.findIndex((e) => e.hook.id === id);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
  }
  // 2. Insert fresh defensive copies.
  const next = new Set<string>();
  for (const h of hooks) {
    const copy: HookDefinition = { ...h };
    this.push(copy);  // existing push() handles byEvent + seq
    next.add(copy.id);
  }
  this.sourceIndex.set(sourceId, next);
  // 3. getMatchingHooks already sorts by SOURCE_PRIORITY + seq on read -
  //    no separate name index needed (hooks key on event+matcher, not name).
}

unregisterSource(sourceId: string): void {
  this.replaceSource(sourceId, []);
}
```
Note: `HookRegistry` diverges from `AgentDefinitionRegistry` in that it has NO `byName` index (hooks look up by event + matcher, not by name), so `rebuildNameIndex()` is not needed - `getMatchingHooks` re-sorts on every read. `[VERIFIED: codebase - HookRegistry.ts:81-110]`

### Pattern 2: Trust filter line (clone from Phase 16 agents line)
**What:** Drop untrusted capabilities BEFORE registry mutation.
**Example:**
```typescript
// Source: src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:155-167 [VERIFIED: codebase]
// Add the hooks: line mirroring the agents: line at L165.
const filtered: AIFetchlyConfigSnapshot = {
  ...snapshot,
  instructions: trust.instructions ? snapshot.instructions : [],
  commands: trust.commands ? snapshot.commands : [],
  agents: trust.agents ? snapshot.agents : [],
  hooks: trust.hooks ? snapshot.hooks : [],   // <- Phase 17 NEW LINE
};
```

### Pattern 3: Per-capability trust entity (clone from AgentDefinitionEntity + tech-design §13.2)
**What:** TypeORM entity + Model + Module for persisted per-capability trust.
**Example:**
```typescript
// Source: tech-design §13.2 L1226-1239 [CITED] + src/entity/AgentDefinition.entity.ts [VERIFIED]
@Entity("aifetchly_workspace_trust")
@Index(["workspaceRootHash"], { unique: true })
export class AIFetchlyWorkspaceTrustEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column("varchar", { length: 128, nullable: false, unique: true })
  workspaceRootHash: string;          // SHA-256 of normalized root path - stable across moves
  @Column("varchar", { length: 1024, nullable: false })
  workspaceRootPath: string;
  @Column("varchar", { length: 64, nullable: true })
  conversationId: string | null;      // optional link to the approving conversation
  @Column("boolean", { default: false, nullable: false })
  trustInstructions: boolean;
  @Column("boolean", { default: false, nullable: false })
  trustCommands: boolean;
  @Column("boolean", { default: false, nullable: false })
  trustAgents: boolean;
  @Column("boolean", { default: false, nullable: false })
  trustHooks: boolean;
  @Column("boolean", { default: false, nullable: false })
  trustSkills: boolean;
}
```

### Pattern 4: Worker IPC protocol with zod (clone from WorkspaceWatchProtocol)
**What:** Validate every worker->main + main->worker message; malformed -> non-fatal diagnostic (never crash).
**Example:**
```typescript
// Source: src/service/workspaceWatch/WorkspaceWatchProtocol.ts [VERIFIED: codebase pattern]
// Clone for hook execution.
const executeHookCommandSchema = z.object({
  type: z.literal("execute-hook"),
  hookRunId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  envAllowlist: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  stdinPayload: z.string(),            // JSON.stringify(input)
});
const hookResultEventSchema = z.object({
  type: z.literal("hook-result"),
  hookRunId: z.string().min(1),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
  error: z.object({ message: z.string(), timedOut: z.boolean().optional() }).optional(),
});
```

### Anti-Patterns to Avoid
- **Spawning config-sourced hook commands in the main process** - violates HOK-02 SC2. Route through the worker.
- **Mixing the scan worker's role** (don't add hook execution to `WorkspaceConfigWatchWorker` - breaks WAT-02's scan-only invariant + lifecycle mismatch).
- **Validating/parsing hook JSON in the worker** - the worker snapshots raw bytes only (WAT-02); `buildHookDefinition` runs main-side (mirror `buildWorkspaceAgentDefinitions`). `[VERIFIED: codebase - WorkspaceConfigScanner.tryReadAgentFiles emits raw drafts; buildWorkspaceAgentDefinitions validates main-side]`
- **Gating hook IPC with `registerAiValidatedHandler`** - hook list/diagnostic IPC is NON-AI-serving (TRS-05). Use `registerValidatedHandler`. `[VERIFIED: codebase - workspace-watch-ipc.ts uses registerValidatedHandler for the same rationale]`
- **Mutating `HookDefinition` objects returned by the registry** - always defensive-copy (CLAUDE.md immutability; `AgentDefinitionRegistryImpl` returns `{...d}` copies).
- **Re-introducing the in-memory `approvalCache`** - Phase 17 replaces it with the persisted entity (D-Migration). The `markWorkspaceApproved` shim can delegate to the entity Module.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hook command spawn/timeout/caps | Custom spawn logic | Existing `CommandHookExecutor.executeCommand` | Already handles `shell:false`, env allowlist, SIGKILL on timeout/abort, stdout/stderr caps, JSON parse + `validateHookOutput`. Import it into the worker. |
| Hook output validation | Manual shape checks | Existing `validateHookOutput` | Handles all HookOutput fields, size caps, permission-decision enum. |
| DENY aggregation | Custom deny logic | Existing `HookResultAggregator.aggregateResults` | deny-wins, first-block-reason-wins, non-fatal error handling already encoded. |
| Glob matcher | Regex matcher | Existing `matchesHookMatcher` | Glob-lite, DoS-safe, char-capped. |
| Source reconciliation | Patch-on-change | `replaceSource` atomic delete-then-insert | Handles rename/delete/atomic-save correctly (design §10.1). |
| `hooks.json` schema | Ad-hoc parsing | zod schema | CFG-03 pattern already established for settings.json. |
| Trust persistence | IPC->repository direct | Model + Module (three-layer) | CLAUDE.md mandatory rule. |

**Key insight:** The hook runtime is a finished, tested subsystem. Phase 17 is a wiring + trust-evolution phase. The riskiest new code is the worker IPC round-trip + the entity migration seed - both of which have in-repo templates (SkillWorker, AgentDefinitionEntity). Resist any urge to rewrite the dispatcher/aggregator/executor.

## Runtime State Inventory

> This phase introduces a new persisted entity AND replaces an in-memory cache. The inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | NONE yet - `AIFetchlyWorkspaceTrust` table does not exist. Workspace approval currently lives in `WorkspaceEntity.approvalState` (`src/entity/Workspace.entity.ts`, `approvalState: "pending"\|"approved"\|"revoked"`). `[VERIFIED: codebase]` | **Data migration (code, one-time seed):** on first run after the entity is introduced, query `WorkspaceEntity` for rows where `approvalState='approved'` and seed `AIFetchlyWorkspaceTrust` rows with all 5 flags = true, keyed by `workspaceRootHash`. Idempotent (upsert by `workspaceRootHash`). Runs at startup via the Module. |
| Live service config | The in-memory `approvalCache: Map<string, boolean>` in `WorkspaceWatchManagerSingleton.ts` (L45) backs `trustResolver`. `[VERIFIED: codebase]` | **Code edit:** replace `approvalCache.get(workspaceId)` reads with `AIFetchlyWorkspaceTrustModule.getTrust(workspaceRootHash)` reads. The `markWorkspaceApproved` function becomes a thin wrapper that writes the entity (all flags true) via the Module. Keep the sync signature the manager expects (the Module can expose a sync-read cache hydrated from the entity at startup, OR the resolver stays async-bridged - see Open Questions). |
| OS-registered state | None. | - |
| Secrets/env vars | None. (`DEFAULT_HOOK_ENV_KEYS` is a hardcoded allowlist PATH/HOME/USER/etc., not a secret.) | - |
| Build artifacts | New worker entry must be registered in `forge.config.js` + a new `vite.hookExecutionWorker.config.mjs`, or the bundled worker won't be found at runtime (worker path resolution in `WorkspaceWatchManager.defaultWorkerEntry` pattern). | **Build config edit:** add the entry + vite config before the worker can be forked. |

**Nothing-found affirmation:** No Mem0/n8n/Redis/task-scheduler state touches this phase. The only runtime state is (1) the new SQLite table (migration seed) and (2) the replaced in-memory cache (code edit). Both addressed above.

## Common Pitfalls

### Pitfall 1: Worker spawn latency on the PreToolUse hot path
**What goes wrong:** PreToolUse fires synchronously before every tool call; forking a worker per firing adds 50-200ms, violating the PRD <5ms no-hooks overhead + making deny hooks feel slow.
**Why it happens:** `child_process.fork` is expensive; doing it inside `HookDispatcher.executeHooks` per command hook.
**How to avoid:** Spawn the hook-execution worker ONCE (lazy singleton at startup or on first command-hook dispatch, mirroring `SkillWorker`). The per-firing cost is then one IPC round-trip (~1ms), not a fork. The no-hooks fast path (`HookDispatcher` returns `EMPTY_AGGREGATE` before any IPC when `getMatchingHooks` is empty) is preserved exactly.
**Warning signs:** tool calls feel sluggish when a command hook is registered; `HookAuditService` logs show >50ms `durationMs` for trivial commands.

### Pitfall 2: Stale trust after workspace revoke
**What goes wrong:** User revokes a workspace, but the hook stays registered because the trust cache/entity read returns stale true.
**Why it happens:** Phase 14's `approvalCache` is documented as "stale until next app restart" on revoke (`WorkspaceWatchManagerSingleton.ts:20-22`). Phase 17 must NOT carry this limitation forward.
**How to avoid:** The entity-backed `trustResolver` must reflect revoke immediately. On `revokeWorkspace`, the Module sets all flags false (or deletes the row) AND the manager triggers a rescan -> `applyWorkspaceSnapshot` drops the hooks -> `HookRegistry.replaceSource(sourceId, [])`. Test this path explicitly.
**Warning signs:** a revoked workspace's PreToolUse hook still fires after revoke.

### Pitfall 3: `spawn(shell:false)` whitespace splitter breaks realistic commands
**What goes wrong:** `CommandHookExecutor.parseCommand` does `trimmed.split(/\s+/)` - a command like `node -e "console.log('a b')"` splits incorrectly (the quoted string becomes two args).
**Why it happens:** The minimal splitter rejects shell syntax deliberately (no `shell:true`). Config-sourced authors will hit this.
**How to avoid:** Document the limitation in hook author docs: commands run with `shell:false`, so quoted args with spaces don't work; authors should wrap complex commands in a script file (`node .aifetchly/hooks/format.js`). Do NOT switch to `shell:true` (HOK-02 + injection risk). This is an existing executor behavior Phase 17 inherits unchanged.
**Warning signs:** hooks with multi-word quoted args fail with ENOENT or wrong argv.

### Pitfall 4: `HookRegistry` source enum vs sourceId scoping mismatch
**What goes wrong:** `replaceSource("workspace:42", hooks)` is called, but the hooks carry `source: "project"` (the HookSource enum value for workspace-scoped). The registry's `SOURCE_PRIORITY` uses the enum, while `sourceIndex` keys on the sourceId string. Mixing them up corrupts the index.
**Why it happens:** The HookSource enum (`builtin|session|user|project|plugin|policy`) uses `project` where the config pipeline uses `workspace:<id>`.
**How to avoid:** Map config source -> HookSource explicitly in `buildHookDefinition` (workspace -> `source:"project"` or extend the enum). The `sourceIndex` keys on the full sourceId string ("workspace:42"); the `SOURCE_PRIORITY` lookup uses the hook's `source` enum field. Keep both consistent. Add a test that `replaceSource` + `getMatchingHooks` round-trips for workspace + user sources.
**Warning signs:** hooks from a re-added workspace appear twice; deleted workspace hooks persist.

### Pitfall 5: Trust filter reads entity async but `trustResolver` is sync
**What goes wrong:** `WorkspaceWatchManager.trustResolver: (workspaceId: string) => boolean` is SYNCHRONOUS (called inside the worker event handler). TypeORM reads are async. A naive `await model.findOne()` inside a sync resolver breaks compilation.
**Why it happens:** Phase 14 bridged this with the in-memory `approvalCache` precisely because `WorkspaceResolver.resolve` is async.
**How to avoid:** Keep a sync read path: the Module hydrates an in-memory `Map<workspaceRootHash, AIFetchlySourceTrust>` from the entity at startup + on every trust write, and the sync `trustResolver` reads that map. The entity is the source of truth (persisted); the map is a sync-read cache hydrated from it. This preserves the manager's sync contract AND makes trust persisted. (Same bridge pattern as Phase 14, but backed by the entity instead of a write-only cache.)
**Warning signs:** TypeScript error "Promise return in sync function"; or trust reads missing the entity.

### Pitfall 6: Bare `yarn testmain` hangs
**What goes wrong:** Running the full main-process vitest suite hangs 20+ min on a pre-existing Electron/DB integration test unrelated to Phase 17.
**Why it happens:** Documented in STATE.md resume note.
**How to avoid:** Use targeted runs: `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <new test files>` + a standalone `npx tsc --noEmit`. Only run the full suite at the phase gate.
**Warning signs:** test run exceeds 5 minutes with no output.

## Code Examples

### buildHookDefinition - pure validator (mirrors buildAgentDefinition)
```typescript
// Source: pattern from src/service/slashCommands/agentFrontmatter.ts [VERIFIED]
// + src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts [VERIFIED]
// Pure: no fs/DB/Electron. Never throws; returns {ok, definition} | {ok:false, diagnostic}.
import { z } from "zod";
import type { CommandHookDefinition, HookEventName } from "@/entityTypes/hookTypes";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";

const hookEntrySchema = z.object({
  event: z.enum(["PreToolUse", "PostToolUse", "SessionStart", "Stop"]),
  matcher: z.string().max(128).optional(),        // HOOK_LIMITS.maxMatcherChars
  command: z.string().min(1).optional(),
  skill: z.string().min(1).optional(),            // D-Vocabulary skill-ref (no-op this phase)
  timeoutMs: z.number().int().positive().max(60_000).optional(),
  cwd: z.string().optional(),
  envAllowlist: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  failureMode: z.enum(["warn", "block"]).optional(),
}).refine((d) => d.command || d.skill, {
  message: "hook entry must declare either 'command' or 'skill'",
});

export function buildHookDefinition(
  raw: unknown,
  sourceMeta: { source: "user" | "workspace"; sourceId: string; relativePath: string },
  index: number
): { ok: true; definition: CommandHookDefinition } | { ok: false; diagnostic: AIFetchlyConfigDiagnostic } {
  const parsed = hookEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, diagnostic: { /* code: "hooks-json-invalid", ... */ } as AIFetchlyConfigDiagnostic };
  }
  const d = parsed.data;
  const id = `${sourceMeta.sourceId}:hook:${index}`;   // stable scoped id
  // skill-ref: register but the action is a documented no-op (D-Vocabulary).
  // The dispatcher/executor treats it as a non-fatal skill-registry-not-available diagnostic at fire time.
  const definition: CommandHookDefinition = {
    id,
    eventName: d.event as HookEventName,
    matcher: d.matcher,
    source: sourceMeta.source === "user" ? "user" : "project",  // map to HookSource enum
    enabled: d.enabled ?? true,
    trusted: sourceMeta.source === "user",  // user-global trusted; workspace gated by trust.hooks
    failureMode: d.failureMode ?? "warn",
    type: "command",
    command: d.command ?? "true",           // skill-ref placeholder (no-op until Phase 18)
    cwd: d.cwd,
    timeoutMs: d.timeoutMs,
    envAllowlist: d.envAllowlist,
  };
  return { ok: true, definition };
}
```

### DENY precedent (the in-repo example)
```typescript
// Source: src/service/hooks/builtinHooks.ts:25-38 [VERIFIED: codebase]
// This is the live, in-repo precedent for PreToolUse DENY via continue:false + reason.
callback: (input) => {
  if (input.eventName !== "PreToolUse") return {};
  const command = String((input as { input?: { command?: unknown } }).input?.command ?? "");
  if (/\brm\s+-rf\s+(\/|\*)/.test(command)) {
    return { continue: false, reason: "Dangerous recursive delete command blocked by hook policy." };
  }
  return { continue: true };
},
```
A config-sourced command hook denies by writing JSON to stdout: `{"continue": false, "reason": "blocked"}`. The aggregator converts `continue:false` -> `blocked:true`; `StreamEventProcessor` (L504-506) reads `blocked` and calls `buildHookBlockedToolResult`. `[VERIFIED: codebase - HookResultAggregator.ts:77-80, StreamEventProcessor.ts:504-506]`

### Migration seed (one-time, idempotent)
```typescript
// Source: pattern from WorkspaceModule.approveWorkspace [VERIFIED] + tech-design §13.1 [CITED]
// Runs at startup via AIFetchlyWorkspaceTrustModule.ensureMigrationSeed().
async ensureMigrationSeed(): Promise<void> {
  await this.ensureConnection();
  // Read all approved workspaces from the existing WorkspaceEntity.
  const approved = await this.workspaceRepo.find({ where: { approvalState: "approved" } });
  for (const ws of approved) {
    const hash = sha256(normalize(ws.rootPath));
    // Idempotent upsert by workspaceRootHash - only sets flags true if the row is new.
    await this.trustRepo.upsert({
      workspaceRootHash: hash,
      workspaceRootPath: ws.rootPath,
      conversationId: ws.conversationId,
      trustInstructions: true, trustCommands: true, trustAgents: true,
      trustHooks: true, trustSkills: true,   // D-Migration: all flags true
    }, ["workspaceRootHash"]);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-memory binary `approvalCache` (Phase 14) | Persisted `AIFetchlyWorkspaceTrust` entity (Phase 17) | Phase 17 / 2026-07 | Trust survives restart; per-capability flags enable granular UX later; revoke reflects immediately (Pitfall 2) |
| `derivePhase14Trust` (binary: instructions+commands only) | Entity lookup returning all 5 flags | Phase 17 | Hooks/agents/skills trust now persisted, not hardcoded false |
| `HookRegistry` builtin+session only | Source-aware `replaceSource` (user/workspace/plugin) | Phase 17 | Config-sourced hooks reconcile atomically on file change |
| `CommandHookExecutor` runs in main | Runs in hook-execution worker | Phase 17 | HOK-02 compliance; main never spawns config-sourced shell |

**Deprecated/outdated:**
- `WorkspaceTrustFilter.derivePhase14Trust` body - replace with entity lookup (keep the export signature so callers don't change). `[CITED: WorkspaceTrustFilter.ts:14-18 comment]`
- `WorkspaceWatchManagerSingleton.approvalCache` + `markWorkspaceApproved` - replace the cache backing with entity reads; keep `markWorkspaceApproved` as a thin wrapper for call-site compatibility.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `workspaceRootHash` should be SHA-256 of the normalized root path (tech-design §13.2 names the field but does not specify the hash algorithm) | Entity Design | Low - if a different hash is wanted, it's a one-line change before the table ships; normalize path first (resolve symlinks/case) to avoid duplicate rows |
| A2 | The `conversationId` column on the trust entity is optional/nullable (tech-design marks it `?`) | Entity Design | Low - nullable matches the spec |
| A3 | `HookSource` enum value `"project"` is the correct mapping for workspace-scoped hooks (the registry has no `"workspace"` enum value) | Pitfall 4 / buildHookDefinition | Medium - if the enum should be extended with `"workspace"`, the registry sort + tests change. Recommend the planner verify against `SOURCE_PRIORITY` intent (workspace hooks should rank BELOW user, matching the agent precedence) |
| A4 | The hook-execution worker should be long-lived (lazy singleton), not forked-per-firing | Pitfall 1 | Low - if fork-per-firing is preferred for isolation, latency suffers but correctness is unchanged |
| A5 | SessionStart/Stop/UserPromptSubmit hook events should be REGISTERED but dormant this phase (no new emitters), per HOK-02 SC4 "unsupported events produce diagnostics" | Event Coverage | Medium - the planner may decide to wire SessionStart/Stop emitters at stream start/stop. Either is defensible; see Open Questions |

**Note on confidence:** All other claims in this research are `[VERIFIED: codebase]` (traced to specific files/lines this session) or `[CITED: technical-design §X]` / `[CITED: PRD §X]` (quoted from the in-repo design docs). The gsd-tools classify-confidence seam was unavailable in this environment; tiers assigned manually from source authority: codebase traces = HIGH, design-doc citations = HIGH (authoritative for this project), assumptions A1-A5 = LOW.

## Open Questions (RESOLVED)

1. **SessionStart / Stop / UserPromptSubmit emitters - wire this phase or defer?**
   - What we know: HOK-01 names "matchers for PreToolUse/PostToolUse/SessionStart/Stop". The registry + dispatcher SUPPORT all 8 `HookEventName` values. But ONLY PreToolUse/PostToolUse/PostToolUseFailure have emitters today (`StreamEventProcessor` L752/781/821). SessionStart/Stop/UserPromptSubmit have ZERO emission sites. `[VERIFIED: codebase - grep for eventName "SessionStart"/"Stop"/"UserPromptSubmit" returns nothing in src/]`
   - What's unclear: does HOK-01 require live emitters for all 4 events, or just that `hooks.json` can DECLARE matchers for them (with dormant registration)?
   - Recommendation: **Register all 4 events from hooks.json (reject truly-unknown event names with an `unsupported-event` diagnostic), but only PreToolUse/PostToolUse are live this phase.** Wiring SessionStart/Stop emitters at stream start/stop is cheap (two `HookDispatcher.executeHooks` calls) and completes HOK-01's event coverage - recommend the planner include it as a small task. If scope-bound, defer the emitters and document SessionStart/Stop as "registered, fires when emitter lands."
   - **RESOLVED:** wire SessionStart/Stop emitters in Plan 03 Task 2 (StreamEventProcessor stream-start/completion `executeHooks` calls). UserPromptSubmit stays out of HOK-01 event scope (not named by HOK-01).

2. **Sync `trustResolver` hydration timing**
   - What we know: the manager's `trustResolver` is sync; TypeORM is async (Pitfall 5). The bridge is a sync map hydrated from the entity.
   - What's unclear: exactly WHEN the map is hydrated (at manager construction? on first acquire? on each trust write?).
   - Recommendation: hydrate at `initWorkspaceWatchManager` (startup, after the migration seed) + on every `markWorkspaceApproved`/revoke write. The map is the sync-read cache; the entity is the durable source.
   - **RESOLVED:** hydrate the entity-backed sync trust cache at `initWorkspaceWatchManager` (after `ensureMigrationSeed`) + re-hydrate on every `markWorkspaceApproved`/revoke write — implemented in Plan 02 Task 2b.

3. **`/hooks` built-in command - include or defer?**
   - CONTEXT.md marks it Claude's-discretion nice-to-have. Recommend DEFER to avoid scope creep - HOK-01/02 success criteria don't require it, and `/status` already shows a hook count.
   - **RESOLVED:** defer `/hooks` command (out of HOK-01/02 scope); `/status` already shows a hook count.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `child_process` | hook-execution worker spawn + fork | YES | stdlib (Node 18+/Electron) | - |
| `typeorm` | AIFetchlyWorkspaceTrust entity | YES | ^0.3.20 | - |
| `better-sqlite3` | entity persistence | YES | ^11.9.1 | - |
| `zod` | hooks.json + worker protocol validation | YES | ^3.24.0 | - |
| `vitest` | test suite | YES | (existing) | - |
| `tsc` | type-check gate | YES | (existing globalSetup) | `AIFETCHLY_SKIP_TSC=1` for tight inner loops only |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

> `workflow.nyquist_validation` is absent in `.planning/config.json` -> treated as ENABLED. This section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (main + utilitycode configs) + Mocha (modules, if a Module test is added) |
| Config file | `vite.main.config.mjs`, `vite.utilityCode.config.mjs` (both reference `test/vitest/_typecheck/globalSetup.ts` for the `tsc --noEmit` gate) |
| Quick run command | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <file>` (main) / `--config vite.utilityCode.config.mjs` (utilitycode) |
| Full suite command | `npx tsc --noEmit` + targeted vitest runs (AVOID bare `yarn testmain` - hangs 20min, see Pitfall 6) |

Existing hook tests at `test/vitest/utilitycode/hooks/` (HookRegistry, HookDispatcher, CommandHookExecutor, HookResultAggregator, HookOutputValidator, HookMatcher, CallbackHookExecutor, builtinHooks, HookCommandTrustService, HookAuditService). Config loader tests at `test/vitest/main/service/AIFetchlyConfigLoader*.test.ts`. Agent registry test (replaceSource mirror) at `test/vitest/main/service/AgentDefinitionRegistry.test.ts`.

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOK-01 (parse) | `hooks.json` valid -> `HookDefinition[]` with scoped ids; invalid -> `hooks-json-invalid` diagnostic; oversized -> `file-too-large`; too many -> count-cap diagnostic | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts -x` | NO Wave 0 |
| HOK-01 (replaceSource) | `HookRegistry.replaceSource("workspace:1", hs)` atomically reconciles add/change/delete/rename; `unregisterSource` clears; stale entries never survive | unit | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/hooks/HookRegistry.test.ts -x` | YES (extend existing) |
| HOK-01 (trust filter) | `applyWorkspaceSnapshot` with `trust.hooks=false` drops hooks BEFORE registry mutation; `trust.hooks=true` passes through | unit | `... test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts -x` | NO Wave 0 |
| HOK-02 (no main shell) | Config-sourced command hook dispatch sends IPC to worker; NO `spawn` import remains on the main-process command path | unit + grep gate | vitest (worker IPC mock) + `grep -n "spawn" src/service/hooks/HookDispatcher.ts` returns nothing | NO Wave 0 |
| HOK-02 (worker executes) | HookExecutionWorker receives `execute-hook`, spawns with `shell:false`, returns `hook-result` with validated stdout | unit | `... test/vitest/utilitycode/hooks/HookExecutionWorker.test.ts -x` | NO Wave 0 |
| HOK-02 (non-fatal) | Hook failure/timeout -> aggregator `hookErrors[]`, does NOT throw; stream continues | unit | `... test/vitest/utilitycode/hooks/HookResultAggregator.test.ts -x` (extend) | YES |
| HOK-02 (unsupported event) | `hooks.json` entry with event `PermissionRequest` -> `unsupported-event` diagnostic, hook skipped | unit | `... AIFetchlyConfigLoader.hooks.test.ts -x` | NO Wave 0 |
| HOK-02 (skill-ref no-op) | `"skill":"foo"` hook registers; at fire time emits `skill-registry-not-available` diagnostic, no execution | unit | `... HookDispatcher.test.ts -x` (extend) | YES |
| TRS-02 (entity) | `AIFetchlyWorkspaceTrustEntity` persists 5 boolean flags + workspaceRootHash unique; Model upsert/get; Module wraps | unit (mocha) | `yarn test test/modules/AIFetchlyWorkspaceTrustModule.test.ts` | NO Wave 0 |
| TRS-02 (migration seed) | `ensureMigrationSeed()` seeds all-true rows for existing approved workspaces; idempotent on re-run | unit (mocha) | `yarn test test/modules/AIFetchlyWorkspaceTrustModule.test.ts -g "migration"` | NO Wave 0 |
| TRS-02 (replaces cache) | `WorkspaceWatchManagerSingleton.trustResolver` reads entity-backed map, not the old `approvalCache`; revoke reflects immediately | unit | `... test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts -x` | NO Wave 0 |
| SC1 (live update) | Editing trusted `<ws>/.aifetchly/hooks/hooks.json` triggers rescan -> `HookRegistry.replaceSource` -> dispatch behavior changes | integration | `... test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts -g "rescan"` | NO Wave 0 |
| SC2 (no main shell) | Static grep gate: main-process dispatcher has no `spawn` for config hooks; worker has it | grep | `grep -rn "spawn" src/service/hooks/ src/childprocess/hook-execution/` - only in worker | - |
| SC3 (entity persists) | Restart-safe: write trust, reload Module from DB, flags persist | unit (mocha) | `yarn test test/modules/AIFetchlyWorkspaceTrustModule.test.ts -g "persist"` | NO Wave 0 |
| SC4 (diagnostics) | Hook failure + unsupported event both surface as `AIFetchlyConfigDiagnostic` with stable codes | unit | covered by HOK-02 rows above | - |
| TRS-05 (AI gating) | ZERO `registerAiValidatedHandler` for hook channels; hook IPC uses `registerValidatedHandler` | grep gate | `grep -c "registerAiValidatedHandler" src/main-process/communication/*hook*` returns 0 | - |
| WAT-02 (worker-no-DB) | New hook-execution worker imports NO DB/TypeORM/Electron/modules | grep gate | `grep -rn "typeorm\|better-sqlite3\|SqliteDb\|@/modules\|@/model\|electron" src/childprocess/hook-execution/` returns nothing | - |

### Sampling Rate
- **Per task commit:** `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <new test files>` (+ utilitycode variant) - fast feedback, <30s.
- **Per wave merge:** targeted vitest runs for ALL new + extended hook/config test files + `npx tsc --noEmit` (0 errors).
- **Phase gate:** full targeted suite green (NEW: ~8 test files; EXTENDED: HookRegistry/HookDispatcher/HookResultAggregator/AIFetchlyConfigLoader) + grep gates (SC2, TRS-05, WAT-02) + manual UAT for SC1 (edit hooks.json, observe dispatch change).

### Wave 0 Gaps
- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.hooks.test.ts` - covers HOK-01 parse + CFG-04/CFG-06 caps + unsupported-event diagnostic
- [ ] `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.hooks.test.ts` - covers HOK-01 trust filter + replaceSource wiring (SC1)
- [ ] `test/vitest/utilitycode/hooks/HookExecutionWorker.test.ts` - covers HOK-02 worker execute-hook/hook-result (mock fork)
- [ ] `test/vitest/utilitycode/hooks/HookRegistry.test.ts` - EXTEND with replaceSource/unregisterSource tests (mirror AgentDefinitionRegistry.test.ts)
- [ ] `test/modules/AIFetchlyWorkspaceTrustModule.test.ts` - covers TRS-02 entity + Model + Module + migration seed (SC3)
- [ ] `test/vitest/main/service/WorkspaceWatchManagerSingleton.trust.test.ts` - covers TRS-02 cache replacement + revoke-reflects (Pitfall 2)
- [ ] `src/childprocess/hook-execution/workerProtocol.ts` - zod schemas (shared by worker + dispatcher tests)

## Security Domain

> `security_enforcement` is not set `false` in config -> section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a (no new auth) |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | Trust filter (`trust.hooks` gate) BEFORE registry mutation - workspace hooks require explicit per-capability trust (TRS-01/TRS-02). `HookCommandTrustService.isTrusted` defense-in-depth. |
| V5 Input Validation | yes | zod schema for `hooks.json` (CFG-03 pattern); `validateHookOutput` for command stdout; CFG-04 size caps checked before read; CFG-06 count caps |
| V6 Cryptography | partial | SHA-256 `workspaceRootHash` for stable entity keying (not for secrecy - for dedup across path moves) |
| V12 Files & Resources | yes | CFG-05 path safety (`resolveConfigRelativePath`) on hook file paths; `shell:false` (never `shell:true`); env allowlist (`DEFAULT_HOOK_ENV_KEYS`); stdout/stderr byte caps |

### Known Threat Patterns for the hook + worker stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious workspace hook command injection (Tampering via `hooks.json`) | Tampering | Workspace hooks require `trust.hooks` (TRS-02 entity); commands run `shell:false` with minimal whitespace splitter (no shell metachar expansion); worker boundary isolates execution (HOK-02) |
| Hook stdout smuggling malformed `permissionDecision:"allow"` to bypass SkillExecutor | Elevation | `HookOutputValidator` parses stdout as JSON + validates enum; aggregator's "allow is advisory" rule - hook allow NEVER bypasses `SkillExecutor`/`SkillPermissionService` `[VERIFIED: codebase - HookResultAggregator.ts:40, StreamEventProcessor runs SkillExecutor regardless]` |
| Workspace PreToolUse hook DoS-gates every tool call (deny-all) | Denial of Service | Workspace deny hooks gated behind `trust.hooks` (D-Blocking); user must opt in; `HookCommandTrustService` defense-in-depth |
| Worker process compromise -> DB access | Elevation | Hook-execution worker is pure-Node fork (like the scan worker); WAT-02 grep gate forbids DB/TypeORM/Electron/modules imports; worker only spawns + validates JSON |
| Command hook exfiltrates secrets via env | Information Disclosure | `DEFAULT_HOOK_ENV_KEYS` allowlist (PATH/HOME/USER/USERNAME/TEMP/TMP only); `process.env` never spread; Token secrets never injected `[VERIFIED: codebase - CommandHookExecutor.buildEnv L53-63]` |
| Oversized hooks.json / stdout DoS | Denial of Service | CFG-04 `hooksJsonBytes` (128KB) checked via stat before read; stdout capped at `maxCommandStdoutBytes` (256KB); matcher capped at `maxMatcherChars` (128) |
| Path traversal via `cwd` / command path | Tampering | CFG-05 `resolveConfigRelativePath` on hook file; `cwd` validation against trusted root (planner: add a check that `cwd` doesn't escape the workspace for workspace hooks) |

## Sources

### Primary (HIGH confidence)
- `src/service/hooks/HookRegistry.ts` - byEvent map, SOURCE_PRIORITY, getMatchingHooks (no replaceSource yet) `[VERIFIED]`
- `src/service/hooks/HookDispatcher.ts` - executeHooks dispatch loop, calls executeCallback/executeCommand in main today `[VERIFIED]`
- `src/service/hooks/executors/CommandHookExecutor.ts` - spawn(shell:false), env allowlist, timeout, caps, JSON validate `[VERIFIED]`
- `src/service/hooks/HookResultAggregator.ts` - deny-wins, continue:false->blocked, non-fatal errors `[VERIFIED]`
- `src/service/hooks/builtinHooks.ts` - BLOCK_DANGEROUS_SHELL (the DENY precedent using continue:false + reason) `[VERIFIED]`
- `src/service/StreamEventProcessor.ts:485-506,747-842` - PreToolUse/PostToolUse dispatch + DENY short-circuit + buildHookBlockedToolResult `[VERIFIED]`
- `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:151-168` - applyWorkspaceSnapshot trust filter (the agents: line template) `[VERIFIED]`
- `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts:466-612` - tryReadAgentFiles (the tryReadHookFiles template) `[VERIFIED]`
- `src/service/workspaceWatch/WorkspaceConfigScanner.ts:596-727` - tryReadAgentFiles worker-side raw draft (scan-only) `[VERIFIED]`
- `src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts` - main-side raw-draft->definition converter template `[VERIFIED]`
- `src/service/AgentDefinitionRegistry.ts:145-270` - replaceSource + sourceIndex + rebuildNameIndex (the HookRegistry.replaceSource template) `[VERIFIED]`
- `src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts` - approvalCache (the cache being replaced) `[VERIFIED]`
- `src/service/workspaceWatch/WorkspaceTrustFilter.ts` - derivePhase14Trust (body to replace with entity lookup) `[VERIFIED]`
- `src/entity/AgentDefinition.entity.ts`, `src/model/AgentDefinition.model.ts`, `src/entity/Workspace.entity.ts`, `src/entity/Auditable.entity.ts` - entity/model conventions `[VERIFIED]`
- `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts` - worker protocol + lifecycle pattern `[VERIFIED]`
- `src/main-process/communication/_shared/registerValidatedHandler.ts` - registerValidatedHandler (non-AI) vs registerAiValidatedHandler (AI) `[VERIFIED]`
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §7.5 (HookRegistry replaceSource/unregisterSource + adapter caveat), §8 (RuntimeRegistrySync), §13.1/§13.2 (AIFetchlyWorkspaceTrust entity column spec L1226-1239), Phase 5 scope L1572-1579 `[CITED]`
- `src/entityTypes/aifetchlyConfigTypes.ts` - AIFetchlySourceTrust already has hooks+skills fields; snapshot has hooks[] slot `[VERIFIED]`
- `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` - hooksJsonBytes (128KB) already defined; maxHooksPerSource MISSING (add it) `[VERIFIED]`

### Secondary (MEDIUM confidence)
- `.planning/phases/16-dynamic-agents/16-CONTEXT.md` - THE analog phase (markdown->validator->replaceSource->trust filter) `[CITED]`
- `docs/prd/aifetchly-local-extensibility-prd.md` §7.6 - hooks/hooks.json events, trust, no-main-shell, worker/skill routing, non-fatal diagnostics `[CITED]`

### Tertiary (LOW confidence)
- A1-A5 in the Assumptions Log - `[ASSUMED]`, need planner/user confirmation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages already in package.json, verified directly.
- Architecture: HIGH - every integration point traced to specific files/lines; the open question (execution boundary) settled with code evidence.
- Entity design: HIGH - tech-design §13.2 gives exact columns; entity/model conventions cloned from AgentDefinition.
- Pitfalls: HIGH - all grounded in codebase behavior (Pitfall 5 sync/async bridge is the subtlest; mitigation provided).
- Event coverage: MEDIUM - SessionStart/Stop emitter question is a genuine scope decision (A5).

**Research date:** 2026-07-10
**Valid until:** 2026-08-09 (stable - codebase-integration phase, no external API/library version drift)

## RESEARCH COMPLETE

**Phase:** 17 - Hooks
**Confidence:** HIGH

### Key Findings
- **Execution-boundary mechanism SETTLED -> Option (b): new dedicated hook-execution worker** (`src/childprocess/hook-execution/HookExecutionWorker.ts`). Reusing the Phase 14 watcher worker was rejected (lifecycle mismatch + breaks scan-only invariant); in-process allowlist eliminated (violates HOK-02 SC2). The existing `CommandHookExecutor` is reused inside the worker.
- **The hook runtime is finished.** PreToolUse DENY is already fully wired end-to-end (`StreamEventProcessor` L504-506 -> `buildHookBlockedToolResult`); `builtin-block-dangerous-shell` is the in-repo DENY precedent (`continue:false` + reason). Phase 17 FEEDS config-sourced hooks into this runtime via `HookRegistry.replaceSource` - it does NOT rewrite the dispatcher/aggregator/executor.
- **`HookRegistry.replaceSource`/`unregisterSource` -> add DIRECTLY to `HookRegistryImpl`** (clone `AgentDefinitionRegistryImpl` with `sourceIndex: Map<sourceId, Set<id>>`; no `byName` index needed since hooks key on event+matcher). No adapter - the existing `CommandHookDefinition` type fits config-sourced hooks.
- **Trust filter = one line:** `hooks: trust.hooks ? snapshot.hooks : []` mirroring the Phase 16 `agents:` line at `AIFetchlyRuntimeRegistrySync.ts:165`. `AIFetchlySourceTrust` already has the `hooks` field; `derivePhase14Trust` body is replaced with an entity-backed sync-read cache.
- **`AIFetchlyWorkspaceTrust` entity follows tech-design §13.2 exactly** (workspaceRootHash unique + workspaceRootPath + conversationId? + 5 trust booleans + timestamps). Migration seed: approved workspaces -> all flags true (idempotent).
- **Zero new packages.** The sync/async trust bridge (Pitfall 5) + worker spawn latency (Pitfall 1) + SessionStart/Stop emitter scope (Open Q1) are the items most likely to bite the planner.

### File Created
`/home/robertzeng/project/aiFetchly/.claude/worktrees/merry-stirring-scroll/.planning/phases/17-hooks/17-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All packages verified in package.json; Phase 17 adds none |
| Architecture | HIGH | Every integration point traced to specific files/lines; execution-boundary decision settled with code evidence (not training-knowledge) |
| Entity Design | HIGH | tech-design §13.2 provides exact columns; conventions cloned from verified AgentDefinitionEntity |
| Pitfalls | HIGH | All grounded in actual codebase behavior (sync resolver, spawn latency, splitter, source enum) |
| Event Coverage | MEDIUM | SessionStart/Stop emitter wiring is a genuine scope decision (A5) |

### Open Questions (RESOLVED)
1. SessionStart/Stop/UserPromptSubmit emitters - wire this phase or register-dormant? RESOLVED: wire SessionStart/Stop in Plan 03 Task 2.
2. Sync `trustResolver` hydration timing - at startup + on every trust write (map = sync cache, entity = durable source). RESOLVED: hydrate at initWorkspaceWatchManager (after ensureMigrationSeed) + on every trust write/revoke — Plan 02 Task 2b.
3. `/hooks` built-in command - defer (out of HOK-01/02 success criteria). RESOLVED: deferred.

### Ready for Planning
Research complete. The central architectural question (execution-boundary mechanism) is settled with code evidence, all integration points are traced to specific files/lines, and the Validation Architecture maps every requirement + success criterion to a concrete test + grep gate. Planner can now create PLAN.md files.
