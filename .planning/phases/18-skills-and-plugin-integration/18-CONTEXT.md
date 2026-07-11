# Phase 18: Skills and Plugin Integration - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate the **existing** skill + plugin subsystems with the local-extensibility pipeline:
- **SKL-01:** Validate `~/.aifetchly/skills/<name>/manifest.json`, register it through the existing `SkillRegistry`, expose it as an OpenAI tool schema, execute via `SkillExecutor`, and permission-check via `SkillPermissionService` — skills are NEVER `import()`'d as arbitrary code into the Electron main process and NEVER shell-exec'd directly in main (they run through the existing skill runtime boundaries — `SandboxedSkillExecutor` / `SkillWorkerClient`).
- **SKL-02:** Promote plugin `commands/*.md` into the native `CommandRegistry` and plugin `agents/*.md` into the native `AgentDefinitionRegistry` (both stable since Phase 15/16), and preserve the `~/.aifetchly/plugins/<name>/options.json` path without conflicting with installed plugin package roots under `userData/plugins/installed`.

This is an **integration** phase, NOT greenfield skill/plugin construction. The skill runtime (`SkillRegistry`, `SkillExecutor`, `SandboxedSkillExecutor`, `SkillPermissionService`, `SkillWorkerClient`, `SkillImportService`, `SkillDiagnosticsService`, `SkillEnvironmentManager`, `PythonSkillRuntimeService`) and the plugin subsystem (`PluginLoaderService`, `PluginManifestService`, `PluginComponentRegistryService`, `PluginRuntimeCache`, `PluginImportService`, `PluginDiagnosticsService`, `pluginPaths`, `pluginSources/*`) already exist. Phase 18 adds the `~/.aifetchly` discovery path for skills and flips plugin commands/agents from opaque metadata into the native registries.

It also closes Phase 17's documented gap: the `skill:<name>` hook reference (Phase 17 D-Vocabulary) resolves here instead of emitting `skill-registry-not-available`.

In scope (delivers SKL-01, SKL-02):
- **`skills/<name>/manifest.json` parsing** (user-global `~/.aifetchly/skills/` + trusted-workspace `<ws>/.aifetchly/skills/`) → validated manifest → registered local skill → OpenAI tool schema → `SkillExecutor` → `SkillPermissionService`. Mirrors the Phase 15/16/17 capability-loader pattern (restricted JSON parser + CFG-04/CFG-06 caps + diagnostic codes).
- **`skills:` trust-filter line** in `AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot` (mirror the Phase 17 `hooks:` line) so untrusted-workspace skills are dropped BEFORE registry mutation.
- **Skill-ref hook resolution** — the `skill:<name>` command sentinel (Phase 17) resolves to invoking the registered skill (closes the loop); non-fatal `skill-registry-not-available` only when the named skill is not registered.
- **Plugin command/agent promotion** — plugin `commands/*.md` → `CommandRegistry` and plugin `agents/*.md` → `AgentDefinitionRegistry`, carrying a `plugin` source badge (D-PluginBadge).
- **Plugin options path preservation** — `~/.aifetchly/plugins/<name>/options.json` coexists with `userData/plugins/installed` package roots (no path collision).

**Out of scope (locked boundaries — do NOT pull in):**
- A new skill runtime / sandbox / executor (reuse `SkillExecutor`/`SandboxedSkillExecutor`/`SkillWorkerClient`).
- A new plugin loader (reuse `PluginLoaderService`/`PluginManifestService`).
- Skill marketplace / sharing / remote install (the existing `pluginSources/*` fetchers are out of scope for the `~/.aifetchly` local path).
- Plugin-sourced hooks (`plugin:<name>:hook:`) and plugin-sourced skills (SKL-02 covers commands/agents only).
- Granular per-capability trust approval UX (deferred via D-TrustUX in Phase 17 — the entity already ships per-capability flags; v2.0 approval stays binary).
- Rewriting the existing `SkillRegistry`/`SkillExecutor`/permission flow — Phase 18 feeds local skills INTO it, it does not rewrite it.

</domain>

<decisions>
## Implementation Decisions

### Skill enable model
- **D-SkillEnable: Auto-register, gate at call.** A discovered local skill is registered as an OpenAI tool immediately (no per-skill "enable" step). Execution is gated by the EXISTING `SkillPermissionService` at call time — skills touching filesystem/network/automation/shell require the existing permission policy. This mirrors how MCP tools work today and matches the PRD §7.5 flow (validate → register → expose → execute → permission-check). Lowest friction; the permission service is the gate, not a discovery-time opt-in.
  - Side effect: the manifest's declared permissions feed `SkillPermissionService` exactly as already-installed skills do — no new permission UX this phase.

### Skill-ref hook resolution
- **D-SkillRefResolve: Resolve `skill:<name>` to invoke.** Phase 17's `skill:<name>` command-sentinel hook references (registered as command hooks with `command: "skill:<name>"`) resolve in Phase 18 to invoking the named skill as a tool — closing the Phase 17 documented gap and matching PRD §7.6 ("hook actions that require execution should route through a worker or registered skill"). The `skill-registry-not-available` diagnostic is emitted only when the named skill is NOT registered (non-fatal; the hook is a documented no-op in that case). This is wired in the `HookDispatcher` skill-ref branch (Phase 17) — it calls into the skill runtime instead of returning the no-op diagnostic.

### Plugin promotion transparency
- **D-PluginBadge: Plugin source badge.** When plugin `commands/*.md` and `agents/*.md` are promoted into the native `CommandRegistry` / `AgentDefinitionRegistry`, they carry a `plugin` source badge (scoped id `plugin:<name>:command:<name>` / `plugin:<name>:agent:<name>`), mirroring the Phase 13 source-badge pattern (`user`/`workspace`/`plugin` badges) and preserving `SOURCE_RANK`/`SOURCE_PRIORITY` ordering. Users see plugin provenance; plugin commands are NOT indistinguishable from native/user ones.
  - Side effect: the existing `SlashCommand`/`AgentDefinitionView` source fields already reserve `plugin`; Phase 18 populates them.

### Workspace skills scope (defaulted — user declined to discuss; flagged for researcher)
- **D-WorkspaceSkills: Workspace skills gated by `trust.skills` (mirror Phase 17 hooks).** User-global `~/.aifetchly/skills/` is the primary path. Workspace `<ws>/.aifetchly/skills/` is scanned into raw drafts (worker-side, WAT-02) and, when `trust.skills` is true, validated main-side and registered; when false, dropped by the `skills:` trust-filter line before registry mutation. This mirrors exactly how Phase 17 treated workspace hooks and consumes the `trust.skills` flag Phase 17 reserved. PRD §7.5 ("workspace skills not enabled unless explicitly installed or trusted") is satisfied because trust.skills is the explicit-trust gate. **Researcher latitude:** if the worker scanner cannot carry skill manifests cleanly (skills are directories, not single files), it is acceptable to ship user-global skills only this phase and defer the workspace path — surface this in RESEARCH.md.

### Carry-Forward from Prior Phases (locked, do not re-litigate)
- **D-TrustUX (Phase 17, locked):** binary workspace approval = all capabilities; `trust.skills` writes as a block on approval. The per-capability entity already has the `skills` column.
- **D-Vocabulary skill-ref (Phase 17, locked):** the `skill:<name>` sentinel command is the marker Phase 18 detects (Phase 17 registered it; Phase 18 resolves it).
- **Source replacement (Phase 13/15/16/17, locked):** `SkillRegistry`/`CommandRegistry`/`AgentDefinitionRegistry.replaceSource(sourceId, …)` — atomic delete-then-insert reconciliation. Plugin commands/agents register under `plugin:<name>` source IDs.
- **Restricted parser + caps (Phase 13-01, locked):** manifest.json parsed via zod at the boundary; CFG-04 size cap + CFG-06 count cap on skills (manifest + skill dir). CFG-05 path safety on skill/plugin paths.
- **Diagnostic shape (Phase 13–17, locked):** closed-set `AIFETCHLY_DIAGNOSTIC_CODES` — add skill-specific codes only if needed (e.g. `manifest-invalid`, `skill-count-cap`); reuse `skill-registry-not-available` (Phase 17) for unresolved refs.
- **Three-layer DB / worker-no-DB (CLAUDE.md, locked):** no DB/registry/Electron imports in the worker; the worker snapshots raw skill drafts only; validation + registration happen main-side. WAT-02 grep gate must pass for any worker changes.
- **i18n (CLAUDE.md, locked):** skill/plugin names + manifest fields are author DATA. New chrome strings (e.g. a "plugin" badge label) → all 6 lang files.
- **NEVER use `any`**; immutability (defensive copies); explicit error handling; USER_AI_ENABLED gating (TRS-05 Strategy A) — skill execution IPC (if any) is NON-AI-serving → `registerValidatedHandler`.

### Claude's Discretion
- **Manifest schema fields** — exact `manifest.json` shape (name, description, permissions, runtime/handler entry point, tool schema). Align with the EXISTING `SkillImportService`/`SkillDiagnosticsService` manifest contract — researcher confirms whether the existing skill manifest format already covers local skills or needs extension. Do not invent a new manifest format if one exists.
- **Skill execution boundary** — local skills run through the EXISTING `SandboxedSkillExecutor`/`SkillWorkerClient` (never `import()` in main, never shell in main). Researcher confirms the existing boundary handles `~/.aifetchly/skills` roots (path/sandbox config).
- **options.json conflict mechanism** — how `~/.aifetchly/plugins/<name>/options.json` coexists with `userData/plugins/installed/<pkg>` roots. PRD §6.3 locks the constraint (no conflict); researcher traces `pluginPaths.ts` + `PluginLoaderService` to confirm the resolution (separate roots, namespaced keys, or precedence rule).
- **Plugin promotion timing** — promote on plugin load (`PluginLoaderService`) vs on config-scan. Researcher picks based on the existing plugin lifecycle.
- **OpenAI tool schema mapping** — how a registered local skill's manifest maps to the OpenAI function/tool schema the existing `AIChatQueryEngine`/`AgentRuntime` exposes. Researcher confirms against the existing skill→tool path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked design (authoritative)
- `docs/prd/aifetchly-local-extensibility-prd.md` §7.5 (`skills/*` — manifest → validate → register → OpenAI tool → SkillExecutor → SkillPermissionService; no main import/shell; workspace skills need explicit install/trust) — **PRIMARY requirements source for SKL-01**.
- `docs/prd/aifetchly-local-extensibility-prd.md` §7.6 (`hooks/hooks.json` — "route through a worker or registered skill") — **the hook→skill routing D-SkillRefResolve implements**.
- `docs/prd/aifetchly-local-extensibility-prd.md` §6.3 (Plugin-owned options — `~/.aifetchly/plugins/<name>/options.json` preserved, no conflict with `userData/plugins/installed`) — **SKL-02 options path**.
- `docs/prd/aifetchly-local-extensibility-prd.md` §5.4 (Plugin Author persona) — plugin command/agent authoring expectations.
- `docs/prd/aifetchly-local-extensibility-technical-design.md` §2.3 (Skill and tool execution — "register local skills through the existing SkillRegistry and execute through SkillExecutor, preserving permission checks"), §2.6 (Plugin compatibility), §Phase 6 (Skills and plugin integration scope) — **the integration contract**.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — SKL-01 (local skills via existing SkillRegistry/Executor/PermissionService, no main arbitrary-code load), SKL-02 (plugin commands/agents promoted once native registries stable; options.json path preserved); also TRS-01 (workspace trust before registration), CFG-04/CFG-06 (caps), TRS-05 (AI-gating).
- `.planning/ROADMAP.md` §Phase 18 — goal + 3 success criteria.

### Prior-phase surfaces this phase consumes (read the SUMMARYs / CONTEXT)
- `.planning/phases/17-hooks/17-CONTEXT.md` — **THE carry-forward**: D-Vocabulary `skill:<name>` sentinel (D-SkillRefResolve closes it), reserved `trust.skills` flag + the `skills:` filter line (D-WorkspaceSkills), D-TrustUX binary approval. The skill-ref no-op in `HookDispatcher.ts` is the exact site Phase 18 rewires.
- `.planning/phases/16-dynamic-agents/16-CONTEXT.md` — agent registry + `replaceSource` (the template plugin agents mirror); source-badge + scoped-id conventions.
- `.planning/phases/15-prompt-command-files/15-CONTEXT.md` — command registry + `replaceSource` + source badges (the template plugin commands mirror).
- `.planning/phases/13-global-context-and-built-in-slash-commands/13-02-SUMMARY.md` — `CommandRegistry.replaceSource` + `SOURCE_RANK` + source badges (the pattern D-PluginBadge reuses).

### Project rules + constants
- `./CLAUDE.md` — three-layer DB, worker-no-DB/WAT-02, i18n (6 langs), no `any`, zod at boundaries, USER_AI_ENABLED gating, child-process file placement, immutability, auto-commit per function.
- `src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts` — size/count caps (CFG-04/CFG-06); closed-set diagnostic codes (add skill codes only if needed; `skill-registry-not-available` already present from Phase 17).

### Core source files (EXISTING — integration targets; NOT greenfield)
- `src/config/skillsRegistry.ts` — existing SkillRegistry (the registration target for local skills).
- `src/service/SkillExecutor.ts`, `src/service/SandboxedSkillExecutor.ts`, `src/service/SkillWorkerClient.ts` — existing execution boundaries (local skills run through these; never `import()`/shell in main).
- `src/service/SkillPermissionService.ts` — existing per-call permission gate (D-SkillEnable's gate).
- `src/service/SkillImportService.ts`, `src/service/SkillDiagnosticsService.ts`, `src/service/SkillEnvironmentManager.ts`, `src/service/PythonSkillRuntimeService.ts` — existing skill import/diagnostics/environment (manifest contract + runtime boundaries to reuse).
- `src/service/PluginLoaderService.ts`, `src/service/PluginManifestService.ts`, `src/service/PluginComponentRegistryService.ts`, `src/service/PluginRuntimeCache.ts`, `src/service/PluginDiagnosticsService.ts`, `src/service/pluginPaths.ts`, `src/service/pluginSources/*` — existing plugin subsystem (promotion + options path).
- `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` — add the `skills:` trust-filter line (mirror Phase 17 `hooks:` line).
- `src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts` + `src/service/workspaceWatch/WorkspaceConfigScanner.ts` — `tryReadSkillFiles` (global) + raw-draft scan (worker), mirroring `tryReadHookFiles` (Phase 17).
- `src/service/hooks/HookDispatcher.ts` — the skill-ref branch (Phase 17) that Phase 18 rewires from no-op to invoke (D-SkillRefResolve).
- `src/service/AgentDefinitionRegistry.ts` + `src/service/slashCommands/CommandRegistry.ts` — promotion targets for plugin agents/commands (D-PluginBadge).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Existing skill runtime (Phase 18 does NOT rebuild):** `SkillRegistry` + `SkillExecutor`/`SandboxedSkillExecutor`/`SkillWorkerClient` + `SkillPermissionService` + `SkillImportService`/`SkillDiagnosticsService`. Phase 18's job is to feed `~/.aifetchly/skills` manifests INTO this runtime (register → expose → execute → permission-check), not to rewrite it.
- **Existing plugin subsystem (Phase 18 does NOT rebuild):** `PluginLoaderService` + `PluginManifestService` + `PluginComponentRegistryService` already load plugins and hold their commands/agents as opaque metadata. Phase 18 promotes that metadata into the native registries.
- **`tryReadHookFiles` (Phase 17)** — the template for `tryReadSkillFiles` (global loader + worker raw-draft scanner), adapted for skill directories (manifest.json per skill dir, not a single JSON file).
- **`replaceSource` + source badges (Phase 13/15/16/17)** — the structural template for plugin command/agent promotion (`plugin:<name>` source IDs) and for skill registration.
- **`applyWorkspaceSnapshot` trust filter (Phase 14/16/17)** — the `hooks:` line is the exact template for the `skills:` line.

### Established Patterns
- **Source-replacement on scan** — every rescan calls `replaceSource(sourceId, entries)`; renames/deletes reconcile automatically.
- **Scoped-ID convention** — `user:skill:<name>`, `workspace:<wsId>:skill:<name>`, `plugin:<pluginName>:command:<name>`, `plugin:<pluginName>:agent:<name>` (paralleling command/agent/hook scoped IDs).
- **Skill-ref sentinel** — `command: "skill:<name>"` (Phase 17) is the marker the dispatcher detects.
- **Three-layer DB** — entity + model + module for any new persistence (likely none new this phase — the skill registry is in-memory via `SkillRegistry`, and trust reuses Phase 17's entity).

### Integration Points
- `WorkspaceConfigScanner.scan()` → snapshot `skills[]` (raw drafts, worker-side) → `applyWorkspaceSnapshot(snapshot, trust)` filters by `trust.skills` → trusted skill manifests flow into the existing `SkillRegistry`. Global skills flow from the global loader (`~/.aifetchly/skills/`) into the `SkillRegistry`.
- `SkillRegistry` registered skill → exposed as an OpenAI tool by the existing `AIChatQueryEngine`/`AgentRuntime` → executed via `SkillExecutor`/`SandboxedSkillExecutor` → gated by `SkillPermissionService`.
- `HookDispatcher` skill-ref branch → on a `skill:<name>` hook, invoke the registered skill (D-SkillRefResolve) instead of returning `skill-registry-not-available`.
- `PluginLoaderService` load → promote `commands/*.md` → `CommandRegistry.replaceSource("plugin:<name>", …)`; promote `agents/*.md` → `AgentDefinitionRegistry.replaceSource("plugin:<name>", …)` (D-PluginBadge).
- `pluginPaths.ts` → resolve `~/.aifetchly/plugins/<name>/options.json` without colliding with `userData/plugins/installed`.

</code_context>

<specifics>
## Specific Ideas

- **D-SkillRefResolve closes Phase 17's loop (cite):** Phase 17's `HookDispatcher.skillRefResult` (commit ff640227) is the exact site to rewire — replace the no-op diagnostic with a skill invocation (and fall back to `skill-registry-not-available` only when the named skill is not registered). Cite this when implementing/testing the skill-ref path.
- **D-PluginBadge mirrors Phase 13:** the `user`/`workspace`/`plugin` badge pattern is already in the `SlashCommand`/`AgentDefinitionView` source fields and the `/status` + command-suggestions UI (Phase 13 source badges). Plugin promotion populates the existing `plugin` source value — no new badge UI, just data.
- **Skill enable = MCP-tool parity (cite):** D-SkillEnable intentionally matches how MCP tools are exposed (registered → permission-gated at call). The existing `SkillPermissionService` is the gate. If the user later wants per-skill opt-in, that's a deferred UX layer on top, not a change to this decision.

</specifics>

<deferred>
## Deferred Ideas

- **Granular per-skill enable/disable UI** — D-SkillEnable chose auto-register + gate-at-call; a per-skill opt-in management UI (enable/disable toggles, per-skill permission review) is deferred to a future phase.
- **Plugin-sourced skills + plugin-sourced hooks** — SKL-02 covers plugin commands/agents only; plugin-provided skills and `plugin:<name>:hook:` hooks are out of scope (future).
- **Skill marketplace / sharing / remote install** — the existing `pluginSources/*` fetchers are for plugins; a skill marketplace is a future capability.
- **Workspace skills (if worker can't carry skill dirs)** — D-WorkspaceSkills defaults to gating by `trust.skills`, but the researcher may defer the workspace path if skill-directory scanning doesn't fit the worker's single-file draft model; user-global is the guaranteed v2.0 deliverable.
- **Granular per-capability trust approval UX** (5 checkboxes) — deferred via D-TrustUX (Phase 17); the entity enables it later without a schema migration.

</deferred>

---

*Phase: 18-skills-and-plugin-integration*
*Context gathered: 2026-07-11*
