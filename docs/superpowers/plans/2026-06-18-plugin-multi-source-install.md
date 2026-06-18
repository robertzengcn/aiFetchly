# Plugin Multi-Source Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users install plugins from local-zip, local-folder, git, github, npm, and url sources through a single new IPC channel and a new install dialog, reusing the existing validation/persistence/rollback pipeline.

**Architecture:** Introduce a `PluginSourceFetcher` interface. Each fetcher acquires plugin contents into a local directory; the refactored `PluginImportService.installFromLocalRoot` then runs the existing manifest→skill→MCP→persist pipeline. New `PluginInstallService` orchestrates fetcher selection, size/time limits, and secret redaction. New entity columns record provenance.

**Tech Stack:** TypeScript 5.x, TypeORM/SQLite, Electron IPC, Vue 3 + Vuetify, Vitest (utility code + main), Mocha (modules).

**Spec:** `docs/superpowers/specs/2026-06-18-plugin-multi-source-install-design.md`

---

## File Structure

**New files (src):**
- `src/service/pluginSources/pluginSourceTypes.ts`
- `src/service/pluginSources/pluginSourceLimits.ts`
- `src/service/pluginSources/pluginSourceRedact.ts`
- `src/service/pluginSources/LocalZipPluginFetcher.ts`
- `src/service/pluginSources/LocalFolderPluginFetcher.ts`
- `src/service/pluginSources/GitPluginFetcher.ts`
- `src/service/pluginSources/GitHubPluginFetcher.ts`
- `src/service/pluginSources/NpmPluginFetcher.ts`
- `src/service/pluginSources/UrlPluginFetcher.ts`
- `src/service/pluginSources/PluginSourceRegistry.ts`
- `src/service/PluginInstallService.ts`

**Modified files (src):**
- `src/entityTypes/pluginTypes.ts` — `PluginSourceKind`, provenance input fields.
- `src/entity/InstalledPlugin.entity.ts` — `sourceKind`, `sourceUri`, `sourceRef`, `sourceMetaJson`.
- `src/service/PluginImportService.ts` — extract `installFromLocalRoot`.
- `src/config/channellist.ts` — `PLUGIN_INSTALL_FROM_SOURCE`.
- `src/main-process/communication/plugin-ipc.ts` — new handler; provenance in `PLUGIN_GET`.
- `src/views/api/plugins.ts` — types + `installPluginFromSource`.
- `src/views/components/plugins/PluginInstallSourceDialog.vue` — new.
- `src/views/components/plugins/PluginManager.vue` — toolbar entry.
- `src/views/components/plugins/PluginOverviewTab.vue` — provenance readout.
- `src/views/lang/{en,zh,es,fr,de,ja}.ts`.

**New test files (test/vitest/utilitycode, test/vitest/main):** one per fetcher, registry, install service, IPC additions.

---

## Task 1: Provenance types

- [ ] Add `PluginSourceKind` union and `PluginSourceProvenance` interface plus optional provenance fields on `CreateInstalledPluginInput` in `src/entityTypes/pluginTypes.ts`.
- [ ] `yarn tsc-result` — no new errors.
- [ ] Commit `feat(plugin): add PluginSourceKind and provenance types`.

## Task 2: Entity columns

- [ ] Add `sourceKind`, `sourceUri`, `sourceRef`, `sourceMetaJson` columns to `InstalledPluginEntity` (with `@Order(14-17)`).
- [ ] `yarn test test/modules/PluginManagementModule.test.ts` — existing tests still pass.
- [ ] Commit `feat(plugin): record install provenance on InstalledPlugin row`.

## Task 3: Redaction helper (TDD)

- [ ] Write `test/vitest/utilitycode/pluginSourceRedact.test.ts` covering query-string strip, basic-auth strip, `_authToken=` redaction, `Authorization: Bearer` redaction.
- [ ] Run vitest, expect FAIL.
- [ ] Implement `src/service/pluginSources/pluginSourceRedact.ts` with `redactUri()` and `redactMessage()`.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add provenance secret redaction helper with tests`.

## Task 4: Directory limits helper (TDD)

- [ ] Write `test/vitest/utilitycode/pluginSourceLimits.test.ts` covering small-tree pass, file-count overflow, size overflow.
- [ ] Run vitest, expect FAIL.
- [ ] Implement `src/service/pluginSources/pluginSourceLimits.ts` with `applyDirectoryLimits()` (walks tree, enforces `PLUGIN_PACKAGE_LIMITS`).
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add directory size/file limit helper for fetchers`.

## Task 5: Source contracts + registry (TDD)

- [ ] Create `src/service/pluginSources/pluginSourceTypes.ts` exporting `PluginSourceRequest`, `FetchedPluginSource`, `PluginAcquireResult`, `PluginSourceFetcher`, `err()` helper.
- [ ] Write `test/vitest/utilitycode/pluginSourceRegistry.test.ts` covering register/get and missing-kind throw.
- [ ] Implement `src/service/pluginSources/PluginSourceRegistry.ts`.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add source fetcher contracts and registry`.

## Task 6: Refactor PluginImportService

- [ ] Move steps 3–12 of `importFromZip` into `public static async installFromLocalRoot(localRoot, opts: { overwrite?, provenance? })`. Persist `sourceKind/sourceUri/sourceRef/sourceMetaJson` on the plugin row.
- [ ] Make `importFromZip` extract + delegate to `installFromLocalRoot` with `provenance: { sourceKind: "local-zip" }`.
- [ ] Run `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginImportService.test.ts` — existing tests still pass.
- [ ] Commit `refactor(plugin): extract installFromLocalRoot for multi-source reuse`.

## Task 7: LocalFolderPluginFetcher (TDD)

- [ ] Write tests: accepts real folder, rejects missing, rejects folder inside `getPluginsRoot()`.
- [ ] Implement with directory existence check, plugins-root escape check, limits check, no-op cleanup.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add LocalFolderPluginFetcher`.

## Task 8: LocalZipPluginFetcher (TDD)

- [ ] Write tests: extracts a valid zip (via `AdmZip`), rejects missing path.
- [ ] Implement wrapping `PluginArchiveService.extractZip`.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add LocalZipPluginFetcher wrapping existing archive service`.

## Task 9: GitPluginFetcher (TDD, spawn-injectable)

- [ ] Write tests: rejects `http://`, rejects `file://`/local paths, builds argv containing `--depth 1 --branch <ref>`, fails on non-zero exit, suppresses stderr.
- [ ] Implement with constructor-injected `spawnFn` (default real `child_process.spawn`, `shell: false`), 60s timeout, single-subdir unwrap, size limits, `redactUri` on errors.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add GitPluginFetcher with shallow clone + size limits`.

## Task 10: GitHubPluginFetcher (TDD)

- [ ] Write tests for `classifyGitHubUrl`: repo, release asset, releases/latest, unknown.
- [ ] Implement classifier + fetcher delegating repo URLs to `GitPluginFetcher`, asset/latest URLs to HTTPS download (size-capped, redirect-following) → `LocalZipPluginFetcher`.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add GitHubPluginFetcher with URL classifier`.

## Task 11: NpmPluginFetcher (TDD)

- [ ] Write tests for `buildNpmArgs` (must include `--ignore-scripts`, optional `--registry=`) and missing-package rejection.
- [ ] Implement using `npm pack --ignore-scripts --json` with auth token written to a 0600 `.npmrc` (never on CLI), extract via `tar.x` (fallback `spawn('tar', ['-xzf', tgz])`), `applyDirectoryLimits`.
- [ ] `yarn add tar && yarn add -D @types/tar` (fallback to child-process `tar` if install blocked).
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add NpmPluginFetcher with --ignore-scripts and .npmrc token`.

## Task 12: UrlPluginFetcher (TDD)

- [ ] Write tests for `classifyUrlKind`: `.zip`/`.git`/`git@`/`github.com`/`http:// rejected`/unknown.
- [ ] Implement dispatcher delegating to git/github/zip-download as classified.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add UrlPluginFetcher dispatcher`.

## Task 13: PluginInstallService orchestrator (TDD)

- [ ] Write tests with a stub fetcher and a fake `installFromLocalRoot` callback (dependency-injected): success path calls install with provenance; failure path returns errors without calling install.
- [ ] Implement with constructor `(registry, installFromLocalRootFn)`, default registry wires all six fetchers, default install fn delegates to `PluginImportService.installFromLocalRoot`, errors pass through `redactMessage`, `cleanup()` always called in `finally`.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add PluginInstallService orchestrator`.

## Task 14: IPC channel + handler

- [ ] Add `PLUGIN_INSTALL_FROM_SOURCE = "plugin:install-from-source"` to `src/config/channellist.ts`.
- [ ] Register handler in `plugin-ipc.ts`: AI-enable gate, `kind` whitelist, CRLF/control-char rejection on all string fields, then call `new PluginInstallService().installFromSource(...)`. Surface provenance on `PLUGIN_GET` (extend `PluginDetail`).
- [ ] Extend `test/vitest/main/plugin-ipc.test.ts` with an invalid-kind rejection test.
- [ ] Run vitest, expect PASS.
- [ ] Commit `feat(plugin): add plugin:install-from-source IPC with validation`.

## Task 15: Frontend API + types

- [ ] In `src/views/api/plugins.ts`: add `PluginSourceKind`, `PluginInstallSourceRequest`, `installPluginFromSource()`, and `sourceKind/sourceUri/sourceRef` on `PluginDetail`.
- [ ] Commit `feat(plugin): renderer API for install-from-source`.

## Task 16: Install source dialog (UI)

- [ ] Create `src/views/components/plugins/PluginInstallSourceDialog.vue`: source-kind selector + per-kind fields (file pickers for zip/folder; text inputs for git/github/npm/url; password input for npm token).
- [ ] Wire toolbar button + dialog in `PluginManager.vue`.
- [ ] Commit `feat(plugin): add install-from-source dialog and toolbar entry`.

## Task 17: Provenance in detail panel

- [ ] Extend `PluginOverviewTab.vue` to show `sourceKind · sourceUri · sourceRef` when present.
- [ ] Commit `feat(plugin): show provenance in overview tab`.

## Task 18: i18n (en/zh/es/fr/de/ja)

- [ ] Add `plugins.install_source.*` keys to all six language files.
- [ ] `yarn vue-check` — no errors.
- [ ] Commit `feat(plugin): i18n for install-from-source (en/zh/es/fr/de/ja)`.

## Task 19: Integration test + final checks

- [ ] Add a happy-path integration test in `test/vitest/utilitycode/pluginInstallService.test.ts` exercising a fixture local folder end-to-end through the real `installFromLocalRoot` (mock the Module/DB layer if needed).
- [ ] Run all plugin tests: utilitycode vitest, main vitest, PluginManagementModule mocha.
- [ ] `yarn vue-check && yarn tsc-result` — no errors.
- [ ] Commit `test(plugin): add end-to-end integration test for folder-source install`.
