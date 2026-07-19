# Claude Code Plugin Compatibility — Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-03
- **Owner**: Engineering Team
- **Related docs**:
  - `docs/skills/PRD_Plugin_Management_System.md`
  - `docs/skills/Plugin_Management_System_Technical_Design.md`
  - `docs/skills/PRD_AI_Skills_System.md`
  - `docs/mcp-server-prd.md`
  - `/home/robertzeng/project/github/claude-code/docs/plugin-system.md`
  - <https://code.claude.com/docs/en/plugins>

## 1. Executive Summary

AiFetchly already ships a plugin system that is architecturally close to Claude Code's: a self-contained package with a manifest, multi-source install pipeline, memoized loader with an `enabled` gate, per-component error collection, MCP server integration, and path-traversal guards. We want users to be able to install **off-the-shelf Claude Code plugins** (from GitHub, npm, local folders, or ZIPs) into AiFetchly and have their skills and MCP servers work without modification.

The proposed approach is a **compatibility adapter layer**, not a schema merger or a parallel runtime. A small set of components — primarily `ClaudePluginAdapter` and `ClaudeSkillFormatAdapter` — translate Claude-format manifests and Claude-format skills into AiFetchly's existing internal model at load time. The existing `PluginManifestService`, `PluginLoaderService`, `PluginManagementModule`, `SkillExecutor`, and MCP runtime continue to be the source of truth.

Compatibility is delivered in four phases:

1. **Read-only compat**: install Claude plugins, run their skills.
2. **MCP compat**: spawn Claude plugin MCP servers with scoping and per-plugin options.
3. **Hooks compat**: wire Claude `hooks.json` into the existing `HookRegistry`.
4. **Commands / agents compat** (optional, gated on chat-surface demand).

LSP servers and output styles are explicitly deferred.

## 2. Background And Problem Statement

### 2.1 Current state

AiFetchly's plugin system (see `docs/skills/PRD_Plugin_Management_System.md` and `Plugin_Management_System_Technical_Design.md`) supports:

- Plugin manifest at `.aifetchly-plugin/plugin.json` (fallback root `plugin.json`), with required fields `name`, `version`, `description`, and at least one of `skills` or `mcpServers` (string-path arrays).
- Multi-source install: `local-zip`, `local-folder`, `git`, `github`, `npm`, `url` (see `src/service/pluginSources/`).
- Memoized loader with `enabled` gate and per-component error collection (`PluginLoaderService`).
- Plugin-owned skills and MCP servers stored in `InstalledSkillEntity` / `MCPToolEntity`, with `pluginName` provenance.
- Path-traversal protection via `resolvePluginRelativePath()`.
- Structured `PluginError` discriminated union with ~17 codes.
- Existing AI skill runtime: `SkillRegistry`, `SkillExecutor`, `SkillPermissionService`, `SandboxedSkillExecutor`, `SkillWorker`.

### 2.2 Problem

Claude Code plugins are an emerging de-facto packaging standard. Their on-disk shape is similar but not identical to ours:

| Aspect | Claude Code | AiFetchly |
|---|---|---|
| Manifest path | `.claude-plugin/plugin.json` | `.aifetchly-plugin/plugin.json` |
| Required components | Any of `commands`, `agents`, `skills`, `hooks`, `mcpServers`, `outputStyles`, `lspServers` | At least one of `skills`, `mcpServers` |
| MCP config | Inline `mcp` map in manifest OR sibling `.mcp.json` | Path array `mcpServers: string[]` to config files |
| Skill format | `SKILL.md` markdown with YAML frontmatter | `manifest.json` per skill |
| Hooks | `hooks/hooks.json` with event matchers | Not yet wired at plugin boundary |
| Commands / agents / LSP / output styles | Supported | Not supported |

Without compatibility, users who want to reuse a Claude plugin must manually rewrite its manifest, convert every `SKILL.md` to `manifest.json`, and lose any non-skill components. That defeats the purpose of adopting an ecosystem.

### 2.3 Why now

The Claude plugin ecosystem is growing. If we move first, our users get access to a large library of ready-to-use skill/MCP packs at the cost of one adapter layer. If we wait, we will either build a competing format (wasted effort) or rush the adapter under deadline pressure later.

## 3. Goals

1. **Install any Claude Code plugin unchanged** from any supported source (local folder/zip, git, github, npm, url) and have its skills and MCP servers become usable in AiFetchly.
2. **Preserve the existing AiFetchly plugin model** as the internal source of truth — no schema merger, no parallel runtime.
3. **Round-trip fidelity**: a Claude plugin installed in AiFetchly stays byte-identical on disk so users can `git pull` upstream updates cleanly.
4. **Isolated failure**: one malformed Claude component never breaks other plugins or the main session.
5. **Phased delivery**: ship Phase 1 (skills) independently and let later phases layer on without rework.
6. **Maintain AiFetchly's security posture**: path-traversal guards, sandboxed skill execution, AI-enable gating on all AI-related IPC handlers, and no direct database access from worker processes.
7. **Full i18n coverage** for any new user-facing strings introduced by compatibility features.
8. **Maintain existing architecture rules**: IPC → Module/Service → Model layering; `Token` service for DB paths; worker processes never touch the DB.

## 4. Non-Goals

1. **No public marketplace browsing UI** in this work. Marketplace identifier parsing (`name@marketplace`) is in scope; a marketplace browser is not.
2. **No LSP server support.** Plugin-declared `lspServers` are stored opaquely and ignored at runtime in all four phases.
3. **No output style support.** Stored opaquely, ignored at runtime.
4. **No auto-update** from remote Claude marketplaces in this version.
5. **No support for plugin-provided Vue UI extensions** or plugin-provided main-process code.
6. **No conversion scripts** that mutate the original plugin on disk. All translation happens at load time, in memory.
7. **No merging of the AiFetchly and Claude manifest schemas into a single schema.** Two formats coexist at the disk boundary.
8. **No execution of Claude plugin hooks in the main process.** Hooks run in the existing isolated `SkillWorker` boundary.
9. **No replacement of the existing `SkillExecutor` or MCP runtime** — adapters project Claude components onto the existing pipeline; they do not fork it.

## 5. Target Users

### 5.1 Marketing Operator

Installs a Claude plugin such as a "LinkedIn Lead Research" skill pack from a GitHub URL. They expect: paste URL → install → see new skills in the Plugin Manager → use those skills in AiChatV2. They should never see the word "Claude" in error paths.

### 5.2 Power User / Consultant

Already runs both Claude Code and AiFetchly. Wants to reuse a Claude skill pack they trust across both tools without maintaining two copies of the manifest.

### 5.3 Plugin Author

Publishes a Claude plugin to GitHub today. Wants the same ZIP to be installable in AiFetchly tomorrow without writing an AiFetchly-specific fork.

### 5.4 Reviewer / Security-conscious User

Wants to inspect any installed plugin, see exactly which capabilities it claims, which paths it touches, and disable any component without uninstalling.

## 6. Use Cases

### UC-1: Install Claude plugin from GitHub
User pastes `https://github.com/foo/bar-claude-plugin` into the Plugin Manager install dialog. The plugin is fetched by `GitHubPluginFetcher`, copied to the versioned cache. The manifest at `.claude-plugin/plugin.json` is detected, adapted, skills and MCP servers are registered, and the plugin appears in the Plugin Manager with a "Format: Claude" badge.

### UC-2: Install Claude plugin from local folder
User picks a local directory containing a Claude plugin. `LocalFolderPluginFetcher` copies it (stripping `.git`). Same adapter pipeline runs.

### UC-3: Use a Claude `SKILL.md` skill
After install, a Claude skill is invokable from AiChatV2 through the existing `SkillExecutor`. The skill's frontmatter `description` is used verbatim as the trigger predicate in the prompt. The skill body (markdown) is treated as the skill content.

### UC-4: Disable a single skill inside a Claude plugin
User opens Plugin Manager → expands the plugin → toggles off one skill. That skill no longer appears in the AI's available skills; the rest of the plugin keeps working. Persisted to `componentStateJson`.

### UC-5: Update a Claude plugin
User clicks "Update" on a plugin installed from GitHub. The fetcher re-clones, replaces the cached copy atomically, and re-runs the adapter. Local enable/disable state and per-plugin options are preserved across the update.

### UC-6: Uninstall a Claude plugin
User clicks "Uninstall". All owned skills, all owned MCP server entries, the versioned cache directory, and the manifest row are removed. No orphaned records.

### UC-7: Diagnose a broken Claude plugin
User opens Plugin Manager and sees a structured error list ("skill 'lead-tools' missing required frontmatter field `name`", "MCP server 'foo' missing command"). The rest of the plugin still loads.

## 7. Product Behavior

### 7.1 Manifest discovery

When `PluginManifestService.loadFromDirectory()` runs against an installed plugin, it MUST probe in this order:

1. `.aifetchly-plugin/plugin.json` (native AiFetchly)
2. `.claude-plugin/plugin.json` (Claude compat)
3. `plugin.json` at root (legacy / fallback for both)

The first file found wins. The loaded manifest carries a `format: "aifetchly" | "claude"` discriminator on the internal `PluginManifest` representation (not on the on-disk JSON). This discriminator is propagated to `PluginSummary` and `PluginDetail` for UI display.

### 7.2 Manifest translation

A new `ClaudePluginAdapter` (pure, synchronous, side-effect-free) translates a parsed Claude manifest JSON object into the internal `PluginManifest` shape. Translation rules:

- `name`, `version`, `description`, `author`, `homepage`, `repository` → copied directly (Claude and AiFetchly names match for these).
- `commands`, `agents`, `hooks`, `outputStyles`, `lspServers` → carried through as opaque `extra` fields. Phase 1 ignores them at runtime; later phases consume them.
- `skills` → normalized to a path array. Claude allows `skills/` directory auto-detect, a single string path, an array of paths, or an object map. The adapter unifies all four into `string[]`.
- `mcpServers` / `mcp` → normalized. Claude allows either an inline object map of server declarations or a sibling `.mcp.json` file. The adapter resolves both into the existing `PluginMcpServersFile` shape used by `PluginMcpDeclaration`.
- The "at least one of skills/mcpServers must be non-empty" rule in `PluginManifestService.validateManifest()` (line ~150) is **relaxed when `format === "claude"`**: a Claude plugin may be commands-only or hooks-only. In that case it installs cleanly, but its skill count and MCP count are both zero and the Plugin Manager shows it as "no active capabilities" until a supported component is added.

### 7.3 Skill format adapter

Claude skills are markdown files (`SKILL.md` or `*.md` under `skills/`) with YAML frontmatter. AiFetchly skills are directories with `manifest.json`. The adapter:

- At load time, for each Claude skill, reads the markdown file, parses YAML frontmatter (`name`, `description`, optional `allowed-tools`, etc.).
- Synthesizes an in-memory `InstalledSkill`-shaped object whose fields are populated from frontmatter; the markdown body becomes the skill content.
- **Never writes a synthesized `manifest.json` to disk.** Round-trip fidelity requires the original plugin bytes stay unchanged.
- Skill identity = plugin name + frontmatter `name`. Two skills within the same plugin with the same frontmatter `name` is a load error (`skill-manifest-invalid`, recoverable: false).

### 7.4 Trigger description handling

Claude skills use the frontmatter `description` as both human-readable docs and as the model's trigger predicate ("Use when…"). The prompt-building code that feeds `SkillExecutor` MUST pass this string through verbatim. Specifically:

- No truncation.
- No paraphrasing.
- No length-based filtering.
- Frontmatter's optional `name` field is the display name shown in the Plugin Manager; the `description` is the model-facing trigger.

### 7.5 MCP integration

Claude plugins contribute MCP servers in two ways: an inline `mcp` map in the manifest, or a sibling `.mcp.json`. AiFetchly adapters MUST resolve both into the existing `PluginMcpServersFile` structure and register them through the existing MCP runtime. Specifics:

- **Scoping**: server names are namespaced as `<plugin-name>__<server-name>` in the MCP client manager so two plugins cannot collide. The user-facing Plugin Manager shows the original (un-scoped) name; the runtime uses the scoped name.
- **Per-plugin options**: Claude stores user-saved MCP option values in `~/.claude/plugins/<id>/options.json` and injects them as env vars at server spawn time. AiFetchly introduces `~/.aifetchly/plugins/<plugin-name>/options.json` with the same shape. At spawn time, `PluginMcpDeclaration` reads the options file, resolves `${VAR}` placeholders in the server's `env` block, and only then spawns the server.
- **Transport parity**: `stdio`, `sse`, `websocket` already supported in `PluginMcpTransport`.

### 7.6 Hooks integration (Phase 3)

Claude's `hooks/hooks.json` declares matchers for events like `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `SubagentStart`. AiFetchly already has `HookRegistry` and `builtinHooks.ts`. The adapter:

- Parses `hooks/hooks.json` and any manifest-declared hook files.
- Translates each matcher into the existing `HookRegistry` matcher format.
- **All plugin hooks run inside the existing `SkillWorker` process** (the sandboxed worker used for skill execution), never in the Electron main process. Hook IPC is one-way: main → worker for events, worker → main for results.
- Plugin hook failures are non-fatal and surface as Plugin Manager errors.

### 7.7 Identifier parsing and marketplaces

Add `parsePluginIdentifier(id: string)` returning `{ name, marketplace }` for `name@marketplace` syntax. The marketplace component is **optional**; bare `name` is treated as a local install. A future Marketplace Registry can enforce allow/deny lists; for now, parsing is the only thing in scope (matching the Non-Goal on marketplace browsing UI).

### 7.8 Plugin Manager UI changes

- New badge on plugin rows: "Format: Claude" or "Format: AiFetchly".
- "Update" action on plugins installed from `git`, `github`, `npm`, or `url` sources (re-fetches via the same fetcher, atomic directory swap, preserves enable and options state).
- Per-skill and per-MCP enable toggles already exist — no UI change for Phase 1.
- New error display section showing per-plugin structured errors (already designed in v1, just making sure it surfaces Claude-specific error codes too).
- All new user-facing strings added to `en.ts` first, then `zh`, `es`, `fr`, `de`, `ja`.

### 7.9 AI-enable gating

Every new IPC handler added under `plugin-ipc.ts` (or anywhere else) that serves an AI function (skill execution, tool invocation) MUST check `USER_AI_ENABLED` via `Token` before doing work, per the global rule in `CLAUDE.md`. Non-AI handlers (install, list, enable/disable, uninstall) are exempt.

## 8. Technical Architecture

### 8.1 Component diagram

```
[ Claude plugin on disk ]
   .claude-plugin/plugin.json
   skills/*.md (frontmatter)
   .mcp.json or inline mcp
   hooks/hooks.json
            │
            ▼
  PluginManifestService.loadFromDirectory()
     ├── probe .aifetchly-plugin/ → .claude-plugin/ → root
     └── detect format
            │
            ▼
  ClaudePluginAdapter.adapt(raw)      ◄── pure, synchronous
     ├── normalize skills/agents/commands/etc paths
     ├── resolve inline mcp OR sibling .mcp.json
     └── return internal PluginManifest + format tag
            │
            ▼
  PluginLoaderService.forceLoad()
     ├── per-skill: ClaudeSkillFormatAdapter.parse(markdownFile)
     │              → InstalledSkill-shaped object (in memory only)
     ├── per-mcp:   PluginMcpDeclaration (existing path)
     └── aggregate errors per-component
            │
            ▼
  Existing pipeline unchanged:
     SkillExecutor, SkillPermissionService, SandboxedSkillExecutor
     MCPToolModule, MCP runtime
     HookRegistry (Phase 3)
```

### 8.2 New files (Phase 1)

- `src/service/pluginCompat/ClaudePluginAdapter.ts` — manifest translator.
- `src/service/pluginCompat/ClaudeSkillFormatAdapter.ts` — markdown+frontmatter → internal skill shape.
- `src/service/pluginCompat/claudeFrontmatterParser.ts` — minimal YAML frontmatter parser (no external dependency; the subset Claude uses is small).
- `src/service/pluginCompat/pluginFormatTypes.ts` — shared types for the compat layer.
- Tests under `test/vitest/main/service/pluginCompat/`:
  - `ClaudePluginAdapter.test.ts`
  - `ClaudeSkillFormatAdapter.test.ts`
  - `claudeFrontmatterParser.test.ts`
  - Integration test that loads a real sample Claude plugin from `test/fixtures/`.

### 8.3 Modified files (Phase 1)

- `src/service/PluginManifestService.ts` — add dual-path discovery; route Claude manifests through `ClaudePluginAdapter`. Keep all existing v1 behavior for AiFetchly-format plugins.
- `src/service/PluginLoaderService.ts` — detect skill format per-component; use `ClaudeSkillFormatAdapter` for Claude skills, existing path for AiFetchly skills.
- `src/entityTypes/pluginTypes.ts` — add `format?: "aifetchly" | "claude"` to `PluginManifest`, `PluginSummary`, `PluginDetail`. Optional field; existing rows default to `"aifetchly"`.
- `src/views/pages/systemsetting/...` (Plugin Manager UI) — format badge, error display.
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` — new strings.

### 8.4 Phase 2 additions

- Extend `PluginMcpDeclaration` to read inline `mcp` map from manifest in addition to path array.
- New `PluginOptionsStore` (service + Model/Module) for `options.json` per plugin.
- MCP spawn path resolves `${VAR}` from options before spawning.

### 8.5 Phase 3 additions

- `src/service/pluginCompat/ClaudeHooksAdapter.ts`.
- `src/service/pluginCompat/claudeHooksSchema.ts` — schema for `hooks/hooks.json`.
- Integration point: `HookRegistry` gains a "plugin hook" registration path that dispatches into `SkillWorker` rather than running in main.

### 8.6 Database impact

Phase 1: **no schema changes**. `format` is computed at load time from the on-disk manifest; not persisted. (If we later want to query by format without re-reading the manifest, we add a column — but that's out of scope for v1.)

Phase 2: **no schema changes**. Options live in JSON files on disk, not in the DB.

Phase 3: **no schema changes**.

### 8.7 Security posture

- All install-pipeline path-traversal guards already cover Claude plugins (same directory structure).
- `validateGitUrl()` equivalent MUST be confirmed in `GitPluginFetcher` and `GitHubPluginFetcher` as part of Phase 1 — audit task, not new code unless a gap is found.
- `.git` directories stripped during install (verify in all fetchers; add if missing).
- Plugin hooks run in `SkillWorker` sandbox, not main process — critical because Electron main-process hooks have full privileges.
- Per-plugin MCP options file is read-only to the worker; only the main process writes it via the Plugin Manager UI.
- AI-enable gating checked at every AI-serving IPC handler.

## 9. Phasing

### Phase 1 — Read-only compatibility (skills)
**Scope:** Install Claude plugins; run their skills.
**Exit criteria:** A real-world Claude plugin with only skills (e.g. a small skill pack from GitHub) installs cleanly, its skills appear in Plugin Manager, and at least one skill is invokable from AiChatV2 producing correct output.

Deliverables:
- Dual-path manifest discovery.
- `ClaudePluginAdapter`.
- `ClaudeSkillFormatAdapter` + frontmatter parser.
- `format` discriminator on internal types.
- UI badge + new error surfaces.
- Full i18n.
- Unit tests + one fixture-based integration test.

### Phase 2 — MCP server compatibility
**Scope:** Claude plugins that contribute MCP servers work end-to-end.
**Exit criteria:** A Claude plugin whose only component is an MCP server installs, the server spawns, and its tools appear in AiChatV2 as `mcp__<plugin>__<server>__<tool>`.

Deliverables:
- Inline `mcp` map support in manifest.
- `.mcp.json` sibling file support.
- Server-name scoping.
- Per-plugin `options.json` read at spawn time; `${VAR}` resolution.
- UI for editing per-plugin options (key/value editor; stored values are secrets-aware — use Electron `safeStorage`).

### Phase 3 — Hooks compatibility
**Scope:** Claude plugins that declare `hooks/hooks.json` react to tool-use events.
**Exit criteria:** A Claude plugin with a `PreToolUse` hook causes a measurable effect (e.g. blocks a disallowed tool call) when its matcher fires.

Deliverables:
- `ClaudeHooksAdapter`.
- Hook dispatch into `SkillWorker`.
- Event-type allowlist (start with `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`).
- Failure isolation: a hook error never aborts the tool call; it logs and continues.

### Phase 4 — Commands / agents compatibility (optional)
**Scope:** Only if AiChatV2 exposes a slash-command surface or a subagent-dispatch surface that consumes them.
**Exit criteria:** Deferred until a concrete internal consumer exists. Do not speculatively build the consumer for this PRD.

### Deferred indefinitely
- LSP server support.
- Output styles support.
- Marketplace browsing UI.
- Plugin auto-update.
- Plugin-provided UI extensions.

## 10. Acceptance Criteria

### Functional

- **AC-1**: Installing any of three reference Claude plugins (one skills-only, one MCP-only, one mixed) from a local folder, a GitHub URL, and a ZIP file produces an enabled-capable plugin with zero manual steps beyond paste-and-confirm.
- **AC-2**: A Claude skill with frontmatter `name: foo` and `description: "Use when the user asks about lead research"` appears in Plugin Manager under its parent plugin, and the description is passed verbatim to the model.
- **AC-3**: Toggling off one skill in a multi-skill Claude plugin does not affect the others; toggling off the plugin disables all of them.
- **AC-4**: Uninstalling a Claude plugin removes all owned skills, all owned MCP rows, the cache directory, and the manifest row — verified by direct DB and filesystem inspection.
- **AC-5**: A Claude plugin with one deliberately broken skill loads the rest of its skills successfully, and the broken skill's error is shown in Plugin Manager.
- **AC-6** (Phase 2): An MCP tool from a Claude plugin is callable from AiChatV2 with the `mcp__<plugin>__<server>__<tool>` naming.
- **AC-7** (Phase 3): A `PreToolUse` hook in a Claude plugin blocks a tool call when the hook returns a deny decision.
- **AC-8**: All new IPC handlers serving AI functions check `USER_AI_ENABLED` first.

### Non-functional

- **AC-9**: No schema migration required to upgrade from current main to Phase 1.
- **AC-10**: Loading a Claude plugin is at most 1.5× the cost of loading an equivalent AiFetchly plugin (measured on the fixture integration test).
- **AC-11**: All new code paths have unit tests with ≥80% coverage.
- **AC-12**: All new user-facing strings are present in `en`, `zh`, `es`, `fr`, `de`, `ja`.
- **AC-13**: No new direct database access in IPC handlers; everything goes through Module/Model layers.
- **AC-14**: No worker process touches the database; all worker→main IPC for hooks/skills is message-based.

### Security

- **AC-15**: A plugin containing a path-traversal payload in its skill paths is rejected with `path-outside-plugin` and does not write outside the plugin directory.
- **AC-16**: A plugin containing a malicious `.git/hooks/post-checkout` is rendered inert because `.git` is stripped at install time.
- **AC-17**: Plugin hooks (Phase 3) execute in `SkillWorker`, verified by inspecting process ownership in tests.

## 11. Risks And Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Frontmatter parser drift: Claude adds a YAML feature we don't support | Medium | Medium | Use a strict, minimal parser; surface `skill-manifest-invalid` errors instead of silently degrading. Track unsupported features in a follow-up. |
| Skill semantic mismatch: Claude skills assume tools/Claude-Code-only capabilities that AiFetchly doesn't expose | High | Medium | The skill runs; tool calls it makes that we don't support surface as "unknown tool" errors at execution time, not at install time. Document a compatibility matrix in the user guide. |
| Round-trip breakage: user manually edits a synthesized `manifest.json` we wrote to disk | — | — | Mitigation: we never write one. Translation is in-memory only. |
| MCP name collision between two plugins | Medium | High | Scoping (`<plugin>__<server>`) eliminates this; tested explicitly. |
| Plugin hook runs malicious code in main process | Low (if Phase 3 wrong) | Critical | Hard rule: hooks run in `SkillWorker` only. Code-review gate + test that asserts process ownership. |
| Ecosystem divergence: Claude changes their manifest schema | Medium | Medium | The adapter is the only place that knows about Claude's shape; a schema change is a one-file update plus tests. Monitor Claude's plugin docs quarterly. |
| Performance regression on `loadAllPlugins` due to per-load markdown parsing | Low | Low | Memoization already in place. Cache invalidation unchanged. |
| User confusion from "Format: Claude" badge | Low | Low | Tooltip explaining what it means; default-hidden behind a "developer info" expando if user research flags it. |

## 12. Open Questions

1. **Skill permission model**: Claude skills declare `allowed-tools` in frontmatter. Do we honor that verbatim (intersect with our own permission system) or ignore it in favor of our existing `SkillPermissionService`? **Recommendation**: ignore in v1; document as known divergence; revisit if users ask.
2. **What constitutes "the official Claude plugin docs" as a normative reference for the format?** Pin a dated snapshot of <https://code.claude.com/docs/en/plugins> in the technical design doc so future changes are explicit.
3. **Do we ship a curated starter set of Claude plugins** pre-listed in an empty Plugin Manager? Out of scope for this PRD but worth a follow-up product decision.
4. **Telemetry**: should we measure which plugin sources / formats are most used? Decide before Phase 1 ship.
5. **Should `format` be persisted in the DB** to avoid re-reading the manifest on every cold start? Current PRD says no (computed at load); revisit if load cost shows up in profiles.

## 13. Out Of Scope Explicitly

To prevent scope creep:

- Re-implementing the AiFetchly plugin format as a strict subset of Claude's.
- Building a marketplace browser.
- LSP / output style support.
- Plugin auto-update from remotes.
- Plugin-provided Vue components or main-process extensions.
- Converting existing AiFetchly plugins to Claude format (or vice versa).
- A unified permission UI merging Claude `allowed-tools` and AiFetchly permissions.

## 14. Glossary

- **AiFetchly plugin**: a plugin package in AiFetchly native format (`.aifetchly-plugin/plugin.json`).
- **Claude plugin**: a plugin package in Claude Code format (`.claude-plugin/plugin.json`).
- **Format discriminator**: the `format: "aifetchly" | "claude"` field on the in-memory `PluginManifest`.
- **Adapter**: a pure translation function from one format's on-disk shape to the internal model. Adapters never mutate disk.
- **Scoping**: prefixing an MCP server name with `<plugin-name>__` to prevent cross-plugin collisions.
- **Round-trip fidelity**: an installed plugin's bytes on disk are identical to its source bytes; updates from upstream apply cleanly.

## 15. Implementation Notes For Engineering

- Follow TDD per global rules: tests first for adapters, then implementation.
- Each completed adapter file is an atomic commit per the project's auto-commit rule.
- Adapters live under `src/service/pluginCompat/` — a new subdirectory. Keep this directory cohesive; do not scatter compat code across existing services.
- The frontmatter parser must be dependency-free (no `yaml` package). The subset Claude uses is `key: value` lines plus simple arrays. If a value spans multiple lines or uses YAML features beyond that, fail with a structured error rather than partially parse.
- All adapter functions return `{ success: true, ... } | { success: false, errors: PluginError[] }` to match the existing `PluginManifestLoadResult` pattern.
- Do not introduce a new error code without adding it to `PluginErrorCode` in `pluginTypes.ts` and rendering it in any existing error-display code.
- Verify `GitPluginFetcher` and `GitHubPluginFetcher` strip `.git` and validate URLs before Phase 1 ships; add unit tests for both if missing.
