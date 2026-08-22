# Inner-Page UI Convergence — Implementation Plan

- **Version**: 1.0
- **Created**: 2026-08-22
- **Source**: [`inner-page-ui-convergence-prd.md`](./inner-page-ui-convergence-prd.md) · [`inner-page-ui-convergence-technical-design.md`](./inner-page-ui-convergence-technical-design.md)
- **Status**: In execution

## Deliverable

The PRD's Phase 0–2 core on this branch: route inventory + migration registry
for all 50 in-scope surfaces, the centralized token system, the shared
authenticated shell (`AppWorkspaceShell` + center route host + typed inspector
host + notice host) gated behind `innerPageShellV2` (default off, LegacyPageFrame
compatibility), the six composable page templates + landing pattern + shared
states, and the **Schedule family as the first converged vertical slice**
(design §4.18). Remaining families render inside the new shell via
LegacyPageFrame and migrate per-family per the design's registry-driven recipe
(IPR-053 explicitly permits independent family migration).

## Stages (each committed separately)

### Stage A — Inventory, contracts, registry (Phase 0)
- `src/views/types/uiConvergenceTypes.ts` — template kinds, migration states,
  route `ui` meta, action/state/setting/inspector contracts (IPR contracts).
- `src/views/router/routeMeta.d.ts` — add optional typed `ui` field only.
- `src/views/router/uiMigrationRegistry.ts` — classify every active
  customer-facing route: family, template, state (`legacy`|`shell`|`converged`),
  explicit exclusions (login/404/statistics-pending-decision/extra-modules),
  never skipping `visible:false` routes (IPR-054).
- `src/views/router/validateUiRouteCoverage.ts` + test: registry covers every
  active router route; 50-surface count assertion.

### Stage B — Tokens and themes (IPR-009..013)
- `src/views/design/tokens.ts` — typed `aifetchlyDark`/`aifetchlyLight`
  palettes (near-black dark direction from the parent preview; complete
  semantic light counterpart).
- `src/views/styles/tokens.scss` — spacing/radius/duration/typography tokens +
  Vuetify aliases (`--app-canvas`, `--app-surface`, …).
- `src/views/plugins/vuetify.ts` — register both themes from the palette.

### Stage C — Shell foundations (IPR-001..008, 044, 045)
- `src/views/store/appShell.ts` (mode/navigation/inspector geometry),
  `appInspector.ts` (discriminated-union targets + request generation +
  focus-restoration token), `appNotices.ts` (bounded queue, action ids).
- `src/views/composables/useResponsiveShell.ts` — single ResizeObserver
  measurement, wide/medium/narrow thresholds (1280/900), rAF debounce.
- `src/views/components/appShell/AppWorkspaceShell.vue` (three-region grid;
  left = the workspace sidebar from the parent redesign), `AppCenterRouteHost.vue`
  (stable scroll container + legacy/converged frame + route-keyed inspector
  cleanup), `LegacyPageFrame.vue`, `AppInspectorHost.vue` (static typed
  registry dispatch), `AppNoticeHost.vue`.
- `innerPageShellV2` rollout flag (localStorage, default off) with the
  design's rollback: off ⇒ existing layout untouched.

### Stage D — Page templates + shared states (IPR-014..043)
- `AppPageShell/Header/Toolbar/Section/OverflowMenu`, `AppDataTable`,
  `PageStateView` (loading/first-use/no-results/error/forbidden/save receipt),
  `FormSection`, `AdvancedSection`, `StickyFormActions`, `DefinitionList`,
  `RunReceipt`, `TaskStateStrip`, `TaskDecisionCard`, `SettingsShell`,
  `SettingFieldFrame`, `LandingPage`.
- Composables: `useCollectionState` (query/selection/paging/request
  generation), `useUnsavedChangesGuard`, `useSettingSaveState`
  (revision-ordered auto-save), `useAsyncPageState` (stale-safe loads).

### Stage E — layout.vue integration
- Flag on ⇒ layout renders `AppWorkspaceShell` (sidebar + center host +
  inspector host) with the old fixed breadcrumb header suppressed; flag off ⇒
  byte-identical current behavior. Route names/paths/params untouched
  (IPR-052).

### Stage F — Schedule vertical slice (Phase 2)
- list.vue → collection page (toolbar, bulk reveal, row overflow, inspector);
  create/edit → form page (sections, sticky actions, dirty guard);
  detail.vue → detail page (identity/status/primary action, DefinitionList,
  run/activity inspector target `kind:"schedule"`); family marked `converged`
  behind `scheduleUiV2` (registry-driven), with LegacyPageFrame fallback.

### Stage G — Localization
- `ui.*` namespaces in all six language files + key-parity test.

### Stage H — Tests
- Unit: registry coverage, shell thresholds, request generation, dirty
  snapshot, save revision ordering, token completeness, translation parity.
- Component (happy-dom): AppPageShell slots/limits, shared states, inspector
  static dispatch + stale rejection, focus restoration, schedule collection.

### Stage I — Verification
- Full suites + tsc/vue-tsc; plan-doc gap record.

## Completion record (2026-08-22)

Stages A–G landed (commits 004c2435..58e72f2a plus this test commit):

- **A** Inventory/contracts/registry: 50 surfaces classified, every active
  route covered or explicitly excluded, 5 coverage tests.
- **B** Tokens: typed dark/light palettes, semantic SCSS aliases, dual
  Vuetify themes, 4 completeness/contrast tests.
- **C** Shell: appShell/appInspector/appNotices stores, ResizeObserver mode
  service, AppWorkspaceShell + AppCenterRouteHost + AppInspectorHost (static
  registry + Schedule inspector) + AppNoticeHost + LegacyPageFrame,
  innerPageShellV2/scheduleUiV2 flags.
- **D** Templates: AppPageShell, PageStateView, DefinitionList, FormSection,
  AdvancedSection, StickyFormActions, TaskStateStrip, TaskDecisionCard,
  RunReceipt, SettingsShell, SettingFieldFrame, LandingPage + 4 composables.
- **E** layout.vue hosts the shell behind the flag (rollback = flag off).
- **F** Schedule family converged (list/create/edit/detail) — the vertical
  slice proving collection/form/detail + typed inspector + shared states.
- **G** ui.* namespaces ×6 languages + parity test.
- **H** Tests: 10 unit (shell modes, stale generations, notice bounds,
  collection resets, save ordering, dirty guard), 7 component (AppPageShell
  slots/focus/hierarchy, PageStateView states), plus earlier registry/token/
  parity suites.

Verification: `yarn testmain` 427 files / 3,777 tests all passing; component
suite — the only failures (8 files / 29 tests in AiChatV2 suites) are
**pre-existing at the pristine base dbd31f1c** (verified by running the suite
at that commit; they need a window.api mock absent in this environment) and
are unrelated to convergence; convergence suites 28/28 green; tsc + vue-tsc
clean on every commit.

## Explicitly deferred (per design §26 family recipe)

Families beyond Schedule (Insights/Settings/Knowledge/Campaign/Search/Email/
Proxy/Social accounts) migrate incrementally after the foundations + first
slice land; Statistics stays excluded pending the product retention decision
(IPR-056); Login/404 receive token alignment in the cleanup phase.
