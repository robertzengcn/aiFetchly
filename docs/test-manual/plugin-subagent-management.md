# Plugin-Installed Subagents and Subagent Management - Manual Test Cases

**Related PRD**: `docs/prd/plugin-subagent-management-prd.md`
**Date**: 2026-07-19
**Total**: 55 test cases

---

## 1. Plugin Agent Installation

### TC-1: Install plugin with `agents/` directory
1. Prepare a test plugin folder with `agents/reviewer.md` and `agents/optimizer.md`
2. Install the plugin via Plugin Manager
3. **Verify**: Plugin installs successfully
4. **Verify**: Agents page shows `my-plugin:reviewer` and `my-plugin:optimizer`
5. **Verify**: Plugin detail > Subagents tab shows both agents
6. **Verify**: Both agents are enabled by default

### TC-2: Install plugin with manifest-declared agent paths
1. Prepare a plugin with `"agents": ["agents/researcher.md", "extra-agents/verifier.md"]` in manifest
2. Install the plugin
3. **Verify**: Both agents appear under Subagents page with correct names
4. **Verify**: Plugin detail shows correct agent count

### TC-3: Install plugin with `agents: true` (Claude-compatible)
1. Prepare a Claude-compatible plugin with `"agents": true` in manifest and an `agents/` directory with `.md` files
2. Install the plugin
3. **Verify**: All `.md` files in `agents/` are parsed and installed
4. **Verify**: Non-Markdown files in `agents/` are ignored

### TC-4: Install plugin with `agents` as a single string
1. Prepare a plugin with `"agents": "agents/reviewer.md"` (string, not array)
2. Install the plugin
3. **Verify**: Single agent is installed correctly

### TC-5: Install agent-only plugin (no skills, no MCP)
1. Prepare a plugin with only `agents/` directory, no skills or MCP servers
2. Install the plugin
3. **Verify**: Install succeeds
4. **Verify**: Plugin summary shows 0 skills, 0 MCP servers, correct agent count

### TC-6: Install plugin with `agents/` directory auto-detection (Claude-compatible)
1. Prepare a Claude-compatible plugin with no `agents` field in manifest but has an `agents/` directory
2. Install the plugin
3. **Verify**: Agents are auto-detected and installed

---

## 2. Security & Path Validation

### TC-7: Path traversal rejection
1. Prepare a plugin manifest with `"agents": ["../../secret-agent.md"]`
2. Attempt to install
3. **Verify**: Install fails with path safety error
4. **Verify**: No partial agent rows are created in database

### TC-8: Absolute path rejection
1. Prepare a plugin manifest with `"agents": ["/etc/passwd.md"]`
2. Attempt to install
3. **Verify**: Install fails with path validation error

### TC-9: Forbidden fields are filtered with warnings
1. Prepare an agent file with `permissionMode`, `hooks`, `mcpServers` in frontmatter
2. Install the plugin
3. **Verify**: Agent installs but forbidden fields are ignored
4. **Verify**: Warnings appear in diagnostics view
5. **Verify**: Agent does NOT have elevated permissions at runtime

### TC-10: Plugin agent does not execute code on import
1. Prepare a plugin with an agent file containing backticks with shell commands in Markdown body
2. Install the plugin
3. **Verify**: Agent is imported as text only, no commands executed

---

## 3. Agent Management UI

### TC-11: Subagents page navigation
1. Open System Settings
2. **Verify**: "Subagents" appears in navigation alongside Plugins, Skills, MCP Tools
3. Click Subagents
4. **Verify**: Page loads with table, search, filters, and "Add Subagent" button

### TC-12: Subagents page - all filters work
1. Install a plugin with 2 agents, create 1 manual agent
2. On Subagents page, test each filter:
   - **All**: Shows all agents
   - **Enabled**: Shows only enabled agents
   - **Disabled**: Shows only disabled agents
   - **Built-in**: Shows only built-in agents (if any)
   - **Plugin**: Shows only plugin-owned agents
   - **Manual**: Shows only user-created agents
   - **Has warnings**: Shows agents with warnings

### TC-13: Subagents page - search
1. Create agents with names "Campaign Reviewer", "Lead Scraper", "Email Writer"
2. Search "campaign"
3. **Verify**: Only "Campaign Reviewer" appears
4. Clear search
5. **Verify**: All agents reappear

### TC-14: Subagents table columns
1. Open Subagents page
2. **Verify**: Columns present: Agent, Description, Source, Plugin, Mode, Tools, Model, Status, Actions
3. **Verify**: Plugin-owned rows show plugin chip
4. **Verify**: Tool count shown in table

### TC-15: Agent detail panel - plugin agent (read-only)
1. Click on a plugin-owned agent row
2. **Verify**: Detail panel shows: ID, Display name, Description, Source, Plugin owner, Component path, Status, Mode, Default model, Max tool calls, Max runtime, Max continue calls, Allowed tools, Output schema, System prompt, Warnings, Last updated
3. **Verify**: System prompt and schema are **read-only** (no edit controls)

### TC-16: Agent detail panel - manual agent (editable)
1. Click on a manual (user-created) agent row
2. **Verify**: All fields are displayed
3. **Verify**: Edit controls are available (fields can be modified in place or via dialog)

### TC-17: Empty state - no agents
1. On a fresh install with no agents
2. **Verify**: Shows message "No subagents" and "Add Subagent" button

### TC-18: Empty state - filters hide all results
1. Apply a filter that matches no agents
2. **Verify**: Shows "No subagents match these filters"

---

## 4. Manual Agent CRUD

### TC-19: Create manual agent - happy path
1. Click "Add Subagent" on Subagents page
2. Fill: Name = "Dental Clinic Lead Researcher", Description = "...", System prompt = "You are...", Allowed tools = select some
3. Click Save
4. **Verify**: Agent appears in table with source = "user"
5. **Verify**: Agent is enabled by default
6. **Verify**: Agent appears in active runtime agent lists

### TC-20: Create manual agent - validation
1. Click "Add Subagent"
2. Try to save with empty Name
3. **Verify**: Validation error shown, save blocked
4. Try to save with empty Description
5. **Verify**: Validation error shown
6. Try to save with empty System prompt
7. **Verify**: Validation error shown
8. Enter a duplicate ID that already exists
9. **Verify**: Validation error shown

### TC-21: Create manual agent - ID slug auto-generation
1. Click "Add Subagent"
2. Enter Name = "My Cool Agent"
3. **Verify**: ID slug auto-generates (e.g., `my-cool-agent`)
4. **Verify**: ID is editable before first save

### TC-22: Create manual agent - mode selection
1. Open Add Subagent dialog
2. **Verify**: Mode dropdown shows: coordinator, specialist, verifier, formatter
3. Select each mode, save
4. **Verify**: Agent saves with selected mode

### TC-23: Edit manual agent
1. Create a manual agent
2. Click to open detail, edit Description and System prompt
3. Save changes
4. **Verify**: Changes persist after page reload
5. **Verify**: Runtime uses updated definition

### TC-24: Delete manual agent
1. Create a manual agent
2. Click delete action
3. **Verify**: Confirmation prompt appears
4. Confirm deletion
5. **Verify**: Agent removed from table
6. **Verify**: Agent removed from active runtime lists

### TC-25: Cannot delete built-in agents
1. Find a built-in agent in the list
2. **Verify**: No delete action available for built-in agents

---

## 5. Plugin Agent Enable/Disable

### TC-26: Disable individual plugin agent
1. Install a plugin with 2 agents (both enabled)
2. Open plugin detail > Subagents tab
3. Disable one agent via toggle
4. **Verify**: Agent toggle switches to disabled
5. **Verify**: Disabled agent no longer appears in active runtime agent lists
6. **Verify**: Other plugin agents remain enabled and available

### TC-27: Disabled agent state persists across restart
1. Disable a plugin agent
2. Restart the app
3. **Verify**: Agent remains disabled after restart

### TC-28: Enable/disable from Subagents page (not plugin detail)
1. On Subagents page, find a plugin agent
2. Toggle its status
3. **Verify**: Toggle works and reflects in both Subagents page and plugin detail Subagents tab

---

## 6. Plugin Enable/Disable Impact on Agents

### TC-29: Disable plugin hides all its agents
1. Install a plugin with 3 enabled agents
2. Disable the entire plugin
3. **Verify**: All 3 agents disappear from active runtime agent lists
4. **Verify**: Agents still visible as disabled in management UI (Subagents page)

### TC-30: Re-enable plugin restores previously enabled agents
1. Disable a plugin (agents were enabled)
2. Re-enable the plugin
3. **Verify**: Previously enabled agents become active again

### TC-31: Re-enable plugin does NOT restore individually disabled agents
1. Disable one agent in a plugin
2. Disable the entire plugin
3. Re-enable the plugin
4. **Verify**: The individually disabled agent stays disabled
5. **Verify**: Other agents that were enabled become active

### TC-32: Component-level state preserved across plugin disable/enable
1. Plugin has agents A (enabled), B (disabled), C (enabled)
2. Disable the plugin
3. Re-enable the plugin
4. **Verify**: A is enabled, B is still disabled, C is enabled

---

## 7. Plugin Uninstall Cleanup

### TC-33: Uninstall plugin removes its agents
1. Install a plugin with 3 agents
2. Note the agent IDs
3. Uninstall the plugin
4. **Verify**: All 3 agent rows are removed from database
5. **Verify**: Agents no longer appear in Subagents page
6. **Verify**: Agents no longer appear in active runtime lists

### TC-34: Uninstall does not affect manual agents
1. Create a manual agent named "My Agent"
2. Install a plugin with a similarly named agent
3. Uninstall the plugin
4. **Verify**: Manual agent "My Agent" is unaffected

### TC-35: Uninstall does not affect other plugins' agents
1. Install Plugin A with agents and Plugin B with agents
2. Uninstall Plugin A
3. **Verify**: Plugin A's agents removed
4. **Verify**: Plugin B's agents still present

---

## 8. Agent File Format

### TC-36: Valid agent file with all supported fields
1. Create an agent `.md` file with frontmatter:
   ```yaml
   ---
   name: reviewer
   description: Reviews campaigns
   tools: [knowledge_library_search]
   model: gpt-5-mini
   mode: verifier
   maxTurns: 8
   maxToolCalls: 10
   maxRuntimeMs: 60000
   color: blue
   ---
   You are a campaign review specialist.
   ```
2. Install plugin containing this file
3. **Verify**: Agent created with all fields parsed correctly
4. **Verify**: System prompt is the Markdown body exactly as written

### TC-37: Agent file with missing required fields
1. Create an agent `.md` file missing `name` or `description`
2. Install plugin
3. **Verify**: Error reported for missing required field
4. **Verify**: Agent does not appear in runtime catalog

### TC-38: Agent file with invalid YAML frontmatter
1. Create an agent `.md` file with malformed YAML
2. Install plugin
3. **Verify**: Error reported with file name and reason
4. **Verify**: No broken agent in runtime catalog

### TC-39: Agent ID namespacing
1. Install plugin "lead-pack" with agent "researcher.md"
2. **Verify**: Agent ID is `lead-pack:researcher`
3. **Verify**: Display name shows "researcher" (or custom name from frontmatter)

### TC-40: Nested directory namespacing
1. Install plugin with `agents/nested/deep-agent.md`
2. **Verify**: Agent ID is `<plugin-name>:nested:deep-agent`

---

## 9. Plugin Detail Subagents Tab

### TC-41: Plugin detail shows Subagents tab
1. Open detail for a plugin with agents
2. **Verify**: "Subagents" tab exists alongside Overview, Skills, MCP Servers, Permissions, Diagnostics, Manifest
3. Click Subagents tab
4. **Verify**: Only agents owned by this plugin are listed

### TC-42: Plugin Subagents tab - actions
1. Open plugin detail > Subagents tab
2. **Verify**: Enable/disable toggle available
3. **Verify**: "View details" action available
4. **Verify**: NO edit or delete actions shown for plugin agents

### TC-43: Plugin Subagents tab - empty state
1. Open detail for a plugin with no agents
2. **Verify**: Shows "This plugin does not include subagents"

### TC-44: Plugin summary shows agent count
1. Open Plugin Manager list
2. **Verify**: Plugin row shows agent count (if layout permits)

---

## 10. Internationalization (i18n)

### TC-45: All UI strings translated
1. Switch app language to Chinese (zh)
2. **Verify**: Subagents page title, filters, table headers, empty states, dialog labels are in Chinese
3. Repeat for Spanish, French, German, Japanese
4. **Verify**: No untranslated English strings visible

### TC-46: Switch language mid-session
1. While on Subagents page, switch language from English to Japanese
2. **Verify**: All text updates to Japanese without page reload issues

---

## 11. Runtime Behavior

### TC-47: Active runtime agent list excludes disabled agents
1. Create 3 agents: A (enabled), B (disabled), C (enabled)
2. Check active runtime agent list (via AI chat or agent invocation)
3. **Verify**: Only A and C appear, B is excluded

### TC-48: Active runtime agent list excludes disabled-plugin agents
1. Install plugin with 2 enabled agents
2. Disable the plugin
3. Check active runtime agent list
4. **Verify**: Plugin agents are excluded

### TC-49: Tool allowlist intersection at runtime
1. Create an agent with `allowedTools: ["tool_a", "tool_b"]`
2. Disable `tool_b`
3. **Verify**: At runtime, agent can only access `tool_a` (not `tool_b`)

### TC-50: Agent mode affects behavior
1. Create agents with modes: coordinator, specialist, verifier, formatter
2. **Verify**: Each mode is stored and displayed correctly in UI
3. **Verify**: Runtime respects mode in agent invocation

---

## 12. Edge Cases

### TC-51: Duplicate agent ID across plugins
1. Install Plugin A with agent named "helper" (ID: `plugin-a:helper`)
2. Install Plugin B with agent also named "helper" (ID: `plugin-b:helper`)
3. **Verify**: Both agents coexist with different IDs

### TC-52: Manual agent ID collision with plugin agent
1. Install a plugin with agent `my-plugin:reviewer`
2. Try to create a manual agent with ID `my-plugin:reviewer`
3. **Verify**: Validation error - ID collision prevented

### TC-53: Plugin reinstall overwrites agents
1. Install plugin v1 with agent "reviewer" (custom description)
2. Install plugin v2 with updated agent "reviewer" (new description)
3. **Verify**: Agent is updated with v2 content
4. **Verify**: Enable/disable state preserved if possible

### TC-54: App restart preserves all states
1. Install plugin, enable/disable some agents, create manual agents
2. Restart app
3. **Verify**: All agent states, manual agents, and plugin associations preserved

### TC-55: Multiple plugins with agents
1. Install 3 plugins each with 2 agents
2. **Verify**: All 6 agents appear in Subagents page
3. **Verify**: Each plugin's Subagents tab shows only its own agents
4. **Verify**: Disabling one plugin only affects that plugin's agents

---

## Test Execution Checklist

| # | Test Case | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| TC-1 | Install plugin with `agents/` directory | | |
| TC-2 | Install plugin with manifest-declared agent paths | | |
| TC-3 | Install plugin with `agents: true` (Claude-compatible) | | |
| TC-4 | Install plugin with `agents` as a single string | | |
| TC-5 | Install agent-only plugin | | |
| TC-6 | Install plugin with `agents/` auto-detection | | |
| TC-7 | Path traversal rejection | | |
| TC-8 | Absolute path rejection | | |
| TC-9 | Forbidden fields filtered with warnings | | |
| TC-10 | No code execution on import | | |
| TC-11 | Subagents page navigation | | |
| TC-12 | All filters work | | |
| TC-13 | Search | | |
| TC-14 | Table columns | | |
| TC-15 | Detail panel - plugin agent (read-only) | | |
| TC-16 | Detail panel - manual agent (editable) | | |
| TC-17 | Empty state - no agents | | |
| TC-18 | Empty state - filters hide all | | |
| TC-19 | Create manual agent - happy path | | |
| TC-20 | Create manual agent - validation | | |
| TC-21 | ID slug auto-generation | | |
| TC-22 | Mode selection | | |
| TC-23 | Edit manual agent | | |
| TC-24 | Delete manual agent | | |
| TC-25 | Cannot delete built-in agents | | |
| TC-26 | Disable individual plugin agent | | |
| TC-27 | Disabled state persists across restart | | |
| TC-28 | Toggle from Subagents page | | |
| TC-29 | Disable plugin hides all agents | | |
| TC-30 | Re-enable restores enabled agents | | |
| TC-31 | Re-enable does NOT restore individually disabled | | |
| TC-32 | Component-level state preserved | | |
| TC-33 | Uninstall removes plugin agents | | |
| TC-34 | Uninstall does not affect manual agents | | |
| TC-35 | Uninstall does not affect other plugins' agents | | |
| TC-36 | Valid agent file with all fields | | |
| TC-37 | Agent file with missing required fields | | |
| TC-38 | Agent file with invalid YAML | | |
| TC-39 | Agent ID namespacing | | |
| TC-40 | Nested directory namespacing | | |
| TC-41 | Plugin detail shows Subagents tab | | |
| TC-42 | Plugin Subagents tab - actions | | |
| TC-43 | Plugin Subagents tab - empty state | | |
| TC-44 | Plugin summary shows agent count | | |
| TC-45 | All UI strings translated | | |
| TC-46 | Switch language mid-session | | |
| TC-47 | Runtime excludes disabled agents | | |
| TC-48 | Runtime excludes disabled-plugin agents | | |
| TC-49 | Tool allowlist intersection | | |
| TC-50 | Agent mode affects behavior | | |
| TC-51 | Duplicate agent ID across plugins | | |
| TC-52 | Manual agent ID collision | | |
| TC-53 | Plugin reinstall overwrites agents | | |
| TC-54 | App restart preserves states | | |
| TC-55 | Multiple plugins with agents | | |
