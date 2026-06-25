# Plugin Management System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plugin layer that can package and manage AI skills and MCP servers as installable, enableable, uninstallable units above the existing skill and MCP runtime stacks.

**Architecture:** A five-layer system (Renderer UI → IPC → Services → Modules → Models/Entities) layered above the existing `installed_skills` and `mcp_tool` stacks. Plugins own components via new `pluginName` columns on `InstalledSkillEntity` and `MCPToolEntity`. Effective enablement is computed as `plugin.enabled && component.enabled` (no row rewrites on plugin toggle). Local-zip-only in V1; no marketplace.

**Tech Stack:** TypeScript 5.x, Electron (main + Vue 3 renderer), TypeORM + better-sqlite3, `adm-zip`, existing `SkillImportService`/`SkillRegistry`/`MCPToolService`/`MCPClient`.

**Source of truth:** `docs/skills/Plugin_Management_System_Technical_Design.md` (all type contracts, validation rules, IPC shapes, security rules live there). This plan references sections by number rather than duplicating contracts.

---

## Scope & Decomposition

Seven phases, each producing working, testable software. Phases 1–4 build the backend (types → persistence → import → runtime). Phase 5 wires IPC. Phase 6 builds the UI. Phase 7 hardens.

| Phase | Deliverable | Tests |
|---|---|---|
| 1 | Types, `InstalledPluginEntity`, model, module, DB registration | `test/modules/PluginManagementModule.test.ts` |
| 2 | `PluginManifestService`, `PluginArchiveService` | `test/vitest/utilitycode/pluginManifestService.test.ts`, `pluginArchiveService.test.ts` |
| 3 | `PluginImportService` (atomic install + rollback) | `test/vitest/utilitycode/pluginImportService.test.ts` |
| 4 | `PluginLoaderService`, `PluginComponentRegistryService`, `PluginRuntimeCache` | `test/vitest/utilitycode/pluginLoaderService.test.ts` |
| 5 | `plugin-ipc.ts`, channels, AI-enable checks | `test/vitest/main/plugin-ipc.test.ts` |
| 6 | Renderer page, components, API, router, i18n | manual + existing `vue-check` |
| 7 | Security edge tests, ownership labels on existing pages | fixture-driven tests |

---

## File Map

**Create:**
```
src/entityTypes/pluginTypes.ts
src/entity/InstalledPlugin.entity.ts
src/model/InstalledPlugin.model.ts
src/modules/PluginManagementModule.ts
src/service/PluginManifestService.ts
src/service/PluginArchiveService.ts
src/service/PluginImportService.ts
src/service/PluginLoaderService.ts
src/service/PluginComponentRegistryService.ts
src/service/PluginDiagnosticsService.ts
src/service/PluginRuntimeCache.ts
src/main-process/communication/plugin-ipc.ts
src/views/api/plugins.ts
src/views/pages/systemsetting/plugins.vue
src/views/components/plugins/PluginManager.vue
src/views/components/plugins/PluginImportDialog.vue
src/views/components/plugins/PluginDetailPanel.vue
src/views/components/plugins/PluginOverviewTab.vue
src/views/components/plugins/PluginSkillsTab.vue
src/views/components/plugins/PluginMcpServersTab.vue
src/views/components/plugins/PluginPermissionsTab.vue
src/views/components/plugins/PluginDiagnosticsTab.vue
src/views/components/plugins/PluginManifestTab.vue
test/modules/PluginManagementModule.test.ts
test/vitest/utilitycode/pluginManifestService.test.ts
test/vitest/utilitycode/pluginArchiveService.test.ts
test/vitest/utilitycode/pluginImportService.test.ts
test/vitest/utilitycode/pluginLoaderService.test.ts
test/vitest/main/plugin-ipc.test.ts
test/fixtures/plugins/  (zip fixtures)
```

**Modify:**
```
src/config/SqliteDb.ts                            (register InstalledPluginEntity)
src/entity/InstalledSkill.entity.ts               (add pluginName, pluginComponentPath)
src/entity/MCPTool.entity.ts                      (add pluginName, pluginComponentPath, command, argsJson, envJson, url, origin; make host nullable for stdio)
src/config/channellist.ts                         (PLUGIN_* channels)
src/main-process/communication/index.ts           (register plugin-ipc handlers)
src/config/skillsRegistry.ts                      (effective-enablement filter for plugin-owned skills)
src/service/MCPToolService.ts                     (effective-enablement filter; stdio build path)
src/views/router/index.ts                         (plugins route)
src/views/lang/{en,zh,es,fr,de,ja}.ts             (plugins.* namespace)
src/views/pages/systemsetting/skills.vue          (ownership label)
src/views/pages/systemsetting/mcp.vue             (ownership label)
```

---

## Cross-Cutting Decisions (locked)

1. **Effective enablement over row rewrites** — toggling a plugin never rewrites owned skill/MCP `enabled` columns. Computed at registry/catalog query time. (Design §8.3, §19.2)
2. **Plugin-owned skill root lives under plugin install root** — `userData/plugins/installed/<plugin-name>/skills/<skill-name>/`. Requires `SkillEnvironmentManager` root resolution update. (Design §8.1, §19.1)
3. **Explicit MCP stdio fields** — new `command`/`argsJson`/`envJson`/`url` columns on `mcp_tool`; `host` becomes nullable compat field for stdio rows. (Design §9.2, §19.4)
4. **Validation returns errors, not thrown exceptions** — manifest/archive/import services return `{ success: false, errors }` shapes; only unexpected I/O or DB failures throw, and IPC converts them to `{ status: false, msg, data: null }`. (Design §14)
5. **Plugin import never executes plugin code** — no skill entry files, no MCP commands, no shell, no `pip install` during validation/preview. (Design §15.5)
6. **Local zip only in V1.** (Design §19.3)
7. **SQLite `synchronize: true`** — entity changes auto-migrate; verify by running app init. (Design §16.3)
8. **Auto-commit per logical unit** per project CLAUDE.md — commit after each Task's green step.

---

## Phase 1: Types, Entity, Model, Module (Design §5.1, §5.2, §5.3, §6)

### Task 1.1: Plugin type definitions

**Files:**
- Create: `src/entityTypes/pluginTypes.ts`

- [ ] **Step 1: Write the type file**

Define per Design §4.2, §4.3, §14: `PluginSource`, `PluginHealth`, `PluginManifest`, `PluginDependency`, `PluginMcpTransport`, `PluginMcpServersFile`, `PluginMcpServerDeclaration`, `PluginErrorCode`, `PluginError`, `PluginComponentStateEntry`, `PluginComponentState`, `PluginSummary`, `PluginValidationResult`, `CreateInstalledPluginInput`, `UpdatePluginStateInput`, `PluginUninstallResult`. Export `PLUGIN_PACKAGE_LIMITS` constant (Design §7.2: `maxZipBytes: 50MB, maxExtractedBytes: 250MB, maxFiles: 5000`). Export `PLUGIN_NAME_REGEX = /^[a-z][a-z0-9_-]*$/` and `PLUGIN_SEMVER_REGEX`. Export `resolvePluginRelativePath(pluginRoot, relativePath)` helper (Design §7.1) — throws on path escape.

- [ ] **Step 2: Typecheck**

Run: `yarn vue-check` (or `yarn tsc --noEmit`)
Expected: PASS (types only, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/entityTypes/pluginTypes.ts
git commit -m "feat(plugin): add plugin type definitions and path resolver"
```

### Task 1.2: InstalledPlugin entity

**Files:**
- Create: `src/entity/InstalledPlugin.entity.ts`

- [ ] **Step 1: Write entity**

Per Design §5.1. Columns: `id` (PK), `name` (text, unique index), `displayName?`, `version`, `source` (default `"local"`), `author?`, `description`, `installPath`, `manifestJson`, `permissionsJson` (default `"[]"`), `componentStateJson` (default `"{}"`), `enabled` (integer default 1), `health` (text default `"healthy"`), `lastLoadErrorsJson` (default `"[]"`). Extends `AuditableEntity`. Add `@Index(["enabled"])` and `@Index(["health"])`.

- [ ] **Step 2: Typecheck**

Run: `yarn vue-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/entity/InstalledPlugin.entity.ts
git commit -m "feat(plugin): add InstalledPlugin entity"
```

### Task 1.3: Ownership columns on InstalledSkill + MCPTool

**Files:**
- Modify: `src/entity/InstalledSkill.entity.ts`
- Modify: `src/entity/MCPTool.entity.ts`

- [ ] **Step 1: Add columns to InstalledSkillEntity**

```typescript
@Index()
@Column("text", { nullable: true })
pluginName?: string;

@Column("text", { nullable: true })
pluginComponentPath?: string;
```

- [ ] **Step 2: Add columns to MCPToolEntity**

Per Design §5.3. Add: `pluginName?` (indexed, nullable), `pluginComponentPath?`, `command?`, `argsJson?`, `envJson?`, `url?`, `origin` (text default `"manual"`). **Change `host` to nullable** (`{ nullable: true }`) so stdio plugin rows don't need a fake host.

- [ ] **Step 3: Typecheck**

Run: `yarn vue-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/entity/InstalledSkill.entity.ts src/entity/MCPTool.entity.ts
git commit -m "feat(plugin): add pluginName ownership + stdio columns to skill and MCP entities"
```

### Task 1.4: Register InstalledPluginEntity in SqliteDb

**Files:**
- Modify: `src/config/SqliteDb.ts`

- [ ] **Step 1: Add import + entity entry**

Import `InstalledPluginEntity` from `@/entity/InstalledPlugin.entity` and add it to the `entities: [...]` array (next to `InstalledSkillEntity`).

- [ ] **Step 2: Commit**

```bash
git add src/config/SqliteDb.ts
git commit -m "feat(plugin): register InstalledPluginEntity in SqliteDb"
```

### Task 1.5: InstalledPluginModel

**Files:**
- Create: `src/model/InstalledPlugin.model.ts`

- [ ] **Step 1: Write the failing test**

`test/modules/PluginManagementModule.test.ts` — but the model is a dependency of the module, so test via a thin direct model test first. Actually: place the model test inside `test/modules/PluginManagementModule.test.ts` covering model methods indirectly through the module (Task 1.6). For this task, just write the model following the `InstalledSkillModel` pattern (Design §6.1 methods: `findAll`, `findEnabled`, `findByName`, `create`, `updateByName`, `toggle`, `remove`).

- [ ] **Step 2: Implement InstalledPluginModel**

Mirror `InstalledSkill.model.ts`: extends `BaseDb`, lazy `getRepository()` via `ensureConnection()`. Implement all seven methods with explicit return types. `findEnabled` filters `enabled: 1`.

- [ ] **Step 3: Typecheck**

Run: `yarn vue-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/model/InstalledPlugin.model.ts
git commit -m "feat(plugin): add InstalledPluginModel with lazy repository"
```

### Task 1.6: PluginManagementModule

**Files:**
- Create: `src/modules/PluginManagementModule.ts`
- Test: `test/modules/PluginManagementModule.test.ts`

- [ ] **Step 1: Write the failing test**

`test/modules/PluginManagementModule.test.ts` (Mocha style matching `test/modules/`):

```typescript
import { expect } from "chai";
import { PluginManagementModule } from "@/modules/PluginManagementModule";

describe("PluginManagementModule", () => {
  it("creates and retrieves a plugin by name", async () => {
    const mod = new PluginManagementModule();
    const id = await mod.createPlugin({
      name: "test-plugin",
      version: "1.0.0",
      description: "test",
      installPath: "/tmp/test",
      manifestJson: "{}",
      source: "local",
    });
    expect(id).to.be.a("number");
    const found = await mod.getPluginByName("test-plugin");
    expect(found?.version).to.equal("1.0.0");
    await mod.uninstallPlugin("test-plugin");
  });

  it("toggles plugin enabled state", async () => {
    const mod = new PluginManagementModule();
    await mod.createPlugin({ name: "toggle-plugin", version: "1.0.0", description: "d", installPath: "/tmp", manifestJson: "{}", source: "local" });
    expect(await mod.togglePlugin("toggle-plugin", false)).to.equal(true);
    const disabled = await mod.getPluginByName("toggle-plugin");
    expect(disabled?.enabled).to.equal(0);
    await mod.uninstallPlugin("toggle-plugin");
  });

  it("returns null for unknown plugin", async () => {
    const mod = new PluginManagementModule();
    expect(await mod.getPluginByName("does-not-exist")).to.equal(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/modules/PluginManagementModule.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement PluginManagementModule**

Per Design §6.2. Extends `BaseModule`. Holds `InstalledPluginModel`. Methods: `listInstalledPlugins`, `listEnabledPlugins`, `getPluginByName`, `createPlugin`, `updatePluginState`, `togglePlugin`, `uninstallPlugin` (returns `{ removedPlugin, removedSkills, removedMcpServers }`; for now only deletes the plugin row + install path — coordination with skill/MCP modules happens in Phase 3 via the import service and in Phase 4 via loader), `setLoadErrors`, `updateComponentState`. No zip parsing, no code execution.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/modules/PluginManagementModule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/PluginManagementModule.ts test/modules/PluginManagementModule.test.ts
git commit -m "feat(plugin): add PluginManagementModule with CRUD and tests"
```

---

## Phase 2: Manifest and Archive Validation (Design §7.1, §7.2, §15.1, §15.2)

### Task 2.1: PluginManifestService

**Files:**
- Create: `src/service/PluginManifestService.ts`
- Test: `test/vitest/utilitycode/pluginManifestService.test.ts`

- [ ] **Step 1: Write the failing test**

Cover (Design §17.1 cases): valid manifest loads; `.aifetchly-plugin/plugin.json` preferred; missing manifest → `{ success: false, errors }`; invalid JSON → failure; invalid semver → failure; name regex violation → failure; path-escaping skill path → failure; description > 500 chars → failure; missing both `skills` and `mcpServers` → failure; unknown top-level fields allowed (ignored at runtime).

Use `fs` + `os.tmpdir()` to write fixtures in `beforeEach`. Assert `success: true` and `manifest.name` for the valid case.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vitest/utilitycode/pluginManifestService.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement PluginManifestService**

Per Design §7.1. Static methods `loadFromDirectory(pluginRoot)` and `validateManifest(manifest, pluginRoot)`. Return discriminated unions (`PluginManifestReadResult | PluginManifestFailure`). Apply all validation rules from Design §4.2 validation constraints. Use `resolvePluginRelativePath` from `pluginTypes.ts`. **Do not execute any plugin code, do not resolve network, do not run pip.** (Design §15.2)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/vitest/utilitycode/pluginManifestService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/PluginManifestService.ts test/vitest/utilitycode/pluginManifestService.test.ts
git commit -m "feat(plugin): add PluginManifestService with safe validation"
```

### Task 2.2: PluginArchiveService

**Files:**
- Create: `src/service/PluginArchiveService.ts`
- Test: `test/vitest/utilitycode/pluginArchiveService.test.ts`

- [ ] **Step 1: Write the failing test**

Cover (Design §17.1, §15.1): valid zip extracts to temp dir; zip with absolute path entry → failure; zip with `..` segment → failure (zip slip); symlink entry → rejection; zip over `maxZipBytes` → failure; zip with > `maxFiles` entries → failure; total extracted bytes over `maxExtractedBytes` → failure. Use `adm-zip` to construct adversarial fixtures programmatically. Verify `cleanup()` removes the temp dir.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vitest/utilitycode/pluginArchiveService.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement PluginArchiveService**

Per Design §7.2 + §15.1. Static `extractZip(zipPath): Promise<ExtractedPluginArchive>`. Use `adm-zip`. Reject absolute paths, `..` segments, symlinks, device files. Enforce `PLUGIN_PACKAGE_LIMITS`. Return `{ tempRoot, cleanup }`. `cleanup` is async, idempotent, swallows ENOENT.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/vitest/utilitycode/pluginArchiveService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/PluginArchiveService.ts test/vitest/utilitycode/pluginArchiveService.test.ts
git commit -m "feat(plugin): add PluginArchiveService with zip-slip and bomb protection"
```

---

## Phase 3: Import Service (Design §7.3, §8.1, §9.1, §15.5)

### Task 3.1: MCP declaration normalization helper

**Files:**
- Create: `src/service/PluginMcpDeclaration.ts` (extracted from import service for testability)

- [ ] **Step 1: Write the failing test**

`test/vitest/utilitycode/pluginMcpDeclaration.test.ts`: stdio with `command` → `transport` defaults to `"stdio"`; stdio missing `command` → failure; sse missing host AND url → failure; `args` not an array → failure; env placeholder `${user:NAME}` preserved in metadata; `command` with `..` → failure (must resolve inside plugin root).

- [ ] **Step 2: Implement**

Pure functions: `normalizeMcpDeclaration(key, decl, pluginRoot): { ok: true; normalized } | { ok: false; error }` and `parseServersJson(content): { ok } | { error }`. Apply Design §4.3 normalization rules.

- [ ] **Step 3: Run test, commit**

```bash
git add src/service/PluginMcpDeclaration.ts test/vitest/utilitycode/pluginMcpDeclaration.test.ts
git commit -m "feat(plugin): add MCP declaration parser and normalizer"
```

### Task 3.2: PluginImportService — happy path (skill-only plugin)

**Files:**
- Create: `src/service/PluginImportService.ts`
- Test: `test/vitest/utilitycode/pluginImportService.test.ts`
- Fixture: `test/fixtures/plugins/valid-skill-plugin/` (assembled into a zip at test runtime)

- [ ] **Step 1: Build fixture + write the failing test**

Test builds a plugin dir in `os.tmpdir()`:
```
.aifetchly-plugin/plugin.json   (name: "lead-tools", skills: ["skills/lead-enrichment/manifest.json"])
skills/lead-enrichment/manifest.json  (valid skill manifest)
skills/lead-enrichment/main.js
```
Zips it with `adm-zip`, calls `PluginImportService.importFromZip({ zipPath })`, asserts `{ success: true, plugin: { name: "lead-tools" } }`. Then asserts an `InstalledPlugin` row exists with `enabled=1`, and an `InstalledSkill` row exists with `pluginName="lead-tools"`. Calls `uninstallPlugin` in cleanup.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vitest/utilitycode/pluginImportService.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement PluginImportService.importFromZip**

Per Design §7.3 atomic sequence (steps 1–12) and rollback. Responsibilities:
1. Validate path string.
2. `PluginArchiveService.extractZip`.
3. `PluginManifestService.loadFromDirectory`.
4. For each skill path: re-use `SkillImportService.validateManifest` on the inner skill manifest (do NOT call full `importFromZip` — files live under plugin root per Design §20.2). Validate entry exists.
5. For each MCP path: `PluginMcpDeclaration.parseServersJson` + normalize.
6. Resolve install path: `userData/plugins/installed/<plugin-name>/`.
7. Copy temp → install path via a sibling temp dir, atomic rename.
8. `PluginManagementModule.createPlugin`.
9. For each skill: `SkillManagementModule.installSkill({ ..., pluginName, pluginComponentPath })`.
10. For each MCP server: `MCPToolModule.addMCPServer` with `pluginName`, `origin: "plugin"`, stdio command fields.
11. `PluginRuntimeCache.clear("import")`.
12. Return `{ success: true, plugin: summary }`.

Rollback (Design §7.3): if steps 8–10 fail, delete inserted rows + remove install path + cleanup temp.

Skill root under plugin install path (Design §8.1): `userData/plugins/installed/<plugin>/skills/<skill>/`. Add a helper `getPluginInstallRoot(pluginName)` and `getPluginOwnedSkillRoot(pluginName, skillName)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/vitest/utilitycode/pluginImportService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/PluginImportService.ts test/vitest/utilitycode/pluginImportService.test.ts test/fixtures/plugins/
git commit -m "feat(plugin): add PluginImportService with atomic install and rollback"
```

### Task 3.3: Import rollback + conflict tests

**Files:**
- Modify: `test/vitest/utilitycode/pluginImportService.test.ts`

- [ ] **Step 1: Add cases**

- Duplicate plugin name without `overwrite` → `{ success: false, errors: [{ code: "plugin-name-conflict" }] }`.
- Broken skill component (skill manifest missing `entry` file) → failure, and rollback removes any partial plugin row.
- Path-traversal plugin (skill path `../escape`) → failure with `path-outside-plugin`.

- [ ] **Step 2: Run, commit**

```bash
git add test/vitest/utilitycode/pluginImportService.test.ts src/service/PluginImportService.ts
git commit -m "test(plugin): cover rollback, name conflicts, path traversal"
```

### Task 3.4: SkillEnvironmentManager plugin-owned root support

**Files:**
- Modify: `src/service/SkillEnvironmentManager.ts`

- [ ] **Step 1: Add resolution branch**

When resolving a skill root for a `SkillEntity` with `pluginName != null`, resolve against `getPluginOwnedSkillRoot(pluginName, skillName)` instead of `userData/installed_skills/<name>/`. Add `resolveSkillRoot(skill: InstalledSkillEntity): string`. Export `getPluginOwnedSkillRoot` from a new `src/service/pluginPaths.ts` (shared with import service and loader).

- [ ] **Step 2: Update `loadPersistedSkills` in SkillImportService.ts**

Use `resolveSkillRoot(skill)` instead of `path.join(getInstalledSkillsDir(), skill.name)`.

- [ ] **Step 3: Commit**

```bash
git add src/service/SkillEnvironmentManager.ts src/service/SkillImportService.ts src/service/pluginPaths.ts
git commit -m "feat(plugin): resolve plugin-owned skill roots via SkillEnvironmentManager"
```

---

## Phase 4: Loader and Runtime Registry (Design §7.4, §7.5, §8.3, §9.4, §13)

### Task 4.1: PluginLoaderService

**Files:**
- Create: `src/service/PluginLoaderService.ts`
- Test: `test/vitest/utilitycode/pluginLoaderService.test.ts`

- [ ] **Step 1: Write the failing test**

Seed: install two plugins via `PluginImportService` in test setup (one enabled, one disabled). One plugin has a skill whose install dir was deleted post-install (simulates `missing_files`). Call `PluginLoaderService.loadAllPlugins()`. Assert: `enabled` list contains the enabled plugin with its skill loaded; `disabled` list contains the disabled plugin; `errors` contains a `missing_files` entry for the broken plugin. Call again → assert cache hit (same object identity or a `loadedAt` timestamp unchanged).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vitest/utilitycode/pluginLoaderService.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement PluginLoaderService**

Per Design §7.4. Static `loadAllPlugins(): Promise<PluginLoadResult>`. Memoize. For each installed plugin: verify `installPath` exists, reload manifest via `PluginManifestService`, attach skills (read each skill's manifest from disk) and MCP server declarations, collect errors with `recoverable` flag. `clearCache(reason)` invalidates. Split enabled vs disabled by `enabled === 1`.

- [ ] **Step 4: Run test, commit**

```bash
git add src/service/PluginLoaderService.ts test/vitest/utilitycode/pluginLoaderService.test.ts
git commit -m "feat(plugin): add PluginLoaderService with memoization and error collection"
```

### Task 4.2: PluginRuntimeCache

**Files:**
- Create: `src/service/PluginRuntimeCache.ts`

- [ ] **Step 1: Implement**

Per Design §13.2. `PluginRuntimeCache.clear(reason)` calls `PluginLoaderService.clearCache(reason)` and, if they expose cache-clear APIs (check at call time via `typeof ... === "function"`), `SkillRegistry.clearDynamicCache?.(reason)` and `MCPToolService.clearCache?.(reason)`. Do not invent fake APIs — only call what exists (Design §13.2 last paragraph). Add `SkillRegistry.clearDynamicCache` only if a dynamic cache is found.

- [ ] **Step 2: Commit**

```bash
git add src/service/PluginRuntimeCache.ts
git commit -m "feat(plugin): add PluginRuntimeCache invalidation hub"
```

### Task 4.3: Effective-enablement filters

**Files:**
- Modify: `src/config/skillsRegistry.ts`
- Modify: `src/service/MCPToolService.ts`

- [ ] **Step 1: Skills — plugin-state filter**

Where `skillsRegistry.ts` enumerates enabled skills for the AI tool catalog, add a filter: for any `InstalledSkillEntity` with `pluginName != null`, also require the owning plugin's `enabled === 1`. Implement via `PluginManagementModule.listEnabledPlugins()` → `Set<pluginName>` once per catalog build. Skip plugin-owned skills whose owner isn't in the set.

- [ ] **Step 2: MCP — plugin-state filter + stdio client build**

In `MCPToolService.getEnabledMCPTools()` (or equivalent tool-catalog path), apply the same plugin-state filter. In `MCPToolService.discoverTools(serverId)` / `MCPClient` build path: if `origin === "plugin"` and `command` is set, build the client from `command`/`argsJson`/`envJson` (stdio) instead of `host`/`port`. Resolve `${user:NAME}` env placeholders from existing secure token storage at connect time (prompt-on-first-use deferred to Phase 6 UI; v1 backend resolves from stored values or fails with `needs_configuration`).

- [ ] **Step 3: Tests**

Add cases to existing skills/MCP test files (or new ones under `test/vitest/utilitycode/`): disabled plugin → its skills/MCP tools absent from catalog; enabled plugin → present; standalone skill (pluginName null) unaffected.

- [ ] **Step 4: Run, commit**

```bash
git add src/config/skillsRegistry.ts src/service/MCPToolService.ts
git commit -m "feat(plugin): compute effective enablement for plugin-owned skills and MCP tools"
```

### Task 4.4: PluginComponentRegistryService

**Files:**
- Create: `src/service/PluginComponentRegistryService.ts`
- Test: `test/vitest/utilitycode/pluginComponentRegistryService.test.ts`

- [ ] **Step 1: Implement + test**

Per Design §7.5. Static `applyLoadedPlugins(loadResult)` and `unregisterPluginCapabilities(pluginName)`. For enabled plugins: register plugin-owned skills into `SkillRegistry` (reusing the registration helpers extracted from `SkillImportService` — refactor `registerImportedSkill` into an exported function if needed). Ensure plugin-owned MCP server rows are enabled in the catalog. For disabled plugins: unregister their skills from `SkillRegistry` (add `SkillRegistry.unregisterSkill(name)` if missing) and exclude their MCP tools. Boundary: this service never executes skill code itself (execution is the registry's job) and never spawns MCP processes directly (that's `MCPClient`'s job).

- [ ] **Step 2: Run, commit**

```bash
git add src/service/PluginComponentRegistryService.ts test/vitest/utilitycode/pluginComponentRegistryService.test.ts
git commit -m "feat(plugin): add PluginComponentRegistryService for dynamic registration"
```

### Task 4.5: PluginDiagnosticsService

**Files:**
- Create: `src/service/PluginDiagnosticsService.ts`

- [ ] **Step 1: Implement**

Per Design §7.6. `buildBundle(pluginName): PluginDiagnosticsBundle`. Convert errors to UI-safe text, redact obvious secret patterns (`/api[_-]?key/i`, bearer tokens, password fields), produce summary + skills + mcpServers diagnostic arrays. Pure data shaping — no side effects.

- [ ] **Step 2: Commit**

```bash
git add src/service/PluginDiagnosticsService.ts
git commit -m "feat(plugin): add PluginDiagnosticsService with secret redaction"
```

---

## Phase 5: IPC (Design §10, §10.1, §10.2)

### Task 5.1: PLUGIN_* channels

**Files:**
- Modify: `src/config/channellist.ts`

- [ ] **Step 1: Add channels**

Per Design §10: `PLUGIN_IMPORT`, `PLUGIN_VALIDATE_PACKAGE`, `PLUGIN_LIST`, `PLUGIN_GET`, `PLUGIN_TOGGLE`, `PLUGIN_UNINSTALL`, `PLUGIN_RELOAD`, `PLUGIN_EXPORT_DIAGNOSTICS`, `PLUGIN_TOGGLE_SKILL`, `PLUGIN_TOGGLE_MCP_SERVER`, `PLUGIN_TOGGLE_MCP_TOOL`, `PLUGIN_TEST_MCP_CONNECTION`, `PLUGIN_DISCOVER_MCP_TOOLS`.

- [ ] **Step 2: Commit**

```bash
git add src/config/channellist.ts
git commit -m "feat(plugin): add PLUGIN IPC channels"
```

### Task 5.2: plugin-ipc handlers

**Files:**
- Create: `src/main-process/communication/plugin-ipc.ts`
- Modify: `src/main-process/communication/index.ts`
- Test: `test/vitest/main/plugin-ipc.test.ts`

- [ ] **Step 1: Write the failing test (shape + AI-enable gate)**

Mock `ipcMain.handle`. For each channel, register and invoke with a fake event + payload. Assert: (a) when `USER_AI_ENABLED !== "true"`, every handler returns `{ status: false, msg: "...not enabled...", data: null }` without calling any service; (b) `PLUGIN_LIST` returns `{ status: true, data: [...] }`; (c) `PLUGIN_IMPORT` validates the path string is non-empty and rejects paths containing `..`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vitest/main/plugin-ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement plugin-ipc.ts**

`registerPluginIpcHandlers(): void`. Each handler:
1. Calls a local `checkAiEnabled()` helper that constructs `new Token()`, reads `USER_AI_ENABLED`, returns the not-enabled response envelope or `null`.
2. Validates payload shape (reject non-strings, empty strings, path-traversal strings). No `any`.
3. Delegates to `PluginManagementModule`, `PluginImportService`, `PluginLoaderService`, `PluginDiagnosticsService`, `SkillManagementModule`, `MCPToolService` as appropriate.
4. Wraps unexpected errors into `{ status: false, msg, data: null }`.

Register in `index.ts` next to the other `register*IpcHandlers()` calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/vitest/main/plugin-ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main-process/communication/plugin-ipc.ts src/main-process/communication/index.ts test/vitest/main/plugin-ipc.test.ts
git commit -m "feat(plugin): register plugin IPC handlers with AI-enable gating"
```

---

## Phase 6: Renderer UI (Design §11, §12)

### Task 6.1: Frontend API

**Files:**
- Create: `src/views/api/plugins.ts`

- [ ] **Step 1: Implement**

Types per Design §11.2 (`PluginSummary`, `PluginDetail`). Functions: `listPlugins`, `getPlugin`, `importPlugin`, `validatePluginPackage`, `togglePlugin`, `uninstallPlugin`, `exportPluginDiagnostics`, `togglePluginSkill`, `togglePluginMcpServer`, `togglePluginMcpTool`, `testPluginMcpConnection`, `discoverPluginMcpTools`, `reloadPlugins`. Each `window.electron.ipcRenderer.invoke(CHANNEL, payload)`.

- [ ] **Step 2: Commit**

```bash
git add src/views/api/plugins.ts
git commit -m "feat(plugin): add renderer API client"
```

### Task 6.2: Router + i18n

**Files:**
- Modify: `src/views/router/index.ts`
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- [ ] **Step 1: Add route**

Per Design §12.1, add `system_setting_plugins` under the system settings parent, lazy-importing `plugins.vue`.

- [ ] **Step 2: Add translations**

Add the `plugins.*` namespace keys listed in Design §12.2 to **all six** language files. English is source; translate to zh/es/fr/de/ja. Required by project CLAUDE.md i18n rule.

- [ ] **Step 3: Typecheck**

Run: `yarn vue-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/views/router/index.ts src/views/lang/
git commit -m "feat(plugin): add plugins route and i18n for all six languages"
```

### Task 6.3: Plugin page + manager component

**Files:**
- Create: `src/views/pages/systemsetting/plugins.vue`
- Create: `src/views/components/plugins/PluginManager.vue`
- Create: `src/views/components/plugins/PluginImportDialog.vue`

- [ ] **Step 1: Implement page + manager**

Per Design §11.3. Page is a settings tool surface with toolbar (search, filters, Import button) and a main region (plugin table + selected-plugin detail panel). Use Vuetify components consistent with `skills.vue`/`mcp.vue`. Import dialog uses the existing file-open flow (`CHOOSEFILEDIALOG` channel) to pick a `.zip`, calls `validatePluginPackage` for preview, then `importPlugin`.

- [ ] **Step 2: Implement import dialog**

Two-step UI: (1) pick zip → preview validation result; (2) confirm install. Surface validation errors as a list.

- [ ] **Step 3: Manual smoke**

Run: `yarn dev` → System Settings → Plugins. Verify empty state renders.

- [ ] **Step 4: Commit**

```bash
git add src/views/pages/systemsetting/plugins.vue src/views/components/plugins/PluginManager.vue src/views/components/plugins/PluginImportDialog.vue
git commit -m "feat(plugin): add plugins page, manager, and import dialog"
```

### Task 6.4: Detail panel + tabs

**Files:**
- Create: `src/views/components/plugins/PluginDetailPanel.vue`
- Create: `src/views/components/plugins/PluginOverviewTab.vue`
- Create: `src/views/components/plugins/PluginSkillsTab.vue`
- Create: `src/views/components/plugins/PluginMcpServersTab.vue`
- Create: `src/views/components/plugins/PluginPermissionsTab.vue`
- Create: `src/views/components/plugins/PluginDiagnosticsTab.vue`
- Create: `src/views/components/plugins/PluginManifestTab.vue`

- [ ] **Step 1: Implement tabs**

Per Design §11.3 detail tabs. Each tab consumes a slice of `PluginDetail`. Skills tab: per-skill enable toggles calling `togglePluginSkill`. MCP tab: per-server enable toggles + per-tool enable toggles + Discover/Test Connection actions + `${user:NAME}` secret prompt-on-first-use (Phase 6 minimal: prompt for value, store via existing secure token storage, never display plaintext after save). Permissions tab: read-only list. Diagnostics tab: read-only + Export button calling `exportPluginDiagnostics`. Manifest tab: read-only JSON viewer.

- [ ] **Step 2: Commit**

```bash
git add src/views/components/plugins/
git commit -m "feat(plugin): add detail panel with overview/skills/mcp/permissions/diagnostics/manifest tabs"
```

### Task 6.5: Ownership labels on existing pages

**Files:**
- Modify: `src/views/pages/systemsetting/skills.vue`
- Modify: `src/views/pages/systemsetting/mcp.vue`

- [ ] **Step 1: Show owner**

When a skill/MCP row has `pluginName`, show a "via plugin: {pluginName}" chip. Disable destructive standalone actions on plugin-owned rows; route the user to the Plugins page for uninstall. (Design §11.4.)

- [ ] **Step 2: Commit**

```bash
git add src/views/pages/systemsetting/skills.vue src/views/pages/systemsetting/mcp.vue
git commit -m "feat(plugin): surface plugin ownership on Skills and MCP pages"
```

---

## Phase 7: Hardening (Design §15, §17.1, §17.2)

### Task 7.1: Security edge tests

**Files:**
- Modify: `test/vitest/utilitycode/pluginArchiveService.test.ts`
- Modify: `test/vitest/utilitycode/pluginImportService.test.ts`
- Add fixture zips: `test/fixtures/plugins/{missing-manifest,invalid-manifest-json,path-traversal,broken-skill-component,broken-mcp-component}.zip`

- [ ] **Step 1: Add cases**

Zip with symlink entry → archive service rejects. Import with zip-slip entry → import service returns `path-outside-plugin`. Import with zip bomb (over `maxExtractedBytes`) → rejected. Import where MCP `command` is an absolute path → rejected. Import where MCP env value contains literal secret (not `${user:...}`) → import still succeeds but diagnostics redacts it (covered in Task 7.2).

- [ ] **Step 2: Run, commit**

```bash
git add test/vitest/utilitycode/ test/fixtures/plugins/
git commit -m "test(plugin): add security edge cases for archive and import"
```

### Task 7.2: Diagnostics redaction test

**Files:**
- Create: `test/vitest/utilitycode/pluginDiagnosticsService.test.ts`

- [ ] **Step 1: Add cases**

Feed a `PluginError`/manifest/env bundle containing `api_key=sk-xxxx`, `Authorization: Bearer yyyy`, `password: hunter2`. Assert output string contains `"[redacted]"` and none of the literal secrets.

- [ ] **Step 2: Run, commit**

```bash
git add test/vitest/utilitycode/pluginDiagnosticsService.test.ts
git commit -m "test(plugin): verify diagnostics secret redaction"
```

### Task 7.3: End-to-end verification checklist (manual)

- [ ] `yarn test` — all Mocha tests green
- [ ] `yarn testmain` — all main-process vitest tests green
- [ ] `yarn vue-check` — typecheck green
- [ ] `yarn dev` → System Settings → Plugins:
  - Import a valid combined (skill + MCP stdio) plugin → appears enabled.
  - Disable the plugin → its skill disappears from AI tool list, its MCP tools disappear from catalog.
  - Re-enable → preferences preserved, tools reappear.
  - Open detail → Skills/MCP/Permissions/Diagnostics/Manifest tabs render.
  - Discover MCP tools → tool list populates.
  - Uninstall → plugin row + owned skill + MCP rows removed; install dir gone.

### Task 7.4: Done-criteria sign-off

Cross-check against Design §21 before declaring complete.

---

## Self-Review Notes

**Spec coverage:** every Design section maps to a task — §4–5 (Phase 1), §7.1–7.2 (Phase 2), §7.3/§8.1/§9.1 (Phase 3), §7.4–7.6/§8.3/§9.4/§13 (Phase 4), §10 (Phase 5), §11–12 (Phase 6), §15/§17 (Phase 7). §16 migration is automatic via `synchronize: true` (Task 1.4 registration).

**Open decisions deferred to implementation:** the exact exported shape of `SkillRegistry.unregisterSkill` (may need adding) and whether `MCPToolService` exposes a cache-clear API (Task 4.2 guards with optional chaining).

**Type consistency:** `PluginError.code` uses the `PluginErrorCode` union everywhere; `LoadedPlugin`/`PluginSummary` field names match the Design §7.4/§11.2 contracts.
