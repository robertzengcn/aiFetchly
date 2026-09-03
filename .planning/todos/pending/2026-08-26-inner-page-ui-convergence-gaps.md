---
created: 2026-08-26T18:30:00.000Z
title: Inner-page UI convergence PRD gaps remaining
area: ui
files:
  - docs/prd/inner-page-ui-convergence-prd.md:1050
  - docs/prd/inner-page-ui-convergence-technical-design.md:1494
  - docs/prd/inner-page-ui-convergence-implementation-plan.md:138
  - src/views/types/uiConvergenceTypes.ts:80
  - src/views/router/routeMeta.d.ts:26
  - src/views/router/uiMigrationRegistry.ts:50
  - src/views/router/validateUiRouteCoverage.ts:40
  - src/views/design/tokens.ts:30
  - src/views/styles/tokens.scss:24
  - src/views/plugins/vuetify.ts:20
  - src/views/store/appShell.ts:40
  - src/views/store/appInspector.ts:40
  - src/views/store/appNotices.ts:40
  - src/views/composables/useResponsiveShell.ts:28
  - src/views/composables/useInnerPageShellFlag.ts:10
  - src/views/components/appShell/AppWorkspaceShell.vue:40
  - src/views/components/appShell/AppCenterRouteHost.vue:47
  - src/views/components/appShell/AppInspectorHost.vue:15
  - src/views/components/appShell/LegacyPageFrame.vue:10
  - src/views/components/appShell/AppNoticeHost.vue:10
  - src/views/components/appShell/AppConfirmHost.vue:10
  - src/views/components/pageTemplates/AppPageShell.vue:15
  - src/views/components/pageTemplates/AppPageHeader.vue:10
  - src/views/components/pageTemplates/AppPageToolbar.vue:10
  - src/views/components/pageTemplates/AppPageSection.vue:10
  - src/views/components/pageTemplates/AppPageOverflowMenu.vue:10
  - src/views/components/pageTemplates/AppDataTable.vue:10
  - src/views/components/pageTemplates/PageStateView.vue:10
  - src/views/layout/layout.vue:302
  - test/vitest/main/components/AppPageShell.test.ts:44
  - test/vitest/main/components/uiMigrationCoverage.test.ts:12
  - test/vitest/utilitycode/uiTranslationParity.test.ts:32
---

## Problem

Audit of `inner-page-ui-convergence-prd.md` (PRD §30 24 acceptance criteria, §31 Definition of Done) and `inner-page-ui-convergence-technical-design.md` (design §34 17 bullets, §27 file map, §31 traceability IPR-001..056) against `workspace-ui-redesign` branch. Core architecture is implemented: 50 surfaces classified in `uiMigrationRegistry.ts:51` all `state: "converged"`, typed `ui` contract in `routeMeta.d.ts:26`, coverage validator `validateUiRouteCoverage.ts:1` + `uiMigrationCoverage.test.ts:12` (50-surface, IPR-054 `visible:false` guard, IPR-056 statistics exclusion), centralized tokens `design/tokens.ts:1` + `styles/tokens.scss:11` dual Vuetify themes, shell foundations `AppWorkspaceShell.vue:1` + `AppCenterRouteHost.vue:47` + `AppInspectorHost.vue:1` + `LegacyPageFrame.vue:1` + `AppNoticeHost.vue:1` + stores `appShell.ts:1`/`appInspector.ts:1`/`appNotices.ts:1` + `useResponsiveShell.ts:13` ResizeObserver, and six templates + landing (`AppPageShell.vue:15`, `PageStateView.vue:1`, `LandingPage.vue:1`, etc.) + 4 composables. However the implementation plan explicitly scopes this branch to Phase 0-2 (registry + shell + Schedule vertical slice, `implementation-plan.md:10`); several §27 file-map entries, rollout, and verification items remain incomplete and block PRD §31 / design §34 Done.

### Confirmed incomplete requirements

| Requirement | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| PRD AC 6 / design §27.2 file map — `AppPageHeader.vue`, `AppPageToolbar.vue`, `AppPageSection.vue`, `AppPageOverflowMenu.vue`, `AppDataTable.vue` | Partial | Components are **folded into slots of `AppPageShell.vue:15-37`** (header/toolbar/overflow as named slots) rather than standalone files listed in design §27.2. Functionally covered, but file-map contract is not literally satisfied; no `AppDataTable` wrapper normalizing density/header/selection exists. | Either split out the 5 components as separate files per map (and import them in `AppPageShell`) or record a formal deviation in the implementation plan and prove slot composition satisfies the §11-13 contracts via component tests. |
| Design §27.1 + §20.2 — `AppConfirmHost.vue` | Missing | File listed in design §27.1 (`AppConfirmHost.vue` for shared destructive confirmation per §20.2) **does not exist** in `src/views/components/appShell/` (only `AppCenterRouteHost`, `AppInspectorHost`, `AppNoticeHost`, `AppWorkspaceShell`, `LegacyPageFrame`). Confirmation still uses ad-hoc dialogs. | Create `AppConfirmHost.vue` per §20.2 contract (explicit object name, consequence, cancel-focused, busy/error), wire `useConfirm` composable, and replace feature-local confirms. |
| Design §9.1 composable — `useAppInspector.ts` | Missing as named file | Logic lives in `appInspector.ts:14` Pinia store + direct store imports (`pages/schedule/list.vue:217`), but design §27.3 lists a dedicated `useAppInspector.ts` composable (typed open/close/focus API). | Create `src/views/composables/useAppInspector.ts` thin wrapper over `useAppInspectorStore` exposing the §9-composable API, or document store-as-composable equivalence. |
| Design §7.4 token enforcement — hex literal lint | Missing | No lint rule enforcing §7.4 "literal brand/semantic colors flagged in converged directories". `tokens.scss:11` correctly aliases Vuetify vars, but nothing prevents regression. | Add ESLint/stylelint rule (e.g. `no-restricted-syntax` for `#[0-9a-f]{3,8}` / `rgb(` in `src/views/pages/**` and `pageTemplates/**` with allowlist for previews/tests) and a CI check. |
| PRD AC 23 / IPR-056 — Statistics retention decision | Open | Still classified `statistics-pending-decision` in `uiMigrationRegistry.ts:80` and excluded in `uiMigrationCoverage.test.ts:36`. Product has not confirmed retention vs retirement, so AC 23 cannot be closed and design §26.5 exit gate is blocked. | Obtain product decision, then either migrate `statistic_page` to a template or remove it from navigation and document as retired (update `uiExcludedRoutes` reason). |
| PRD AC 22 / IPR-051 — legacy CSS removal post-stability | Deferred | Tokens centralized but per-family legacy palettes not yet removed. Design §30.3 requires two stable releases / observation window with no rollback before legacy styles are deleted. | Defer until stability window completes; track as debt, do not claim AC 22 complete. |
| PRD AC 24 / design §30.1 rollout — no active route remains on legacy shell | Flag-gated | `useInnerPageShellFlag.ts:10` defaults `innerPageShellV2=false` (rollback = flag off). With flag on, all 50 via `AppWorkspaceShell` + `LegacyPageFrame` geometry; with default off, customers still see legacy shell. Full rollout (§30.1 gate 5) not enabled. | Flip default to `true` after gates 1-4 pass, or document as staged rollout with current flag-off as expected interim state. |

### Required verification gaps

| Contract | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| PRD §27.2 a11y + §27.3 responsive + §27.5 visual / design §28.2-28.6 | Partial | Only `AppPageShell.test.ts:44` (h1/focus/slots) and `uiMigrationCoverage.test.ts:12` exist. Missing: §28.2 component tests for toolbar/bulk-selection, inspector static dispatch + stale rejection, sticky actions/dirty guard, settings save receipts, task decisions/run receipts, reduced-motion; §28.3 route-integration (shell remains mounted, inspector closes on owner change, visible:false coverage); §28.4 Playwright Electron E2E (shell→family nav, inspector preserves list state, create/edit Schedule, running/permission/failure/retry, language switch, resize 1280/900, theme flash); §28.5 visual matrix (landing/collection/form/detail/results/settings/task-decision × wide/medium/narrow × dark/light + loading/empty/no-results/error/forbidden/saved/completed); §28.6 manual keyboard + automated axe/contrast. | Implement the §28 suites (happy-dom component tests remain isolated per design §3.7), wire `test/vitest/main/components/vitest.config.mjs` into CI (`yarn test:convergence`), and capture the visual matrix via Playwright/Chromatic. |
| PRD AC 17-18 / IPR-045-047 responsive + a11y + AC 19 i18n long translations | Partial | `useResponsiveShell.ts:13` measurement + `AppWorkspaceShell.vue:38` thresholds (wide/medium/narrow) exist, but no responsive E2E proving 1280/900 drawer/overlay/sheet behavior per PRD §21, and no long-translation truncation test per IPR-049. | Add Playwright resize tests and a long-string (e.g. de `Donaudampfschiffart`) truncation/accessibility test. |
| Design §31 traceability IPR-001..056 | Partial | Registry + store + template layers implement IPRs, but no 56-row traceability matrix published. | Publish matrix per design §31 (PRD requirement → technical implementation → verification test) and keep it green in CI. |
| Design §34 Done + PRD §31 Done | Blocked | Blocked by the rows above (5 file-map deviations, confirmation host, Statistics decision, responsive/a11y/visual/E2E evidence). | Close the incomplete requirement rows and verification rows above, then flip `innerPageShellV2` default on. |

### Existing positive evidence (preserve)

- Inventory/contracts/registry: 50 surfaces classified, every active route covered or explicitly excluded, IPR-054 never skips `visible:false`, IPR-056 statistics excluded — all asserted in `uiMigrationCoverage.test.ts`.
- Tokens/themes: `design/tokens.ts:1` typed dark/light palettes, `styles/tokens.scss:11` aliases, dual Vuetify themes.
- Shell foundations: `appShell.ts:1` mode/navigation/inspector geometry, `appInspector.ts:1` discriminated union + request generation + focus token, `appNotices.ts:1` bounded queue, `AppWorkspaceShell` three-region grid (left = parent workspace sidebar), `AppCenterRouteHost` stable scroll + legacy/converged frame + inspector cleanup, `LegacyPageFrame` safe geometry.
- Templates + landing + shared states: composable `AppPageShell` with one `h1 tabindex=-1` `focusHeading()` (`AppPageShell.vue:58`), `PageStateView` union `PageLoadState` (`uiConvergenceTypes.ts`), `DefinitionList` dl/dt/dd, `SettingsShell` tabs/rail, plus `useCollectionState`/`useUnsavedChangesGuard`/`useSettingSaveState`/`useAsyncPageState`.
- Localization: `ui.*` namespaces in all 6 language files + `uiTranslationParity.test.ts:32` cross-file tree check.
- Schedule vertical slice: `pages/schedule/list.vue:207` collection + `ScheduleInspector.vue` `kind:"schedule"` typed target proved the architecture.

## Solution

Close in four traceable units (do not flip `innerPageShellV2` default on until all pass):

1. **File-map conformance**: split `AppPageShell` header/toolbar/section/overflow/data-table into their §27.2 files (or record a deviation), add `AppConfirmHost.vue` + `useAppInspector.ts` thin wrapper to satisfy §27, and add the §7.4 hex-literal lint.
2. **Verification suites**: add the §28.2-28.3 component + route-integration tests, the §28.4 Playwright Electron E2E (shell nav, inspector, Schedule CRUD, task states, i18n, resize, theme), the §28.5 visual matrix, and the §28.6 a11y passes; include them in the standard `yarn test:convergence` command.
3. **Product gates**: obtain Statistics retention decision (AC 23) and schedule legacy-CSS removal post-stability-window (AC 22).
4. **Traceability + rollout**: publish the 56-row IPR matrix per design §31 and flip `innerPageShellV2` default on only after the matrices are green — this unblocks PRD §31 / design §34 Done and AC 24.
