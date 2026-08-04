# Phase 18: Skills and Plugin Integration - Research

**Researched:** 2026-07-12
**Domain:** Integration of the EXISTING skill runtime (`SkillRegistry` / `SkillExecutor` / `SandboxedSkillExecutor` / `SkillWorkerClient` / `SkillPermissionService` / `SkillImportService`) and plugin subsystem (`PluginLoaderService` / `PluginManifestService` / `PluginComponentRegistryService`) with the local-extensibility `~/.aifetchly` discovery pipeline.
**Confidence:** HIGH (all claims verified by reading the actual source in this session — exact file paths, line numbers, and signatures cited inline)

## Summary

Phase 18 is an **integration** phase, not greenfield. The skill runtime and plugin subsystem already exist and work. The phase's job is narrow and well-scoped: (a) add a `~/.aifetchly/skills/<name>/manifest.json` discovery path that feeds validated manifests INTO the existing `SkillRegistry.registerSkill` -> `SkillExecutor.execute` -> `SkillPermissionService.checkPermission` pipeline; (b) rewire the Phase 17 `skill:<name>` hook-ref no-op (`HookDispatcher.skillRefResult`) to actually invoke the registered skill; (c) promote plugin `commands/*.md` and `agents/*.md` from undiscovered files into the native `CommandRegistry` / `AgentDefinitionRegistry` under `plugin:<name>` source IDs; and (d) preserve the `~/.aifetchly/plugins/<name>/options.json` path.

The single most important finding: **the existing `SkillManifest` schema (`src/entityTypes/skillTypes.ts:289-335`) and `SkillImportService.registerImportedSkill(manifest, skillDir)` already cover local `~/.aifetchly/skills` directories.** A local skill is structurally identical to a zip-installed skill (same manifest fields, same execution boundary via `SkillWorkerClient`/`PythonSkillRuntimeService`, same permission gate). Phase 18 does NOT invent a new manifest format, a new executor, or a new permission flow — it adds a discovery path (the config loader's `tryReadSkillFiles`) that calls the existing registration function with a different `skillDir` root.

The second most important finding: **`SkillRegistry` has NO `replaceSource` method** (unlike `CommandRegistry` / `AgentDefinitionRegistry` / `HookRegistry`). It has `registerSkill` (throws on duplicate name) and `unregisterSkill`. The tech-design doc references `SkillRegistry.replaceSource(sourceId, skills)` (line 557), but that method does not exist in the code. Phase 18 must bridge this gap with a thin adapter (track local-skill names per source, unregister-then-register on rescan) — NOT by rewriting SkillRegistry (CONTEXT.md locks "do not rewrite").

**Primary recommendation:** Reuse `SkillImportService.registerImportedSkill(manifest, skillDir)` as the single registration entry point for local skills. Add a `tryReadSkillFiles` method to `AIFetchlyConfigLoader` (global) and a raw-draft scan to `WorkspaceConfigScanner` (worker), mirroring the Phase 17 `tryReadHookFiles` template. Add a `skills:` trust-filter line to `AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot` mirroring the `hooks:` line. Rewire `HookDispatcher.skillRefResult` to call `SkillExecutor.execute`. Promote plugin commands/agents inside `PluginComponentRegistryService.applyLoadedPlugins` (or a new method it delegates to) by scanning each `LoadedPlugin.installPath` for `commands/*.md` + `agents/*.md` and calling `replaceSource("plugin:<name>", ...)`.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-SkillEnable:** Auto-register, gate at call. Discovered local skill is registered as an OpenAI tool immediately (no per-skill "enable" step). Execution gated by the EXISTING `SkillPermissionService` at call time. Manifest's declared permissions feed `SkillPermissionService` exactly as installed skills do — no new permission UX.
- **D-SkillRefResolve:** Resolve `skill:<name>` to invoke. Phase 17's `skill:<name>` hook-ref resolves in Phase 18 to invoking the named skill. `skill-registry-not-available` emitted only when the named skill is NOT registered (non-fatal no-op).
- **D-PluginBadge:** Plugin source badge. Plugin `commands/*.md` / `agents/*.md` carry a `plugin` source badge (scoped id `plugin:<name>:command:<name>` / `plugin:<name>:agent:<name>`), mirroring Phase 13 source-badge pattern. The existing `SlashCommand`/`AgentDefinitionView` source fields already reserve `plugin`.
- **D-WorkspaceSkills:** Workspace skills gated by `trust.skills` (mirror Phase 17 hooks). User-global `~/.aifetchly/skills/` is the primary path. Workspace `<ws>/.aifetchly/skills/` scanned into raw drafts (worker-side), validated main-side when `trust.skills` is true. Researcher latitude: defer workspace path if worker scanner cannot carry skill dirs cleanly.
- **Carry-Forward (locked):** Source replacement (`replaceSource`); restricted parser + caps (CFG-04/CFG-06); diagnostic shape (closed-set `AIFETCHLY_DIAGNOSTIC_CODES`); three-layer DB / worker-no-DB (WAT-02); i18n (6 langs); NEVER `any`; immutability; USER_AI_ENABLED gating (TRS-05 — skill execution IPC is NON-AI-serving -> `registerValidatedHandler`).

### Claude's Discretion (the 5 items this research MUST resolve)
1. **Manifest schema fields** — exact `manifest.json` shape.
2. **Skill execution boundary** — confirm existing boundary handles `~/.aifetchly/skills` roots.
3. **OpenAI tool schema mapping** — how registered skill -> OpenAI tool.
4. **options.json conflict mechanism** — how `~/.aifetchly/plugins/<name>/options.json` coexists with `userData/plugins/installed`.
5. **Plugin promotion timing** — promote on plugin load vs on config-scan.

### Deferred Ideas (OUT OF SCOPE)
- Granular per-skill enable/disable UI.
- Plugin-sourced skills + plugin-sourced hooks (`plugin:<name>:hook:`).
- Skill marketplace / sharing / remote install.
- Workspace skills (IF worker can't carry skill dirs — researcher recommendation below).
- Granular per-capability trust approval UX (5 checkboxes).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKL-01 | `~/.aifetchly/skills/*/manifest.json` validated and registered through the existing `SkillRegistry`, executed via `SkillExecutor`, permission-checked via `SkillPermissionService`; never loaded as arbitrary code into the Electron main process. | Existing `SkillManifest` type + `SkillImportService.registerImportedSkill` + `SkillExecutor.execute` + `SkillPermissionService.checkPermission` cover the full pipeline. Phase 18 adds the `~/.aifetchly/skills` discovery path (`tryReadSkillFiles`) that feeds INTO these existing functions. The execution boundary (`SkillWorkerClient` utility process for JS, `PythonSkillRuntimeService` per-skill venv for Python) is NEVER `import()`'d in main. See Architecture Patterns -> Discretion Item 1-3. |
| SKL-02 | Plugin `commands/*.md` promoted from opaque metadata once the native command registry is stable; plugin `agents/*.md` promoted once the dynamic agent registry is stable; `~/.aifetchly/plugins/<name>/options.json` path preserved without conflicting with installed plugin package roots under `userData/plugins/installed`. | `CommandRegistry.replaceSource` (stable since Phase 13) and `AgentDefinitionRegistryImpl.replaceSource` (stable since Phase 16) both reserve `plugin` source rank 3. Plugin install dirs are scanned for `commands/*.md` + `agents/*.md` and promoted under `plugin:<name>` source IDs. `options.json` coexists by filesystem-root separation (see Architecture Patterns -> Discretion Item 4). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted actionable directives the planner MUST honor:

- **Three-layer DB:** All database logic in Model (`src/model/`) + Module (`src/modules/`), NEVER in IPC handlers. Phase 18 likely adds NO new entity (skill registry is in-memory; trust reuses Phase 17's `AIFetchlyWorkspaceTrust` entity).
- **Worker-no-DB (WAT-02):** The workspace-config worker MUST NOT access SQLite/TypeORM, mutate registries, execute user functions, or call renderer IPC. The worker snapshots raw skill drafts only; validation + registration happen main-side. WAT-02 grep gate must pass.
- **Child-process file placement:** All worker entry points in `src/childprocess/`. The existing `SkillWorker.ts` is already there; Phase 18 does NOT add a new worker process (reuses `SkillWorkerClient`).
- **i18n (6 langs):** Any new chrome string (e.g. a "Plugin" badge label) -> all 6 lang files (en, zh, es, fr, de, ja). Skill/plugin names + manifest fields are author DATA, not app strings.
- **NEVER use `any`**; use `unknown` and validate. Immutability (defensive copies on registry accessors).
- **USER_AI_ENABLED gating (TRS-05):** Skill execution IPC (if any) is NON-AI-Serving -> `registerValidatedHandler`, NOT `registerAiValidatedHandler`. Skill list/status/diagnostic handlers are non-AI-serving.
- **zod at boundaries:** The existing settings-JSON parsing uses zod; the restricted JSON parser is reused for skill manifests.
- **Auto-commit per function:** After completing each logical unit, stage + commit.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Skill manifest discovery (global `~/.aifetchly/skills/`) | Frontend Server (main) | — | `AIFetchlyConfigLoader` runs main-side; reads files, validates, registers. Trusted by default (user-owned). |
| Skill manifest discovery (workspace) | API / Backend (worker scan) | Frontend Server (main validate) | Worker snapshots raw drafts (WAT-02); main validates + registers after `trust.skills` gate. |
| Skill execution | API / Backend (utility process) | — | `SkillWorkerClient` forks `SkillWorker.ts` (Electron utilityProcess). NEVER main-process `import()`/shell. Python via per-skill venv. |
| Skill permission gating | API / Backend (main) | — | `SkillPermissionService.checkPermission` reads Token store + registry. Per-call gate. |
| Skill -> OpenAI tool exposure | API / Backend (main) | — | `SkillRegistry.getAllToolFunctions` -> `skillDefinitionToToolFunction` -> consumed by `AIChatQueryEngine` (lines 251, 580). |
| Plugin command/agent promotion | API / Backend (main) | — | `PluginComponentRegistryService.applyLoadedPlugins` (called from `plugin-ipc.ts`) scans install dir -> `CommandRegistry.replaceSource` / `AgentDefinitionRegistryImpl.replaceSource`. |
| Hook `skill:<name>` resolution | API / Backend (main) | — | `HookDispatcher` detects `skill:` prefix -> `SkillExecutor.execute`. |
| `options.json` preservation | Database / Storage (filesystem) | — | `~/.aifetchly/plugins/<name>/options.json` is a distinct filesystem root from `userData/plugins/installed`. |

## Standard Stack

This is an integration phase — it installs NO new packages. The "stack" is the set of EXISTING modules Phase 18 wires together.

### Core (EXISTING — Phase 18 does NOT rebuild)
| Module | Path | Purpose | Phase 18 Usage |
|--------|------|---------|----------------|
| `SkillRegistry` | `src/config/skillsRegistry.ts` | Module-level singleton `Map<name, SkillDefinition>`. API: `registerSkill`/`unregisterSkill`/`getSkill`/`isRegistered`/`getAllToolFunctions`. | Local skills call `registerSkill` with a `SkillDefinition` whose `source` is `"user"`. |
| `SkillExecutor` | `src/service/SkillExecutor.ts` | `execute(name, args, context)` — validates -> permission-check -> `skill.execute()`. | HookDispatcher skill-ref calls `SkillExecutor.execute(skillName, {}, context)`. |
| `SkillWorkerClient` | `src/service/SkillWorkerClient.ts` | `execute(code, args, context)` — forks Electron `utilityProcess` (`childprocess/SkillWorker.js`), sends CODE string. | Local JS skills route through this (same as zip-installed skills). |
| `SkillPermissionService` | `src/service/SkillPermissionService.ts` | `checkPermission(skillName)` — Token-backed gate. Pure auto-allowed; shell always-prompt; others check stored grant. | Per-call gate for local skills (D-SkillEnable). NO new code. |
| `SkillImportService` | `src/service/SkillImportService.ts` | `validateManifest(raw)` + `registerImportedSkill(manifest, skillDir)` — constructs SkillDefinition with sandboxed execute handler. | **THE registration entry point Phase 18 reuses.** `skillDir` = `~/.aifetchly/skills/<name>` (resolved from config rootPath). |
| `CommandRegistry` | `src/service/slashCommands/CommandRegistry.ts` | `replaceSource(sourceId, commands)` — atomic reconcile. `SOURCE_RANK`: built-in(0) > workspace(1) > user(2) > plugin(3). | Plugin commands: `replaceSource("plugin:<name>", pluginCommandDefs)`. |
| `AgentDefinitionRegistryImpl` | `src/service/AgentDefinitionRegistry.ts` | `replaceSource(sourceId, agents)` — atomic reconcile. `SOURCE_RANK`: built-in(0) > user(1) > workspace(2) > plugin(3). | Plugin agents: `replaceSource("plugin:<name>", pluginAgentDefs)`. |
| `PluginLoaderService` | `src/service/PluginLoaderService.ts` | `loadAllPlugins()` — memoized, loads from DB+disk, returns `LoadedPlugin[]` with `installPath`. | Phase 18 scans `LoadedPlugin.installPath` for commands/agents dirs. |
| `PluginComponentRegistryService` | `src/service/PluginComponentRegistryService.ts` | `applyLoadedPlugins()` — called from `plugin-ipc.ts` after install/enable/disable/uninstall. Currently just clears cache. | **Promotion hook point:** Phase 18 adds command/agent promotion here (or a sibling method). |
| `AIFetchlyRuntimeRegistrySync` | `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` | `applySnapshot` / `applyWorkspaceSnapshot(snapshot, trust)` — trust filter + registry mutation. | Add `skills:` trust-filter line + skill registration in `applySnapshot`. |
| `HookDispatcher` | `src/service/hooks/HookDispatcher.ts` | `executeHooks` — dispatches hooks; skill-ref branch at lines 103-108. | Rewire `skillRefResult` (lines 175-183) to invoke registered skill. |

### Supporting
| Module | Path | Purpose | When to Use |
|---------|------|---------|-------------|
| `AIFetchlyConfigLoader` | `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` | Global config scan. Has `tryReadCommandFiles`/`tryReadAgentFiles`/`tryReadHookFiles`. | Add `tryReadSkillFiles` (global skills scan). |
| `WorkspaceConfigScanner` | `src/service/workspaceWatch/WorkspaceConfigScanner.ts` | Worker-side scan-only. Has `tryReadHookFiles` raw-draft. | Add `tryReadSkillFiles` (workspace skills raw drafts). |
| `AIFetchlyConfigConstants` | `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` | Size/count caps + diagnostic codes. | Add `skillManifestBytes` + `maxSkillsPerSource` + `manifest-invalid` code. |
| `pluginPaths` | `src/service/pluginPaths.ts` | `getPluginsRoot()` -> `userData/plugins/installed`. | Confirms options.json path is a separate root (no conflict). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `SkillImportService.registerImportedSkill` for local skills | Writing a new `registerLocalSkill` | Reuse wins: the execute handler (`buildImportedSkillExecuteHandler`) is identical for zip-installed and local skills. A new function would duplicate the SkillWorkerClient/PythonSkillRuntimeService wiring. |
| Adapter for SkillRegistry source-replacement | Adding `replaceSource` to SkillRegistry | Adding `replaceSource` would be cleaner but CONTEXT.md locks "do not rewrite SkillRegistry". A thin adapter (track names per sourceId, unregister-then-register) achieves the same reconciliation without touching the registry internals. |

**Installation:**
```bash
# No packages to install — integration phase.
# All dependencies (electron, adm-zip, uuid, zod) are already in package.json.
```

**Version verification:** N/A — no new packages. All referenced modules are existing source files verified in this session.

## Package Legitimacy Audit

> **N/A** — Phase 18 installs NO external packages. It is a pure integration phase that wires together existing source modules. All dependencies (`electron`, `adm-zip`, `uuid`, `zod`, `better-sqlite3`) are already in `package.json` and were verified in prior phases.

## Architecture Patterns

### System Architecture Diagram

```
                          +-------------------------------------+
                          |     ~/.aifetchly/  (user-global)     |
                          |  |- skills/<name>/manifest.json     |
                          |  |- skills/<name>/<entry>.js|.py     |
                          |  |- plugins/<name>/options.json     |
                          |  |- commands/*.md  (Phase 15)       |
                          |  |- agents/*.md    (Phase 16)       |
                          |  +- hooks/hooks.json(Phase 17)      |
                          +---------------+---------------------+
                                          | fs scan (main)
                                          v
             +--------------------------------------------+
             |         AIFetchlyConfigLoader (main)        |
             |  tryReadSkillFiles: readdir skills/, read   |
             |  each manifest.json, validate via           |
             |  SkillImportService.validateManifest,       |
             |  push LocalSkillDraft[]                     |
             +---------------+----------------------------+
                             | snapshot.skills[] (source="user")
                             v
             +--------------------------------------------+
             |    AIFetchlyRuntimeRegistrySync.applySnapshot|
             |  (global path - trust always true)          |
             |  -> for each skill draft:                   |
             |    SkillImportService.registerImportedSkill(|
             |      manifest, skillDir=<rootPath>/skills/<name>)
             |  -> SkillRegistry adapter: unregister old   |
             |    source names, register new set           |
             +---------------+----------------------------+
                             | SkillRegistry.registerSkill
                             v
    +----------------------------------------------+
    |                  SkillRegistry (in-memory Map)|
    |  name -> SkillDefinition { execute, ... }    |
    +------+-----------------+---------------------+
           |                 |                     |
           v                 v                     v
  +-----------------+  +------------------+  +------------------------+
  | getAllToolFuncs |  | SkillExecutor    |  | SkillPermissionService |
  | -> ToolFunction]|  | .execute(name)   |  | .checkPermission(name) |
  | -> AIChatQuery  |  | -> skill.execute)|  | -> Token store gate    |
  |   Engine (251)  |  | -> SkillWorker   |  | (D-SkillEnable gate)   |
  +-----------------+  |   Client (JS)    |  +------------------------+
                       |   .execute(code) |
                       |   utilityProcess |
                       | ---------------  |
                       | PythonSkillRuntime|
                       | Service (Python) |
                       +------------------+

  -- Workspace path (worker-scanned, trust-gated) --

  <workspace>/.aifetchly/skills/<name>/manifest.json
        | worker scan (WorkspaceConfigScanner.tryReadSkillFiles)
        v
  WorkspaceSkillDraft[] (raw manifest blob - WAT-02 scan-only)
        | applyWorkspaceSnapshot(snapshot, trust)
        |   skills: trust.skills ? snapshot.skills : []
        v
  [if trusted] -> same registration path as global (main-side)

  -- Hook skill-ref resolution (D-SkillRefResolve) --

  HookDispatcher: hook.command = "skill:<name>"
        | extract name -> SkillRegistry.isRegistered(name)?
        |   YES -> SkillExecutor.execute(name, {}, context)
        |   NO  -> skillRefResult (skill-registry-not-available, non-fatal)

  -- Plugin command/agent promotion (SKL-02) --

  PluginLoaderService.loadAllPlugins() -> LoadedPlugin[]
        | for each plugin: scan installPath/commands/*.md, agents/*.md
        v
  PluginComponentRegistryService.applyLoadedPlugins()
        | CommandRegistry.replaceSource("plugin:<name>", cmdDefs)
        | AgentDefinitionRegistryImpl.replaceSource("plugin:<name>", agentDefs)
        v
  Active slash commands + dynamic agents with "plugin" source badge
```

### Recommended Project Structure
```
src/
|- service/aifetchlyConfig/
|   |- AIFetchlyConfigLoader.ts        # ADD tryReadSkillFiles (global)
|   |- AIFetchlyRuntimeRegistrySync.ts # ADD skills: trust line + skill registration
|   +- AIFetchlyConfigConstants.ts     # ADD skillManifestBytes, maxSkillsPerSource, manifest-invalid
|- service/workspaceWatch/
|   |- WorkspaceConfigScanner.ts       # ADD tryReadSkillFiles (worker raw draft)
|   +- buildWorkspaceSkillDefinitions.ts # NEW: raw draft -> validated (main-side)
|- service/hooks/
|   +- HookDispatcher.ts              # REWIRE skillRefResult -> SkillExecutor.execute
|- service/
|   |- SkillImportService.ts          # REUSE registerImportedSkill (factor out shared helper)
|   |- PluginComponentRegistryService.ts # ADD plugin command/agent promotion
|   +- pluginPaths.ts                 # CONFIRM options.json path separation (no change)
|- config/skillsRegistry.ts            # POSSIBLY add LocalSkillSourceAdapter (or handle in sync)
+- entityTypes/
    +- aifetchlyConfigTypes.ts         # snapshot.skills already reserved (readonly unknown[])
```

### Pattern 1: Discretion Item 1 — Manifest Schema Fields (REUSE EXISTING)

**What:** The local `~/.aifetchly/skills/<name>/manifest.json` uses the EXISTING `SkillManifest` type — no new format.

**Evidence:** `src/entityTypes/skillTypes.ts:289-335` defines `SkillManifest`:
```typescript
export interface SkillManifest {
  readonly name: string;              // kebab-case ^[a-z][a-z0-9_-]*$
  readonly version: string;           // semver
  readonly description: string;       // <=500 chars
  readonly author?: string;
  readonly runtime: SkillManifestRuntime;  // "javascript" | "python"
  readonly entry: string;             // relative path to .js or .py
  readonly parameters: Record<string, unknown>; // JSON Schema type:"object"
  readonly permissions?: SkillPermissionCategory[]; // "network"|"filesystem"|"automation"
  readonly supportedFileTypes?: readonly string[];
  readonly documentationOnly?: boolean;
  readonly python?: SkillPythonManifestBlock;          // required when runtime="python"
  readonly python_attachment_execution?: SkillPythonAttachmentExecutionBlock;
}
```

`SkillImportService.validateManifest(raw)` (`src/service/SkillImportService.ts:572-681`) is the existing validator. It checks: name regex, semver, description <=500, runtime in {javascript, python}, parameters type:object, permissions in {network, filesystem, automation}, python block validation, path traversal on entry. `[VERIFIED: source code]`

**Recommendation:** Phase 18 REUSES `SkillManifest` + `validateManifest` unchanged. The only adaptation: extract `validateManifest` + `resolvePermissionCategory` so they're callable from the config loader without importing the full SkillImportService (which has zip/DB concerns). A pure `buildLocalSkillDraft(raw, sourceMeta)` function (mirroring Phase 16's `buildAgentDefinition`) wraps the validation + constructs the `LocalSkillDraft`.

### Pattern 2: Discretion Item 2 — Skill Execution Boundary (EXISTING HANDLES LOCAL ROOTS)

**What:** Local skills run through the EXISTING `SkillImportService.registerImportedSkill` -> `SkillWorkerClient` / `PythonSkillRuntimeService`. NEVER `import()` in main, NEVER shell in main.

**Evidence:** `src/service/SkillImportService.ts:985-1042` — `registerImportedSkill(manifest, skillDir)`:
```typescript
function registerImportedSkill(manifest: SkillManifest, skillDir: string): void {
  const entryPath = path.join(skillDir, manifest.entry);
  let code = fs.readFileSync(entryPath, "utf-8");  // read entry file content
  SkillRegistry.registerSkill({
    name: resolvedManifest.name,
    tier: "sandboxed",
    permissionCategory: resolvePermissionCategory(resolvedManifest.permissions),
    source: "user",
    execute: buildImportedSkillExecuteHandler(resolvedManifest, skillDir, code),
  });
}
```

`buildImportedSkillExecuteHandler` (`src/service/SkillImportService.ts:1107-1281`) routes execution:
- Documentation-only skills -> return SKILL.md guidance (+ attachment handling).
- JavaScript skills -> `SkillWorkerClient.getInstance().execute(capturedCode, args, context)` (line 1276) — sends CODE to the utility process.
- Python skills -> `PythonSkillRuntimeService.executePythonSkill({manifest, skillDir, args, context})`.

`[VERIFIED: source code]`

**The ONLY difference for local skills:** `skillDir` is `~/.aifetchly/skills/<name>` (resolved from the config loader's `rootPath`) instead of `userData/installed_skills/<name>`. The `buildImportedSkillExecuteHandler` closure captures `skillDir` and `code` — it does not care WHERE the skill directory lives. **The existing boundary handles `~/.aifetchly/skills` roots with zero changes to the executor.**

### Pattern 3: Discretion Item 3 — OpenAI Tool Schema Mapping (AUTOMATIC, NO NEW CODE)

**What:** A local skill registered via `SkillRegistry.registerSkill` is AUTOMATICALLY exposed as an OpenAI tool. No new mapping code.

**Evidence:** The skill->tool path is:
1. `SkillRegistry.registerSkill(skill)` — adds to the in-memory `registry` Map (`src/config/skillsRegistry.ts:2108`).
2. `SkillRegistry.getAllToolFunctions()` (line 2049) — iterates `registry.values()`, converts each via `skillDefinitionToToolFunction(skill)`, merges MCP tools.
3. `skillDefinitionToToolFunction(skill)` (`src/entityTypes/skillTypes.ts:346-359`):
   ```typescript
   export function skillDefinitionToToolFunction(skill: SkillDefinition): ToolFunction {
     return { type: "function", name: skill.name,
       description: skill.documentationOnly ? `[doc-only] ${skill.description}` : skill.description,
       parameters: skill.parameters };
   }
   ```
4. `AIChatQueryEngine` calls `SkillRegistry.getAllToolFunctions()` at lines 251 and 580 — the result is sent to the AI server as `client_tools`. `[VERIFIED: source code]`

**A local skill appears in the AI tool catalog the moment `registerSkill` is called. No Phase 18 code touches this path.**

### Pattern 4: Discretion Item 4 — options.json Conflict Mechanism (SEPARATE ROOTS)

**What:** `~/.aifetchly/plugins/<name>/options.json` and `userData/plugins/installed/<pkg>` coexist because they are in COMPLETELY SEPARATE filesystem trees. No collision is possible by construction.

**Evidence:**
- `pluginPaths.ts:14-16`: `getPluginsRoot()` -> `path.join(getElectronUserDataPath(), "plugins", "installed")`. Installed package roots are `userData/plugins/installed/<name>`. `[VERIFIED: source code]`
- `SkillEnvironmentManager.getElectronUserDataPath()` (`src/service/SkillEnvironmentManager.ts:31`) -> Electron's `app.getPath('userData')` — the platform-specific app data directory.
- `~/.aifetchly/plugins/<name>/options.json` — the literal user-home `~/.aifetchly` directory (per `AIFETCHLY_CONFIG_DIR_NAME = ".aifetchly"`, `AIFetchlyConfigConstants.ts:21`).

These are two different directories: `~/.aifetchly/` (user home) vs `<userData>/` (app data). **PRD section 6.3's "must not conflict" is satisfied by filesystem-root separation — no code-level collision resolution is needed.** `[CITED: docs/prd/aifetchly-local-extensibility-prd.md section 6.3]`

Phase 18's only obligation: the config loader should read `~/.aifetchly/plugins/<name>/options.json` as a `plugin-options` file kind (already reserved in `AIFetchlyConfigFileKind`, `aifetchlyConfigTypes.ts:36`) and NEVER resolve it via `getPluginInstallRoot`. The existing `pluginPaths.ts` does not touch `~/.aifetchly/plugins/` — it only resolves `userData/plugins/installed`. No change needed.

### Pattern 5: Discretion Item 5 — Plugin Promotion Timing (ON PLUGIN LOAD)

**What:** Promote plugin commands/agents inside `PluginComponentRegistryService.applyLoadedPlugins()` (or a sibling method it calls), which fires after every plugin state change.

**Evidence:** `PluginComponentRegistryService.applyLoadedPlugins()` (`src/service/PluginComponentRegistryService.ts:31-33`) is called from `plugin-ipc.ts` at lines 279, 338, 349, 383 — after install, enable, disable, uninstall, and reload. It currently just clears the `PluginRuntimeCache`. `[VERIFIED: source code]`

`PluginLoaderService.loadAllPlugins()` (`src/service/PluginLoaderService.ts:75-82`) is memoized and returns `LoadedPlugin[]`, each with an `installPath` (line 50). The `PluginManifest` (`src/entityTypes/pluginTypes.ts:28-43`) declares `skills` and `mcpServers` arrays but does NOT declare `commands` or `agents`. `[VERIFIED: source code]` **Plugin commands/agents are discovered by scanning `LoadedPlugin.installPath/commands/*.md` and `LoadedPlugin.installPath/agents/*.md`** — mirroring the `~/.aifetchly/commands|agents` scan. `[ASSUMED — see A3]`

**Recommendation:** Phase 18 extends `applyLoadedPlugins()` (or adds a `promotePluginCommandsAndAgents()` method it calls) to:
1. Call `PluginLoaderService.loadAllPlugins()` (cache hit is fine).
2. For each enabled `LoadedPlugin`, scan `installPath/commands/*.md` -> parse via the existing restricted frontmatter parser + `buildPromptCommandDefinition` (Phase 15) -> call `CommandRegistry.replaceSource("plugin:<pluginName>", defs)`.
3. Scan `installPath/agents/*.md` -> parse via `buildAgentDefinition` (Phase 16) -> call `AgentDefinitionRegistryImpl.replaceSource("plugin:<pluginName>", defs)`.
4. For disabled/uninstalled plugins, call `replaceSource("plugin:<pluginName>", [])` to drop their entries.

This fires on every plugin state change (install/enable/disable/uninstall/reload), which is the correct lifecycle boundary — not the config-scan path (which is for `~/.aifetchly` files, not installed packages).

### Pattern 6: Carry-Forward — D-SkillRefResolve (HookDispatcher Rewire)

**What:** Rewire `HookDispatcher.skillRefResult` from a no-op diagnostic to invoking the registered skill.

**Current code** (`src/service/hooks/HookDispatcher.ts:103-108, 175-183`):
```typescript
// Line 103-108 (dispatch branch):
} else if (hook.command.startsWith(SKILL_REF_COMMAND_PREFIX)) {
  result = skillRefResult(hook);  // NO-OP today
}
// Line 175-183 (the no-op):
function skillRefResult(hook: CommandHookDefinition): HookSingleResult {
  const error: HookExecutionError = {
    hookId: hook.id, source: hook.source,
    message: "skill-registry-not-available: hook declared a skill action but the skill registry is not yet wired",
  };
  return { hook, error, durationMs: 0 };
}
```
`[VERIFIED: source code]`

**Phase 18 rewire:**
```typescript
} else if (hook.command.startsWith(SKILL_REF_COMMAND_PREFIX)) {
  const skillName = hook.command.slice(SKILL_REF_COMMAND_PREFIX.length);
  if (SkillRegistry.isRegistered(skillName)) {
    const execResult = await SkillExecutor.execute(skillName, {}, {
      conversationId: input.conversationId ?? "",
      toolCallId: input.hookRunId,
    });
    result = execResult.success
      ? { hook, output: { summary: `Skill ${skillName} executed` }, durationMs: 0 }
      : { hook, error: { hookId: hook.id, source: hook.source,
          message: `Skill ${skillName} failed` }, durationMs: 0 };
  } else {
    result = skillRefResult(hook); // FALLBACK: skill-registry-not-available
  }
}
```

**Note:** The `skillRefResult` function stays — it is now the FALLBACK for unregistered skills, not the default. The diagnostic code `skill-registry-not-available` remains in the closed set.

### Pattern 7: Carry-Forward — skills: Trust-Filter Line

**What:** Add the `skills:` line to `applyWorkspaceSnapshot`, mirroring `hooks:`.

**Current code** (`src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts:182-197`):
```typescript
const filtered: AIFetchlyConfigSnapshot = {
  ...snapshot,
  instructions: trust.instructions ? snapshot.instructions : [],
  commands: trust.commands ? snapshot.commands : [],
  agents: trust.agents ? snapshot.agents : [],
  hooks: trust.hooks ? snapshot.hooks : [],
  // ADD: skills: trust.skills ? snapshot.skills : [],
};
```
`[VERIFIED: source code]`

**Then in `applySnapshot`** (lines 92-155), add skill registration after the hooks block:
```typescript
// Phase 18 (SKL-01): skills.
let skills: readonly LocalSkillDraft[];
if (snapshot.source === "workspace") {
  const drafts = snapshot.skills as readonly unknown[] as readonly WorkspaceSkillDraft[];
  const workspaceId = snapshot.workspaceId ?? snapshot.sourceId.replace(/^workspace:/, "");
  const converted = buildWorkspaceSkillDefinitions(drafts, workspaceId, diagnostics);
  skills = converted.definitions;
} else {
  skills = snapshot.skills as readonly unknown[] as readonly LocalSkillDraft[];
}
this.registerLocalSkills(snapshot.sourceId, skills); // adapter: unregister old, register new
```

### Pattern 8: Carry-Forward — SkillRegistry Source-Replacement Adapter

**What:** Since `SkillRegistry` has NO `replaceSource`, add an adapter that tracks local-skill names per sourceId and reconciles via `unregisterSkill` + `registerSkill`.

**Evidence:** `SkillRegistry.registerSkill` (`src/config/skillsRegistry.ts:2108-2113`) THROWS if the name is already registered:
```typescript
function registerSkill(skill: SkillDefinition): void {
  if (registry.has(skill.name)) {
    throw new Error(`Skill already registered: ${skill.name}`);
  }
  registry.set(skill.name, skill);
}
```
`[VERIFIED: source code]`

**Recommendation:** A `LocalSkillSourceAdapter` (or a method on `AIFetchlyRuntimeRegistrySync`):
```typescript
// Track: sourceId -> Set<skillName>
private readonly skillSourceIndex = new Map<string, Set<string>>();

private registerLocalSkills(sourceId: string, drafts: readonly LocalSkillDraft[]): void {
  const oldNames = this.skillSourceIndex.get(sourceId);
  if (oldNames) for (const name of oldNames) SkillRegistry.unregisterSkill(name);
  const nextNames = new Set<string>();
  for (const draft of drafts) {
    try {
      SkillImportService.registerImportedSkill(draft.manifest, draft.skillDir);
      nextNames.add(draft.manifest.name);
    } catch (err) { /* Non-fatal: emit diagnostic */ }
  }
  this.skillSourceIndex.set(sourceId, nextNames);
}
```

**CRITICAL collision rule:** Local skill names that collide with built-in skills (`scrape_urls_from_search_engine`, etc.) cause `registerSkill` to throw — the adapter catches this and emits a `manifest-invalid` diagnostic. Built-in skills ALWAYS win (they're registered first at module load).

### Pattern 9: D-WorkspaceSkills Recommendation

**What:** The worker scanner's single-file raw-draft model CAN carry skill directories, but requires a `readdir` + per-dir `manifest.json` read.

**Analysis:** The worker's `tryReadHookFiles` (`WorkspaceConfigScanner.ts:781-857`) reads a SINGLE file (`hooks/hooks.json`). Skills are DIRECTORIES (`skills/<name>/manifest.json` + `skills/<name>/<entry>.js`). The worker would need to: (1) `fs.readdir(skills/)` -> enumerate dirs; (2) for each `<name>/manifest.json`: stat (CFG-04), read, JSON.parse, push ONE `WorkspaceSkillDraft`. The entry file content is NOT shipped by the worker — the main process reads it from the trusted workspace rootPath when registering. `[VERIFIED: source code pattern]`

**Recommendation: INCLUDE workspace skills this phase.** The readdir+per-manifest scan is a moderate extension of `tryReadHookFiles` (one readdir + N bounded reads, capped by `maxSkillsPerSource`). It fits the worker's scan-only contract (no validation, no DB, no registry). The `trust.skills` flag (already reserved in `AIFetchlySourceTrust`) gates registration main-side. The user-global path is the guaranteed deliverable regardless.

### Anti-Patterns to Avoid
- **DO NOT add `replaceSource` to `SkillRegistry`.** CONTEXT.md locks "do not rewrite". Use the adapter pattern.
- **DO NOT ship the entry file content through the worker.** The worker ships the manifest draft only; the main process reads the entry file from disk.
- **DO NOT use `getInstalledSkillRoot()` for local skills.** That resolves `userData/installed_skills/<name>`. Local skills resolve from the config loader's `rootPath`.
- **DO NOT resolve `~/.aifetchly/plugins/<name>/options.json` via `getPluginInstallRoot`.** That would create the exact collision PRD section 6.3 forbids.
- **DO NOT register plugin commands/agents during config-scan.** Plugins are installed packages, not `~/.aifetchly` files. Promote on plugin load.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Skill manifest validation | A new validator | `SkillImportService.validateManifest` | Already handles name regex, semver, runtime, python blocks, path traversal, permissions. |
| Skill execution handler | A new execute function | `SkillImportService.registerImportedSkill` / `buildImportedSkillExecuteHandler` | Already wires SkillWorkerClient (JS) + PythonSkillRuntimeService (Python) + doc-only handling. |
| Permission gate | A new permission system | `SkillPermissionService.checkPermission` | Token-backed, per-call, handles all categories. |
| OpenAI tool schema | Manual ToolFunction construction | `skillDefinitionToToolFunction` + `SkillRegistry.getAllToolFunctions` | Automatic registration -> exposure. |
| Plugin command parsing | A new parser | Phase 15's `buildPromptCommandDefinition` + restricted frontmatter parser | Already validates CMD-06 schema. |
| Plugin agent parsing | A new parser | Phase 16's `buildAgentDefinition` | Already validates AGT-02 schema. |
| Source reconciliation | Custom add/remove logic | `CommandRegistry.replaceSource` / `AgentDefinitionRegistryImpl.replaceSource` | Atomic delete-then-insert. |
| Skill source reconciliation | `replaceSource` on SkillRegistry | Adapter tracking names per sourceId + `unregisterSkill`/`registerSkill` | SkillRegistry has no replaceSource; CONTEXT.md forbids rewriting it. |

**Key insight:** Every problem in Phase 18 already has a solved component. The phase's entire value is the WIRING (discovery path -> existing registration -> existing execution -> existing permission).

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `SkillRegistry` in-memory Map holds built-in + zip-installed skills. Local skills registered via `registerSkill` persist for the session (cleared on restart; re-registered on next config scan). | None — no DB migration. Local skills are not persisted to the `InstalledSkill` DB table (they're discovered from `~/.aifetchly` on each scan). |
| Live service config | Plugin enable/disable state in `PluginManagementModule` (DB). `PluginLoaderService` memoized cache. | Plugin command/agent promotion reads from `PluginLoaderService.loadAllPlugins()`. Cache invalidation via `PluginComponentRegistryService.applyLoadedPlugins()` (already wired). |
| OS-registered state | None. | — |
| Secrets/env vars | `Token` service stores `SKILL_PERMISSION_<name>` keys. Local skills that pass permission gating create new Token keys at runtime. | None — permission keys are created on-demand by the existing `SkillPermissionService.grantPermission`. |
| Build artifacts | `dist/childprocess/SkillWorker.js` (existing, built by forge). No new build artifacts. | Verify the worker entry is registered in `forge.config.js` (it already is — Phase 18 adds no new worker). |

## Common Pitfalls

### Pitfall 1: Built-in Skill Name Collision
**What goes wrong:** A local skill manifest declares `name: "scrape_urls_from_search_engine"` (same as a built-in). `SkillRegistry.registerSkill` throws `Skill already registered`.
**Why it happens:** `registerSkill` enforces uniqueness globally. Built-ins are registered at module-load time.
**How to avoid:** The adapter MUST catch the throw and emit a `manifest-invalid` diagnostic ("skill name collides with an existing skill"). Built-in names ALWAYS win. Optionally pre-filter against `SkillRegistry.listBuiltInSkillDefinitions()`.
**Warning signs:** App crashes on config scan when a local skill has a colliding name.

### Pitfall 2: Entry File Not Found (Local Skill Dir Structure)
**What goes wrong:** `SkillImportService.registerImportedSkill` calls `fs.readFileSync(path.join(skillDir, manifest.entry))` and the file doesn't exist.
**Why it happens:** The manifest's `entry` field points to a file that's absent from `~/.aifetchly/skills/<name>/`.
**How to avoid:** `tryReadSkillFiles` must verify the entry file exists BEFORE constructing the draft (or the adapter catches the error and emits a diagnostic).
**Warning signs:** Silent skill registration failure; skill absent from `/status` counts.

### Pitfall 3: Worker Scanner Carrying Skill DIRECTORIES
**What goes wrong:** The worker's `tryReadHookFiles` is built for a SINGLE file. Naively cloning it for skills reads only one manifest, missing the rest.
**Why it happens:** Skills are directories (`skills/<name>/manifest.json`), not a single file like `hooks/hooks.json`.
**How to avoid:** `tryReadSkillFiles` in the scanner must `readdir(skills/)`, filter directories, then read each `<name>/manifest.json`. Cap iterations at `maxSkillsPerSource`.
**Warning signs:** Only the first workspace skill registers; others silently absent.

### Pitfall 4: Config Rescan Does Not Unregister Removed Local Skills
**What goes wrong:** User deletes `~/.aifetchly/skills/my-skill/`. On rescan, the skill stays registered (stale).
**Why it happens:** `SkillRegistry.unregisterSkill` is never called for the removed skill.
**How to avoid:** The adapter's source-replacement pattern (unregister old sourceId names, register new set) handles this. NEVER patch individual skills; always full-source-replace.
**Warning signs:** Deleted local skill still appears in AI tool catalog until app restart.

### Pitfall 5: Plugin Promotion Fires Before Plugin Files Are Extracted
**What goes wrong:** `applyLoadedPlugins` fires after install, but the commands/*.md files aren't on disk yet (async extraction).
**Why it happens:** Race between install IPC and file extraction.
**How to avoid:** `PluginLoaderService.loadAllPlugins` already checks `fs.existsSync(installPath)` and records `missing_files` health. The promotion scan should skip plugins with `missing_files` health.
**Warning signs:** Plugin commands absent after install; appear after manual `/reload-config`.

### Pitfall 6: Hook Skill-Ref Passes No Args
**What goes wrong:** `SkillExecutor.execute(skillName, {}, context)` passes empty args. A skill expecting parameters fails validation.
**Why it happens:** The hook context (`HookInput`) does not carry tool-call arguments.
**How to avoid:** Accept this limitation — hook-skill-refs are best for skills with optional/no parameters. Document that hook skill-refs pass empty args. Non-fatal on failure.

## Code Examples

### Local Skill Manifest (reuse existing SkillManifest shape)
```json
// ~/.aifetchly/skills/my-scraper/manifest.json
// Source: src/entityTypes/skillTypes.ts:289-335 (SkillManifest interface)
{
  "name": "my-scraper",
  "version": "1.0.0",
  "description": "Scrape my internal CRM for leads.",
  "runtime": "javascript",
  "entry": "handler.js",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" }
    },
    "required": ["query"]
  },
  "permissions": ["network"]
}
```

### tryReadSkillFiles (global loader — mirrors tryReadHookFiles)
```typescript
// Source: template is AIFetchlyConfigLoader.tryReadHookFiles (lines 641-755)
private async tryReadSkillFiles(
  files: AIFetchlyConfigFileSnapshot[],
  skills: LocalSkillDraft[],
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<void> {
  const source = "user" as const;
  const sourceId = "user";
  const skillsDir = path.join(this.rootPath, SKILLS_DIR);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // happy path
    diagnostics.push(this.ioError(SKILLS_DIR, err));
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (skills.length >= AIFETCHLY_CONFIG_LIMITS.maxSkillsPerSource) {
      diagnostics.push({ /* code: "count-cap" */ }); break;
    }
    const manifestPath = path.join(skillsDir, entry.name, "manifest.json");
    // stat (CFG-04 cap), read, JSON.parse, validate via buildLocalSkillDraft
    // Push LocalSkillDraft { name, manifest, skillDir, contentHash }
  }
}
```

### SkillRegistry Adapter (source-replacement without replaceSource)
```typescript
// Mirrors CommandRegistry.replaceSource semantics (atomic delete-then-insert).
private readonly skillSourceIndex = new Map<string, Set<string>>();

registerLocalSkills(sourceId: string, drafts: readonly LocalSkillDraft[]): void {
  const old = this.skillSourceIndex.get(sourceId);
  if (old) for (const name of old) SkillRegistry.unregisterSkill(name);
  const next = new Set<string>();
  for (const draft of drafts) {
    try {
      SkillImportService.registerImportedSkill(draft.manifest, draft.skillDir);
      next.add(draft.manifest.name);
    } catch (err) { /* Non-fatal: emit diagnostic */ }
  }
  this.skillSourceIndex.set(sourceId, next);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Skills only from zip install (`SkillImportService.importFromZip`) | Skills also from `~/.aifetchly/skills/<dir>` (local discovery) | Phase 18 | Local skills need no zip; discovered by config scan |
| Plugin commands/agents opaque metadata | Promoted into native CommandRegistry/AgentDefinitionRegistry | Phase 18 | Plugin commands appear in `/` suggestions with `plugin` badge |
| Hook `skill:<name>` -> no-op diagnostic | Hook `skill:<name>` -> invokes registered skill | Phase 18 | Closes the Phase 17 loop (D-SkillRefResolve) |
| `SkillRegistry.registerSkill` (throws on dup, no source tracking) | Adapter adds source tracking for local skills | Phase 18 | Enables rescan reconciliation without rewriting SkillRegistry |

**Deprecated/outdated:**
- The tech-design doc reference to `SkillRegistry.replaceSource(sourceId, skills)` (line 557) describes a method that DOES NOT EXIST in the code. Phase 18 implements the equivalent via an adapter.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `SkillImportService.registerImportedSkill` works unchanged when `skillDir` is `~/.aifetchly/skills/<name>` (it only uses `skillDir` for `path.join(skillDir, manifest.entry)`). | Pattern 2 | LOW — verified by reading the function body. |
| A2 | The worker scanner can carry skill directory manifests via `readdir` + per-dir read without violating WAT-02. | Pattern 9 | LOW — readdir + read is scan-only I/O; no DB/registry/Electron imports. |
| A3 | Plugin commands/agents are discovered by scanning `installPath/commands/*.md` + `installPath/agents/*.md` (not declared in the plugin manifest). | Pattern 5 | MEDIUM — the `PluginManifest` type has no `commands`/`agents` field (verified), but the plugin install directory MIGHT follow a convention. Planner should verify. |
| A4 | Hook skill-refs pass empty args `{}` (the hook context does not carry tool arguments). | Pitfall 6 | LOW — `HookInput` does not have an args field. |
| A5 | `SkillEnvironmentManager.getInstalledSkillRoot(name)` should NOT be used for local skills. | Anti-Patterns | LOW — verified by reading the function. |

## Open Questions

1. **Plugin command/agent directory convention**
   - What we know: `PluginManifest` declares `skills` and `mcpServers` arrays but NOT `commands`/`agents`.
   - What's unclear: Are plugin commands/agents expected at `<installPath>/commands/*.md` and `<installPath>/agents/*.md` (mirroring `~/.aifetchly`), or at a different path?
   - Recommendation: Check PRD section 5.4 and tech-design section 2.6. Default to `<installPath>/commands/*.md` + `<installPath>/agents/*.md`.

2. **Should local skills be persisted to the `InstalledSkill` DB table?**
   - What we know: Zip-installed skills are persisted. Local skills are discovered by file scan.
   - Recommendation: NO — D-SkillEnable chose auto-register + gate-at-call. Local skills are ephemeral (in-memory). The `/status` command counts from the adapter's sourceIndex.

3. **Does `AIFetchlyConfigSettings` need a `skillsEnabled` flag?**
   - What we know: The settings type has `commandsEnabled`/`agentsEnabled`/`hooksEnabled` but NO `skillsEnabled`.
   - Recommendation: Add for consistency (default `true`), checked in `tryReadSkillFiles`. Low-cost. If minimal scope preferred, skip (permission service is the real gate).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Electron utilityProcess | SkillWorkerClient (JS skill execution) | YES | (existing) | — |
| `childprocess/SkillWorker.js` (built artifact) | SkillWorkerClient worker path | YES | (existing, forge-built) | — |
| Python runtime (system) | PythonSkillRuntimeService (Python skills) | YES | (existing) | Python skills skip if interpreter missing |
| `adm-zip` | SkillImportService (zip import — NOT used by local skills) | YES | (existing) | N/A for Phase 18 local path |
| `zod` | Manifest validation (if Phase 18 adds zod schema) | YES | (existing) | Hand-rolled validation (existing) |
| `uuid` | SkillWorkerClient requestId generation | YES | (existing) | — |

**Missing dependencies with no fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (main + utilitycode configs) + Mocha (modules) |
| Config file | `vite.main.config.mjs`, `vite.utilityCode.config.mjs` (both have `globalSetup` TSC gate) |
| Quick run command | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <test-file> -t "<name>"` |
| Full suite command | `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs test/vitest/main/` (targeted) |

**Note (from STATE.md):** Do NOT run bare `yarn testmain` for self-check — it hangs 20+ min on a pre-existing Electron/DB integration test. Use targeted runs + a standalone `npx tsc --noEmit`.

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SKL-01 | Local skill manifest validated -> registered -> exposed as tool | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyConfigLoader.skills.test.ts -x` | NO Wave 0 |
| SKL-01 | Local skill executes via SkillWorkerClient (not import in main) | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/SkillImportService.local.test.ts -x` | NO Wave 0 |
| SKL-01 | Permission gate fires on local skill execution | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/SkillPermissionService.local.test.ts -x` | NO Wave 0 |
| SKL-01 | Built-in name collision -> diagnostic, no crash | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/LocalSkillSourceAdapter.test.ts -x` | NO Wave 0 |
| SKL-01 | skills: trust-filter line drops untrusted workspace skills | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/AIFetchlyRuntimeRegistrySync.skills.test.ts -x` | NO Wave 0 |
| SKL-01 | Rescan unregisters removed local skills | unit | (same as LocalSkillSourceAdapter test) | NO Wave 0 |
| SKL-02 | Plugin commands promoted into CommandRegistry with plugin badge | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts -x` | NO Wave 0 |
| SKL-02 | Plugin agents promoted into AgentDefinitionRegistry with plugin badge | unit | (same file) | NO Wave 0 |
| SKL-02 | Disabled plugin -> replaceSource("plugin:<name>", []) | unit | (same file) | NO Wave 0 |
| SKL-02 | options.json path does not collide with userData/plugins/installed | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/pluginPaths.options.test.ts -x` | NO Wave 0 |
| D-SkillRefResolve | Hook skill:<name> invokes registered skill | unit | `npx vitest run --config vite.main.config.mjs test/vitest/main/service/HookDispatcher.skillRef.test.ts -x` | NO Wave 0 |
| D-SkillRefResolve | Unregistered skill:<name> -> skill-registry-not-available (fallback) | unit | (same file) | NO Wave 0 |
| WAT-02 | Worker scanner has zero DB/Electron/registry imports | grep gate | `grep -E "SqliteDb|TypeORM|SkillRegistry|CommandRegistry|electron" src/service/workspaceWatch/WorkspaceConfigScanner.ts && exit 1 || exit 0` | YES (reuse) |

### Sampling Rate
- **Per task commit:** `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <new test files>`
- **Per wave merge:** Full targeted suite (`test/vitest/main/service/` + `test/vitest/utilitycode/`) + standalone `npx tsc --noEmit`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/vitest/main/service/AIFetchlyConfigLoader.skills.test.ts` — covers SKL-01 global skill discovery (mirror `AIFetchlyConfigLoader.hooks.test.ts`)
- [ ] `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.skills.test.ts` — covers SKL-01 skills: trust-filter line
- [ ] `test/vitest/main/service/LocalSkillSourceAdapter.test.ts` — covers SKL-01 source reconciliation + collision handling
- [ ] `test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts` — covers SKL-02 plugin command/agent promotion
- [ ] `test/vitest/main/service/HookDispatcher.skillRef.test.ts` — covers D-SkillRefResolve
- [ ] `test/vitest/utilitycode/` scanner test for workspace skill raw drafts

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (no new auth) |
| V3 Session Management | no | N/A |
| V4 Access Control | yes | `trust.skills` flag gates workspace skill registration BEFORE registry mutation (TRS-01). `SkillPermissionService.checkPermission` is the per-call access gate. |
| V5 Input Validation | yes | Skill manifests validated via `SkillImportService.validateManifest`. CFG-04 size cap + CFG-06 count cap. CFG-05 path safety on entry paths (no `..`, no absolute). |
| V6 Cryptography | no | N/A (no new crypto) |
| V8 Data Protection | yes | `SkillExecutor.validateArgs` rejects sensitive patterns (API keys, passwords) in skill arguments. `sanitizeForLog` strips sensitive values from audit logs. |
| V12 Files & Resources | yes | CFG-05 path safety on skill/plugin paths. Entry file path must be relative, no traversal. Local skill directories bounded by `maxSkillsPerSource`. |

### Known Threat Patterns for Skill/Plugin Integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Arbitrary code execution in main process | Elevation of Privilege | Local skills NEVER `import()` in main — JS skills run in `SkillWorkerClient` utility process; Python in per-skill venv. SkillExecutor wraps `skill.execute()`. |
| Malicious skill masquerading as built-in | Spoofing | `registerSkill` throws on duplicate name; adapter catches and emits diagnostic. Built-in names always win. |
| Path traversal via manifest.entry | Tampering | `validateManifest` rejects entries with `..` or absolute paths. |
| Untrusted workspace skill auto-executing | Elevation of Privilege | `skills: trust.skills ? snapshot.skills : []` drops untrusted workspace skills BEFORE registration. |
| Plugin command poisoning the command registry | Tampering | Plugin commands registered under `plugin:<name>` source (rank 3, lowest). Built-in (rank 0) and user/workspace commands always win name collisions. |
| Sensitive data exfiltration via skill args | Information Disclosure | `SkillExecutor.validateArgs` rejects API-key/password/token patterns in arguments before execution. |

## Sources

### Primary (HIGH confidence — source code read directly in this session)
- `src/config/skillsRegistry.ts` — `SkillRegistry` singleton: `registerSkill` (throws on dup, line 2108), `unregisterSkill`, `getSkill`, `getAllToolFunctions` (line 2049, consumed by AIChatQueryEngine at 251/580). NO `replaceSource`.
- `src/entityTypes/skillTypes.ts` — `SkillManifest` (lines 289-335), `SkillDefinition`, `skillDefinitionToToolFunction` (lines 346-359).
- `src/service/SkillImportService.ts` — `validateManifest` (lines 572-681), `registerImportedSkill` (lines 985-1042), `buildImportedSkillExecuteHandler` (lines 1107-1281, routes to SkillWorkerClient line 1276).
- `src/service/SkillExecutor.ts` — `execute(name, args, context)` (line 218): validate -> sanitize -> `SkillPermissionService.checkPermission` -> `skill.execute()`.
- `src/service/SkillPermissionService.ts` — `checkPermission(skillName)` (line 109): pure auto-allowed, shell always-prompt, others check Token store.
- `src/service/SkillWorkerClient.ts` — `execute(code, args, context)` (line 79): forks `utilityProcess` (`childprocess/SkillWorker.js`).
- `src/service/hooks/HookDispatcher.ts` — skill-ref branch (lines 103-108), `skillRefResult` no-op (lines 175-183), `SKILL_REF_COMMAND_PREFIX = "skill:"` (line 22).
- `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` — `applySnapshot` (line 92), `applyWorkspaceSnapshot` trust filter (lines 182-197).
- `src/service/slashCommands/CommandRegistry.ts` — `replaceSource(sourceId, commands)` (line 83), `SOURCE_RANK` (line 26).
- `src/service/AgentDefinitionRegistry.ts` — `replaceSource(sourceId, agents)` (line 219), `SOURCE_RANK` (line 102, `plugin` rank reserved for Phase 18).
- `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` — `tryReadHookFiles` (line 641): template for `tryReadSkillFiles`.
- `src/service/workspaceWatch/WorkspaceConfigScanner.ts` — `tryReadHookFiles` (line 781): worker raw-draft template.
- `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` — `AIFETCHLY_CONFIG_LIMITS` (line 30), `AIFETCHLY_DIAGNOSTIC_CODES` (line 91, `skill-registry-not-available` at line 113).
- `src/entityTypes/aifetchlyConfigTypes.ts` — `snapshot.skills` (line 101, reserved), `trust.skills` (line 143, reserved), `AIFetchlyConfigFileKind` includes `"skill"` and `"plugin-options"` (lines 34, 38).
- `src/service/pluginPaths.ts` — `getPluginsRoot()` -> `userData/plugins/installed` (line 15).
- `src/service/PluginLoaderService.ts` — `loadAllPlugins()` (line 75, memoized), `LoadedPlugin.installPath` (line 50).
- `src/service/PluginComponentRegistryService.ts` — `applyLoadedPlugins()` (line 31, called from plugin-ipc.ts).
- `src/entityTypes/pluginTypes.ts` — `PluginManifest` (line 28): has `skills`/`mcpServers`, NO `commands`/`agents`.

### Secondary (MEDIUM confidence — PRD/tech-design referenced)
- `docs/prd/aifetchly-local-extensibility-prd.md` section 7.5 (lines 321-342): skills flow + rules.
- `docs/prd/aifetchly-local-extensibility-prd.md` section 6.3 (lines 169-177): options.json path preserved.
- `.planning/phases/17-hooks/17-CONTEXT.md` — D-Vocabulary skill-ref sentinel, reserved `trust.skills`.
- `.planning/phases/16-dynamic-agents/16-CONTEXT.md` — agent registry + replaceSource + source badges.
- `.planning/phases/15-prompt-command-files/15-CONTEXT.md` — command registry + replaceSource.

### Tertiary (LOW confidence — assumptions for planner validation)
- A3: Plugin command/agent directory convention.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules read directly from source; signatures and line numbers cited.
- Architecture: HIGH — the 5 discretion items resolved by tracing existing call paths.
- Pitfalls: HIGH — derived from actual code semantics.
- Plugin promotion timing: MEDIUM — the hook point (`applyLoadedPlugins`) is verified, but the plugin command/agent directory convention is an assumption (A3).

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (30 days — stable integration phase)

## RESEARCH COMPLETE
