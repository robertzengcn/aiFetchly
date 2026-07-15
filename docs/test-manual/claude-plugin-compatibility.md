# Claude Code Plugin Compatibility — Test Manual

| Metadata | Value |
|---|---|
| Version | 1.0 |
| Created | 2026-07-06 |
| Feature | Claude Code Plugin Compatibility (Phase 1-3) |
| PRD | `docs/prd/claude-code-plugin-compatibility-prd.md` |

## 1. Prerequisites

### 1.1 Environment

- [ ] AiFetchly dev server running (`yarn dev`)
- [ ] Application initialized with `yarn init`
- [ ] No existing Claude plugins installed (start clean)
- [ ] Browser DevTools open for network/console inspection
- [ ] Electron main process logs visible (run with `DEBUG='plugin*,mcp*,skill*' yarn dev`)

### 1.2 Test Fixtures

Four sample Claude plugins are available at `test/fixtures/claude-plugins/`:

| Fixture | Skills | MCP Servers | Hooks | Notes |
|---|---|---|---|---|
| `skills-only/` | 2 (`lead-research`, `email-writer`) | 0 | 0 | Minimal skills pack |
| `mcp-only/` | 0 | 1 (`demo-server`) | 0 | Single MCP server |
| `mixed/` | 1 (`lead-research`) | 1 (`echo`) | 0 | Skills + MCP |
| `broken-skill/` | 1 good + 1 broken (no frontmatter) | 0 | 0 | Error isolation test |

### 1.3 Reference Plugins (Real-World)

For end-to-end testing, use a real Claude plugin from GitHub (e.g., any public repo with `.claude-plugin/plugin.json` structure). If none is available, the fixtures above serve as the canonical test targets.

---

## 2. Manifest Discovery

### 2.1 Dual-Path Probe Order

Verify the manifest discovery order: `.aifetchly-plugin/plugin.json` > `.claude-plugin/plugin.json` > root `plugin.json` (legacy).

| Test | Steps | Expected |
|---|---|---|
| **2.1a — Native plugin detected** | 1. Create a dir with `.aifetchly-plugin/plugin.json` (valid AiFetchly manifest)<br>2. Also place `.claude-plugin/plugin.json` (different content) in the same dir<br>3. Install from this folder | AiFetchly manifest is loaded; `.claude-plugin/` is ignored |
| **2.1b — Claude plugin detected** | 1. Create a dir with only `.claude-plugin/plugin.json` (valid Claude manifest)<br>2. Install from this folder | Claude manifest is detected; format badge shows "Claude" |
| **2.1c — Root fallback** | 1. Create a dir with `plugin.json` at root (valid manifest)<br>2. No `.aifetchly-plugin/` or `.claude-plugin/` present<br>3. Install from this folder | Root `plugin.json` loaded; treated as AiFetchly format |
| **2.1d — Nothing found** | 1. Create a dir with no manifest files at all<br>2. Install from this folder | Install fails with clear error: "no plugin manifest found" |

---

## 3. Installation (All 6 Sources)

### 3.1 Local Folder

| Test | Steps | Expected |
|---|---|---|
| **3.1a — Install skills-only plugin** | 1. Plugin Manager → "Install" → "Local Folder"<br>2. Browse to `test/fixtures/claude-plugins/skills-only/`<br>3. Click confirm | Plugin installed; 2 skills shown; format badge "Claude"; health "healthy" |
| **3.1b — Install MCP-only plugin** | 1. Install `test/fixtures/claude-plugins/mcp-only/` | Plugin installed; 1 MCP server shown; no skills |
| **3.1c — Install mixed plugin** | 1. Install `test/fixtures/claude-plugins/mixed/` | Plugin installed; 1 skill + 1 MCP server shown |
| **3.1d — Install broken-skill plugin** | 1. Install `test/fixtures/claude-plugins/broken-skill/` | Plugin installed; 1 good skill loads; 1 broken skill shows error; health shows "partial_load" |

### 3.2 Local Zip

| Test | Steps | Expected |
|---|---|---|
| **3.2a — Install from zip** | 1. Zip `test/fixtures/claude-plugins/skills-only/` into a temp zip<br>2. Plugin Manager → "Install" → "Local Zip"<br>3. Select the zip file | Same as 3.1a: plugin installs cleanly |
| **3.2b — Zip with path traversal** | 1. Create a zip with entries containing `../../outside-plugin/` paths<br>2. Attempt to install | Zip rejected with `path-outside-plugin` error |
| **3.2c — Zip with .git directory** | 1. Create a zip that includes `.git/hooks/post-checkout`<br>2. Install the zip | Plugin installs; `.git/` contents are stripped; no `.git` directory in cached copy |

### 3.3 GitHub URL

| Test | Steps | Expected |
|---|---|---|
| **3.3a — Install from GitHub** | 1. Plugin Manager → "Install" → "GitHub"<br>2. Paste a valid GitHub URL of a Claude plugin<br>3. Confirm | Plugin fetched, installed, and registered; skills appear in Plugin Manager |
| **3.3b — Invalid GitHub URL** | 1. Paste an invalid URL (e.g., `https://github.com/not-a-real-repo/invalid`) | Error surface: "failed to fetch from GitHub" with actionable message |

### 3.4 npm

| Test | Steps | Expected |
|---|---|---|
| **3.4a — Install from npm** | 1. Plugin Manager → "Install" → "npm"<br>2. Enter npm package name<br>3. Confirm | Plugin fetched from npm registry and installed |

### 3.5 Git (Raw URL)

| Test | Steps | Expected |
|---|---|---|
| **3.5a — Install from git** | 1. Plugin Manager → "Install" → "Git"<br>2. Paste a raw git remote URL<br>3. Confirm | Plugin cloned, `.git` stripped, installed cleanly |

### 3.6 URL (Direct)

| Test | Steps | Expected |
|---|---|---|
| **3.6a — Install from URL** | 1. Plugin Manager → "Install" → "URL"<br>2. Paste a direct URL to a plugin zip archive<br>3. Confirm | Plugin downloaded and installed |

---

## 4. Skill Adaptation

### 4.1 SKILL.md Frontmatter Parsing

| Test | Steps | Expected |
|---|---|---|
| **4.1a — Skill with valid frontmatter** | 1. Install `skills-only` plugin<br>2. Open Plugin Detail → Skills tab | `lead-research` and `email-writer` shown with correct names from frontmatter |
| **4.1b — Skill description preserved verbatim** | 1. Check the skill `lead-research`'s description | Description matches the frontmatter `description` field exactly — no truncation, no paraphrasing |
| **4.1c — Skill name sanitization** | 1. Create a Claude plugin with a skill named `My Cool Skill!@#$`<br>2. Install it | Skill name sanitized to kebab-case alphanumeric form |
| **4.1d — Skill with supportedFileTypes** | 1. Create a Claude skill with `supportedFileTypes: [".csv", ".json"]` in frontmatter<br>2. Install and inspect | File types are normalized and stored in the skill manifest |

### 4.2 Skill Execution via AiChatV2

| Test | Steps | Expected |
|---|---|---|
| **4.2a — Invoke Claude skill from chat** | 1. Install `skills-only` plugin<br>2. Open AiChatV2<br>3. Ask a question matching the skill's trigger description | Skill executor picks up the Claude skill; skill runs and produces output |
| **4.2b — Skill as documentation-only** | 1. Check the skill's runtime type | Runtime is `"javascript"` with `documentationOnly: true`; skill body is markdown fed to the model |

### 4.3 Skill Enable/Disable

| Test | Steps | Expected |
|---|---|---|
| **4.3a — Disable one skill** | 1. Install `skills-only` plugin (2 skills)<br>2. In Skills tab, toggle off `lead-research`<br>3. Save/reload the plugin | Only `email-writer` skill is active; `lead-research` is disabled per component state |
| **4.3b — Disable in AiChatV2** | 1. After 4.3a, invoke AiChatV2 with a lead-research prompt | Disabled skill is NOT invoked; only enabled skills are available |
| **4.3c — Re-enable skill** | 1. Toggle `lead-research` back on<br>2. Reload | Both skills active again; no data loss |
| **4.3d — Disable plugin disables all skills** | 1. Toggle the entire plugin off<br>2. Verify in AiChatV2 | Neither skill is invokable |

---

## 5. MCP Server Integration

### 5.1 Inline MCP Map

| Test | Steps | Expected |
|---|---|---|
| **5.1a — Inline MCP server loads** | 1. Install `mcp-only` plugin<br>2. Open Plugin Detail → MCP Servers tab | `demo-server` shown with transport type, command, args |
| **5.1b — MCP server naming** | 1. Check the registered tool names in the MCP runtime | Tools follow pattern: `mcp__<plugin>__<server>__<tool>` |

### 5.2 Sibling `.mcp.json`

| Test | Steps | Expected |
|---|---|---|
| **5.2a — .mcp.json detected** | 1. Create a plugin with `.claude-plugin/plugin.json` (no inline `mcp`) and a sibling `.mcp.json` file<br>2. Install | MCP declarations loaded from `.mcp.json` |

### 5.3 MCP Server Enable/Disable

| Test | Steps | Expected |
|---|---|---|
| **5.3a — Disable MCP server** | 1. Install `mixed` plugin<br>2. In MCP Servers tab, toggle off the `echo` server<br>3. Reload | Server is disabled; its tools are not available |
| **5.3b — Disable plugin disables all MCP** | 1. Toggle the entire plugin off<br>2. Check MCP tool availability | No MCP tools from this plugin are callable |

### 5.4 MCP Options

| Test | Steps | Expected |
|---|---|---|
| **5.4a — Read options** | Call `PLUGIN_GET_MCP_OPTIONS` IPC | Returns current options for the plugin (may be empty) |
| **5.4b — Set option** | Set an option via `PLUGIN_SET_MCP_OPTION` | Option persisted; `${VAR}` placeholders resolve at server spawn time |
| **5.4c — Option resolution** | Configure a server with `env: { API_KEY: '${API_KEY}' }` and set `API_KEY` via options | Server spawns with API_KEY resolved to the configured value |

### 5.5 Scoping (Name Collision Prevention)

| Test | Steps | Expected |
|---|---|---|
| **5.5a — No collision between plugins** | 1. Install two plugins each defining an MCP server named `api`<br>2. Check registered MCP servers | Servers registered as `<plugin1>__api` and `<plugin2>__api` — no collision |
| **5.5b — UI shows un-scoped name** | 1. View Plugin Manager | Format badge shows original server name; scoping is internal only |

---

## 6. Plugin Manager UI

### 6.1 Format Badge

| Test | Steps | Expected |
|---|---|---|
| **6.1a — Claude badge display** | 1. Install any Claude-format plugin<br>2. View Plugin Manager list | Row shows "Claude" chip with deep-purple color |
| **6.1b — AiFetchly badge display** | 1. Install an existing AiFetchly-format plugin (or a native one)<br>2. View Plugin Manager list | Row shows "AiFetchly" chip with grey color |
| **6.1c — Badge tooltip** | 1. Hover over the Claude badge | Tooltip explains what the format tag means |

### 6.2 Health Status Display

| Test | Steps | Expected |
|---|---|---|
| **6.2a — Healthy plugin** | Install `skills-only` plugin | Status shows "healthy" (green) |
| **6.2b — Partial load** | Install `broken-skill` plugin | Status shows "partial_load" (yellow/warning) |
| **6.2c — Disabled plugin** | Toggle off a plugin | Status shows "disabled" |
| **6.2d — Missing files** | Delete the plugin's skill directory manually, then reload | Status shows "missing_files" (red) |

### 6.3 Error Display

| Test | Steps | Expected |
|---|---|---|
| **6.3a — Broken skill error visible** | 1. Install `broken-skill` plugin<br>2. Open Plugin Detail → Diagnostics tab | Error for the broken skill is listed with code `claude-frontmatter-invalid` and description "missing required frontmatter field" |
| **6.3b — Errors don't block healthy skills** | 1. After 6.3a, check Skills tab | The good skill is listed and functional; only the broken skill shows an error |

### 6.4 Detail Tabs

| Test | Steps | Expected |
|---|---|---|
| **6.4a — Overview tab** | Open Plugin Detail | Shows name, version, source, author, homepage, description |
| **6.4b — Skills tab** | Open Skills tab | Lists all skills with enable/disable toggle, health chip |
| **6.4c — MCP Servers tab** | Open MCP Servers tab | Lists all MCP servers with transport chip, enable/disable toggle |
| **6.4d — Permissions tab** | Open Permissions tab | Shows declared permissions (if any) as chips |
| **6.4e — Diagnostics tab** | Open Diagnostics tab | Shows structured error list, export button |
| **6.4f — Manifest tab** | Open Manifest tab | Shows the adapted (internal) manifest as raw JSON |

---

## 7. Update

| Test | Steps | Expected |
|---|---|---|
| **7a — Update from same source** | 1. Install `skills-only` from local folder<br>2. Modify a skill file in the source folder<br>3. Click "Update" in Plugin Manager<br>4. Confirm | Plugin re-fetches from same source; updated skill content is reflected |
| **7b — State preserved after update** | 1. Install plugin, disable one skill, set an MCP option<br>2. Update the plugin | Enable/disable state and options are preserved |
| **7c — Update from different source** | 1. Install from local folder<br>2. Click "Update" but with a different source type | Update uses the original source; changing source requires re-install |

---

## 8. Uninstall

| Test | Steps | Expected |
|---|---|---|
| **8a — Uninstall removes all data** | 1. Install `mixed` plugin<br>2. Click "Uninstall"<br>3. Confirm | Plugin removed from Plugin Manager list |
| **8b — All DB rows removed** | 1. After uninstall, query the DB for plugin-owned skills and MCP rows | No orphaned records for this plugin |
| **8c — Cache directory removed** | 1. Check filesystem for the plugin's cached directory | Directory no longer exists |
| **8d — Skills no longer invokable** | 1. Try to invoke a removed skill from AiChatV2 | Skill not available; no "unknown skill" errors (it simply doesn't show up) |
| **8e — Re-install after uninstall** | 1. Install same plugin again | Fresh install; no residue from previous installation |

---

## 9. Hooks Integration (Phase 3)

| Test | Steps | Expected |
|---|---|---|
| **9a — Hook plugin installs cleanly** | 1. Create a plugin with `.claude-plugin/plugin.json` declaring hooks and `hooks/hooks.json`<br>2. Install | Plugin installs; hooks registered silently |
| **9b — PreToolUse hook fires** | 1. Create a hook with `PreToolUse` event matcher and a sandboxed `aifetchly.script`<br>2. Use a tool that matches the hook's matcher pattern | Hook runs; its result (allow/deny) is respected |
| **9c — Hook failure non-fatal** | 1. Create a hook script that throws an error<br>2. Use the matching tool | Tool call succeeds (hook failure is logged, not propagated); no crash |
| **9d — Unsupported hooks ignored** | 1. Declare `PostToolUse` and `SubagentStart` hook events<br>2. Install | Plugin installs; unsupported events are logged as opaque; no error |

---

## 10. Identifier Parsing

| Test | Steps | Expected |
|---|---|---|
| **10a — Bare name** | Enter `lead-tools` as identifier | Parsed as `{ name: "lead-tools", marketplace: undefined }` |
| **10b — Name@marketplace** | Enter `lead-tools@anthropics` | Parsed as `{ name: "lead-tools", marketplace: "anthropics" }` |
| **10c — Invalid characters** | Enter `Lead Tools!!!@market` | Error: invalid plugin name (only `[a-z0-9._-]` allowed) |
| **10d — Empty segments** | Enter `@market` or `name@` | Error: both segments must be non-empty |

---

## 11. Diagnostics

| Test | Steps | Expected |
|---|---|---|
| **11a — Export diagnostics** | 1. Install any plugin<br>2. Open Detail → Diagnostics tab<br>3. Click "Export Diagnostics" | A JSON file is saved containing: manifest, skill list, MCP declarations, errors, source info |
| **11b — Secrets redacted** | 1. Set an option with value `sk-123-secret`<br>2. Export diagnostics | The option value is redacted (shows `"***REDACTED***"` or similar) |

---

## 12. Security Testing

### 12.1 Path Traversal

| Test | Steps | Expected |
|---|---|---|
| **12.1a — Skill path traversal** | 1. Create a Claude manifest with `skills: ["../../etc/passwd"]`<br>2. Attempt to install | Rejected with `path-outside-plugin` error; no file written outside plugin directory |
| **12.1b — MCP path traversal** | 1. Create a Claude manifest with `mcpServers: [{"command": "../../../bin/sh"}]`<br>2. Attempt to install | MCP declaration rejected with `path-outside-plugin` error |

### 12.2 `.git` Stripping

| Test | Steps | Expected |
|---|---|---|
| **12.2a — .git directory stripped** | 1. Create a plugin directory containing `.git/objects/...` and `.git/hooks/post-checkout`<br>2. Install from local folder | Cached copy has no `.git/` directory or `.git` entries |
| **12.2b — .github stripped** | 1. Include `.github/workflows/ci.yml` in the plugin<br>2. Install | `.github/` directory is stripped |

### 12.3 AI-Enable Gating

| Test | Steps | Expected |
|---|---|---|
| **12.3a — AI disabled = skills blocked** | 1. Set `USER_AI_ENABLED` to `false` via `Token` service<br>2. Restart / reload<br>3. Try to invoke a Claude skill from AiChatV2 | AI function call returns `{ status: false, msg: "AI is not enabled" }` |
| **12.3b — AI disabled = MCP blocked** | 1. With AI disabled, try to use an MCP tool from a Claude plugin | MCP tool call returns error; AI-gated IPC handler blocked |
| **12.3c — Non-AI handlers work without AI** | 1. With AI disabled, install a plugin, list plugins, uninstall | All non-AI operations work normally |
| **12.3d — Re-enable AI** | 1. Set `USER_AI_ENABLED` back to `true`<br>2. Try to invoke skills again | Skills work normally |

### 12.4 Path Traversal in ZIP

| Test | Steps | Expected |
|---|---|---|
| **12.4a — ZIP with ../ paths** | 1. Create a zip with entries like `../evil.txt`<br>2. Try to import | Rejected; error `path-outside-plugin` |
| **12.4b — ZIP with symlinks to parent** | 1. Create a zip with symlink pointing to `/etc` | Symlink is not extracted (or resolved safely) |

---

## 13. Edge Cases

| Test | Steps | Expected |
|---|---|---|
| **13a — Empty plugin (no skills, no MCP)** | 1. Create a Claude manifest with only `name` and `version` (no `skills` or `mcpServers` or any other component)<br>2. Install | Plugin installs; shows "no active capabilities" message; health "healthy" |
| **13b — Plugin with only unsupported components** | 1. Create a plugin with only `commands: [...]` and `lspServers: [...]`<br>2. Install | Plugin installs; shows "no active capabilities"; components are opaque |
| **13c — Duplicate skill names** | 1. Create a plugin with two skills having the same frontmatter `name`<br>2. Install | Second skill fails to load with `skill-manifest-invalid` error |
| **13d — Very large plugin** | 1. Create a plugin zip near the 50MB limit with 5000 files<br>2. Install | Plugin installs if within limits; rejected with size error if over |
| **13e — Malformed manifest JSON** | 1. Place invalid JSON as `.claude-plugin/plugin.json`<br>2. Install | Install fails at manifest parse stage with syntax error message |
| **13f — Missing skills directory** | 1. Create a manifest declaring `skills: true` but no `skills/` directory<br>2. Install | Plugin installs; skills count is 0; health shows warning |
| **13g — Reload after external change** | 1. Install a plugin, then manually delete a skill file from the cache<br>2. Click "Reload All" | Plugin health changes to "missing_files"; error shown in diagnostics |
| **13h — Concurrent installs** | 1. Start two install operations simultaneously<br>2. Complete both | Both installs complete; both plugins registered; no data race |
| **13i — Same plugin installed twice** | 1. Install `skills-only` once<br>2. Install it again with same source | Second install fails or updates the existing entry (dedup by name + source) |

---

## 14. Internationalization (i18n)

| Test | Steps | Expected |
|---|---|---|
| **14a — All strings translated in all 6 languages** | Switch app language to each of: `en`, `zh`, `es`, `fr`, `de`, `ja` | All plugin UI strings are translated; no raw English keys visible |
| **14b — Format badge translated** | Check `format_claude` and `format_aifetchly` keys in each language | Each language has its own translation for "Claude" and "AiFetchly" |
| **14c — Error messages translated** | Trigger a plugin error (e.g., install broken-skill) in each language | Error titles and descriptions are localized |
| **14d — RTL layout** | (If supported) switch to a RTL language | Plugin Manager layout adapts correctly |

---

## 15. Regression Testing

### 15.1 AiFetchly Native Plugins Unaffected

| Test | Steps | Expected |
|---|---|---|
| **15a — Native plugin still works** | 1. Install an existing AiFetchly-format plugin<br>2. List, inspect, toggle, uninstall | All operations work as before; format badge shows "AiFetchly" |
| **15b — Native plugin load performance** | 1. Measure load time for an AiFetchly plugin before and after Claude compat changes | No regression (within 1.5x baseline) |
| **15c — Legacy root plugin.json** | 1. Install a plugin with only root `plugin.json`<br>2. Verify it works | Detected as AiFetchly format; no Claude path invoked |

### 15.2 Existing IPC Handlers

| Test | Steps | Expected |
|---|---|---|
| **15d — Existing plugin IPC handlers unchanged** | 1. Run the existing plugin test suite (`yarn test` with plugin-related tests) | All existing tests pass |
| **15e — Non-plugin handlers unaffected** | 1. Run a general functional test of the app (e.g., login, task creation) | No regressions |

---

## 16. Unit and Integration Test Reference

The following automated tests cover the implementation at the unit/integration level. Run them with:

```bash
# All plugin compat tests
npx vitest run test/vitest/main/service/pluginCompat/

# Specific test file
npx vitest run test/vitest/main/service/pluginCompat/ClaudePluginAdapter.test.ts

# Integration tests (uses fixtures)
npx vitest run test/vitest/main/service/pluginCompat/ClaudeFixtures.integration.test.ts

# Full test suite
yarn test
```

| Test File | Coverage |
|---|---|
| `ClaudePluginAdapter.test.ts` | Manifest adaptation paths, skills normalization, path traversal, inline mcp, hooks, opaque |
| `ClaudeSkillFormatAdapter.test.ts` | SKILL.md adaptation, frontmatter requirements, name sanitization |
| `ClaudeHooksAdapter.test.ts` | Hook adaptation, event types, matchers, error handling |
| `claudeFrontmatterParser.test.ts` | YAML subset parsing, arrays, booleans, integers, edge cases |
| `parsePluginIdentifier.test.ts` | Name@marketplace parsing, validation |
| `McpToolNaming.test.ts` | Tool naming, parsing, scope extraction |
| `PluginHookRegistrar.test.ts` | Hook registration, script dispatch, no-op fallback |
| `PluginOptionsStore.test.ts` | Options read/write, env resolution, placeholder discovery |
| `ClaudeFixtures.integration.test.ts` | End-to-end: all fixtures loaded, round-trip, skill isolation, uninstall |
| `loadClaudePlugin.integration.test.ts` | Load skills-only plugin, adapt SKILL.md, verify round-trip |
| `PluginMcpDeclaration.inline.test.ts` | Inline MCP normalization, error collection, path traversal |
| `GitStripping.test.ts` | .git/.github stripping verification |

---

## 17. Test Pass Criteria

### Phase 1 — Skills (Gate: all must pass)

- [ ] All 6 install sources work for Claude plugins
- [ ] Manifest discovery probes in correct order
- [ ] Claude skills appear in Plugin Manager with "Claude" format badge
- [ ] Claude skills are invokable from AiChatV2
- [ ] Skill enable/disable works per-skill and per-plugin
- [ ] Uninstall removes all traces (DB + filesystem)
- [ ] Path traversal rejected for skills and MCP paths
- [ ] .git directories stripped during install
- [ ] AI-enable gating blocks AI functions when disabled
- [ ] Broken skill loads rest of plugin (isolation)
- [ ] Error display shows structured errors per component
- [ ] All 6 languages have translated strings
- [ ] All 12 unit/integration test files pass

### Phase 2 — MCP (Gate: all must pass)

- [ ] Inline MCP map loads and registers servers
- [ ] Sibling `.mcp.json` detected
- [ ] Server name scoping prevents collisions (`<plugin>__<server>`)
- [ ] MCP enable/disable works per-server and per-plugin
- [ ] Options read/write + `${VAR}` resolution works

### Phase 3 — Hooks (Gate: all must pass)

- [ ] Plugin with hooks installs cleanly
- [ ] PreToolUse hooks fire and affect tool execution
- [ ] Hook failure is non-fatal (tool still runs)
- [ ] Unsupported events silently ignored
- [ ] Hooks run in SkillWorker (not main process)

---

## 18. Bug Report Template

When filing a bug found during manual testing, include:

```
## Environment
- AiFetchly commit: <git hash>
- Plugin fixture: <name>
- Install source: <local-folder | local-zip | github | ...>

## Steps to Reproduce
1. ...

## Expected
...

## Actual
...

## Logs / Screenshots
<attach main process logs, DevTools console, screenshot>

## Additional Context
- Plugin format: Claude | AiFetchly
- Health status: healthy | partial_load | invalid | ...
```
