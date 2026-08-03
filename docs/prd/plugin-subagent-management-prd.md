# Plugin-Installed Subagents and Subagent Management - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-11
- **Owner**: aiFetchly Desktop
- **Related docs**:
  - `docs/prd/plugin-subagent-management-technical-design.md`
  - `docs/marketing-subagent-system-prd.md`
  - `docs/marketing-subagent-system-technical-design.md`
  - `docs/skills/PRD_Plugin_Management_System.md`
  - `docs/skills/Plugin_Management_System_Technical_Design.md`
  - `docs/prd/claude-code-plugin-compatibility-prd.md`
  - `docs/prd/claude-code-plugin-compatibility-tech-design.md`
  - `/home/robertzeng/project/github/claude-code/docs/multi-agent-system.md`

## 1. Executive Summary

aiFetchly already has a plugin system, an AI skill runtime, an MCP integration layer, and an early marketing subagent runtime. The missing product layer is a unified way for users to install, inspect, manually create, enable, disable, and remove subagent definitions.

Claude Code supports plugin-installed subagents by letting plugins ship Markdown agent definition files under `agents/`. Those files are parsed, namespaced by plugin, security-filtered, merged into the active agent catalog, and invoked through the normal Agent runtime. aiFetchly should adopt the same product model, adapted to its existing Electron, Vue, TypeORM, skill, MCP, and plugin architecture.

The proposed feature extends plugins from "packages of skills and MCP servers" to "packages of skills, MCP servers, and subagents." It also adds a first-class Subagents management UI where users can view system agents, plugin-installed agents, and manually created agents, then enable or disable them safely.

The implementation should not create a second plugin system or a second agent runtime. Plugin-installed subagents become persisted `AgentDefinition` records with plugin ownership metadata, and the existing agent runtime consumes the enabled catalog.

## 2. Background

### 2.1 Current aiFetchly foundations

aiFetchly already includes:

- Plugin installation and management services:
  - `PluginImportService`
  - `PluginManifestService`
  - `PluginLoaderService`
  - `PluginComponentRegistryService`
  - `PluginManagementModule`
- Plugin UI:
  - `PluginManager.vue`
  - `PluginDetailPanel.vue`
  - `PluginSkillsTab.vue`
  - `PluginMcpServersTab.vue`
- Claude plugin compatibility:
  - `.claude-plugin/plugin.json` detection
  - `ClaudePluginAdapter`
  - `ClaudeSkillFormatAdapter`
  - opaque carry-through of unsupported Claude fields, including `agents`
- Agent runtime foundations:
  - `AgentDefinitionEntity`
  - `AgentDefinitionModel`
  - `AgentDefinitionModule`
  - `AgentDefinitionRegistry`
  - `AgentRuntime`
  - `AgentTaskModule`
  - `agent-runtime-ipc.ts`
- Existing architecture rules:
  - IPC handlers call Modules or Services, not TypeORM repositories directly.
  - Database access stays in Models and Modules.
  - Worker and child process code must live under `src/childprocess/`.
  - Worker processes must not access the database directly.
  - AI feature IPC handlers must check AI enablement before doing work.

### 2.2 Claude Code reference model

The Claude Code multi-agent architecture document describes plugin-installed subagents as follows:

- Plugins can include an `agents/` directory.
- The plugin manifest can also declare additional agent paths.
- Markdown agent files are parsed from YAML frontmatter plus Markdown body.
- Agent names are prefixed with the plugin name, such as `my-plugin:reviewer`.
- Nested folders become deeper namespaces, such as `my-plugin:nested:deep-agent`.
- Plugin agents are merged into the normal agent definition catalog.
- Plugin agents are security-filtered. They cannot set privilege-escalating fields such as permission mode, hooks, or MCP servers.
- Invocation uses the normal Agent runtime; plugin-installed agents are definitions, not separate processes.

aiFetchly should copy this component model, not Claude Code's full coordinator or teammate runtime. The first aiFetchly release should focus on agent definition installation and management.

## 3. Problem Statement

Users and plugin authors need a predictable way to package and manage specialist AI agents.

Today:

- Plugins can contribute skills and MCP servers, but not first-class subagents.
- Claude plugin `agents` declarations are preserved opaquely but not installed.
- The system has `AgentDefinition` persistence, but no complete UI for viewing or managing all agents.
- Users cannot manually create an agent definition without engineering changes.
- Users cannot disable one plugin-provided subagent while keeping the rest of the plugin enabled.
- Plugin uninstall does not need to clean up agent definitions because plugin-owned agents are not installed yet.

This creates a product gap:

- A marketing workflow plugin cannot ship the specialists that explain how to use its skills and tools.
- Users cannot audit "which agents are available to AI chat and workflows?"
- Power users cannot create reusable specialist agents for their business process.
- Claude-compatible plugin support remains incomplete.

## 4. Product Goals

1. Let plugins install subagent definitions from `agents/` Markdown files.
2. Support Claude-compatible plugin agent declarations without requiring plugin authors to rewrite packages for aiFetchly.
3. Persist plugin-owned agent definitions with clear ownership metadata.
4. Add a Subagents management UI for built-in, plugin-installed, and manually created agents.
5. Let users enable or disable individual subagents.
6. Let users manually add, edit, disable, and delete user-created subagents.
7. Let plugin detail pages show included subagents beside skills and MCP servers.
8. Ensure disabled plugins contribute no active subagents.
9. Ensure disabled subagents do not appear in runtime agent catalogs or AI-accessible agent tools.
10. Preserve current architecture boundaries: IPC -> Module/Service -> Model.
11. Preserve aiFetchly's security posture by filtering plugin-supplied agent fields.
12. Provide complete i18n coverage for all new user-facing UI strings.

## 5. Non-Goals

The first release will not include:

- A new multi-agent runtime.
- Freeform agent-to-agent messaging.
- Claude Code coordinator mode.
- Claude Code in-process teammate mode.
- Remote agent execution.
- Separate OS processes per subagent.
- Agent-provided Electron main-process code.
- Agent-provided Vue UI extensions.
- Agent-provided database migrations.
- Plugin agent frontmatter that can register MCP servers, hooks, or permission modes.
- Marketplace browsing for agents.
- Automatic agent update conflict resolution beyond plugin reinstall or overwrite.
- Full prompt-builder redesign for marketing workflow orchestration.

## 6. Product Principles

### 6.1 Agents are definitions, not runtimes

A plugin-installed subagent is a definition: name, description, instructions, allowed tools, model preference, limits, and output shape. It is invoked by the existing aiFetchly agent runtime.

### 6.2 Plugins flatten into existing capability registries

Plugins should not create isolated runtime islands. Skills go to the Skill Registry, MCP servers go to the MCP runtime, and agents go to the Agent Definition catalog.

### 6.3 Disable means unavailable

If a plugin is disabled, all plugin-owned agents are unavailable. If an individual agent is disabled, only that agent is unavailable.

### 6.4 Plugin agents are read-only except enablement

Users can inspect and enable or disable plugin-provided agents. They cannot directly edit plugin-owned agent instructions because plugin reinstall or update would overwrite them. Manual copying into a user-owned agent can be added later.

### 6.5 Manual agents are user-owned

Manual agents are editable records created inside aiFetchly. They are not attached to a plugin and can be changed or deleted by the user.

### 6.6 Agent prompts must be self-contained

Normal subagents should not assume they see the parent chat history. Descriptions and system prompts must make the agent's purpose clear enough for the runtime to build self-contained task prompts.

### 6.7 Tool access is narrowed at the agent boundary

An agent declares an upper bound of allowed tools. Runtime policy must intersect this allowlist with actually registered and enabled tools.

### 6.8 Security-sensitive fields are ignored for plugin agents

Plugin agent files must not set:

- permission mode
- hooks
- MCP servers
- direct shell permissions outside normal tool policy
- database access
- worker process behavior

If those fields are present, they are ignored and surfaced as warnings.

## 7. Target Users

### 7.1 Marketing Operator

Installs a plugin such as "Lead Research Pack" and expects new specialist agents to become available without understanding manifest formats.

### 7.2 Power User

Creates custom agents for recurring workflows, such as "Dental Clinic Lead Researcher" or "Cold Email Compliance Reviewer."

### 7.3 Plugin Author

Ships one plugin that includes skills, MCP servers, and subagents. They want the same Claude-compatible package to work in aiFetchly.

### 7.4 Admin or Reviewer

Audits installed capabilities and wants to see which agents exist, what they can do, which tools they can call, and whether they are enabled.

## 8. Core Use Cases

### UC-1: Install plugin with agents directory

User installs a plugin containing:

```text
my-plugin/
  .claude-plugin/plugin.json
  agents/
    reviewer.md
    optimizer.md
```

Expected behavior:

- The plugin installs successfully.
- `reviewer.md` becomes `my-plugin:reviewer`.
- `optimizer.md` becomes `my-plugin:optimizer`.
- Both appear in Plugin Manager and Subagents page.
- Both are enabled by default if the plugin is enabled.

### UC-2: Install plugin with manifest-declared agent paths

User installs a plugin whose manifest contains:

```json
{
  "name": "lead-pack",
  "version": "1.0.0",
  "description": "Lead workflow helpers",
  "agents": ["agents/researcher.md", "extra-agents/verifier.md"]
}
```

Expected behavior:

- Both files are validated as plugin-relative paths.
- Both are installed as plugin-owned agent definitions.
- Path traversal attempts are rejected.

### UC-3: Disable one plugin subagent

User opens plugin details, goes to the Subagents tab, and disables `lead-pack:verifier`.

Expected behavior:

- `lead-pack:verifier` no longer appears in active agent catalogs.
- Other plugin skills, MCP servers, and agents remain available.
- The disabled state persists across app restart.

### UC-4: Disable plugin

User disables `lead-pack`.

Expected behavior:

- All plugin-owned skills, MCP servers, and agents become unavailable.
- Previous component-level enabled states are preserved.
- Re-enabling the plugin restores only components that were individually enabled.

### UC-5: Manually create subagent

User opens System Settings -> Subagents and creates "Local Campaign Verifier."

Expected behavior:

- User fills name, description, system prompt, allowed tools, limits, and optional output schema.
- The agent is saved as source `user`.
- The agent appears in active catalogs when enabled.
- User can later edit, disable, or delete it.

### UC-6: Inspect subagent

User clicks an agent row.

Expected behavior:

- Detail view shows full description, source, plugin owner if any, allowed tools, model, limits, status, and system prompt.
- Plugin-owned prompt is read-only.
- Manual prompt is editable.

### UC-7: Uninstall plugin with agents

User uninstalls a plugin with three subagents.

Expected behavior:

- Plugin row is removed.
- Plugin-owned skill rows are removed.
- Plugin-owned MCP server rows are removed.
- Plugin-owned agent definition rows are removed.
- User-created agents with similar names are unaffected.

### UC-8: Broken agent file

User installs a plugin with one valid agent file and one invalid agent file.

Expected behavior:

- The plugin should either fail atomically during import or install with `partial_load`, depending on the chosen import policy.
- The user sees a structured error naming the bad file and reason.
- No silently broken agent appears in runtime catalogs.

## 9. User Experience Requirements

### 9.1 Navigation

Add a Subagents page under System Settings:

```text
System Settings
  Plugins
  Skills
  MCP Tools
  Subagents
```

The page should be operational and compact. It should not be a marketing landing page.

### 9.2 Subagents page layout

The Subagents page should include:

- Header with title and primary "Add Subagent" action.
- Search input.
- Filters:
  - All
  - Enabled
  - Disabled
  - Built-in
  - Plugin
  - Manual
  - Has warnings
- Dense table of agents.
- Detail drawer or right-side panel for selected agent.

### 9.3 Subagents table columns

Required columns:

- Agent
- Description
- Source
- Plugin
- Mode
- Tools
- Model
- Status
- Actions

Recommended behavior:

- Agent name should show the runtime ID and display name when they differ.
- Plugin-owned rows show a plugin chip.
- Tool count is shown in the table; full tool list appears in detail.
- Built-in agents are not deletable.
- Plugin agents are not editable.
- Manual agents are editable and deletable.

### 9.4 Agent detail panel

The detail panel should show:

- ID
- Display name
- Description
- Source
- Plugin owner
- Component path
- Status
- Mode
- Default model
- Max tool calls
- Max runtime
- Max continue calls
- Allowed tools
- Output schema
- System prompt
- Warnings
- Last updated

For plugin agents, the system prompt and schema are read-only.

For manual agents, the user can edit fields in place or through a dialog.

### 9.5 Add or edit manual subagent dialog

Fields:

- Name
- ID slug, auto-generated but editable before first save
- Description
- Mode:
  - coordinator
  - specialist
  - verifier
  - formatter
- System prompt
- Allowed tools multi-select
- Default model, optional
- Max tool calls
- Max runtime in seconds
- Max continue calls
- Output schema JSON editor, optional
- Enabled toggle

Validation:

- Name is required.
- ID is required and unique.
- ID must be stable once created unless a future migration feature is added.
- Description is required.
- System prompt is required.
- Allowed tools must be known enabled tools or known tool IDs that can become enabled later.
- Numeric limits must be positive and within configured max bounds.
- Output schema must be valid JSON object when provided.

### 9.6 Plugin detail Subagents tab

Add a new tab inside plugin detail:

- Overview
- Skills
- MCP Servers
- Subagents
- Permissions
- Diagnostics
- Manifest

The Subagents tab should show plugin-owned agents only.

Columns:

- Agent
- Description
- Mode
- Tools
- Status
- Health
- Actions

Actions:

- Enable or disable
- View details

No edit or delete action should be shown for plugin-owned agents.

### 9.7 Empty states

Subagents page empty state:

- If no agents exist, show a concise message and "Add Subagent."
- If filters hide all results, show "No subagents match these filters."

Plugin Subagents tab empty state:

- Show "This plugin does not include subagents."

All strings must be localized across all supported languages:

- English
- Chinese
- Spanish
- French
- German
- Japanese

## 10. Agent File Format Requirements

### 10.1 Supported plugin agent file

Plugin agents are Markdown files with YAML frontmatter and Markdown body.

Example:

```markdown
---
name: reviewer
description: Reviews campaign drafts for accuracy, tone, and compliance.
tools: [knowledge_library_search]
model: gpt-5-mini
mode: verifier
maxTurns: 8
color: blue
---

You are a campaign review specialist.

Rules:
1. Check every factual claim against provided source-backed findings.
2. Do not write new campaign copy unless asked.
3. Return JSON with risk level, findings, and recommendations.
```

### 10.2 Required frontmatter fields

- `name`
- `description`

### 10.3 Optional supported frontmatter fields

- `tools`
- `skills`
- `model`
- `mode`
- `maxTurns`
- `maxToolCalls`
- `maxRuntimeMs`
- `outputSchema`
- `color`
- `background`
- `effort`

Fields not used by the first release may be stored in `manifestJson` for diagnostics but should not affect runtime.

### 10.4 Forbidden or ignored plugin fields

The parser must ignore and warn on:

- `permissionMode`
- `hooks`
- `mcpServers`
- `alwaysAllow`
- `disallowedTools` if it attempts to override security policy
- any path-like field that escapes plugin root

### 10.5 Markdown body

The Markdown body becomes the `systemPrompt` or is combined into the system prompt builder. It should be stored exactly as supplied, subject only to normal file reading.

### 10.6 Agent ID generation

For plugin agents:

- Base name comes from frontmatter `name`; fallback to file basename only if product decides to allow missing names in a later compatibility mode.
- Runtime ID format: `<plugin-name>:<agent-name>`.
- Nested path format: `<plugin-name>:<nested-dir>:<agent-name>`.
- IDs must be unique.

For manual agents:

- Runtime ID format should be user-specified slug, with optional `user:` prefix if needed to prevent collisions.
- Manual agent IDs must not collide with built-in or plugin agent IDs.

## 11. Plugin Manifest Requirements

### 11.1 Native aiFetchly manifest

Add optional `agents` to `PluginManifest`:

```json
{
  "name": "lead-pack",
  "version": "1.0.0",
  "description": "Lead workflow helpers",
  "skills": ["skills/research/manifest.json"],
  "mcpServers": ["mcp/servers.json"],
  "agents": ["agents/researcher.md", "agents/verifier.md"]
}
```

### 11.2 Claude-compatible manifest

Support:

```json
{
  "name": "lead-pack",
  "version": "1.0.0",
  "description": "Lead workflow helpers",
  "agents": true
}
```

`agents: true` means scan `agents/`.

Support:

```json
{
  "agents": "agents/reviewer.md"
}
```

Support:

```json
{
  "agents": ["agents/reviewer.md", "extra/verifier.md"]
}
```

### 11.3 Agent-only plugins

Plugin validation should allow a plugin to include only agents. The existing "at least one of skills or mcpServers" rule should become "at least one of skills, mcpServers, or agents."

### 11.4 Auto-detection

For Claude-compatible plugins, if the manifest does not declare `agents` but an `agents/` directory exists, the system should detect it.

For native aiFetchly plugins, auto-detection is optional. Explicit `agents` is preferred for native plugins.

## 12. Functional Requirements

### FR-1: Parse plugin agent declarations

The system must parse plugin agent declarations from:

- Native `agents` field.
- Claude-compatible `agents` field.
- Claude-compatible default `agents/` directory.

Acceptance criteria:

- Valid paths are resolved relative to plugin root.
- Paths escaping plugin root are rejected.
- Direct file and directory declarations are supported.
- Directory declarations recursively find `.md` files.
- Non-Markdown files are ignored.

### FR-2: Persist plugin-owned agents

The system must persist each plugin agent as an agent definition row.

Acceptance criteria:

- Agent rows include plugin name.
- Agent rows include plugin component path.
- Agent rows include source `plugin`.
- Agent rows include parsed manifest/frontmatter JSON.
- Agent rows are enabled by default unless component state says otherwise.

### FR-3: Persist manual agents

The system must let users create manual agent definitions.

Acceptance criteria:

- Manual agents use source `user`.
- Manual agents are editable.
- Manual agents are deletable.
- Manual agents cannot overwrite built-in or plugin-owned agents.

### FR-4: List all agents

The system must list all agents for management UI.

Acceptance criteria:

- List includes built-in, plugin-owned, and manual agents.
- List includes disabled agents.
- List includes source and plugin ownership fields.
- List is available through a typed IPC endpoint.

### FR-5: List active runtime agents

The runtime must list only active agents.

Acceptance criteria:

- Disabled agents are excluded.
- Agents owned by disabled plugins are excluded.
- Built-in active agents remain available.
- Manual enabled agents are available.

### FR-6: Toggle individual agent

The system must let users enable or disable an agent.

Acceptance criteria:

- Toggle persists to the database.
- Toggling plugin-owned agents updates component state or the agent row consistently.
- Runtime catalog updates after toggle.
- UI refreshes without restart.

### FR-7: Plugin disable hides agents

Disabling a plugin must hide all plugin-owned agents from active runtime catalogs.

Acceptance criteria:

- Component-level enabled state is preserved.
- Re-enable restores previously enabled plugin agents.
- No active agent catalog includes disabled-plugin agents.

### FR-8: Plugin uninstall removes owned agents

Plugin uninstall must remove plugin-owned agent rows.

Acceptance criteria:

- Removed agents are included in uninstall result.
- Plugin-owned rows are deleted.
- Manual and built-in rows are unaffected.
- Runtime cache is invalidated.

### FR-9: Plugin detail shows subagents

Plugin detail must include a Subagents tab.

Acceptance criteria:

- Tab lists only agents owned by the selected plugin.
- Toggle works from this tab.
- Empty state appears when none exist.

### FR-10: Subagents settings page

System Settings must include a Subagents page.

Acceptance criteria:

- User can search and filter.
- User can view details.
- User can add manual subagent.
- User can edit manual subagent.
- User can delete manual subagent.
- User can enable or disable any non-built-in agent.

### FR-11: Security filtering

Plugin agent parser must filter forbidden fields.

Acceptance criteria:

- Forbidden fields do not affect runtime.
- Warnings are visible in diagnostics.
- Unknown fields are stored for diagnostics but ignored.

### FR-12: i18n

Every new user-facing string must be translated.

Acceptance criteria:

- `src/views/lang/en.ts` updated.
- `src/views/lang/zh.ts` updated.
- `src/views/lang/es.ts` updated.
- `src/views/lang/fr.ts` updated.
- `src/views/lang/de.ts` updated.
- `src/views/lang/ja.ts` updated.

## 13. Data Model Requirements

### 13.1 AgentDefinitionEntity additions

Extend `agent_definitions` with fields equivalent to:

```typescript
source: "built-in" | "user" | "plugin";
pluginName?: string | null;
pluginComponentPath?: string | null;
manifestJson?: string | null;
health: "healthy" | "disabled" | "partial_load" | "invalid" | "missing_files";
lastError?: string | null;
```

Potential existing field adjustments:

- `status` remains `active | disabled`.
- `agentId` remains unique.
- `allowedTools` remains `simple-json`.
- `outputSchema` remains `simple-json`.

### 13.2 AgentDefinitionView additions

Extend the renderer and shared DTO with:

```typescript
source: "built-in" | "user" | "plugin";
pluginName?: string;
pluginComponentPath?: string;
manifest?: Record<string, unknown>;
health: "healthy" | "disabled" | "partial_load" | "invalid" | "missing_files";
lastError?: string;
createdAt?: string;
updatedAt?: string;
```

### 13.3 Plugin summary additions

Extend plugin summary/detail DTOs with:

```typescript
agentCount: number;
agents: PluginAgentComponent[];
```

`PluginAgentComponent`:

```typescript
interface PluginAgentComponent {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  mode: string;
  toolCount: number;
  componentPath: string;
  health: string;
  error?: string;
}
```

### 13.4 Component state additions

Extend plugin component state with:

```typescript
agents?: Record<string, PluginComponentStateEntry>;
```

This lets plugin-level enablement and component-level enablement remain separate.

## 14. Backend Requirements

### 14.1 AgentDefinitionModel

Add methods:

- `listAll()`
- `listActiveWithPluginEnablement()`
- `findByPluginName(pluginName)`
- `deleteByPluginName(pluginName)`
- `toggle(agentId, enabled)`
- `createUserAgent(input)`
- `updateUserAgent(agentId, input)`
- `deleteUserAgent(agentId)`
- `upsertPluginAgent(view, pluginName, componentPath, manifest)`

Database access must stay in the Model.

### 14.2 AgentDefinitionModule

Add business methods:

- `listAllForManagement()`
- `listActiveForRuntime()`
- `createManualAgent(input)`
- `updateManualAgent(agentId, input)`
- `toggleAgent(agentId, enabled)`
- `deleteManualAgent(agentId)`
- `findAgentsByPluginName(pluginName)`
- `deleteAgentsByPluginName(pluginName)`
- `upsertPluginAgents(pluginName, agents)`

The Module enforces:

- Source-based edit rules.
- Built-in cannot be deleted.
- Plugin-owned cannot be edited directly.
- Manual IDs cannot collide.

### 14.3 PluginAgentImportService

Add a pure import/parse service responsible for:

- Resolving agent declarations from plugin manifest.
- Walking Markdown files.
- Parsing YAML frontmatter.
- Building `AgentDefinitionView` objects.
- Collecting warnings and errors.
- Applying namespace rules.
- Filtering forbidden fields.

This service must not write to the database directly. It returns parsed definitions to `PluginImportService`, which persists through `AgentDefinitionModule`.

### 14.4 PluginImportService

Extend plugin import flow:

1. Load manifest.
2. Validate skills.
3. Validate MCP servers.
4. Validate agents.
5. Copy plugin files.
6. Persist plugin row.
7. Persist skills.
8. Persist MCP servers.
9. Persist agents.
10. Invalidate runtime caches.

Rollback must remove agent rows if later phases fail.

### 14.5 PluginManagementModule

Extend uninstall:

- Remove plugin-owned agents.
- Include removed agent IDs in uninstall result.
- Clear agent runtime cache.

Extend detail:

- Include agent count and agent components.

### 14.6 PluginComponentRegistryService

Extend runtime cache invalidation so agent catalogs refresh after:

- plugin import
- plugin reload
- plugin toggle
- plugin uninstall
- plugin agent toggle
- manual agent create/update/delete

## 15. IPC Requirements

All IPC handlers must use typed schemas and Module/Service layers. IPC must not access TypeORM repositories directly.

### 15.1 Agent management channels

Add channels:

- `agent-definition:list`
- `agent-definition:get`
- `agent-definition:create`
- `agent-definition:update`
- `agent-definition:toggle`
- `agent-definition:delete`

These are management channels. They are not AI execution channels.

### 15.2 Runtime channel adjustment

Existing runtime channel:

- `agent-runtime:definition-list`

should return active runtime agents only. It should use plugin enablement filtering.

### 15.3 Plugin channels

Extend existing:

- `plugin:list`
- `plugin:get`
- `plugin:toggle`
- `plugin:uninstall`

Add if needed:

- `plugin:toggle-agent`

Alternatively, reuse `agent-definition:toggle` for plugin-owned agent toggles. If a plugin-specific channel is added, it must validate plugin ownership.

### 15.4 Schema validation

Add zod schemas for:

- agent ID input
- create manual agent input
- update manual agent input
- toggle input
- delete input
- plugin agent toggle input if separate

### 15.5 AI enable checks

Agent management is not itself AI execution. However:

- Any handler that invokes an agent or exposes AI execution must check AI enablement.
- Existing `registerAiValidatedHandler` should remain for runtime execution or AI-visible operations.
- Management-only list/create/update/toggle/delete may use `registerValidatedHandler`.

## 16. Frontend Requirements

### 16.1 Renderer API

Add `src/views/api/agents.ts` with functions:

- `listAgentDefinitions()`
- `getAgentDefinition(id)`
- `createAgentDefinition(input)`
- `updateAgentDefinition(id, input)`
- `toggleAgentDefinition(id, enabled)`
- `deleteAgentDefinition(id)`

### 16.2 Components

Add components:

- `AgentManager.vue`
- `AgentDetailPanel.vue`
- `AgentEditorDialog.vue`
- `PluginAgentsTab.vue`

### 16.3 Page

Add page:

- `src/views/pages/systemsetting/agents.vue`

or:

- `src/views/pages/systemsetting/subagents.vue`

Use one term consistently in navigation and translations. Product-facing label should be "Subagents"; code can use "agents" where it aligns with existing types.

### 16.4 Plugin UI integration

Update:

- `PluginManager.vue` to include agent count column if layout permits.
- `PluginDetailPanel.vue` to add Subagents tab.
- `PluginOverviewTab.vue` to summarize agent count.

### 16.5 Design expectations

The UI should be dense and operational:

- No hero area.
- No nested cards.
- Use tables, tabs, drawers, dialogs, chips, switches, and icon buttons.
- Use existing Vuetify patterns.
- Use tooltips for icon-only actions.
- Text must fit on narrow screens.

## 17. Security Requirements

### 17.1 Path safety

All plugin-declared agent paths must use existing path safety logic:

- Resolve relative to plugin root.
- Reject absolute paths.
- Reject paths escaping plugin root.

### 17.2 Privilege filtering

Plugin agent frontmatter must not grant permissions. The system must ignore forbidden fields and show diagnostics.

### 17.3 Tool allowlist validation

Agent `allowedTools` are an upper bound. Runtime policy must still check:

- tool exists
- tool is enabled
- owning plugin is enabled if tool is plugin-owned
- permission category allows execution
- user approval requirements are satisfied

### 17.4 Prompt injection boundary

Plugin agent instructions are trusted only as installed plugin content. Web pages, scraped content, and user-uploaded documents remain untrusted evidence and must not override the agent's system prompt.

### 17.5 Import does not execute code

Agent import must only parse Markdown and JSON. It must not execute plugin code, shell commands, MCP servers, or skill code.

### 17.6 No worker DB access

If later agent parsing or validation is moved into a worker, the worker must send parsed results to main process; database persistence remains in Modules/Models in the main process.

## 18. Plugin Enablement Semantics

Effective agent enabled state:

```text
agent.status == active
AND (
  agent.source != plugin
  OR owning_plugin.enabled == true
)
AND (
  if plugin-owned: plugin component state for this agent is enabled
)
```

The UI should distinguish:

- disabled directly
- unavailable because plugin is disabled
- invalid because source file is missing or malformed

## 19. Error and Health Requirements

Agent health values:

- `healthy`
- `disabled`
- `partial_load`
- `invalid`
- `missing_files`

Plugin import errors should reuse or extend `PluginError` with component type `agent`.

Recommended new error codes:

- `agent-manifest-invalid`
- `agent-frontmatter-invalid`
- `agent-frontmatter-missing-field`
- `agent-name-conflict`
- `agent-path-invalid`
- `agent-unsupported-field`

Errors must include:

- plugin name when available
- component path
- agent name when available
- human-readable message
- recoverable flag

## 20. Acceptance Criteria

### AC-1: Plugin agent install

Given a valid plugin with `agents/reviewer.md`, when the user installs it, then the agent appears as `<plugin-name>:reviewer` in the Subagents page and Plugin Subagents tab.

### AC-2: Agent-only plugin

Given a valid plugin with only agents and no skills or MCP servers, when the user installs it, then install succeeds and plugin counts show `0` skills, `0` MCP servers, and the correct agent count.

### AC-3: Disable plugin agent

Given an enabled plugin agent, when the user disables it, then it disappears from active runtime agent lists and remains visible as disabled in management UI.

### AC-4: Disable plugin

Given a plugin with enabled agents, when the user disables the plugin, then active runtime lists exclude those agents without changing each agent's component-level enabled state.

### AC-5: Manual create

Given valid manual agent input, when the user saves, then a source `user` agent is created, enabled by default, and visible in active runtime lists.

### AC-6: Manual edit

Given a manual agent, when the user edits description, prompt, or limits, then the changes persist and runtime uses the updated definition.

### AC-7: Plugin agent edit protection

Given a plugin-owned agent, when the user opens it, then edit controls are not available except enable/disable.

### AC-8: Uninstall cleanup

Given a plugin with agents, when the user uninstalls the plugin, then all plugin-owned agent rows are removed and no orphaned runtime catalog entries remain.

### AC-9: Path traversal rejection

Given a plugin manifest declaring `../agent.md`, when the user installs it, then install fails with a path safety error and no partial rows remain.

### AC-10: i18n

Given the app language is any supported language, when the user opens Subagents UI, then all new labels and messages are translated.

## 21. Testing Requirements

### 21.1 Unit tests

Add tests for:

- Plugin agent declaration normalization.
- Markdown frontmatter parsing.
- Namespace generation.
- Forbidden field filtering.
- Agent-only plugin validation.
- Path traversal rejection.
- AgentDefinitionModel CRUD.
- AgentDefinitionModule source-based edit rules.

### 21.2 IPC tests

Add tests for:

- list
- create
- update
- toggle
- delete
- validation failures
- plugin-owned edit rejection

Place main process IPC tests under `test/vitest/main/`.

### 21.3 Integration tests

Add plugin import tests for:

- native plugin with agents
- Claude plugin with `agents: true`
- Claude plugin with explicit `agents` path
- plugin uninstall cleanup
- plugin disable active-catalog filtering

### 21.4 UI tests

At minimum, verify:

- Subagents page renders.
- Add manual agent dialog validates required fields.
- Plugin Subagents tab renders plugin-owned agents.
- Disable toggle updates row state.

### 21.5 Type checks

Run:

- `yarn vue-check`
- `yarn tsc`
- relevant Vitest or Mocha tests

## 22. Rollout Plan

### Phase 1: Data and backend foundations

- Extend agent entity and DTOs.
- Add Model and Module methods.
- Add parser service for plugin agent files.
- Extend plugin manifest validation for `agents`.
- Add import/uninstall support.

### Phase 2: IPC and runtime catalog

- Add agent management IPC.
- Update runtime active definition listing.
- Add plugin enablement filtering.
- Add cache invalidation.

### Phase 3: Subagents management UI

- Add Subagents settings page.
- Add add/edit dialog for manual agents.
- Add detail panel.
- Add translations.

### Phase 4: Plugin UI integration

- Add Plugin Subagents tab.
- Add agent count to plugin summary/detail.
- Add diagnostics display for agent warnings/errors.

### Phase 5: Hardening

- Add full tests.
- Validate import rollback behavior.
- Test restart and cache refresh.
- Document plugin agent file format.

## 23. Migration and Compatibility

Existing agent rows should migrate with:

- `source = "built-in"` for rows created by `AgentDefinitionRegistry`.
- `pluginName = null`.
- `pluginComponentPath = null`.
- `health = "healthy"`.

Existing plugins should continue to work. Plugins without agents should show agent count `0`.

Existing Claude plugins with opaque `agents` fields should begin installing agents after this feature lands. If that changes behavior for users, release notes should call it out.

## 24. Open Questions

1. Should invalid plugin agent files fail the whole import, or should the plugin install with `partial_load` if at least one agent is valid?
2. Should manual agent IDs use a `user:` prefix to avoid future collision with plugin names?
3. Should plugin agents be editable through "Duplicate as manual agent" in v1 or deferred?
4. Should `tools` and `skills` frontmatter both map to `allowedTools`, or should `skills` only preload documentation-style skills?
5. Should agent output schema be edited as raw JSON only, or should common schema templates be offered?
6. Should `AgentDefinitionRegistry.ensureBuiltIns()` mark existing built-ins as source `built-in` every startup, or only during migration?

## 25. Success Metrics

Product:

- Users can install a plugin with subagents without reading documentation.
- Users can answer "which subagents are active?" from one UI.
- Users can disable a plugin subagent without uninstalling the plugin.
- Manual agent creation succeeds without editing source code.

Engineering:

- No direct database access in IPC handlers.
- No plugin import code execution.
- No orphaned plugin-owned agent rows after uninstall.
- Active runtime catalog respects plugin and component enablement.
- Tests cover parser, persistence, IPC, and plugin lifecycle.

## 26. Implementation Notes

Recommended first implementation path:

1. Add `source`, `pluginName`, `pluginComponentPath`, `manifestJson`, `health`, and `lastError` to agent definitions.
2. Add `agents` support to plugin manifest types and validation.
3. Implement `PluginAgentImportService` as a pure parser.
4. Persist plugin agents during `PluginImportService.importFromDirectory`.
5. Add management IPC and renderer API.
6. Build Subagents page.
7. Add Plugin Subagents tab.
8. Add tests.

Avoid implementing coordinator workers, background swarms, or teammate messaging in this PRD's scope. Those are runtime orchestration features and should be handled separately after the catalog and management model is stable.
