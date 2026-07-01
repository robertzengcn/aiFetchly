# PRD: Plugin Management System for Skills and MCP Servers

Version: 1.0  
Date: 2026-06-17  
Status: Draft  
Owner: aiFetchly Desktop  
Related docs:
- `docs/skills/PRD_AI_Skills_System.md`
- `docs/skills/Skill Permissions and User Trust.md`
- `docs/skills/Sandboxing TypeScript_JS Skills.md`
- `docs/mcp-server-prd.md`
- `/home/robertzeng/project/github/claude-code/docs/plugin-system.md`

## 1. Summary

aiFetchly already supports AI skills and MCP tools, but users manage them as separate technical systems. The product needs a plugin layer that lets a user install one package that can contain one or more skills, one or more MCP server definitions, documentation, assets, and future extension points.

The plugin system should follow the Claude Code model at the architectural level: a plugin is a self-contained package with a manifest, installed into a versioned local cache, loaded only when enabled, and flattened into capability registries consumed by existing subsystems. In aiFetchly, the first supported plugin components are:

- Skills, executed through the existing Skill Registry, Skill Executor, permission service, and sandbox worker.
- MCP servers, registered through the existing MCP tool service and exposed as AI-callable tools after discovery.

The user-facing result is a new Plugin Manager UI where users can install, inspect, enable, disable, configure, manually replace, and uninstall plugins and their contained skills and MCP servers.

## 2. Problem Statement

Current state:

- Skills can be imported and managed from `src/views/pages/systemsetting/skills.vue`.
- MCP servers can be configured from `src/views/pages/systemsetting/mcp.vue` and `MCPToolManager.vue`.
- Skills and MCP servers are treated as unrelated items even when they belong to the same product capability.
- There is no plugin-level ownership, versioning, dependency tracking, install validation, or unified permission review.
- There is no single place to answer "what did I install, what capabilities did it add, what is enabled, and what can it access?"

User pain:

- Non-technical users do not know whether they need a skill, an MCP server, or both.
- A marketing workflow plugin may require several skills plus an MCP server, but the user currently has to manage each piece manually.
- Users cannot easily audit risk because permissions are spread across skill rows, MCP rows, and runtime prompts.
- Updating or uninstalling a bundled capability is risky because the app cannot tell which installed skills or MCP servers came from the same package.

Engineering pain:

- Adding more capability types directly to the settings UI will create duplicated install, enable, error, and permission logic.
- Existing skill and MCP services need plugin ownership metadata to avoid orphaned records.
- The system needs a safe extension boundary before marketplace or third-party distribution.

## 3. Goals

1. Let users install a plugin package from a local zip file.
2. Let a plugin declare skills and MCP servers in one manifest.
3. Provide a Plugin Manager UI for installation, inspection, enablement, configuration, and uninstall.
4. Reuse the existing skill and MCP runtime services instead of creating a parallel execution system.
5. Preserve aiFetchly's database architecture: IPC handlers call Modules or Services; database access remains in Models and Modules.
6. Apply existing AI enable checks to AI-related plugin IPC handlers.
7. Provide structured plugin load errors so one bad component does not break the whole app.
8. Keep v1 local-first and offline-capable, with a design that can support marketplaces later.

## 4. Non-Goals

The first version will not include:

- Public marketplace browsing.
- Remote npm, GitHub, Git, or URL plugin installation.
- Plugin-provided Vue UI extensions.
- Plugin-provided Electron main process code.
- Plugin-provided database migrations.
- Arbitrary lifecycle hooks beyond install/load/unload error reporting.
- Auto-update from remote registries.
- Trusting plugin code with direct filesystem, shell, database, Electron, or Node access.

These can be added later after the local package model is stable.

## 5. Target Users

### 5.1 Marketing Operator

Installs workflow packs created by aiFetchly or a trusted partner, such as "LinkedIn Lead Research Pack." They need clear install prompts, simple enable/disable controls, and plain-language risk summaries.

### 5.2 Power User

Imports their own skills and MCP definitions. They need diagnostics, manifest validation details, per-component configuration, and the ability to inspect tool schemas.

### 5.3 Admin or Team Lead

Wants to audit what capabilities are installed, what is enabled, and what can access external services. They need permission summaries, source metadata, and clean uninstall behavior.

## 6. Product Principles

1. A plugin is a package, not a runtime. It grants abilities only through existing approved runtimes.
2. Enabled plugins contribute capabilities. Disabled plugins contribute nothing to AI tool catalogs.
3. Plugin-level controls are convenient, but component-level controls remain available.
4. Permission prompts should explain user-visible risk, not implementation internals.
5. A broken plugin should degrade gracefully and show actionable errors.
6. Plugin import must be atomic: either all valid records are installed, or no partial plugin remains.
7. Plugin UI should be operational and dense, not marketing-style.

## 7. User Stories

### 7.1 Install Plugin

As a user, I can import a plugin zip so that all related skills and MCP servers are installed together.

Acceptance criteria:

- The Plugin Manager has an Import Plugin action.
- File picker accepts `.zip` files for v1.
- The app validates the plugin manifest before writing final install state.
- The import dialog shows plugin name, version, author, description, included skills, included MCP servers, permissions, and warnings.
- If validation fails, the user sees a clear error and no plugin records are persisted.

### 7.2 Review Plugin Capabilities Before Install

As a user, I can see what a plugin adds before I approve installation.

Acceptance criteria:

- Skills list shows name, description, runtime, permissions, and whether it is documentation-only.
- MCP server list shows server name, transport, command/host summary, auth type, and declared tools if included.
- Permissions are grouped by category: pure, network, filesystem, automation, shell.
- Risky permissions require explicit confirmation.

### 7.3 Manage Installed Plugins

As a user, I can see all installed plugins and their status.

Acceptance criteria:

- Plugin list shows name, version, source, enabled state, component counts, health status, and last updated time.
- Search filters plugins by name, component name, author, or source.
- Filters include Enabled, Disabled, Has Errors, Contains Skills, Contains MCP Servers.
- Selecting a plugin opens a detail panel without leaving the page.

### 7.4 Enable or Disable Plugin

As a user, I can disable a plugin and immediately remove its capabilities from AI chat.

Acceptance criteria:

- Disabling a plugin disables all plugin-owned skills and MCP servers from AI tool catalogs.
- Re-enabling restores previously enabled component-level states.
- Built-in or manually added skills and MCP servers that are not owned by the plugin are unaffected.
- The UI clearly distinguishes plugin-level disabled from component-level disabled.

### 7.5 Manage Skills Inside a Plugin

As a user, I can enable, disable, inspect, and uninstall plugin-owned skills through the plugin detail page.

Acceptance criteria:

- Skill rows show name, description, version, runtime, permission category, enabled state, and last error.
- Component-level toggles update the existing installed skill record.
- Clicking a skill shows manifest JSON summary, parameters schema, supported file types, and permission status.
- Skill execution still uses the existing `SkillExecutor`.

### 7.6 Manage MCP Servers Inside a Plugin

As a user, I can configure and test plugin-owned MCP servers.

Acceptance criteria:

- MCP server rows show server name, transport, enabled state, connection status, discovered tool count, and auth status.
- Users can run Discover Tools for a plugin-owned MCP server.
- Users can test connection.
- Users can enable or disable individual MCP tools.
- Secret fields are never displayed in plaintext after save.

### 7.7 Uninstall Plugin

As a user, I can uninstall a plugin cleanly.

Acceptance criteria:

- The uninstall confirmation lists the skills, MCP servers, cached files, and permissions that will be removed.
- Plugin-owned skill records are removed.
- Plugin-owned MCP server records are removed unless the user chooses to keep them as manually managed MCP servers.
- Plugin cache files are removed.
- Plugin-specific permission grants are revoked.
- Chat histories and past tool execution logs remain intact.

### 7.8 Diagnostics

As a user, I can understand why a plugin is not working.

Acceptance criteria:

- Plugin health states include Healthy, Disabled, Needs Configuration, Partial Load, Invalid, and Missing Files.
- Errors are structured by component.
- UI shows actionable messages such as "MCP server command is missing" or "Skill manifest path escapes plugin root."
- Users can copy diagnostics as JSON for support.

## 8. UX Requirements

### 8.1 Navigation

Add a Plugin Manager entry under System Settings.

Recommended navigation:

- System Settings
  - Plugins
  - Skills
  - MCP Tools

The Plugins page becomes the primary management surface for bundled capabilities. Existing Skills and MCP Tools pages should remain available for direct management and backward compatibility.

### 8.2 Plugin Manager Layout

The page should use a two-pane operational layout:

- Left/content area: plugin table with filters and actions.
- Right/detail drawer or panel: selected plugin details, components, errors, permissions, configuration.

The layout must support repeated management work. Avoid a landing page, oversized hero area, or decorative cards.

### 8.3 Plugin Table Columns

Required columns:

- Plugin
- Version
- Source
- Status
- Skills
- MCP Servers
- Permissions
- Last Updated
- Actions

Actions:

- Enable or disable
- Configure
- Export diagnostics
- Uninstall

### 8.4 Plugin Detail Tabs

Required tabs:

1. Overview
2. Skills
3. MCP Servers
4. Permissions
5. Diagnostics
6. Manifest

Overview:

- Description
- Author
- Version
- Source
- Install path summary
- Component counts
- Health state

Skills:

- Skill list
- Enable/disable controls
- Runtime and permission badges
- Parameters schema preview
- Supported file types

MCP Servers:

- Server list
- Transport
- Config status
- Test connection
- Discover tools
- Per-tool enablement

Permissions:

- Declared permissions
- Granted permissions
- Revocation actions
- Install-time warnings

Diagnostics:

- Last load result
- Component errors
- Validation errors
- Copy JSON action

Manifest:

- Read-only formatted manifest

### 8.5 Import Flow

Step 1: Select package.

- User clicks Import Plugin.
- File picker selects a `.zip`.

Step 2: Validate.

- App extracts to temporary directory.
- App validates manifest and component paths.
- App loads component metadata without executing plugin code.

Step 3: Review.

- Dialog shows plugin metadata, components, permissions, and warnings.
- User can cancel or install.

Step 4: Install.

- App copies package to final install/cache location.
- App persists plugin record.
- App persists plugin-owned skill and MCP records.
- App clears plugin/skill/MCP loader caches.

Step 5: Result.

- Success message shows installed plugin.
- Failure message shows validation or installation error.

### 8.6 Empty States

No plugins installed:

- Show concise empty state: "No plugins installed."
- Primary action: Import Plugin.
- Secondary link: Manage Skills, Manage MCP Tools.

No MCP tools discovered:

- Show "No tools discovered yet."
- Action: Discover Tools.

Needs configuration:

- Show missing fields and focus the first required input.

### 8.7 Internationalization

When implementation adds or changes user-facing strings, all supported language files must be updated:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

All Vue UI text must use `useI18n` with English fallback text.

## 9. Plugin Package Format

### 9.1 Directory Layout

Canonical v1 plugin layout:

```text
example-plugin/
├── .aifetchly-plugin/
│   └── plugin.json
├── skills/
│   ├── lead-enrichment/
│   │   ├── manifest.json
│   │   ├── SKILL.md
│   │   └── main.js
│   └── csv-cleanup/
│       ├── manifest.json
│       └── main.py
├── mcp/
│   └── servers.json
├── docs/
│   └── README.md
└── assets/
```

Legacy manifest location may be supported as `plugin.json` at package root, but new plugins should use `.aifetchly-plugin/plugin.json`.

### 9.2 Plugin Manifest

Example:

```json
{
  "name": "linkedin-research-pack",
  "displayName": "LinkedIn Research Pack",
  "version": "1.0.0",
  "description": "Research prospects and enrich lead records using skills and MCP tools.",
  "author": "aiFetchly",
  "source": "local",
  "skills": [
    "skills/lead-enrichment/manifest.json",
    "skills/csv-cleanup/manifest.json"
  ],
  "mcpServers": [
    "mcp/servers.json"
  ],
  "permissions": [
    "network",
    "filesystem",
    "automation"
  ],
  "dependencies": [],
  "homepage": "https://example.com",
  "repository": "https://example.com/repo"
}
```

### 9.3 Manifest Field Rules

Required:

- `name`: unique plugin id, lowercase, `a-z`, `0-9`, `_`, `-`.
- `version`: semver.
- `description`: non-empty, max 500 characters.
- `skills`: optional array of relative paths.
- `mcpServers`: optional array of relative paths.

Optional:

- `displayName`
- `author`
- `source`
- `permissions`
- `dependencies`
- `homepage`
- `repository`

Validation:

- At least one of `skills` or `mcpServers` must be non-empty.
- All paths must be relative and must resolve inside the plugin root.
- Duplicate component names are rejected unless explicitly namespaced.
- Manifest parse errors are fatal for the plugin install.
- Component parse errors prevent that component from loading and put the plugin in Partial Load during refresh. During initial install, component errors are fatal unless the user explicitly chooses "Install valid components only" in a future version. V1 should reject partial installs.

### 9.4 MCP Server Declaration Format

`mcp/servers.json` should be compatible with common MCP config shape:

```json
{
  "mcpServers": {
    "linkedin-browser": {
      "transport": "stdio",
      "command": "node",
      "args": ["./server/index.js"],
      "env": {
        "LINKEDIN_TOKEN": "${user:LINKEDIN_TOKEN}"
      },
      "timeout": 30000,
      "description": "Tools for LinkedIn research"
    }
  }
}
```

aiFetchly v1 MCP support must normalize this into the existing MCP server model:

- `serverName`
- `host` or command metadata
- `port`
- `transport`
- `authType`
- `authConfig`
- `timeout`
- `metadata`

If the existing `MCPToolEntity` cannot represent stdio command and args cleanly, the implementation should extend the MCP model through a proper entity/model/module change rather than storing opaque command data in unrelated fields.

### 9.5 Skill Declaration Format

Plugin skills should reuse the existing aiFetchly skill package format:

- `manifest.json`
- JavaScript or Python entry file
- Optional `SKILL.md`
- Optional Python requirements with hashes
- Optional supported file types

Each plugin-owned skill record must keep a reference to the owning plugin.

## 10. Data Model Requirements

### 10.1 InstalledPlugin Entity

Create a new TypeORM entity:

`src/entity/InstalledPlugin.entity.ts`

Suggested fields:

- `id`: primary key
- `name`: unique text
- `displayName`: text nullable
- `version`: text
- `source`: text, values initially `local`, `builtin`, `marketplace`
- `author`: text nullable
- `description`: text
- `installPath`: text
- `manifestJson`: text
- `permissionsJson`: text default `[]`
- `componentStateJson`: text default `{}`
- `enabled`: integer default `1`
- `health`: text default `healthy`
- `lastLoadErrorsJson`: text default `[]`
- `installedAt`: inherited or auditable field
- `updatedAt`: inherited or auditable field

### 10.2 Plugin Ownership Columns

Add ownership metadata to plugin-managed component records.

Installed skills:

- `pluginName`: nullable text
- `pluginComponentPath`: nullable text

MCP tools:

- `pluginName`: nullable text
- `pluginComponentPath`: nullable text

Ownership rules:

- Null `pluginName` means manually installed or built-in component.
- Non-null `pluginName` means component lifecycle is owned by a plugin.
- Uninstalling a plugin removes owned components unless user explicitly detaches supported component types.

### 10.3 Model and Module Layer

Required new files:

- `src/model/InstalledPlugin.model.ts`
- `src/modules/PluginManagementModule.ts`

Responsibilities:

- `InstalledPlugin.model.ts`: database CRUD only.
- `PluginManagementModule.ts`: business rules, plugin/component ownership, enable/disable coordination.

IPC handlers must never access repositories directly.

## 11. Service Architecture

### 11.1 Services

Add service classes:

- `PluginImportService`
- `PluginManifestService`
- `PluginLoaderService`
- `PluginComponentRegistryService`
- `PluginDiagnosticsService`

Responsibilities:

`PluginManifestService`

- Locate manifest.
- Parse JSON.
- Validate schema.
- Validate component paths.
- Produce typed validation errors.

`PluginImportService`

- Extract zip to temp path.
- Validate manifest.
- Validate components.
- Copy to final plugin install path.
- Persist plugin and component records through Modules.
- Roll back temp and partial persisted records on failure.

`PluginLoaderService`

- Load all installed plugins.
- Filter enabled plugins.
- Load skill component metadata.
- Load MCP component metadata.
- Return `PluginLoadResult`.
- Memoize results and support cache clearing.

`PluginComponentRegistryService`

- Register plugin-owned skills into `SkillRegistry`.
- Register plugin-owned MCP servers into `MCPToolService`.
- Remove disabled plugin capabilities from runtime catalogs.

`PluginDiagnosticsService`

- Convert structured errors into UI-safe messages.
- Export plugin diagnostics JSON.

### 11.2 Runtime Flow

```text
App startup or plugin cache clear
  -> PluginLoaderService.loadAllPlugins()
  -> PluginManagementModule.listEnabledPlugins()
  -> validate installed plugin paths and manifests
  -> load components
  -> PluginComponentRegistryService applies components
  -> SkillRegistry exposes enabled plugin skills
  -> MCPToolService exposes enabled plugin MCP tools
```

### 11.3 Install Flow

```text
Renderer Plugin Manager
  -> plugin:import IPC
  -> PluginImportService.importFromZip()
  -> PluginManifestService.validate()
  -> SkillImportService-compatible validation for skills
  -> MCP config validation
  -> PluginManagementModule.createPlugin()
  -> SkillManagementModule.installSkill()
  -> MCPToolModule.saveMCPTool()
  -> clear plugin, skill, and MCP caches
  -> return installed plugin summary
```

### 11.4 Disable Flow

```text
Renderer toggles plugin off
  -> plugin:toggle IPC
  -> PluginManagementModule.togglePlugin(false)
  -> persist plugin enabled = false
  -> unregister plugin-owned skills from SkillRegistry
  -> disable plugin-owned MCP servers from MCP catalogs
  -> clear tool catalog caches
```

## 12. IPC Requirements

Add channels to `src/config/channellist.ts`:

- `PLUGIN_IMPORT`
- `PLUGIN_LIST`
- `PLUGIN_GET`
- `PLUGIN_TOGGLE`
- `PLUGIN_UNINSTALL`
- `PLUGIN_VALIDATE_PACKAGE`
- `PLUGIN_EXPORT_DIAGNOSTICS`
- `PLUGIN_RELOAD`
- `PLUGIN_TOGGLE_SKILL`
- `PLUGIN_TOGGLE_MCP_SERVER`
- `PLUGIN_TOGGLE_MCP_TOOL`
- `PLUGIN_TEST_MCP_CONNECTION`
- `PLUGIN_DISCOVER_MCP_TOOLS`

Add handler:

- `src/main-process/communication/plugin-ipc.ts`

Rules:

- Handlers must use Modules and Services.
- Handlers must return the existing `{ status, msg, data }` shape.
- AI-related plugin operations must check `Token` and `USER_AI_ENABLED` before work.
- Input validation must happen before file operations, database operations, or process execution.
- Paths from renderer must be treated as untrusted.
- No direct database access in IPC handlers.

AI-related operations include:

- Importing a plugin that grants AI-callable skills or MCP tools.
- Enabling plugin-provided AI tools.
- Discovering MCP tools for AI use.
- Reloading AI tool catalogs.

## 13. Permission and Trust Requirements

### 13.1 Install-Time Permission Review

The install review dialog must show:

- Plugin source.
- Plugin author.
- Skills and MCP servers included.
- Declared permission categories.
- MCP server auth requirements.
- Filesystem or shell risk warnings.

### 13.2 Runtime Permission Enforcement

Plugin skills use existing skill permission checks.

Plugin MCP tools must use MCP permission policy before AI execution if such policy exists. If no MCP permission policy exists, v1 must at least provide:

- Server-level enable/disable.
- Tool-level enable/disable.
- Install-time warning for external command or network transports.
- Audit logging through existing tool execution logs where available.

### 13.3 Trust States

Suggested trust states:

- `trusted`: built-in or signed by aiFetchly in future.
- `user`: imported local plugin.
- `marketplace`: future marketplace plugin.
- `blocked`: invalid or blocked by policy.

V1 only needs `user` and optional `builtin`.

## 14. Security Requirements

1. Plugin paths must be validated against path traversal.
2. Plugin zip extraction must reject absolute paths and `..` entries.
3. Plugin code must not execute during manifest validation.
4. Plugin JS/Python skills execute only through existing sandbox/runtime services.
5. Plugins must not import Electron, Node, database models, or app internals directly.
6. MCP command fields must be shown to the user before install.
7. Secrets must use user-provided configuration or existing secure storage patterns. They must not be stored in plaintext manifest files after import.
8. Plugin uninstall must not delete files outside the plugin install root.
9. Plugin load errors must not crash startup.
10. Worker process rules remain unchanged: child/worker processes must not access the database directly.

## 15. Error Model

Define a typed plugin error union.

Suggested variants:

- `manifest-not-found`
- `manifest-invalid-json`
- `manifest-schema-invalid`
- `plugin-name-conflict`
- `plugin-version-invalid`
- `path-outside-plugin`
- `component-not-found`
- `skill-manifest-invalid`
- `skill-import-failed`
- `mcp-config-invalid`
- `mcp-server-conflict`
- `permission-denied`
- `dependency-unsatisfied`
- `install-io-failed`
- `cache-missing`
- `uninstall-failed`
- `unknown`

Each error should include:

- `code`
- `pluginName`
- `componentType`
- `componentName`
- `path`
- `message`
- `recoverable`

UI should group errors by component.

## 16. Component Enablement Model

Plugin state:

- Enabled
- Disabled

Component state:

- Enabled
- Disabled by user
- Disabled by plugin
- Invalid
- Needs configuration

Rules:

- If plugin is disabled, all components are effectively disabled.
- Component user state is preserved while plugin is disabled.
- If plugin is re-enabled, components return to their previous component-level state.
- Invalid components stay disabled until fixed or plugin is reinstalled.

## 17. Backward Compatibility

Existing manually installed skills:

- Continue to appear on Skills page.
- May appear in Plugin Manager under a "Standalone Skills" section only if useful.
- Are not assigned a plugin owner.

Existing manually configured MCP servers:

- Continue to appear on MCP Tools page.
- Are not assigned a plugin owner.
- Are not removed by plugin uninstall.

Existing chat tool-call flow:

- Continues to call `SkillExecutor` and `MCPToolService`.
- Should not need to know whether a tool came from a plugin.

## 18. API and Frontend Types

Add frontend API wrapper:

- `src/views/api/plugins.ts`

Suggested types:

```typescript
export interface PluginSummary {
  id: number;
  name: string;
  displayName?: string;
  version: string;
  source: "local" | "builtin" | "marketplace";
  enabled: boolean;
  health: "healthy" | "disabled" | "needs_configuration" | "partial_load" | "invalid" | "missing_files";
  skillCount: number;
  mcpServerCount: number;
  permissions: string[];
  lastUpdated: string;
}

export interface PluginDetail extends PluginSummary {
  description: string;
  author?: string;
  skills: PluginSkillComponent[];
  mcpServers: PluginMcpServerComponent[];
  errors: PluginError[];
  manifest: Record<string, unknown>;
}
```

No `any` types should be introduced.

## 19. UI Implementation Requirements

Potential files:

- `src/views/pages/systemsetting/plugins.vue`
- `src/views/components/plugins/PluginManager.vue`
- `src/views/components/plugins/PluginImportDialog.vue`
- `src/views/components/plugins/PluginDetailPanel.vue`
- `src/views/components/plugins/PluginSkillsTab.vue`
- `src/views/components/plugins/PluginMcpServersTab.vue`
- `src/views/components/plugins/PluginPermissionsTab.vue`
- `src/views/components/plugins/PluginDiagnosticsTab.vue`
- `src/views/api/plugins.ts`

UI controls:

- Use icon buttons for actions where icons are clear.
- Use toggles for enabled/disabled.
- Use tabs for detail sections.
- Use compact tables for plugin and component lists.
- Use dialogs for import review and uninstall confirmation.
- Use tooltips for unfamiliar icons.

Design constraints:

- No nested cards inside cards.
- No marketing hero section.
- No decorative gradients or orbs.
- Stable table row heights.
- Text must not overflow controls on mobile or desktop.
- Cards should be limited to repeated items, modals, and framed tools.

## 20. Database Migration Requirements

Because this project uses TypeORM entities with SQLite:

1. Add `InstalledPluginEntity`.
2. Register entity in `src/config/SqliteDb.ts`.
3. Add plugin ownership columns to installed skills and MCP tools.
4. Ensure `yarn init` can initialize/update schema as expected by current project patterns.
5. Add tests around plugin module CRUD and ownership behavior.

All database operations must go through Models and Modules.

## 21. Testing Strategy

### 21.1 Unit Tests

Add tests for:

- Plugin manifest validation.
- Zip path traversal rejection.
- Missing manifest rejection.
- Duplicate plugin name handling.
- Plugin import rollback on failure.
- Plugin enable/disable preserving component state.
- Plugin uninstall removing owned components.
- Plugin uninstall not removing standalone components.
- MCP server config normalization.
- Skill component validation.
- Structured error rendering.

Suggested locations:

- `test/modules/PluginManagementModule.test.ts`
- `test/vitest/utilitycode/pluginManifestService.test.ts`
- `test/vitest/utilitycode/pluginImportService.test.ts`
- `test/vitest/main/plugin-ipc.test.ts`

### 21.2 UI Tests

Add tests for:

- Empty Plugin Manager state.
- Import dialog review state.
- Validation error state.
- Plugin detail tabs.
- Enable/disable interaction.
- MCP discover and test connection action states.
- Uninstall confirmation.

### 21.3 Integration Tests

Use fixture plugins:

- Valid plugin with one skill.
- Valid plugin with one MCP server.
- Valid plugin with both skill and MCP server.
- Invalid manifest.
- Path traversal zip.
- Broken skill component.
- Broken MCP config.

Integration acceptance:

- Import plugin.
- Verify plugin row appears.
- Verify owned skill appears in skill registry.
- Verify owned MCP server appears in MCP list.
- Disable plugin.
- Verify skill and MCP tools no longer appear in AI tool catalog.
- Re-enable plugin.
- Verify component state is restored.
- Uninstall plugin.
- Verify owned records are removed.

## 22. Observability and Audit

The system should log:

- Plugin import started/succeeded/failed.
- Plugin enable/disable.
- Plugin uninstall.
- Plugin load errors.
- Plugin-owned skill execution through existing skill audit logs.
- Plugin-owned MCP tool execution through existing tool execution logs where available.

Logs must sanitize:

- Secrets
- Tokens
- Cookies
- Auth headers
- Full local paths when not necessary for debugging

## 23. Performance Requirements

- Listing installed plugins should complete in under 500 ms for 100 plugins.
- Import validation for a typical local plugin should complete in under 5 seconds.
- Plugin loading should be memoized after first load.
- Cache clear should be centralized after install, uninstall, enable, disable, or update.
- Startup should not execute plugin code.
- A broken plugin should not add more than 200 ms to startup beyond file validation.

## 24. Rollout Plan

### Phase 1: Core Data and Manifest

- Add plugin entity, model, module.
- Add manifest schema and validation service.
- Add typed plugin errors.
- Add fixture tests.

### Phase 2: Import and Ownership

- Add zip import.
- Persist plugin records.
- Persist plugin-owned skills.
- Persist plugin-owned MCP servers.
- Add rollback behavior.

### Phase 3: Runtime Loading

- Load enabled plugins.
- Register plugin-owned skills.
- Register plugin-owned MCP servers.
- Clear caches on state changes.
- Add disable/uninstall behavior.

### Phase 4: Plugin Manager UI

- Add route and system settings entry.
- Add plugin table.
- Add import review dialog.
- Add detail tabs.
- Add diagnostics export.
- Add translations for all supported languages.

### Phase 5: QA and Hardening

- Add path traversal and malformed package tests.
- Add UI tests.
- Add MCP config edge cases.
- Add error recovery tests.

## 25. Open Decisions

1. Should v1 support importing plugin folders in development mode, or only zip files?
   - Recommendation: zip only for user UI, folder import hidden behind dev mode later.

2. Should plugin-owned MCP servers be detachable during uninstall?
   - Recommendation: yes, but not in v1 unless needed. V1 should remove owned components cleanly.

3. Should plugins be allowed to include built-in-style trusted components?
   - Recommendation: no for v1. All local plugins are untrusted unless shipped as built-in plugins by aiFetchly.

4. Should plugin enablement require AI features enabled?
   - Recommendation: yes for plugins that expose AI-callable skills or MCP tools, because they expand AI functionality.

5. Should component-level management stay on existing Skills and MCP pages?
   - Recommendation: yes. Add ownership labels there, but make Plugin Manager the primary surface for bundled capabilities.

6. Should plugin folder import be available for developers?
   - Recommendation: not in the user-facing v1. Add a dev-mode folder import later after zip import, validation, and rollback are stable.

## 26. Acceptance Criteria Summary

The feature is complete when:

- Users can import a local plugin zip containing skills and MCP servers.
- Users can review plugin capabilities and permissions before install.
- Plugin records persist in SQLite through Model/Module layers.
- Plugin-owned skills execute through the existing skill runtime.
- Plugin-owned MCP servers are manageable through existing MCP services.
- Plugin Manager UI lists, filters, inspects, enables, disables, diagnoses, and uninstalls plugins.
- Disabling a plugin removes its skills and MCP tools from AI tool catalogs.
- Uninstalling a plugin removes owned components without touching standalone components.
- All user-facing UI text has translations in every supported language.
- Tests cover manifest validation, import rollback, ownership, runtime loading, UI states, and security edge cases.
