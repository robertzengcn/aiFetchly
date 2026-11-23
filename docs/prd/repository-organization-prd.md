# Repository Root Organization — Product Requirements

| Field | Value |
| --- | --- |
| Status | Proposed |
| Version | 1.0 |
| Date | 2026-11-23 |
| Audience | AiFetchly contributors, build maintainers, release maintainers |
| Baseline | Repository snapshot at `991a3dfcc` |
| Companion | [Repository Root Organization — Technical Design](./repository-organization-technical-design.md) |

## 1. Problem

AiFetchly has grown several build and contributor workflows in the same directory. A contributor opening the root has to scan through worker and test-specific configurations, one-off artifacts, and historical documents to identify the entry points for the desktop application. Team guidance also spans several agent and planning tools, which makes it harder to know which instructions and decisions are current.

| Observed at baseline | Consequence |
| --- | --- |
| 74 tracked files directly in the root, including 29 `vite.*.config.mjs` files | Desktop build entry points and internal build targets have the same visibility |
| Four tracked scratch candidates (`forge.config.js_backup`, `test.json`, `test-vectra.js`, and `single-marketjs.code-workspace`) | Files with unclear ownership appear to be supported project inputs |
| The root has a Vite timestamp ignore rule and zero tracked timestamp configs. A Cursor rule still lists timestamp files in its directory tree. | The contributor guide presents an outdated view of the checkout |
| Two tracked gstack trees contain 1,202 files in total. Claude’s project guidance also describes a global install. | Contributors need a clear installation path and a way to identify project-owned skills |
| Contributor plans live in `docs/plans/` and multiple tool-specific directories | Readers have to consult several locations to find active decisions and historical records |

See the [Forge build registrations](../../forge.config.js), [ignore rules](../../.gitignore), [Cursor Electron rules](../../.cursor/rules/electron-rules.mdc), [Claude instructions](../../CLAUDE.md), and [documentation index](../README.md).

## 2. Outcomes and users

| User | Outcome |
| --- | --- |
| New contributor | Finds setup through the root README, followed by the application source, contributor guidance, tests, and build entry points |
| Worker maintainer | Finds the worker implementation in `src/childprocess/`, its build config in `config/vite/workers/`, and its Forge registration in one predictable location |
| Test maintainer | Finds the Electron E2E build overlays and test-specific configs by purpose and runs the existing commands |
| Release maintainer | Can review a config move and verify the packaged app and downloadable runtime pipelines with the existing CI workflows |
| Contributor using an AI agent | Finds the shared policy in `AGENTS.md` and can discover project-specific commands through the supported tool’s entry points |

This is a contributor experience initiative. The desktop UI, interfaces, data model, worker behavior, dependency versions, and release artifact contracts remain the compatibility baseline. A common worker config factory, a monorepo conversion, and a packaging redesign are separate initiatives.

## 3. Requirements

### R1. Make the root an entry point

Keep the project manifest and lockfile, primary README and localized README entry points, license, `AGENTS.md`, and root-discovered configuration easy to find. Keep `forge.config.js`, `index.html`, and the main, preload, and renderer Vite configs in the root. Use `config/vite/` for internal build configuration, `src/config/` for application runtime configuration, `scripts/` for maintained developer tooling, and `test/` for shared test assets. Add a short directory map to the developer setup material and link from it to the documentation index.

### R2. Give every scratch candidate a disposition

Remove `forge.config.js_backup` after checking for unique settings worth keeping. Examine the consumers and purpose of `test.json` and `test-vectra.js`. Keep useful data as a named fixture with a documented format, or a supported diagnostic with a documented invocation and available dependencies. Retire unused artifacts. Drop the redundant single-folder workspace file after checking for an active editor integration. Use the existing timestamp ignore rule wherever Vite emits its temporary config files. Give reusable scratch work an explicit home and keep personal experiments in an ignored local directory.

### R3. Relocate internal Vite configs without changing build behavior

Move active worker configs, E2E overlays, test-only configs, and build helpers into the appropriate subdirectories. Give the inactive bulk-email config an explicit disposition. Keep existing worker sources, bundle filenames, output layout, dependency bundling policy, and public Yarn commands compatible. Update every executable consumer in the same change, including Forge, E2E orchestration, test and CI commands, and runtime release fingerprint inputs and workflow filters.

### R4. Establish one shared source of contributor policy

Keep common engineering policy in `AGENTS.md`. Retain project hooks, discovery files, and project-owned skills at the paths their consumers use. Replace duplicated policy text in agent-specific guides with references where the tool can read them. Select and document a reproducible gstack installation path after verifying the active host workflows. Preserve project-specific customizations and keep a tracked copy where a supported workflow still depends on it. Classify files individually when a directory contains both shared rules and local state.

### R5. Make current plans and documentation discoverable

Use the existing `docs/README.md` index and `docs/plans/` for team-readable plans. Keep live tool-owned state in the locations its tool expects. Move durable installer guidance, implementation records, and test reports into a fitting section under `docs/`, with links updated in the same change. Mark completed or superseded plans so contributors can identify the current source. Retain the localized README entry paths and language navigation.

### R6. Preserve release and development entry points

Verify the developer startup, production renderer build, Electron E2E build and test path, main and affected worker test lanes, and runtime build inputs. Verify packaged behavior on CI or through the designated operator. Follow the repository rule that reserves Electron Forge packaging for CI or operators. Attach command, commit, platform, and result to the migration record for checks that distinguish development output from packaged artifacts. [Repository instructions](../../AGENTS.md) · [Operator gate](./aifetchly-desktop-yellow-pages-plugin-todo.md#r01--p1--prove-independent-release-and-staging-hub-to-packaged-desktop-delivery)

## 4. Acceptance criteria

| ID | Acceptance evidence |
| --- | --- |
| AC1 | The root contains three tracked `vite.*.config.mjs` entry files for main, preload, and renderer. Workers, E2E overlays, test-only configs, and helper modules have documented destinations. A maintainer can locate them from the directory map. |
| AC2 | The four named scratch candidates have recorded dispositions. `git ls-files` reports zero tracked Vite timestamp files and `git check-ignore` recognizes a representative timestamp path. Current contributor guides use the new layout. |
| AC3 | The registered build targets, worker source entries, emitted filenames, output directories, and relevant dependency policies match the baseline. Existing public Yarn commands still reach the intended configs and test suites. |
| AC4 | Renderer, Forge development, Electron E2E, and affected worker validation pass. The local AI runtime workflow’s filters, build command, and fingerprint follow its relocated inputs. The expected rebuild decision is recorded. |
| AC5 | An engineer verifies the supported tool entry points affected by the cleanup. Required hooks and project-owned skills resolve. Each retained gstack tree has a documented reason, and migrated plans have a discoverable canonical location. |
| AC6 | CI or an operator records package verification and smoke results for the release targets affected by the move. Any platform evidence still pending is recorded as such before release sign-off. |

Root count is a useful before-and-after measure. The acceptance criteria emphasize whether contributors can find the right files and whether the existing workflows still work through their normal entry points.

## 5. Delivery order and decisions

| Phase | Deliverable | Review point |
| --- | --- | --- |
| A. Scratch cleanup | Remove or relocate confirmed scratch files and fix the stale directory guidance | Confirm references, tool discovery, and Git tracking status |
| B. Build configuration | Move internal configs and update their callers in one logical change | Compare baseline and candidate bundle contracts, then review CI and runtime release evidence |
| C. Documentation and tooling | Publish the directory map, move durable docs, and resolve duplicated agent setup | Verify links, live tool discovery, and preservation of project-specific content |

The proposal groups configs by build purpose, keeps established desktop entry points at the root, and gives each migration phase a reviewable commit. File retirement decisions depend on evidence collected during the migration, especially for the inactive bulk-email build and agent-tool state. The [technical design](./repository-organization-technical-design.md) supplies the file map, validation matrix, and rollback points.
