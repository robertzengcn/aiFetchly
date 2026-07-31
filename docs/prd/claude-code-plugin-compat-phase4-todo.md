# Phase 4 (Commands & Agents) — TODO

**Status:** Not started; blocked on prerequisites in AiChatV2 runtime
**Source PRD:** `docs/prd/claude-code-plugin-compatibility-prd.md` (§9 Phase 4)
**Deferral rationale:** `docs/prd/claude-code-plugin-compat-phase4-deferral.md`

This file tracks the concrete work items required to reactivate Phase 4.
Each item links to the prerequisite or code surface that needs to change.

## Slash Commands — substantial new feature

Claude plugins can declare `commands/<name>.md` files; users invoke them
via `/name` in the chat composer. AiFetchly has no slash-command surface
today, so this is a greenfield feature, not an integration.

### Prerequisites (build first, independent of plugin work)

- [ ] **Composer parser.** Detect `/foo`-prefixed input in
  `src/views/components/aiChatV2/AiChatV2Composer.vue` (around line 58
  where raw text is emitted via `@send`). Tab-completion dropdown is a
  follow-up; start with naive prefix match.
- [ ] **Command registry.** New service `src/service/CommandRegistry.ts`
  with `register({name, description, run})`, `lookup(name)`, `list()`.
  Singleton shape mirroring `SkillRegistry`.
- [ ] **Dispatch path in AiChatV2.vue.** In `onSend` (around line 1407),
  branch on parsed-command vs free-text. Parsed commands bypass the LLM
  round-trip; output goes back to the chat as a system message.
- [ ] **Permission model.** Decide: are commands auto-allowed, prompted,
  or always-ask? Same risk profile as skills — reuse
  `SkillPermissionService` if possible.
- [ ] **3+ built-in commands.** `/help`, `/clear`, `/plugins` are the
  minimum credible starter set. Without built-ins, the surface has no
  user-visible value before plugins ship.

### Plugin integration (only after the above ships)

- [ ] **Load plugin commands during install.** Mirror the Claude skill
  loading path in `PluginImportService`: for each `commands/*.md` under
  the plugin root, parse frontmatter (`name`, `description`, optional
  `allowed-tools`), register via `CommandRegistry.register`.
- [ ] **Round-trip carry-through.** Today `ClaudePluginAdapter` puts
  `commands` in `adapted.opaque`. Promote it to a first-class field on
  `AdaptedClaudeManifest` once there's a consumer.
- [ ] **Per-command enable/disable.** Persist in `componentStateJson`
  alongside skills; mirror the per-skill toggle UI in Plugin Manager.
- [ ] **Uninstall cleanup.** Existing `uninstall-by-pluginName` query
  needs to remove plugin-owned command rows from whatever persistence
  the command registry uses.

### Tests

- [ ] Parser unit tests (prefix match, edge cases: `/`, escaped slashes)
- [ ] Registry unit tests (register, lookup, list, dedupe by name)
- [ ] Dispatch integration test (built-in `/help` returns expected text)
- [ ] Plugin command fixture + integration test (install → invoke)

## Subagents — smaller lift but requires registry change

Claude plugins can declare `agents/<name>.md` files; users dispatch them
via the existing `run_subagent` tool. The runtime exists; the registry
is hard-coded.

### Prerequisites

- [ ] **Extend `AgentDefinitionRegistry`** (`src/service/AgentDefinitionRegistry.ts`)
  to accept dynamic registrations. Today only `BUILT_INS` is consulted:
  ```typescript
  getById(id: string): AgentDefinitionView | null {
    const found = BUILT_INS.find((d) => d.id === id);
    return found ? { ...found } : null;
  }
  ```
  Add a `register(definition)` method + a `Map<string, AgentDefinitionView>`
  for plugin-contributed entries. Lookup order: built-ins first, then
  plugin map.
- [ ] **Validate plugin agent definitions.** Markdown frontmatter must
  declare `name`, `description`, optional `model`/`tools`. Reject
  definitions whose `name` collides with a built-in.
- [ ] **Lifecycle.** Register on plugin enable; unregister on disable
  and uninstall. Hook into the existing `applyLoadedPlugins` /
  `unregisterPluginCapabilities` flow in `PluginComponentRegistryService`.

### Plugin integration

- [ ] **Load plugin agents during install.** New helper
  `readPluginClaudeAgents(localRoot, agentsPath)` in
  `PluginImportService`. Mirror the SKILL.md parsing path:
  markdown + frontmatter → `AgentDefinitionView`.
- [ ] **Promote `agents` from `adapted.opaque`** to a first-class field
  on `AdaptedClaudeManifest`.
- [ ] **`runSubagentTool.ts`** (`src/service/agentTools/runSubagentTool.ts`)
  currently only accepts built-in agent IDs (line 52-55). Verify the
  resolver passes through to `AgentDefinitionRegistry.getById`; if it
  does, dynamic registration is sufficient. If not, extend the
  validation list to accept `plugin:<pluginName>:<agentName>` IDs.

### Tests

- [ ] Registry unit tests (register, lookup, dedupe, lifecycle)
- [ ] Plugin agent fixture + integration test (install → dispatch via
  run_subagent → assert dispatched)
- [ ] Uninstall cleanup test (no orphaned agent registrations)

## Reactivation Checklist

Before starting Phase 4, confirm:

- [ ] At least one slash-command prerequisite shipped (composer parser
  + registry + 3 built-ins) OR a clear decision to defer slash commands
  and ship subagent-only.
- [ ] `run_subagent` runtime has stabilized (no major rewrites pending).
- [ ] Compatibility matrix documented: which Claude conventions work in
  AiFetchly vs which are silently ignored.

## Out of Scope for Phase 4

- Plugin-contributed Vue UI extensions (would require a sandboxed UI
  surface; not planned).
- Plugin-provided main-process code (security: never).
- Plugin-contributed LSP servers (deferred indefinitely).
- Plugin-contributed output styles (deferred indefinitely).

## Reference

- PRD: `docs/prd/claude-code-plugin-compatibility-prd.md` §9 Phase 4
- Tech design: `docs/prd/claude-code-plugin-compatibility-tech-design.md` §9.6
- Deferral rationale: `docs/prd/claude-code-plugin-compat-phase4-deferral.md`
- Current opaque carry-through: `ClaudePluginAdapter.ts` `adapted.opaque`
- Built-in agent registry: `src/service/AgentDefinitionRegistry.ts`
- Subagent dispatch tool: `src/service/agentTools/runSubagentTool.ts`
