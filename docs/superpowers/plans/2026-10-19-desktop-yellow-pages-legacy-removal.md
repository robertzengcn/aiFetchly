# Desktop Yellow Pages Legacy Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the remaining implementable requirement of `docs/prd/aifetchly-desktop-yellow-pages-plugin-prd.md` — Phase 4 / TD-11 / AC-18: remove the complete built-in Yellow Pages feature graph from the desktop while preserving data, shared infrastructure, and unrelated features.

**Architecture:** The host foundation for plugin-hosted browser scraping (HOST-01..HOST-17, TD-01..TD-09: plugin tool-policy registry, `aifetchly-node` runtime, browser capability, managed async jobs with deadlines/cancellation, recovery ledger, file artifacts, lifecycle gates) is already landed on this branch (commits `5c46312f`..`edbb0618`) and the independent plugin repo ships a v1 `yellowpages-com` adapter. This plan removes the legacy desktop scraper so exactly two YELLOW-PAGES sources remain: none in core, plugin-only capability per AC-01/AC-02/AC-18.

**Host prior state verified on this branch:** `ToolJobRegistry` cleanup leases/settlement, `PluginToolPolicyRegistry`, `PluginMcpRuntimeResolver`, `PluginBrowserCapabilityService`, `PluginRecoveryLedger`, `PluginFileArtifactService`/Module/IPC, `AIChatQueryLoop` managed async with deadline-driven cancellation, `McpResultNormalizer`, `SupervisedStdioTransport` trusted launch, docs already corrected (`a8c4012d`).

**Tech Stack:** TypeScript 5.x, Electron + Vue 3, Vitest (`vite.main.config.mjs` via `yarn testmain`, `test/vitest/main/components` via `yarn test:components`, `vite.utilityCode.config.mjs`), Mocha for `test/modules/`, Forge + Vite worker targets.

## Explicitly deferred after this plan (documented, NOT silently dropped)

- **HUB-01/HUB-02 & Phase 3b (Hub publication + packaged-app acceptance):** requires Hub deployment + release infrastructure; release-process gate, cannot be executed in this checkout. AC-16/AC-17 verification stays open until a staging Hub run.
- **HOST-12 / Phase 5 (in-session AI recovery broker):** optional later phase per PRD §15; MCP sampling capability negotiation comes first.
- **PRD §27 gating:** AC-18 says legacy removal happens "after the Hub delivery gate" as a *release* requirement. This plan stages the code removal so the release can proceed; the release acceptance run itself remains gated per PRD §27/§17.3.
- Full Playwright Hub→scrape→export E2E (depends on the Hub fixture environment).

## Cutover decisions honoring PRD §28.3 + §31 (documented defaults)

1. **No destructive database action.** Existing `yellow_pages_task`/`yellow_pages_result`/`yellow_pages_platform` tables and rows are preserved. TypeORM `synchronize: true` does not drop removed-entity tables; existing user DBs simply keep orphan tables.
2. **Fresh-install surface cleaned:** the 3 `src/sql/scraperdb/yellow_pages_*.sql` init files and the 4 baseline-migration table-creation lines are removed so new installs never create them.
3. **`TaskType.YELLOW_PAGES` enum member is KEPT** (`src/entity/ScheduleTask.entity.ts:8`): persisted legacy `schedule_task` rows carry `task_type='yellow_pages'`. Every host branch for it is deleted; legacy rows then hit the existing default "unsupported task type" path — the documented "legacy scheduled tasks no longer run" behavior.
4. **Export/backup policy (PRD §28.3 / open decision #14):** legacy results are exportable from any pre-cutover application build (old app + preserved DB), and the tables remain on disk. Documented in `docs/yellow-pages-cutover.md` (Task 10). No silent deletion.
5. **Parity basis:** plugin v1 retains `yellowpages-com`; `yellowpages-com-sg` and CA platforms are explicitly deferred per the parity matrix recorded in the plugin repo (`8b16766`), consistent with PRD §28.1.1 ("deferred" rows documented).

## Preserved shared surfaces (verified, must keep compiling)

- `src/entityTypes/yellowPagesTaskProxyType.ts` — shared proxy type used by Google/Yandex Maps workers, their modules/IPC, and `BackgroundProcessMessages.ts`. KEEP AS-IS.
- `src/modules/YellowPagesAiSupportHandler.ts` → **renamed** to `src/modules/ScraperAiSupportHandler.ts` (Task 1): pure AI-support proxy consumed by `SearchModule` for search-engine scrapers.
- `src/modules/platforms/JapaneseYellowPagesAdapter.ts`, `ITownPageAdapter.ts`, `USonarYellowPageAdapter.ts` + their factory cases — base classes for live non-Yellow-Pages platforms (`itownpage-jp`, `usonar-yellowpage-jp`). KEEP.
- `PlatformAdapterFactory.ts`, `BasePlatformAdapter.ts`, `IBasePlatformAdapter`/`IPlatformConfig`/`IScraperEngine`/`ITaskManager`/`IProgressReporter` interfaces, `PlatformRegistry.ts`, `platform-ipc.ts` — shared platform infrastructure. KEEP.
- `ObserveExecuteLoop/ObserveExecuteExecutor/AiSupportBridge` — used by Google/Bing/Baidu/Yandex search scrapers. KEEP.
- `search_yellow_pages`-UNrelated generic job/MCP/plugin services (`ToolJobRegistry`, `PluginMcpRuntimeResolver`, etc.). No YP branches in them.
- Managed browser infra; other social scrapers; all plugins/skills infrastructure.

## Global Constraints

- TypeScript: no `any`; explicit return types; `unknown` at boundaries (AGENTS rule).
- i18n: remove matching keys in ALL six language files (en, zh, es, fr, de, ja) whenever removing UI text; update `test/vitest/utilitycode/complianceNouns.test.ts`.
- Every task ends green: `npx tsc --noEmit` + listed test commands + `git add`/`git commit` (conventional message per AGENTS).
- UI edits fold their component-test updates into the same task; `yarn test:components` is a hard gate.
- Do not introduce a dual production scraper path; do not touch generic plugin/chat/services for Yellow Pages specifics.

## Types/identifiers used consistently across tasks

- `TaskType.YELLOW_PAGES` enum member survives; all `case TaskType.YELLOW_PAGES:` switches around it are deleted (details per task).
- `ScraperAiSupportHandler` (renamed), class name inside file also renamed to `ScraperAiSupportHandler`; exports (`handleAiSupportRequest`, `AiSupportErrorCode`, message constants) unchanged.
- Worker identifiers `YELLOW_PAGES_PLATFORMS`..`CHECK_ORPHANED_PROCESSES` (channellist constants) deleted in Task 7.

---

## Task 0: Baseline (no code changes)

- [ ] Run `npx tsc --noEmit` — must pass (record result).
- [ ] Run `yarn test:components` — must pass (record result; this is the pre-change gate).
- [ ] Confirm working tree clean: `git status`.

## Task 1: Shared-surface rename — `YellowPagesAiSupportHandler` → `ScraperAiSupportHandler`

**Files:**
- Rename: `src/modules/YellowPagesAiSupportHandler.ts` → `src/modules/ScraperAiSupportHandler.ts`
- Modify: `src/modules/SearchModule.ts:71,468,487` (import + 2 instantiations)
- Modify: `src/modules/YellowPagesProcessManager.ts:57` (import only — the file itself is deleted later; rename keeps it compiling)
- Test: existing AI-support handler tests (grep `YellowPagesAiSupportHandler` under `test/`, update import paths/names)

**Interfaces:**
- Produces: `src/modules/ScraperAiSupportHandler.ts` with class `ScraperAiSupportHandler`, public API `handleAiSupportRequest`, `AiSupportErrorCode` unchanged — SearchModule is the surviving consumer.

- [x] **Step 1: `git mv src/modules/YellowPagesAiSupportHandler.ts src/modules/ScraperAiSupportHandler.ts`; inside the file rename class `YellowPagesAiSupportHandler` → `ScraperAiSupportHandler` (constructor/exports/types). Do NOT rename its two internal fallback platform strings (`"yellowpages"` @402/550) — they are data defaults, tuned for search scrapers' non-YP failures; leave values as-is.**
- [x] **Step 2: Update `SearchModule.ts`:** line 71 `import { ScraperAiSupportHandler } from "./ScraperAiSupportHandler";`, lines 468/487 `new ScraperAiSupportHandler()`.
- [x] **Step 3: Update `YellowPagesProcessManager.ts:57` import path/name.**
- [x] **Step 4: Update any test files importing `YellowPagesAiSupportHandler` (`grep -rln YellowPagesAiSupportHandler test/`), same mechanical rename. Run them: `yarn testmain <found paths>`.**
- [x] **Step 5: Verify:** `npx tsc --noEmit` green; `yarn testmain test/vitest/main/modules/SearchModule.test.ts` green.
- [x] **Step 6: Commit:** `git add -A && git commit -m "refactor: rename YellowPagesAiSupportHandler to ScraperAiSupportHandler for shared search-scrapers use (PRD §28.1)"`.

## Task 2: Worker build graph deletion (childprocess entries, forge, vite, verify lists)

**Files:**
- Delete: `src/childprocess/YellowPagesScraper.ts`, `src/childprocess/YellowPagesScraperProcess.ts`
- Delete: `src/schemas/worker/yellowPagesScraper.ts`, `src/schemas/worker/yellowPagesScraperProcess.ts`
- Delete: `vite.yellowPages.config.mjs`, `vite.yellowPagesScraperProcess.config.mjs`
- Modify: `forge.config.js:1135-1136,1139-1140` (delete both Vite target objects; keep the surrounding `vite.config.build` array and the `concurrent` OOM comment at 1104 — comment-only)
- Modify: `scripts/verify-packaged-childprocess.js:23,26` (delete `"YellowPagesScraperProcess.js"` and `"YellowPagesScraper.js"` entries) and `:695-697` (delete the filter, use `REQUIRED_WORKERS` directly: replace `let expectedWorkers = ...filter...` with just using `REQUIRED_WORKERS`)
- Modify: `test/vitest/main/verifyPackagedChildprocessLayout.test.ts:17,20` (delete both array entries)

No other module imports these four child/schema files (verified: only each other + the deleted configs).

- [x] **Step 1: Delete the 6 files (2 childprocess, 2 worker schemas, 2 vite configs) with `git rm`.**
- [x] **Step 2: Edit `forge.config.js` to remove the two `{ entry: "src/childprocess/YellowPages*.ts", ... }` rows (lines ~1135-1141).**
- [x] **Step 3: Edit `scripts/verify-packaged-childprocess.js`: drop the two required-worker entries and the `YellowPagesScraperProcess.js` filter at 695-697.**
- [x] **Step 4: Edit `test/vitest/main/verifyPackagedChildprocessLayout.test.ts` worker lists (lines 17/20) to match the script.**
- [x] **Step 5: Verify:** `npx tsc --noEmit`; `yarn testmain test/vitest/main/verifyPackagedChildprocessLayout.test.ts`.
- [x] **Step 6: Commit:** `feat: remove yellow pages worker build targets, schemas, and verify list entries (PRD §17.2)`.

## Task 3: Built-in AI tool graph removal

**Files:**
- Modify: `src/config/aiTools.config.ts:81-131` (delete `search_yellow_pages` + `get_available_yellow_pages_platforms` function definitions)
- Modify: `src/config/skillsRegistry.ts:448-501,591-621` (delete both skill entries)
- Modify: `src/service/ToolExecutor.ts`: imports @4,5,8; `RATE_LIMIT_CONFIG.yellowPages` @145-149; branch @192-196; switch cases @374-378; methods `executeYellowPagesSearch` @833-937 + `executeGetYellowPagesPlatforms` @939-1014
- Modify: `src/service/ToolExecutionService.ts:230-263` (delete `search_yellow_pages` result-projection branch)
- Modify: `src/service/ToolTimeoutPolicy.ts:68` — remove `|| name === "search_yellow_pages"` from the `analyze_website` condition (fall-through default already returns `"network"`)
- Test: `test/modules/ToolTimeoutPolicy.test.ts:46` (remove/replace `search_yellow_pages` fixture; keep `analyze_website` case)

Note: `ToolExecutor` imports `YellowPagesController` (@4) — removing these usages FIRST unblocks the controller deletion in Task 5. `ToolExecutionService.ts:230-263` and `ToolExecutor.ts:374-378` are keyed on the exact tool-name strings; no other tool semantics change.

- [x] **Step 1: Delete the two tool defs + two skill entries.**
- [x] **Step 2: Delete TaskExecutor-coupled YP branches in `ToolExecutor.ts` listed above; remove the 3 imports.**
- [x] **Step 3: Delete `ToolExecutionService.ts:230-263` branch; verify no other branch keys on those strings (`grep -n "search_yellow_pages\|get_available_yellow_pages" src/`).**
- [x] **Step 4: `ToolTimeoutPolicy.ts:68` — drop only `|| name === "search_yellow_pages"`.**
- [x] **Step 5: Update `test/modules/ToolTimeoutPolicy.test.ts` (fixture @46).**
- [x] **Step 6: Verify:** `npx tsc --noEmit`; `env TS_NODE_COMPILER_OPTIONS='{"module": "commonjs"}' npx mocha -r ts-node/register test/modules/ToolTimeoutPolicy.test.ts`; `yarn testmain test/vitest/main/service/ToolJobRegistry.settled.test.ts`.
- [x] **Step 7: Commit:** `feat: remove built-in search_yellow_pages and get_available_yellow_pages_platforms tools (PRD HOST-13/AC-18)`.

## Task 4: Domain modules, lifecycle, and legacy message-union deletion
(Executed jointly with Task 5 as commit `83d8abe9` — the module deletions pull
the controller/dashboard/types files, so the two tasks share one compile-green commit.
Legacy scratch suites (comprehensiveTestSuite, yellowPagesEndToEnd/Integration,
runYellowPagesTests, YellowPagesOrchestrator/ProcessManager tests,
yellowPagesController.test, comprehensive YP mocha suites) were deleted in the
same commit because tsc covers test/. Bonus cleanup found while executing:
BackgroundScheduler reset, preload handler duplicate case, 
test/vitest/main/e2e/AppStartupPolicy.test.ts inspectOrphanedTasks assertions,
UrlHostAllowlist test assertions committed in `fb18b6ae`.)

**Files:**
- Delete: `src/modules/YellowPagesModule.ts`, `YellowPagesProcessManager.ts`, `YellowPagesOrchestrator.ts`, `YellowPagesInitModule.ts`, `YellowPagesHealthCheck.ts`, `YellowPagesPlatformModule.ts`, `YellowPagesResultModule.ts`, `YellowPagesTaskModule.ts`
- Delete: `src/utils/yellowPagesProxyLaunch.ts` (only YP consumers remain — ProcessManager/Scraper both deleted here/in Task 2)
- Modify: `src/modules/interface/BackgroundProcessMessages.ts` — delete `SCRAPING_CLOUDFLARE_DETECTED` member @241, `SCRAPING_PAUSED_CLOUDFLARE` @285, and the two guard overload branches @487-495 and @492-508 (the type-narrowing helpers around `message.details?.url`). Keep everything else (union is shared: `YellowPagesTaskProxyConfig` field @37 stays).
- Modify: `src/modules/bootuprun.ts:3,11-18` — delete `YellowPagesInitModule` import + init try/catch; body keeps `SystemSettingGroupModule.tableInit()`.
- Modify: `src/background.ts:1980-2005` — delete the whole `if (startupPolicy.inspectOrphanedTasks) { YellowPagesController... handleTasksFromPreviousSession(); checkForOrphanedProcesses(); }` block (imports of the controller remain until Task 5 — this task removes only the orphan block).
- Modify: `src/main-process/startup/AppStartupPolicy.ts:33,51,65` — delete `inspectOrphanedTasks` field + both defaults (background block was the only consumer; grep tests referencing it first).
- Modify: `src/main-process/lifecycle/ShutdownParticipants.ts:337-348,373` — delete the `yellowPages` participant + array entry.
- Modify: `src/modules/TaskExecutorService.ts` — import @16; dep field/ctor @42,55,77; case @115-117; `executeYellowPagesTask()` @253-271; case @450-474; case @618-621; try/catch @768-775.
- Modify: `src/service/ScheduleAiTools.ts:15,182-189` — delete `YellowPagesTaskModule` import + case.
- Modify: `src/modules/user.ts:21-22,41-42` — delete YP imports + reset calls (keep `SearchController.resetInstance()` @40).
- Modify: `src/modules/desktopLoginCompletion.ts:35-36,230-231` — delete YP imports + resets (keep neighbors).
- Modify schedule UI: `src/views/pages/schedule/detail.vue:663`, `src/views/pages/schedule/widgets/ScheduleTable.vue:309,322,334`, `src/views/pages/task/widgets/PlatformManagementDashboard.vue:393` — delete each `TaskType.YELLOW_PAGES` case / icon map entry. NOTE: `TaskType.YELLOW_PAGES` enum member STAYS in `src/entity/ScheduleTask.entity.ts:8`.
- Tests updated in the same task: `test/vitest/main/lifecycle/ShutdownParticipants.test.ts:67-68,188-193` (drop mock + participant assertions); `test/vitest/main/modules/TaskExecutorService.test.ts:20,35,78-88` (drop dep field + YP status-mapping case); `test/vitest/main/desktopLoginWindowResolution.test.ts:154-159` (drop YP singleton mocks); `test/modules/ScheduleAiTools.test.ts:30,1212-1218` (YELLOW_PAGES validation case — migrate that case to GoogleMaps/YandexMaps assert or delete); `test/vitest/main/modules/SearchModule.test.ts:147-183` (pattern-test using `YellowPagesResultModule` as subject — retarget to a surviving module or delete the single test).
- Also delete UI: `src/views/pages/task/widgets/PlatformManagementDashboard.vue:393` icon entry (listed above).
- Check `grep -rn "inspectOrphanedTasks" test/` and update any AppStartupPolicy test touching the removed field.

- [x] **Step 1: `git rm` the 8 module files + `src/utils/yellowPagesProxyLaunch.ts`.**
- [x] **Step 2: Apply `BackgroundProcessMessages.ts` union/guard deletions.**
- [x] **Step 3: Apply `bootuprun.ts`, `background.ts` block, and `AppStartupPolicy.ts` field deletions.**
- [x] **Step 4: Apply `ShutdownParticipants.ts` deletions.**
- [x] **Step 5: Apply `TaskExecutorService.ts` + `ScheduleAiTools.ts` deletions.**
- [x] **Step 6: Apply `user.ts` + `desktopLoginCompletion.ts` deletions.**
- [x] **Step 7: Apply schedule/task-widget UI case deletions (detail.vue, ScheduleTable.vue, PlatformManagementDashboard.vue).**
- [x] **Step 8: Update the 5-6 listed test files.**
- [x] **Step 9: Verify:** `npx tsc --noEmit`; `yarn testmain test/vitest/main/lifecycle/ShutdownParticipants.test.ts test/vitest/main/modules/TaskExecutorService.test.ts test/vitest/main/desktopLoginWindowResolution.test.ts test/vitest/main/modules/SearchModule.test.ts`; `env TS_NODE_COMPILER_OPTIONS='{"module": "commonjs"}' npx mocha -r ts-node/register test/modules/ScheduleAiTools.test.ts`; `yarn test:components`.
- [x] **Step 10: Commit:** `feat: remove yellow pages domain modules, process lifecycle, and message unions (PRD §17.2/AC-12)`.

## Task 5: Controller, singleton resets, and dashboard/statistics UI chain

**Files:**
- Delete: `src/controller/YellowPagesController.ts` (ToolExecutor import removed in Task 3; remaining importers cleaned here)
- Modify: `src/modules/BackgroundScheduler.ts:23,179` — delete YP import + `YellowPagesController.resetInstance()` line (keep `SearchController.resetInstance()` + log).
- Modify: `src/controller/DashboardController.ts:15,23,29,40,50-59,65,77-87,96,189-204,265-272` — delete YP module field/init/ensureConnection call, `yellowPagesResults` destructures + return fields, `getYellowPagesSummary()` + `getYellowPagesTrend()`, and their Promise elements. Keep the rest of Promise.all/`fillMissingData` wiring intact (drop only the YP member from the all-array and where-chains).
- Modify: `src/entityTypes/dashboardType.ts:21,30` — delete `yellowPagesResults` from `DashboardSummary` and `TrendData`.
- Modify dashboard views: `src/views/dashboard/components/DashboardActivityChart.vue:61,109-110`; `DashboardTrendsChart.vue:61,109-110`; `DashboardSummaryCards.vue:88-114,180` (delete the yellowpages hover-card block, series, label; adjust any sibling spacing/render guards that keyed on it).
- Modify: `src/views/pages/statistic/index.vue:427-428` — delete `case 'yellowpages': router.push('/yellowpages/list')`.
- Tests: dashboard components have no existing vitest files; per AGENTS "UI changes require UI tests", ADD `test/vitest/main/components/DashboardSummaryCards.yellowPagesRemoval.test.ts` asserting the summary card renders pink-item removal correctly — actually scope this tight (one test asserting no 'Directory Assistant'/yellowpages key bindings render and the other cards still mount). If a full mount fixture is heavy, a lighter `DashboardSummaryCards.test.ts` mount covering 4 remaining cards satisfies the gate.
- Run `yarn test:components` (hard gate).

- [x] **Step 1: `git rm src/controller/YellowPagesController.ts`.**
- [x] **Step 2: BackgroundScheduler cleanup; tsc.**
- [x] **Step 3: DashboardController + dashboardType + 3 dashboard views + statistic case edits.**
- [x] **Step 4: Add the folded dashboard component test (red→green cycle: write test, run, adjust component binding leftovers it exposes).**
- [x] **Step 5: Verify:** `npx tsc --noEmit`; `yarn test:components`; `yarn testmain test/vitest/main/modules/BackgroundScheduler*` if a test exists.
- [x] **Step 6: Commit:** `feat: remove yellow pages controller and dashboard/statistics exposure (PRD §17.2/AC-01)`.

## Task 6: Platform adapters, factory cases, catalog, and URL allowlist cleanup

**Files:**
- Delete: `src/modules/platforms/YellowPagesComAdapter.ts`, `YellowPagesComAdapter.ts` variants — precisely: `YellowPagesComAdapter.ts`, `YellowPagesComSgAdapter.ts`, `YellowPagesCaAdapter.ts`
- KEEP: `JapaneseYellowPagesAdapter.ts`, `ITownPageAdapter.ts`, `USonarYellowPageAdapter.ts` (base of two live platforms)
- Delete: `src/modules/ChildProcessAdapterFactory.ts` (only YP consumers: ProcessManager/Scraper, both gone)
- Modify: `src/modules/platforms/index.ts:4,6,8,17` (delete the 4 exports; keep ITownPage/USonar exports)
- Modify: `src/modules/platforms/PlatformAdapterFactory.ts` — imports @7,9,19; class-map @30-31 (keep 25/29 = ITown/USonar); path-map @46-48; create cases @107-114,142-143; availability entries @164-166,175 and @189-191,200; getAdapterClass cases @224-231,259-260. Keep all ITown/USonar rows.
- Modify: `src/config/platforms/index.ts:10,14,42,46` — remove YP catalog imports/entries; keep the rest.
- Modify: `src/config/generate.ts:76-81` — delete `id:6 "YellowPages.com"` SocialPlatformList entry (shared array stays).
- Modify: `src/modules/lib/urlHostAllowlist.ts:16` — delete the `yellowpages` key.
- Tests: `test/vitest/utilitycode/urlHostAllowlist.test.ts:35-36,67` — remove assertions on the deleted key; `test/vitest/main/modules/platforms/JapaneseYellowPagesAdapter.test.ts` + ITown + USonar tests KEEP passing untouched; delete `test/vitest/main/modules/platforms/*` only if they imported deleted adapters (grep first; none expected).

- [x] **Step 1: `git rm` the 3 adapter files + `ChildProcessAdapterFactory.ts`.**
- [x] **Step 2: Apply `platforms/index.ts`, `PlatformAdapterFactory.ts`, `config/platforms/index.ts`, `generate.ts`, `urlHostAllowlist.ts` edits.**
- [x] **Step 3: Update `urlHostAllowlist.test.ts`.**
- [x] **Step 4: Verify:** `npx tsc --noEmit`; `npx vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/urlHostAllowlist.test.ts test/vitest/utilitycode/platformMatcher.test.ts`; `yarn testmain test/vitest/main/modules/platforms/JapaneseYellowPagesAdapter.test.ts test/vitest/main/modules/platforms/ITownPageAdapter.test.ts`.
- [x] **Step 5: Commit:** `feat: remove yellow pages platform adapters from shared factory and catalog (PRD §17.2)`.

## Task 7: IPC, preload, routes, navigation, i18n, and cloudflare notification removal

**Files:**
- Delete: `src/main-process/communication/yellowPagesIpc.ts`, `src/schemas/ipc/yellowPages.ts`
- Modify: `src/main-process/communication/index.ts:5,109`
- Modify: `src/preload.ts:173-191` (channellist import block incl. the 18 `YELLOW_PAGES_*`/YP channel constants) and `:1092-1111` (allowlist array block + `"yellow_pages:get_process_status"` literal)
- Delete: `src/views/api/yellowpages.ts`, `src/views/pages/yellowpages/` (whole dir)
- Modify routes: `src/views/router/authenticatedFeatureRoutes.ts:515-573`; `src/views/router/translatedRoutes.ts:335-392`; `src/views/router/uiMigrationRegistry.ts:230-252,476`; `src/config/aiNavigationRouteManifest.ts:290-296`
- Delete: `src/views/services/notificationManager.ts`, `src/views/components/widgets/cloudflareNotification.vue` (only producer of `SCRAPING_CLOUDFLARE*` was the deleted YP worker; widget is not mounted anywhere — verified)
- i18n: remove YP keys from all 6 lang files (grep `yellow_pages\|yellow_pages_list\|create_yellow_pages_task\|edit_yellow_pages_task\|yellow_pages_task_detail\|yellow_pages_results\|router.yellow_pages` in `src/views/lang/{en,zh,es,fr,de,ja}.ts`); include `home.yellow_pages` dashboard nouns and `router.*` route titles. Update `test/vitest/utilitycode/complianceNouns.test.ts:35` (drop the `yellow_pages` noun assertion, keep the file's other assertions intact).
- UI tests gate: `yarn test:components` must pass.

- [x] **Step 1: `git rm` the IPC/schema/API/pages/widget/manager files.**
- [x] **Step 2: Edit `communication/index.ts`, `preload.ts` blocks.**
- [x] **Step 3: Edit the 4 router/nav files.**
- [x] **Step 4: Remove YP i18n keys from all 6 lang files; update `complianceNouns.test.ts`.**
- [x] **Step 5: Verify:** `npx tsc --noEmit`; `yarn test:components`; `npx vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/complianceNouns.test.ts`.
- [x] **Step 6: Commit:** `feat: remove yellow pages IPC, routes, navigation, cloudflare notification widget, and i18n (PRD §17.2/AC-01)`.

## Task 8: Persistence surface + agent-harness removal (data preserved)

**Files:**
- Delete: `src/entity/YellowPagesTask.entity.ts`, `YellowPagesResult.entity.ts`, `YellowPagesPlatform.entity.ts`; `src/model/YellowPagesTask.model.ts`, `src/model/YellowPagesResult.model.ts`
- Delete: `src/sql/scraperdb/yellow_pages_task.sql`, `yellow_pages_result.sql`, `yellow_pages_platform.sql` (generic `readdir` init needs no code change)
- Modify: `src/config/dbEntities.ts:47-49,176-178`; `src/config/SqliteDb.ts:44-46` (imports; entity arrays flow from `DB_ENTITIES`/dbEntities)
- Modify: `src/migrations/1788088086796-0000-baseline.ts:81-84` — delete the 3 `CREATE TABLE IF NOT EXISTS` + index lines for yellow_pages_* (fresh installs; existing DBs untouched)
- Delete: `agent-harness/src/commands/yellow-pages.ts`; modify `agent-harness/src/commands/index.ts:14` + `agent-harness/src/repl/repl.ts:21,184`
- KEEP: `src/entity/ScheduleTask.entity.ts:8` `YELLOW_PAGES = "yellow_pages"` enum member (legacy persisted rows).

- [x] **Step 1: `git rm` the 5 entity/model files + 3 SQL files + the agent-harness command; apply the 3 registration edits + baseline-migration edit + agent-harness registration/repl hint removals.**
- [x] **Step 2: Verify:** `npx tsc --noEmit`; `yarn testmain test/vitest/main/config` (if a SqliteDb test exists; otherwise grep `grep -rn "YellowPages" src/config src/entity src/model` → only the enum member + nothing above should remain).
- [x] **Step 3: Commit:** `feat: unregister yellow pages entities, sql init, migration lines, and agent-harness command; preserve legacy tables (PRD §28.3)`.

## Task 9: Legacy test cleanup + absence (AC-01/AC-18) tests
(Executed as `306130db`; `test/yellComAdapterTest.ts` was accidentally deleted
and restored — it is a YellCom adapter test, not YP.)

**Files:**
- Delete legacy feature tests: `test/modules/yellowPagesController.test.ts`, `test/YellowPagesCaAdapter.test.ts`, `test/verifyYellowPagesCaAdapter.ts`, `test/runYellowPagesTests.ts`, `test/yellowPagesAdapterTest.ts`, `test/yellowPagesEndToEndTest.ts`, `test/yellowPagesIntegrationTest.ts`, `test/dataValidationTest.ts`, `test/simpleDataValidation.ts`, `test/simpleDataValidation.js`, `test/runTestSuite.ts`, `test/comprehensiveTestSuite.ts`, `test/mocks/MockScraperEngine.ts`, `test/vitest/main/modules/YellowPagesOrchestrator.test.ts`, `test/vitest/main/modules/YellowPagesProcessManager.test.ts`, `test/vitest/main/SanitizeHtmlYellowPagesViteBundle.test.ts`
- Create: `test/vitest/main/yellowPagesLegacyRemoval.test.ts`

```typescript
// test/vitest/main/yellowPagesLegacyRemoval.test.ts
// AGENTS rule: no `any`; explicit types; vitest.
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { AI_TOOLS_CONFIG } from "@/config/aiTools.config"; // adjust to the file's actual exported symbol
import { skillsRegistry } from "@/config/skillsRegistry"; // adjust to actual export

const repoRoot = path.resolve(__dirname, "../../../..");

const GONE_FILES: string[] = [
  "src/childprocess/YellowPagesScraper.ts",
  "src/childprocess/YellowPagesScraperProcess.ts",
  "src/controller/YellowPagesController.ts",
  "src/modules/YellowPagesProcessManager.ts",
  "src/modules/YellowPagesOrchestrator.ts",
  "src/modules/YellowPagesModule.ts",
  "src/main-process/communication/yellowPagesIpc.ts",
  "src/utils/yellowPagesProxyLaunch.ts",
  "src/views/pages/yellowpages",
  "vite.yellowPages.config.mjs",
];

describe("yellow pages legacy removal (AC-01/AC-18)", () => {
  it("keeps no production yellow pages files in the application tree", () => {
    for (const rel of GONE_FILES) {
      expect(existsSync(path.join(repoRoot, rel)), `exists: ${rel}`).toBe(false);
    }
  });

  it("exposes no built-in yellow pages AI tool or skill", () => {
    const toolNames = ... // from AI_TOOLS_CONFIG: map each def to `.function.name`
    const skillNames = skillsRegistry.map((s: { name: string }) => s.name);
    for (const names of [toolNames, skillNames]) {
      expect(names).not.toContain("search_yellow_pages");
      expect(names).not.toContain("get_available_yellow_pages_platforms");
    }
  });

  it("registers no yellow pages chat routes", () => {
    const routes = readFileSync(path.join(repoRoot, "src/views/router/authenticatedFeatureRoutes.ts"), "utf8");
    expect(routes.includes("/yellowpages")).toBe(false);
  });

  it("allowlists no yellow pages renderer channels", () => {
    const preload = readFileSync(path.join(repoRoot, "src/preload.ts"), "utf8");
    expect(preload.includes("yellow_pages:")).toBe(false);
  });
});
```
(Adjust the two config imports to the actual exports discovered while writing — read the exported symbols first. If the config exports differ in shape, assert via the same source-scan pattern used above.)

- [x] **Step 1: `git rm` the 16 listed legacy test files.**
- [x] **Step 2: Create the absence test file with real exports (`grep -n "^export" src/config/aiTools.config.ts src/config/skillsRegistry.ts` first).**
- [x] **Step 3: Run:** `yarn testmain test/vitest/main/yellowPagesLegacyRemoval.test.ts`.
- [x] **Step 4: Verify no remaining importer breakage:** `grep -rln "YellowPagesController\|YellowPagesModule\|YellowPagesProcessManager\|YellowPagesScraper\|YellowPagesTaskModule\|YellowPagesResultModule\|YellowPagesPlatformModule\|YellowPagesInitModule\|YellowPagesHealthCheck\|yellowPagesProxyLaunch\|yellowPagesResultFormatter\|yellowPagesIpc" src test agent-harness --include='*.ts' --include='*.vue' -g '!*jpeg*'` — expect ONLY: `src/entity/ScheduleTask.entity.ts` (enum), `src/modules/ScraperAiSupportHandler.ts`-adjacent doc comments, `src/childprocess/{AiSupportBridge,ObserveExecuteLoop,ObserveExecuteExecutor}.ts` doc comments, `src/modules/lifecycle/ownedSpawn.ts:19,58` doc example, `src/entityTypes/pluginExecutionTypes.ts:9-13` comment, shared JapaneseYellowPagesAdapter/ITown/USonar files + their tests + urlHostAllowlist.test/fixture mentions, `platformMatcher.test.ts` fixture strings.
- [x] **Step 5: Commit:** `test: remove legacy yellow pages test harnesses and add AC-01/AC-18 absence tests`.

## Task 10: Cutover documentation + full verification
(Executed as `c0cf16d2`. Full-suite result: identical pre/post failure sets at
HEAD vs pre-change worktree `/tmp/opencode/aifetch-pre-yp` (d62a7ac6): all
remaining vitest-main failures are pre-existing/flaky under parallel load.
`npx tsc --noEmit` green; `yarn test:components` 127 files/955 tests green;
mocha ScheduleAiTools 65 passing, ToolTimeoutPolicy 19 passing.)

**Files:**
- Create: `docs/yellow-pages-cutover.md` documenting: two-stage cutover policy (this removal + plugin delivery), legacy data policy (tables preserved, export via pre-cutover build, scheduled YP tasks no longer run with the "unsupported task type" message, no automatic silent deletion), parity basis (plugin `yellowpages-com` v1; com-sg/CA deferred with the parity matrix evidence in the plugin repo commit `8b16766`), deferred items (Hub publication gate per PRD §27 Phase 3b; in-session AI recovery broker Phase 5), and that release acceptance (staging Hub install → scrape → export/cancel on packaged app) remains the gate before shipping per AC-16..AC-18.

- [x] **Step 1: Write the doc.**
- [x] **Step 2: Full checks:** `npx tsc --noEmit`; `yarn testmain` (all main vitest suites); `yarn test:components`; module tests for touched domains (`env TS_NODE_COMPILER_OPTIONS='{"module": "commonjs"}' npx mocha -r ts-node/register test/modules/ToolTimeoutPolicy.test.ts test/modules/ScheduleAiTools.test.ts`).
- [x] **Step 3: Run the mocha module suite if stable:** `yarn test` (record failures unrelated to this change as pre-existing, if any).
- [x] **Step 4: Commit:** `docs: document yellow pages cutover policy and pending release gates (PRD §28.3)`.

## Self-review notes (checks performed)

1. **Spec coverage:** PRD §17.2 removal table rows map to Tasks 2-8; §28.1.1 inventory items map across Tasks 2-9; §28.3 data policy → Cutover decisions + Task 8/10; §25 absence cases → Task 9; HOST-13 docs were corrected pre-plan (a8c4012d). HOST-12/HUB deferred explicitly.
2. **Shared traps:** proxy type, JapaneseYellowPagesAdapter, ITown/USonar factory rows, shared interfaces, ObserveExecute utils, search scrapers — explicitly preserved (Preserved list).
3. **Compile-green ordering:** ToolExecutor YP branches removed before controller deletion (Task 3 → 5); ProcessManager importers (user.ts, desktopLoginCompletion, ShutdownParticipants) cleaned in the module task (Task 4); ChildProcessAdapterFactory deleted after its 2 consumers are gone.
4. **No `any`,** removals mechanical; each task committed separately.
