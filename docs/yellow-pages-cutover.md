# Yellow Pages Desktop Cutover Documentation

Status: Date: 2026-10-19 (legacy graph removal executed on branch
`worktree-yellow-pages-plugin`).

## Cutover Policy (two-stage)

1. **Stage 1 — legacy desktop feature removal (this change set).** The built-in
   Yellow Pages feature (modules, controller, worker processes, IPC, routes,
   AI tools, i18n, persistence wiring, agent-harness command) was deleted from
   the AiFetchly application.
2. **Stage 2 — plugin delivery (parallel track).** Yellow Pages scraping
   capability moves to the independent plugin repository
   `yellow-pages-scraper-plugin` (separate checkout, own git history/node_modules;
   its PRD lives at `docs/yellow-pages-scraper-plugin-prd.md` inside that repo;
   machine-local absolute paths are intentionally absent — the release identity
   and pinned versions are recorded at the release gate, §R01/R04 of
   `docs/prd/aifetchly-desktop-yellow-pages-plugin-todo.md`).
   The plugin ships the `yellowpages-com` adapter as its v1 release
   (`dist/yellow-pages-mcp.cjs`.

## Legacy Data Policy

- **Tables are preserved.** The SQLite tables `yellow_pages_task`,
  `yellow_pages_result`, and `yellow_pages_platform` created by prior versions
  are intentionally NOT dropped at runtime. Existing user data is never
  silently deleted.
- **Baseline migration updated.** Fresh installs no longer create the three
  `yellow_pages_*` tables (`src/migrations/1788088086796-0000-baseline.ts`); the
  `src/sql/scraperdb/yellow_pages_*.sql` init files were removed.
- **Export path.** Historical Yellow Pages results should be exported through a
  pre-cutover build (the exports UI was removed together with the feature; no
  in-app export remains in the post-cutover build).
- **Scheduled tasks.** A legacy scheduled task with
  `task_type = "yellow_pages"` no longer executes. `TaskType.YELLOW_PAGES`
  remains a valid enum value (`src/entity/ScheduleTask.entity.ts`) so legacy
  rows deserialize; at run time the scheduler logs
  `"Unsupported task type: yellow_pages"` and marks the run failed. Nothing is
  auto-deleted or auto-relabelled.

## Parity Basis

- Plugin v1 parity is declared on the `yellowpages-com` adapter (PRD §24).
- `yellowpages-com-sg` and `yellowpages-ca` were deliberately NOT migrated in
  v1; the parity matrix and scrape evidence live in the plugin repo commit
  `8b16766`.
- Shared yellow-pages-class platforms that remain OUT of the deleted surfaces:
  `JapaneseYellowPagesAdapter` (yellowpage.jp), `ITownPageAdapter` (itownpage),
  `USonarYellowPageAdapter` (usonar.jp) — their factory rows, catalog
  entries, URL allowlist rules, and tests are untouched (commit `a6003854`).

## Deferred Items

- **Hub publication gate (Phase 3b):** publishing/installing the plugin from
  the in-app Hub stays gated per PRD §27; installation flows were not moved in
  this change set.
- **In-session AI recovery broker (Phase 5):** the new-scrape AI support
  restart broker stays out until the plugin's session model lands.
- **Release acceptance gate:** before shipping, the staged build must complete the
  REAL Hub-delivery flow — Hub publication of the plugin release → install
  through the in-app Plugin Manager on a clean packaged target (no system
  Node/git/npm) → scrape run → export + stop/cancel → parent/descendant
  termination per advertised OS/arch (`AC-14`..`AC-18`). AC-16 requires ACTUAL
  Hub delivery: a folder/side-load install is a developer-only convenience and
  is NOT part of this acceptance. Hold release until the R01 gate passes
  (operator evidence accrues in
  `docs/prd/aifetchly-desktop-yellow-pages-plugin-todo.md` §R01). Legacy
  removal on this branch is not, by itself, an acceptance pass.

## Verification Evidence (per commit)

| Commit | Gate |
| --- | --- |
| `97db9e44` | `npx tsc --noEmit`, targeted vitest suites |
| `d75d1663` | worker-packaging tests, forge verify script, tsc |
| `d62a7ac6` | tsc, ToolTimeoutPolicy + ToolJobRegistry suites |
| `83d8abe9` | tsc, ShutdownParticipants/TaskExecutorService/desktopLogin/SearchModule vitest, ScheduleAiTools mocha (65 passing), `yarn test:components` 955 passing |
| `a6003854` / `27c3651e` | tsc, urlHostAllowlist + platformMatcher vitest (36), ITown/Japanese/USonar adapter vitest (48) |
| `4db659a7` | tsc, `yarn test:components` (incl. uiMigrationCoverage 50-surface gate) |
| `1319d3dd` | tsc, config vitest suites (71), SqliteDb/dbEntities grep clean |
| `306130db` | `test/vitest/main/yellowPagesLegacyRemoval.test.ts` — 8 AC-01/AC-18 absence tests |
| final | full `yarn testmain` comparison: identical pre/post failure sets
  (ToolExecutor file-op, shell-integration, tc1-install, FileToolIntegration,
  SkillInstallationLifecycle, StreamEventProcessorToolResults, admissionFreeze
  under parallel load) — all pre-existing/flaky, none introduced here.
  Pre-change commit also failed ShutdownParticipants T06 (fixed in `83d8abe9`)
  and the deleted SanitizeHtmlYellowPages bundle test. Suite totals improved
  7201→7201 passing with 2 fewer failing files; `yarn test:components` 955
  green; contracting mocha suites (ScheduleAiTools 65, ToolTimeoutPolicy 19)
  green. |

## Composition of the Absence Gate

`test/vitest/main/yellowPagesLegacyRemoval.test.ts` asserts:
- none of the 19 deleted file/dir paths exist;
- `AVAILABLE_TOOL_FUNCTIONS` exposes neither `search_yellow_pages` nor
  `get_available_yellow_pages_platforms`;
- `src/config/skillsRegistry.ts` and `src/config/aiTools.config.ts` contain
  neither tool name;
- `authenticatedFeatureRoutes.ts` has no `/yellowpages` route;
- `src/preload.ts` allowlists no `yellow_pages:*` channel;
- `TaskType.YELLOW_PAGES` still equals `"yellow_pages"` (legacy rows stay
  readable);
- the surviving yellow-pages-class adapters (`ITownPageAdapter`,
  `USonarYellowPageAdapter`) are still available in
  `PlatformAdapterFactory.isAdapterAvailable`, while `YellowPagesComAdapter`
  is not.
