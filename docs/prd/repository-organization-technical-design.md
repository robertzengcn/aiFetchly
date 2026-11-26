# Repository Root Organization — Technical Design

| Field | Value |
| --- | --- |
| Status | Proposed |
| Version | 1.0 |
| Date | 2026-11-23 |
| Baseline | Repository snapshot at `991a3dfcc` |
| Requirements | [Repository Root Organization — Product Requirements](./repository-organization-prd.md) |

## 1. Design decisions

Use the existing `config/` directory for build infrastructure, with explicit Vite paths grouped by purpose. Keep the current config basenames in the first migration. The files already identify worker and test targets by name, so preserving basenames makes review and follow-up searches easier.

| Approach | Trade-off |
| --- | --- |
| Move the worker configs only | Smallest build change. E2E overlays, test-only configs, and helpers would still be spread between the root and `config/vite/`. |
| Group internal configs by purpose and keep the desktop entry configs in the root | Recommended. The common entry points stay visible and all internal Vite inputs have a predictable home. This requires coordinated changes to scripts, tests, and release inputs. |
| Generate worker configs from a shared factory at the same time | Could reduce boilerplate, but combines the path move with changes to how worker-specific adapters, externals, and aliases are composed. Reassess after the path migration has landed. |

### Proposed layout

```text
aiFetchly/
├── AGENTS.md
├── README.md
├── README.zh.md
├── package.json
├── yarn.lock
├── forge.config.js
├── index.html
├── vite.main.config.mjs
├── vite.preload.config.mjs
├── vite.render.config.mjs
├── playwright.config.ts
├── config/
│   ├── installer-size-baseline.json
│   ├── native-dependency-policy.json
│   └── vite/
│       ├── workers/
│       ├── e2e/
│       ├── test/
│       ├── shared/
│       └── plugins/
├── docs/
│   ├── README.md
│   ├── plans/
│   └── prd/
├── scripts/
├── src/
│   ├── config/
│   └── childprocess/
└── test/
```

The tree highlights paths affected by the design. The existing root project manifest, lockfile, editor and tool discovery files, installer assets, browser extension, native host, and agent harness keep their current interfaces and boundaries.

## 2. Phase A — scratch files and generated output

| Current path | Proposed disposition | Verification before making the change |
| --- | --- | --- |
| `forge.config.js_backup` | Retire the tracked backup and use Git history for point-in-time copies | Compare against active Forge configuration. Record any unique setting worth retaining and where the active behavior is defined. |
| `test.json` | Retire unused captured data. If referenced as a fixture, keep the minimal useful sample under `test/fixtures/<feature>/` with a descriptive name. | Search tracked source, test, and tooling references. The current file fails strict JSON parsing, so check the consuming format before naming or converting it. The `src/config/puppeteerconfig.ts` reference is to `/tmp/test/test.json`. |
| `test-vectra.js` | Retire if obsolete, or move a supported reproduction to `scripts/diagnostics/` | Confirm the owner, intended invocation, dependency availability, and output location. Keep dependencies and application paths consistent with the current implementation. |
| `single-marketjs.code-workspace` | Retire the redundant workspace file | Verify the root opens directly and search editor launch instructions for consumers. Its current content contains one folder at `.` and an empty `settings` object. |
| `*.timestamp-*.mjs` | Use the existing ignore rule and remove stale tree entries from project guidance | Check the tracked index and `git check-ignore`. If a local timestamp file remains from a previous run, confirm it belongs to a completed build before cleaning it up. |
| Generated test and build output | Keep existing output paths and ignore rules | Inspect `.vite/`, `.test-userData/`, `test-results/`, and `dist/` through Git status and ignore checks. `build/` contains tracked macOS entitlements and is a build input. |

Use an anchored `/.local/` ignore entry if the repository adopts a dedicated developer scratch directory. Use `.git/info/exclude` for individual editor preferences and periodically verify that committed fixtures remain trackable. Check tracked state separately from ignore rules, since a tracked file stays in the index after an ignore rule is added. [Ignore rules](../../.gitignore) · [Cursor Electron rules](../../.cursor/rules/electron-rules.mdc)

## 3. Phase B — build configuration migration

### 3.1 File map

Every filename in this table starts at the repository root in the baseline. Destination directories preserve the filename unless the disposition says to retire it.

| Destination | Current files |
| --- | --- |
| Root | `vite.main.config.mjs`, `vite.preload.config.mjs`, `vite.render.config.mjs` |
| `config/vite/workers/` | `vite.taskCode.config.mjs`, `vite.websiteContentScraper.config.mjs`, `vite.googleProxyCheck.config.mjs`, `vite.skillWorker.config.mjs`, `vite.groundingWorker.config.mjs`, `vite.managedBrowserWorker.config.mjs`, `vite.managedBrowserCacheWorker.config.mjs`, `vite.pythonRuntimeWorker.config.mjs`, `vite.contactExtractionWorker.config.mjs` |
| `config/vite/workers/` | `vite.aifetchlyConfigWorker.config.mjs`, `vite.hookExecutionWorker.config.mjs`, `vite.skillInstallationWorker.config.mjs`, `vite.googleMapsWorker.config.mjs`, `vite.yandexMapsWorker.config.mjs`, `vite.localEmbeddingWorker.config.mjs`, `vite.aiChatVoiceWorker.config.mjs`, `vite.runtimeProbeWorker.config.mjs` |
| `config/vite/workers/` or retire | `vite.buckEmail.config.mjs`. Its Forge registration is commented out. Check direct CLI, task, and runbook use. Record the owner and invocation if it remains, or remove the stale registration and config together. |
| `config/vite/e2e/` | `vite.e2e.main.config.mjs`, `vite.e2e.preload.config.mjs`, `vite.e2e.taskCode.config.mjs`, `vite.e2e.managedBrowserWorker.config.mjs`, `vite.e2e.aiChatVoiceWorker.config.mjs`, `vite.e2e.workspaceConfigWatchWorker.config.mjs` |
| `config/vite/test/` | `vite.utilityCode.config.mjs`, `vite.utilityCode.ci.config.mjs`, `vitest.service.config.mjs` |
| `config/vite/shared/` | `vite-checker-toggle.mjs`, `vite.main.shared.mjs`, `vite.workerSsrNoExternal.mjs`, plus a small ESM project-root helper if multiple moved modules need it |
| `config/vite/plugins/` | `vite-plugin-close.ts`, `vite-plugin-renderer-node-guard.ts` |

`vite.taskCode.config.mjs` belongs with the workers because Forge builds it and E2E reuses it. The existing Vitest task-code callers must follow that path too. New worker entry points follow the repository convention under `src/childprocess/`. This migration preserves the existing `src/taskCode.ts` entry and the `src/childprocess/` entries already registered with Forge. [Forge registrations](../../forge.config.js) · [Yarn scripts](../../package.json) · [E2E build script](../../scripts/build-electron-e2e.mjs)

### 3.2 Path resolution and build invariants

1. **Capture the baseline.** Record each active Forge `entry` and config path, renderer name, each direct CLI target, E2E target order, and the required artifacts and adjacent resources emitted by each build lane. Use the same dependency versions and platform when comparing baseline and candidate output.
2. **Separate config-relative imports from repository-relative paths.** Resolve config imports relative to their containing file. For repo paths formerly derived from a root-level `__dirname` or `import.meta.url`, resolve from an explicit project root. A helper inside `config/vite/shared/` can derive the root by resolving `../../../` against its own `import.meta.url` and converting the file URL to a native path. Have `vite.main.shared.mjs` use that root after relocation. Audit aliases, plugin-read files, tsconfig paths, environment loading, glob filters, asset copies, any explicit Vite `root`, and `build.outDir`. Verify import resolution for the TypeScript plugins through Forge and direct Vite. Resolve build-root paths per the baseline, with the renderer HTML still at the repository root.
3. **Preserve target policy.** Update Forge `config` values while keeping `entry`, renderer name, concurrency settings, native rebuild and packaging behavior intact. Preserve alias semantics, worker output filenames and module format, `external` and `ssr.noExternal` behavior, Vite `define` and environment settings, and copy hooks. These affect worker launch from the main bundle and native dependency resolution in packaged builds.
4. **Preserve E2E composition.** Keep main first, followed by preload, task code, managed browser, voice, and workspace-watch. Adjust the config imports that merge production worker settings into the E2E overlays. Keep subsequent builds writing beside `e2e-main.js` with `emptyOutDir: false` where configured. Check `preload.js`, `taskCode.js`, `ManagedBrowser.js`, `AiChatVoiceWorker.js`, and `WorkspaceConfigWatchWorker.js` as appropriate for the selected lanes, along with copied native assets. The existing script fails on missing main, preload, or task-code artifacts and warns for some optional workers, so the migration evidence must explicitly check the optional bundle filenames too.
5. **Preserve test selection and bundle guard assertions.** Repoint CLI config arguments, config imports, and tests that read files from disk. Keep include and exclude patterns tied to their existing suites. Update tests that assert config content or discover worker configs from the project root. Keep the behavioral checks for bundled dependencies, renderer Node boundaries, and environment inlining.

The current path-sensitive code is visible in the [shared main config](../../vite.main.shared.mjs), [renderer config](../../vite.render.config.mjs), [task worker config](../../vite.taskCode.config.mjs), [embedding worker config](../../vite.localEmbeddingWorker.config.mjs), and [E2E build script](../../scripts/build-electron-e2e.mjs).

### 3.3 Consumers to update in the same commit

| Consumer | Update and check |
| --- | --- |
| [Forge configuration](../../forge.config.js) | Repoint active worker config paths and remove stale inactive registrations when retiring their configs. Compare build target count and source entries against the baseline. |
| [Yarn scripts](../../package.json), [main test launcher](../../scripts/run-main-tests.js), editor tasks | Keep public command names and test lanes. Update direct config paths and check implicit discovery before moving anything an editor loads by convention. |
| [E2E build orchestration](../../scripts/build-electron-e2e.mjs), [Playwright config](../../playwright.config.ts) | Update all six E2E config paths and overlays. Check launch paths, renderer startup, and coexistence of worker outputs. |
| [CI workflow](../../.github/workflows/ci.yml), [test workflow](../../.github/workflows/test.yml), [build workflow](../../.github/workflows/build.yml), [release workflow](../../.github/workflows/release.yml) | Repoint explicit config flags and check path filters, cache inputs, packaging scripts, and config references in every workflow. Inspect indirect callers that use Forge’s registrations. |
| [Local AI runtime workflow](../../.github/workflows/local-ai-runtime-release.yml), [runtime build script](../../scripts/build-local-ai-runtime.mjs), [runtime fingerprint module](../../scripts/lib/localAiRuntime/runtimeFingerprint.mjs) | Update the direct build command, input filters, fingerprint sources, and human-readable rebuild commands. Use the runtime verification steps below. |
| [Worker config tests](../../test/vitest/main/ZodSsrNoExternalWorkerConfigs.test.ts), [environment guard](../../test/vitest/main/WorkerViteEnvInlineGuard.test.ts), [renderer guard](../../test/vitest/main/rendererNodeLeakGuard.test.ts) | Update literal paths, expected import paths, and path enumeration. Keep each assertion exercising the relocated production config or helper. |
| [Agent instructions](../../AGENTS.md), [Claude instructions](../../CLAUDE.md), [Cursor rules](../../.cursor/rules/electron-rules.mdc), and active runbooks | Update worker config examples and command lines. Replace the static root listing with a link to the maintained directory map. Label historical snapshots when their old paths are intentional. |

Search tracked scripts, workflows, docs, tests, and editor configs for both exact former paths and basenames before staging. Because basenames are preserved, validate each active reference against the caller’s working directory or import location. Record intentional historical references in the migration summary.

### 3.4 Local AI runtime release

The runtime fingerprint hashes sorted repository-relative names and file bytes. Its baseline input list includes the embedding worker config, shared SSR policy, and the runtime release workflow itself. Relocating these inputs is expected to change `sourcesSha256`, even if the effective worker build is equivalent.

1. Move the explicit embedding build command and `build-local-ai-runtime.mjs` diagnostics to `config/vite/workers/vite.localEmbeddingWorker.config.mjs`.
2. Repoint `FINGERPRINT_SOURCE_PATHS` and the corresponding workflow filters to the moved files. Review the embedding config’s local import chain for the moved root resolver, Vite helpers, and plugins. Include inputs that can change runtime archive contents in both the filter and hash coverage. Specific file paths keep the trigger focused on edits that affect the archives.
3. Compute a fingerprint before and after the migration. Confirm the candidate can read all source inputs and record the expected source hash difference. Run the existing embedding bundle guards and a CI runtime workflow dispatch with `publish_github_release` set to `false` to exercise the build and verification matrix without publication. Check the archived worker’s filename and location, native inventory, and catalog compatibility through the existing runtime checks.
4. Coordinate the expected `master` push-triggered rebuild with the release maintainer. Preserve the runtime version and release tag configuration unless a separate release decision changes them. A later edit to an archive-affecting helper must still activate both the workflow filter and fingerprint comparison.

[Runtime fingerprint implementation](../../scripts/lib/localAiRuntime/runtimeFingerprint.mjs) · [Workflow and dispatch inputs](../../.github/workflows/local-ai-runtime-release.yml) · [Runtime release runbook](../ci/local-ai-runtime-release.md)

## 4. Phase C — contributor tooling and documentation

### 4.1 Agent and planning tools

Inventory how each project tool discovers rules, hooks, skills, and state. Classify entries using Git tracking, actual references, and discovery checks in the affected host.

| Location | Migration policy |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/` | Keep the tool-native entry points and shared policy in `AGENTS.md`. Reduce redundant instructions after verifying the tool can follow the shared reference. Retain rules that apply only to one tool. |
| `.claude/settings.json`, `.claude/hooks/`, `.claude/commands/` | Keep project-owned settings, hooks, and commands. Verify that the hook resolves the same installation described by the contributor guide. |
| `.agents/skills/gstack/`, `.claude/skills/gstack/`, and other `.agents/skills/` entries | Inventory upstream material, generated host adapters, and local customizations. The two gstack trees have different layouts. Compare by tool and skill purpose rather than deleting by folder name. Prefer a documented user-level install at a known working version after confirming supported hosts can find their skills from a clean clone. Keep project-specific skills and any snapshot an active workflow requires. |
| `.planning/`, `.specify/`, `.taskmaster/`, `.zcode/` | Keep executable templates, settings, and live state at supported paths. Move durable team decisions to `docs/plans/`, link or migrate active references, and mark completed or superseded documents. Treat nested copies such as `aiFetchly/.specify/` as separate audit candidates and verify their paths with their consumers. |
| `.vscode/`, user-local settings, scratch folders | Keep team-wide launch and workspace settings where their tools discover them. Keep owner-specific overrides in ignored locations. |

Verify discovery by loading the project in each affected supported agent host with the documented setup, checking that the shared policy is visible, and resolving one representative project skill or command. For Claude, verify the configured pre-tool hook finds the installation. If a host requires a repo-local adapter or a tracked copy, document the reason and keep it until its replacement is verified. [Claude settings](../../.claude/settings.json) · [Claude gstack hook](../../.claude/hooks/check-gstack.sh) · [Shared guidance](../../AGENTS.md)

### 4.2 Root documentation

Move `INSTALLER_SETUP.md` into `docs/` and update active inbound links such as the uninstall guide. Review `CODE_IMPROVEMENTS_SUMMARY.md`, `IMPLEMENTATION_SUMMARY.md`, and `TEST_REPORT.md` for current claims before moving them into the docs tree. Link historical records from the relevant topic or use a marked archive within `docs/` if useful. Cross-link active follow-up work such as `TASK-COMPLETION-POLICY-TODO.md` from its canonical plan if it moves. Keep status and ownership with the document. Keep the root README language links and entry paths compatible.

Add a compact directory map to the existing documentation and link it from root setup guidance. Explain how to register a worker, where to put its Vite config, and how to use the appropriate local and CI validations. Keep existing root tool auto-discovery files in place until their consumers are known. For example, the current lint script uses `vue-cli-service`, so review the Vue CLI and Babel configs through the lint entry point before retiring them. [Documentation index](../README.md) · [Uninstall guide](../UNINSTALL_SUMMARY.md) · [Root README](../../README.md) · [Yarn scripts](../../package.json)

## 5. Validation and release evidence

Run applicable developer commands from the repository root using the project’s supported Node and Yarn versions. Compare baseline and candidate where commands already have environment-dependent failures. Capture exit codes, target platform, and artifact filenames. Confirm the candidate has fresh output so an existing `.vite/` bundle cannot mask a missed build.

| Gate | Check | Pass evidence |
| --- | --- | --- |
| Layout and scratch inventory | `git ls-files`, `git check-ignore --no-index vite.sample.timestamp-0.mjs`, reference search, `git diff --check` | Three root Vite entry configs, no tracked scratch or timestamp remnants after their disposition, and no unresolved active paths |
| Renderer build | `yarn build` | Successful renderer bundle with its expected entry HTML and assets |
| Forge development | `yarn dev` | Forge loads its config table, builds the registered targets, and starts the desktop app. Check the expected fresh worker outputs. |
| Electron E2E | `yarn build:e2e`, `yarn test:e2e:collect`, then `yarn test:e2e` or the existing CI Playwright lane | The E2E app launches with preload, the intended specs are collected, and the worker-dependent lanes exercise the intended artifacts. Record any opt-in lane prerequisites. |
| Tests and static guards | `yarn testmain`, the affected utility, task, and service lanes, and `yarn test:components` through CI | Existing suites run under their intended configs. Assertions for worker externals, environment, and renderer boundaries still pass. |
| Local AI runtime | Compute the runtime fingerprint and use the runtime CI build with publication disabled | All inputs resolve, an expected digest change is recorded, and existing runtime archive validation passes |
| Contributor tooling and docs | Check changed Markdown links, open root setup guidance and the docs map, and verify tool discovery | Working links and supported scripts, hooks, and skills reachable on the documented path |
| Packaged release | Existing CI package smoke and platform release verification, operator evidence where needed | Verified packaged renderer, worker artifacts, and representative startup on affected release targets. Store CI run URLs or operator evidence with the migration. |

Use the normal CI lane for component tests. The repository reserves `yarn package`, `yarn make`, and other Forge packaging runs for CI or operators. Collect packaged evidence through the [CI workflow](../../.github/workflows/ci.yml), [release workflow](../../.github/workflows/release.yml), and [operator gate](./aifetchly-desktop-yellow-pages-plugin-todo.md#r01--p1--prove-independent-release-and-staging-hub-to-packaged-desktop-delivery).

## 6. Rollout and rollback

Deliver scratch cleanup, config migration, and tooling and documentation consolidation as independent logical changes. Land the build move with all callers and tests updated together. If a downstream path or packaging failure appears, revert the config migration as a unit so Forge, E2E, CI, and runtime fingerprint paths refer to the same layout again. Keep the documentation consolidation in step with the layout that is active.

| Failure signal | Recovery |
| --- | --- |
| Alias points into `config/vite/` or renderer startup fails | Check explicit project-root resolution and actual Vite root for the failing lane. Compare against the recorded baseline before retrying. |
| An E2E overlay erases earlier output or omits a worker | Verify config order, shared output directory, `emptyOutDir`, and the launch filename. Rebuild from a fresh E2E output directory. |
| Runtime fingerprint errors or a config edit fails to trigger CI | Correct the moved paths and helper coverage in the workflow and fingerprint module together. Re-run the unpublished build. |
| A packaged worker fails to launch despite local success | Inspect packaged output names and locations, externals, native inventory, and the relevant platform smoke logs. Revert the build move as a unit if release delivery is blocked. |
| An editor or agent loses a project rule, command, or skill | Restore the affected adapter or tracked copy while verifying the documented installation and discovery path on that host. |

After acceptance, use the directory map when adding new internal build configs or project plans. Revisit config factory extraction separately if multiple workers still share a stable set of settings and their differences can stay explicit.
