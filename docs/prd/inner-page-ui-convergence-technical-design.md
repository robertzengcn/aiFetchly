# Inner-Page UI Convergence Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-12
- **Owner**: AiFetchly Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Source requirements**: [`inner-page-ui-convergence-prd.md`](./inner-page-ui-convergence-prd.md)
- **Parent product contract**: [`ai-chat-workspace-ui-redesign-prd.md`](./ai-chat-workspace-ui-redesign-prd.md)
- **Parent technical design**: [`ai-chat-workspace-ui-redesign-technical-design.md`](./ai-chat-workspace-ui-redesign-technical-design.md)
- **Shell refinement technical design**: [`ai-chat-first-application-shell-technical-design.md`](./ai-chat-first-application-shell-technical-design.md) — follow-on authority for the persistent authenticated route parent and default chat center
- **Visual reference**: [`ai-chat-workspace-redesign-preview.html`](../design/ai-chat-workspace-redesign-preview.html)
- **Related test design**: [`playwright-ui-testing-technical-design.md`](./playwright-ui-testing-technical-design.md)

## 1. Purpose

This document defines how AiFetchly will migrate 50 customer-facing inner-page surfaces into the application shell and design language established by the AI Chat Workspace redesign.

It translates the inner-page PRD into:

- Vue component boundaries.
- Router integration.
- Design-token and Vuetify theme architecture.
- Shell, inspector, focus, and responsive state ownership.
- Typed contracts for shared page templates.
- Collection, form, detail, result, settings, task-state, and landing implementations.
- Compatibility rules for existing feature APIs and routed pages.
- Migration sequencing, test strategy, performance budgets, and rollout controls.

This is a design document. It does not modify application behavior by itself.

## 2. Authority and Dependency Model

### 2.1 Document precedence

The documents have the following authority:

1. The AI Chat Workspace PRD owns global product behavior, the three-region shell, chat behavior, artifacts, Activity, Context, and renderer/process performance.
2. The AI Chat Workspace technical design owns the global shell boundary, chat execution architecture, chat stores, and chat inspector behavior.
3. The Inner-Page UI Convergence PRD owns the 50-page scope, template behavior, action placement, migration outcomes, and acceptance criteria for non-chat routes.
4. This document owns the renderer implementation for inner-page convergence.

If this design needs to change the global shell contract, the parent PRD and technical design must be updated in the same logical change.

### 2.2 Shared-shell rule

There must be one authenticated application shell per renderer window. Chat and inner pages plug into that shell. They must not create competing navigation drawers, title bars, inspector hosts, notification hosts, or breakpoint systems.

### 2.3 Domain behavior remains authoritative

Existing renderer APIs, IPC handlers, Modules, Models, database entities, and worker processes remain authoritative for feature behavior. The template system composes presentation around them. It does not become a new business-logic layer.

## 3. Current Architecture Findings

### 3.1 Renderer entry and framework

`src/views/main.ts` currently mounts:

- Vue 3.
- Pinia.
- Vuex.
- Vue Router.
- Vuetify 3.
- Vue I18n.
- Global SCSS.
- Renderer diagnostics.

The convergence design remains within this stack. No framework replacement is required.

### 3.2 Current shell concentration

`src/views/layout/layout.vue` currently owns or coordinates:

- The Vuetify navigation drawer.
- Route navigation.
- Account and plan controls.
- Breadcrumbs and the fixed global header.
- Theme and language actions.
- Route content.
- Route-replacing artifact content.
- Legacy AI chat panel.
- AI Chat V2 dock and resizing.
- Renderer notifications and a separate snackbar.
- Mobile behavior.

This concentration makes it difficult to establish one stable shell while migrating pages independently. The target design decomposes these responsibilities without moving feature-domain logic into the shell.

### 3.3 Current theme system

`src/views/plugins/vuetify.ts` defines a light theme with a single custom primary color. Global SCSS defines additional light/dark variables, while pages such as Insights contain hard-coded light values plus separate `:root[theme="dark"]` overrides.

This produces three styling authorities:

1. Vuetify theme variables.
2. Global custom variables.
3. Page-local literal colors.

The target design creates one semantic token registry and maps Vuetify and application CSS to it.

### 3.4 Current route metadata

`src/views/router/index.ts` contains the active route definitions. `meta.visible` controls navigation presentation, not authorization. `asyncRoutes` is currently empty.

`src/views/router/translatedRoutes.ts` contains a second route description, but its `RouterTranslator.vue` consumer is not mounted by the current application. New UI metadata must not be copied into this dormant duplicate. Route titles should remain translation keys in the active route registry.

### 3.5 Current responsive ownership

`src/views/store/appMain.ts` classifies mobile width at approximately 777px through a global resize listener. Individual pages also define their own media queries. The parent chat design requires layout decisions based on available content width, not only device identity.

The target design centralizes shell mode and exposes container-aware page behavior.

### 3.6 Current page patterns

Representative pages show the migration problems described by the PRD:

- Schedule list independently builds a title area, three primary-looking actions, scheduler status card, filter card, table card, pagination, confirmation dialog, and alert dialog.
- Schedule create and edit wrap a shared form in another card and implement separate loading, error, and result dialogs.
- Schedule table mixes localized and hard-coded text, fixed column widths, several visible row actions, status chips, and a second action menu.
- Campaign uses a separate server-table pattern and feature-local responsive CSS.
- Insights uses page-local colors, a three-column card grid, and independent light/dark selectors.
- System Settings uses a full tree column, a second card column, page-local warning colors, and navigation buttons to other settings routes.

The migration must preserve the underlying API behavior while replacing these duplicated presentation decisions.

### 3.7 Existing test foundation

Renderer component tests use `@vue/test-utils`, Vitest, and a dedicated happy-dom configuration under `test/vitest/main/components/`. Main-process tests remain in the Node environment. This separation must remain because happy-dom changes Node builtin resolution for sibling tests.

Playwright Electron testing has a separate approved technical design. Convergence tests should use that infrastructure when available and must not invent a second Electron E2E boot path.

## 4. Technical Decisions

1. `layout.vue` remains the Vue Router parent route and owns one authenticated application shell.
2. A new `AppWorkspaceShell` provides the global three-region grid. Chat and inner pages become center-surface adapters.
3. The parent chat sidebar is the global left region; inner routes do not mount a second global drawer.
4. The right region is a single static-registry inspector host shared by chat and inner pages.
5. Inner-page shell state uses Pinia. Feature data remains in existing page state, existing stores, and existing APIs.
6. The inspector store holds typed identifiers and presentation state, not full domain records, component instances, HTML, or callbacks.
7. Page templates are composable Vue components. There is no universal page component with feature-condition branches.
8. Vuetify remains the component foundation during migration.
9. One token registry defines semantic colors for both Vuetify and custom CSS.
10. Dark mode follows the parent preview. Light mode remains supported through a complete semantic counterpart.
11. Routes gain one nested, typed `ui` metadata object. Existing loose metadata remains compatible.
12. `translatedRoutes.ts` receives no new convergence metadata and should be retired after a separate usage check.
13. Existing detail routes remain valid during migration even when list selection can open an inspector.
14. Existing feature APIs, IPC, Modules, Models, and database schema do not change solely for convergence.
15. Route families migrate behind additive flags or registry state; the shell can host legacy and converged pages simultaneously.
16. Shell breakpoints derive from measured available width. Pages use container-aware behavior.
17. Shared notices replace duplicate layout message/snackbar hosts after compatibility tests.
18. The Schedule family is the first vertical slice because it exercises collection, form, detail, result/history, task state, confirmation, and responsive behavior.

## 5. Target Renderer Architecture

```text
Vue renderer window
└── App.vue
    └── RouterView
        └── layout.vue
            └── AppWorkspaceShell
                ├── Global left region
                │   └── AiChatWorkspaceSidebar
                │       ├── GlobalNavigation
                │       ├── WorkspaceConversationTree
                │       └── AccountMenu
                ├── Center region
                │   └── AppCenterRouteHost
                │       └── RouterView
                │           ├── AiChatConversationPane
                │           ├── Converged inner page
                │           │   └── AppPageShell
                │           └── LegacyPageFrame
                └── Right region
                    └── AppInspectorHost
                        ├── Chat inspector panels
                        └── Inner-page inspectors

Global overlay hosts
├── AppNoticeHost
├── AppConfirmHost
└── Responsive navigation/inspector sheets
```

### 5.1 Ownership boundaries

| Layer | Owns | Must not own |
| --- | --- | --- |
| `layout.vue` | Router-parent lifecycle and app-shell mounting | Feature tables, forms, fetches, validation, run logic |
| `AppWorkspaceShell` | Three-region layout, shell mode, resizing, overlays | Domain records or feature APIs |
| `AppCenterRouteHost` | Route component boundary, route loading/error presentation | Feature-specific empty or validation states |
| `AppPageShell` | Page identity, toolbar, content geometry, action slots | Global navigation or arbitrary feature branching |
| `AppInspectorHost` | Typed inspector selection, static component dispatch, responsive surface | Full center-page duplication or unvalidated dynamic components |
| Page template | Shared presentation behavior | IPC, database access, feature policy |
| Feature page | Domain data, API calls, validation, route params | New global layout or token palette |

## 6. Shell Integration

### 6.1 Evolving `layout.vue`

`layout.vue` should be reduced in stages:

1. Extract notification rendering into `AppNoticeHost`.
2. Extract account presentation into the shared sidebar.
3. Extract current route content into `AppCenterRouteHost`.
4. Move artifact route replacement into the parent inspector implementation.
5. Remove legacy chat panel after the parent chat rollout allows it.
6. Replace the old fixed breadcrumb header with route-owned `AppPageHeader` or chat header.
7. Keep temporary compatibility adapters until both chat and inner routes use the new shell.

The shell must remain mounted when child routes change. Vue Router already uses `Layout` as the parent for authenticated feature routes, so the migration should reuse that boundary rather than wrap every page separately.

### 6.2 Center route host

`AppCenterRouteHost` renders one child route and supplies:

- A stable scroll container.
- Route-loading presentation.
- Route-error boundary.
- Legacy/converged frame selection.
- Route-keyed inspector cleanup.
- Optional route transition that respects reduced motion.

It must not use a `key` that remounts the entire shell on query-only changes. A child page decides whether a query change requires data reload.

### 6.3 Legacy page frame

During migration, `LegacyPageFrame` normalizes only:

- Center background.
- Maximum available height.
- Outer padding.
- Overflow containment.

It must not restyle feature-internal cards or controls in a way that could break behavior. This allows the new shell and old page content to coexist until a feature family is migrated.

## 7. Design Token Architecture

### 7.1 Single source of truth

Create a typed primitive palette used by Vuetify configuration:

```typescript
export interface AppThemePalette {
  background: string;
  shell: string;
  sidebar: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  surfaceSelected: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  focus: string;
}
```

Provide complete `aifetchlyDark` and `aifetchlyLight` values. The dark palette starts from the approved preview direction. The light palette uses equivalent semantic contrast; pages never choose a separate color by theme.

### 7.2 Vuetify mapping

`src/views/plugins/vuetify.ts` maps palette values to named Vuetify theme colors:

```text
background
surface
surface-variant
primary
secondary
success
warning
error
info
on-background
on-surface
```

Custom aliases use Vuetify variables instead of repeating hexadecimal values:

```scss
:root {
  --app-canvas: rgb(var(--v-theme-background));
  --app-surface: rgb(var(--v-theme-surface));
  --app-text: rgb(var(--v-theme-on-surface));
  --app-accent: rgb(var(--v-theme-primary));
}
```

### 7.3 Structural tokens

`src/views/styles/tokens.scss` defines non-color semantic tokens:

```scss
:root {
  --app-space-1: 4px;
  --app-space-2: 8px;
  --app-space-3: 12px;
  --app-space-4: 16px;
  --app-space-5: 20px;
  --app-space-6: 24px;
  --app-space-8: 32px;

  --app-radius-control: 7px;
  --app-radius-panel: 11px;
  --app-radius-overlay: 16px;

  --app-duration-micro: 100ms;
  --app-duration-short: 160ms;
  --app-duration-medium: 240ms;
}
```

Typography, content widths, control heights, inspector widths, shadow levels, and z-index layers must also be named centrally.

### 7.4 Token enforcement

- Migrated components may use semantic variables and Vuetify theme names.
- Migrated page files may not introduce literal brand or semantic-state colors.
- Feature-specific data visualization palettes require a documented token group.
- Page-local dark-mode selectors are removed during migration.
- A lint check should flag hexadecimal/rgb/hsl literals in converged page directories, with allowlisted exceptions for external content previews and tests.

## 8. Typed Route UI Metadata

### 8.1 Contract

Add a single optional `ui` object to `RouteMeta`:

```typescript
export type InnerPageTemplateKind =
  | "landing"
  | "collection"
  | "form"
  | "detail"
  | "results"
  | "settings";

export type UiMigrationState = "legacy" | "shell" | "converged";

export interface InnerPageRouteUiMeta {
  family: string;
  template: InnerPageTemplateKind;
  migration: UiMigrationState;
  inspector?: "none" | "optional" | "preferred";
  contentWidth?: "reading" | "form" | "wide" | "full";
}
```

`routeMeta.d.ts` adds only `ui?: InnerPageRouteUiMeta`. This avoids tightening existing `title` metadata that may still contain different legacy types.

### 8.2 Metadata uses

The shell uses route UI metadata for:

- Legacy versus converged framing.
- Default center width.
- Inspector availability.
- Telemetry grouping.
- Migration coverage checks.

Metadata must not determine permissions, database access, or whether an action is safe.

### 8.3 Registry validation

A development/test utility walks `router.getRoutes()` and validates:

- Every in-scope route has a `ui` contract.
- Every `converged` route names a known template.
- A route with `inspector: "preferred"` has a registered inspector kind in its feature implementation.
- Excluded routes are explicitly classified.
- No route is considered inaccessible merely because `visible` is false.

### 8.4 Translated route duplication

Do not add `ui` metadata to `translatedRoutes.ts`. Route translation already occurs from keys at render time. After confirming `RouterTranslator.vue` remains unmounted in production and tests, remove the dormant duplicate in a separate cleanup commit. Until then, the active `index.ts` registry is authoritative.

## 9. Shell and Inspector State

### 9.1 Pinia store scope

Create `useAppShellStore` for shell-only state:

```typescript
export type AppShellMode = "wide" | "medium" | "narrow";

export interface AppShellState {
  mode: AppShellMode;
  navigationOpen: boolean;
  navigationCollapsed: boolean;
  inspectorOpen: boolean;
  inspectorWidth: number;
}
```

The store does not hold feature collections, forms, API errors, or selected domain records.

### 9.2 Inspector target contract

Use a discriminated union rather than storing arbitrary component names or payloads:

```typescript
export type AppInspectorTarget =
  | { kind: "schedule"; ownerRoute: string; scheduleId: number }
  | { kind: "campaign"; ownerRoute: string; campaignId: number }
  | { kind: "search-task"; ownerRoute: string; taskId: number }
  | { kind: "email-record"; ownerRoute: string; recordId: number }
  | { kind: "activity"; ownerRoute: string; runId: string }
  | { kind: "chat"; ownerRoute: string; tab: "artifacts" | "activity" | "context" };
```

The final union expands only for inspector-enabled domains. Each variant contains validated identifiers and small presentation selectors, not full records.

### 9.3 Static inspector registry

`AppInspectorHost` maps each `kind` to an allowlisted component through a static registry. It never renders a component path received from route data, IPC, persisted content, or user input.

Each inspector component:

- Loads its record through the existing renderer API.
- Validates loading, missing, error, and permission states.
- Cancels or ignores stale responses after target change.
- Clears full record data when closed or when the owner route changes.

### 9.4 Route change behavior

On route change:

1. If the new route retains the same `ownerRoute`, the page decides whether selection survives.
2. If the owner changes, the inspector closes and clears its target.
3. Focus returns to the route heading after navigation.
4. A stale inspector response is ignored using a monotonically increasing request generation.

### 9.5 Focus restoration

When opening an inspector, the store records a focus-restoration token that resolves to an existing DOM element ID, not a raw element reference. Closing the inspector attempts to focus that origin; if unavailable, focus moves to the page heading.

### 9.6 URL and deep links

Existing detail routes remain canonical deep links. Inspector selection is ephemeral by default. A feature may mirror a selected identifier into a query parameter only when:

- The identifier is safe to expose locally.
- Back/forward navigation remains predictable.
- Reload can restore the inspector through the existing API.
- The full detail route remains compatible.

## 10. Responsive Architecture

### 10.1 One shell measurement system

Replace per-page device checks with one shell measurement service:

- `ResizeObserver` measures the available application-shell width.
- CSS container queries adapt template internals.
- `AppShellMode` changes only when crossing stable thresholds.
- Mode changes are debounced to one animation frame.

Initial thresholds follow the PRD:

| Mode | Available width | Behavior |
| --- | ---: | --- |
| Wide | 1280px and above | Persistent sidebar, center, optional persistent inspector |
| Medium | 900–1279px | Collapsible sidebar and inspector overlay |
| Narrow | Below 900px | Sidebar drawer, center-only work surface, full-height inspector sheet |

The measured width is the application workspace, not `screen.width` and not a user-agent category.

### 10.2 Relationship to `appMain.ts`

`appMain.ts` may preserve a compatibility `isMobile` computed value temporarily. New templates consume `AppShellMode` and CSS containers. The old global resize listener is removed after legacy pages stop depending on it.

### 10.3 Inspector width

- Wide inspector width is clamped to configured minimum and maximum values.
- Medium and narrow overlays derive width from the current container.
- A desktop pixel preference is never reused as an unsafe mobile width.
- Resizing uses pointer events and keyboard-accessible separator controls.

## 11. Shared Page Shell Contract

### 11.1 `AppPageShell`

Proposed props:

```typescript
export interface AppPageShellProps {
  pageId: string;
  titleKey: string;
  descriptionKey?: string;
  contentWidth?: "reading" | "form" | "wide" | "full";
  density?: "compact" | "comfortable";
  busy?: boolean;
}
```

Slots:

- `context`: optional breadcrumb or bounded context label.
- `status`: at most one page-owned summarized status.
- `primary-action`: one primary action.
- `overflow`: infrequent page actions.
- `toolbar`: search, filters, sort, view, and contextual bulk actions.
- default content.

The page shell renders a programmatic `h1`, supports `aria-busy`, and provides a stable focus target.

### 11.2 Action contract

Shared action components use typed presentation data:

```typescript
export type PageActionTone = "primary" | "secondary" | "quiet" | "danger";

export interface PageActionView {
  id: string;
  labelKey: string;
  icon?: string;
  tone: PageActionTone;
  loading?: boolean;
  disabled?: boolean;
  disabledReasonKey?: string;
}
```

Handlers stay in the owning feature component. Callbacks are not stored in Pinia or route metadata.

### 11.3 Content widths

| Width | Use |
| --- | --- |
| `reading` | About, explanatory content, simple detail |
| `form` | Create/edit and settings fields, approximately 640–760px |
| `wide` | Mixed detail and medium tables |
| `full` | Large collections and result tables |

## 12. Shared State Components

### 12.1 State model

```typescript
export type PageLoadState =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "empty"; kind: "first-use" | "no-results" }
  | { state: "error"; messageKey: string; recoverable: boolean }
  | { state: "forbidden"; capabilityKey: string };
```

Raw exception objects and stack traces must not enter presentation props.

### 12.2 Components

- `PageLoadingState`: skeleton structure selected by template.
- `PageEmptyState`: title, explanation, one optional action.
- `PageNoResultsState`: active filter summary and clear action.
- `PageErrorState`: safe explanation, optional retry, Activity link.
- `PageForbiddenState`: unavailable capability and enablement guidance.
- `PageSaveReceipt`: saving, saved, or failed state near a setting/form action.
- `RunReceipt`: compact terminal task result.

### 12.3 Request-generation guard

Shared asynchronous composables maintain a request generation:

```text
start request N
  -> if response generation equals current generation, apply
  -> otherwise discard stale response
```

This prevents route, filter, or inspector changes from applying older results after newer state.

## 13. Collection Template

### 13.1 Component hierarchy

```text
CollectionPage
├── AppPageShell
├── CollectionToolbar
│   ├── SearchField
│   ├── FilterGroup
│   ├── SortControl
│   └── BulkActionBar
├── CollectionBody
│   └── Feature table/list
├── CollectionPagination
└── AppInspectorHost target
```

### 13.2 Do not over-generalize domain tables

The shared layer owns toolbar, selection, states, column-priority classes, and geometry. Feature tables retain domain-specific columns and cell renderers. A single schema-driven table for all domains would create type erasure and feature-condition branches.

An optional `AppDataTable` wrapper may normalize Vuetify defaults:

- Density.
- Header and row height.
- Loading and no-data slots.
- Keyboard selection.
- Sticky header.
- Row key.
- Horizontal overflow.
- Column-priority classes.

### 13.3 Collection state composable

```typescript
export interface CollectionQuery<TFilter extends Record<string, unknown>> {
  search: string;
  filters: TFilter;
  page: number;
  pageSize: number;
  sort: ReadonlyArray<{ key: string; order: "asc" | "desc" }>;
}
```

`useCollectionState` owns UI query state and request generation. It accepts a feature-supplied loader. It does not call IPC itself.

### 13.4 Search behavior

- Input is debounced only when remote loading would otherwise occur per keystroke.
- Enter can submit immediately.
- Clearing search resets the page index.
- Filter changes reset the page index unless the feature explicitly supports stable cursors.
- Existing content remains visible during background refresh.

### 13.5 Selection behavior

- Selection keys use stable domain identifiers.
- Single selection can open an inspector.
- Multi-selection reveals bulk actions in the toolbar.
- Selection is cleared when filters remove the selected records.
- Selection does not imply authorization for an action.

### 13.6 Responsive columns

Feature column definitions assign presentation priority:

```typescript
export type ColumnPriority = "required" | "important" | "optional";
```

- Required columns remain in all modes.
- Important columns remain in wide/medium modes.
- Optional columns may move into the inspector or stacked row detail.
- Actions collapse into one row overflow before business columns disappear.

## 14. Form Template

### 14.1 Component hierarchy

```text
FormPage
├── AppPageShell
├── AppForm
│   ├── FormSection
│   │   ├── FormField
│   │   └── FieldMessage
│   ├── AdvancedSection
│   └── StickyFormActions
└── AppConfirmHost
```

### 14.2 Validation ownership

Shared components render labels, help, required state, and error association. Domain pages retain validation rules and submission behavior. Vuetify validation results are normalized into strings or translation keys before presentation.

### 14.3 Dirty-state guard

`useUnsavedChangesGuard` receives:

- A stable initial snapshot function.
- A current snapshot function.
- A submitting flag.
- A reset-after-save callback.

It uses `onBeforeRouteLeave` and a renderer `beforeunload` listener while dirty. It does not serialize files, secrets, browser sessions, or non-repeatable handles into drafts.

### 14.4 Sticky actions

Sticky actions live inside the center scroll container, not the window. The bar:

- Respects safe areas and inspector width.
- Does not cover validation messages.
- Contains cancel and one commit action.
- Separates destructive actions into overflow or a danger section.

### 14.5 Advanced sections

Advanced sections use native disclosure semantics or an accessible expansion component. Their collapsed state may be stored locally by page ID when it contains no sensitive information.

## 15. Detail Template

### 15.1 Component hierarchy

```text
DetailPage
├── AppPageShell
│   ├── DetailIdentity
│   ├── StatusSummary
│   └── Primary action
├── DetailSummary
├── DetailTabs
│   ├── Overview
│   ├── Runs
│   ├── Results
│   └── Configuration
└── DefinitionList
```

### 15.2 Status ownership

One selector chooses the page-level status summary. Sub-record statuses remain in their rows. The same record status must not be repeated in the page header, a large alert, a summary card, and tab label.

### 15.3 Definition list

Stable metadata uses semantic `<dl>`, `<dt>`, and `<dd>` output through `DefinitionList`. Values support copy and safe link affordances. Disabled form fields are not used for read-only detail.

### 15.4 Existing detail routes

Existing detail routes remain canonical. An inspector may show a bounded preview and link to the full detail route. This provides progressive migration without breaking bookmarks, AI navigation, redirects, or back/forward history.

## 16. Results and Activity Template

### 16.1 Separation of data

The result center contains customer business output. Activity contains execution mechanics.

```text
Center results
├── Outcome receipt
├── Search/filter/export
└── Result rows

Activity/inspector
├── Run timing
├── Attempts and retries
├── Tool or worker phases
├── Safe errors
└── Selected source/validation detail
```

### 16.2 Progressive results

- New results append or update by stable identifier.
- Existing row position remains stable unless the customer explicitly sorts by changing data.
- Batches apply at a bounded cadence.
- Terminal completion flushes immediately.
- Large sets use existing server pagination where available; client virtualization is introduced only for APIs that already return a large bounded set.

### 16.3 Export

Export handlers remain feature-owned. `ResultToolbar` provides placement and disabled/loading state. Export does not require loading all result data into the renderer if the existing API can generate a file in the main process.

## 17. Settings and Catalog Template

### 17.1 Settings navigation

`SettingsShell` renders categories inside the center page:

- Tabs when there are five to seven primary categories.
- A compact in-page rail when more categories are necessary and width permits.
- A select/menu in narrow mode.

It does not mount another global navigation drawer.

### 17.2 Setting field contract

```typescript
export type SettingSaveState = "idle" | "saving" | "saved" | "error";

export interface SettingFieldView {
  id: string;
  labelKey: string;
  descriptionKey: string;
  state: SettingSaveState;
  disabled?: boolean;
  errorKey?: string;
}
```

The feature page owns the actual typed value and save API.

### 17.3 Auto-save sequencing

Independent setting updates use per-setting sequencing:

```text
edit A -> save A revision 1
edit A -> save A revision 2
response revision 1 arrives -> ignore presentation update
response revision 2 arrives -> show Saved
```

If the existing API cannot safely accept overlapping updates, the composable serializes updates per setting. Failure preserves the entered value and offers retry or revert.

### 17.4 Atomic settings

Settings that must validate or commit together use a normal form and explicit save. Auto-save must not be introduced solely for visual consistency when it could create partial configuration.

### 17.5 Catalog reuse

Plugins, skills, MCP servers, providers, subagents, and knowledge sources use collection and detail primitives. Domain-specific permission, installation, health, and diagnostics components remain feature-owned.

## 18. Task-State and Decision Template

### 18.1 State contract

```typescript
export type TaskPresentationState =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_permission"
  | "awaiting_user"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";
```

Domain adapters map existing feature enums into this presentation enum. The shared UI must not persist this enum back into feature tables unless a separate domain change requires it.

### 18.2 Components

- `TaskStateStrip`: ongoing summary and one or two actions.
- `TaskDecisionCard`: blocking permission or customer input.
- `TaskFailureState`: safe explanation, retry eligibility, details link.
- `RunReceipt`: compact terminal outcome.
- `AppStatusBadge`: small state display for a row or definition value.

### 18.3 State ownership

Each domain provides one pure selector that decides:

- Authoritative presentation state.
- Primary action.
- Secondary action.
- Human summary key.
- Whether Activity detail is available.

The page header, strip, row, and inspector consume this projection at their appropriate scope instead of independently inferring status.

## 19. Landing and Insights Pattern

`LandingPage` composes:

- `ContinueWorkList`.
- `AttentionList`.
- `RecentOutcomeList`.
- `SuggestedActionList`.

It does not define a generic statistic-card grid. Each item uses a stable route target, localized title, localized description, semantic state, and one clear navigation action.

Insights may initially adapt its existing navigation data into these lists without requiring new backend aggregation. Recent outcomes and attention are added only when authoritative APIs exist.

## 20. Notifications, Confirmation, and Receipts

### 20.1 Notice host

`layout.vue` currently renders both a custom message stack and `NoticeSnackbar`. Replace them with one `AppNoticeHost` backed by `useNoticeStore`.

```typescript
export interface AppNotice {
  id: string;
  tone: "success" | "info" | "warning" | "error";
  messageKey: string;
  parameters?: Record<string, string | number>;
  timeoutMs?: number;
  action?: { labelKey: string; actionId: string };
}
```

Action callbacks remain in an allowlisted action dispatcher or owning component; arbitrary closures are not persisted in the store.

### 20.2 Confirmation host

Routine destructive confirmation uses a shared dialog surface with:

- Explicit object name.
- Consequence.
- Cancel as initial focus.
- Destructive action label matching the operation.
- Busy and error state.

High-risk feature-specific confirmations may keep custom bodies but use the same overlay and focus contract.

### 20.3 Inline receipts

Save and completion receipts remain near their owning object. Global notices are reserved for cross-page events or outcomes whose origin is no longer visible.

## 21. Localization Architecture

### 21.1 Keys

Shared templates use grouped keys:

```text
ui.page.*
ui.collection.*
ui.form.*
ui.detail.*
ui.results.*
ui.settings.*
ui.task.*
ui.state.*
ui.inspector.*
ui.actions.*
```

Feature nouns and domain-specific copy remain under their existing feature namespaces.

### 21.2 Six-file parity

Every new key is added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

A test extracts the new shared-key namespace and verifies key parity across all six files.

### 21.3 No localized domain state

Components receive stable enums or domain values and translate at render time. Route metadata continues to store translation keys rather than computed translations. Persisted records and IPC payloads never contain localized presentation state solely for the UI.

## 22. Accessibility and Focus Architecture

### 22.1 Semantic responsibilities

- `AppPageShell` owns the page `h1` and main landmark.
- `CollectionPage` owns table/list naming and selection summary.
- `AppDataTable` preserves real headers and row semantics.
- `SettingsNav` follows tabs, listbox, or navigation semantics according to presentation.
- `DefinitionList` renders semantic definition markup.
- `AppInspectorHost` renders a complementary region in wide mode and dialog/sheet semantics in overlay mode.
- `AppNoticeHost` uses restrained live regions.

### 22.2 Focus sequence

Route navigation:

1. Complete route transition.
2. Focus the route `h1` with a programmatic `tabindex="-1"` target.
3. Do not announce every data refresh.

Inspector opening:

1. Record origin token.
2. Wide non-modal inspector keeps focus on the selected row unless the customer requests immediate detail focus.
3. Medium/narrow modal sheet moves focus to its heading and traps focus.
4. Closing restores origin or page heading.

Decision cards:

- Receive focus only when blocking progress and triggered by the customer’s action.
- Expose heading, consequence, and ordered actions.
- Do not announce progress ticks.

### 22.3 Reduced motion

Global CSS reduces or removes route transitions, inspector slides, hover transforms, spinners, and skeleton shimmer when `prefers-reduced-motion: reduce` is active. Static status icons and text remain.

## 23. Security Boundaries

- The template layer never receives Node.js or Electron privileges.
- All privileged work continues through the existing preload and typed renderer APIs.
- Route metadata and inspector selection are presentation inputs, not authorization.
- Inspector APIs validate identifiers through existing main-process handlers and Modules.
- Raw stack traces, command output, secrets, tokens, HTML, and large result bodies are not placed in notices or generic page state.
- Any HTML artifact remains in the sandboxed artifact inspector defined by the parent technical design.
- Shared components must not introduce `v-html` for labels, descriptions, errors, or result summaries.
- External links use existing safe-open behavior and explicit schemes.
- Feature AI IPC handlers retain the mandatory AI-enable check before request parsing or provider work.

No new database entity, worker process, IPC channel, or permission model is required for the template system itself.

## 24. Performance Design

### 24.1 Structural guarantees

- One renderer per application window remains sufficient.
- The authenticated app shell does not remount on child route navigation.
- Only one inner route component is active unless an explicitly bounded keep-alive policy is approved.
- The inspector mounts one selected detail component.
- Closed inspectors release full records and subscriptions.
- Feature collections remain paged or virtualized.
- Background refresh retains stable content.
- Shell resize observation is centralized.

### 24.2 Budgets

| Measurement | Target |
| --- | --- |
| Route selection feedback | Under 100ms |
| Cached page shell visible | Under 150ms |
| Inspector open feedback | Under 100ms |
| Inspector cached detail | Under 200ms |
| Remote search presentation after response | Under 100ms renderer work |
| Filter change | No full application-shell render |
| Shell resize apply | At most once per animation frame |
| Notice enqueue-to-visible | Under 100ms |
| Additional Electron renderers per route/record | 0 |

Feature data-fetch latency is measured separately from renderer presentation.

### 24.3 Collection performance

- Server-backed tables preserve server paging.
- Client-side lists over a defined threshold use virtualization or incremental rendering.
- Column visibility changes use CSS/container state, not remounting the entire dataset.
- Bulk selection stores identifiers rather than cloned records.
- Result updates apply in batches with stable keys.

## 25. Compatibility with Existing Feature APIs

### 25.1 API preservation

Pages continue importing from `src/views/api/*`. A template does not import feature APIs. Feature pages pass presentation data and handlers downward.

### 25.2 Database and IPC

This design requires no database migration. If a later feature persists UI preferences, it must use the existing Token/Module boundaries and must not place database access in the renderer or IPC handler.

### 25.3 Existing route behavior

- Route names and parameter formats remain stable during initial migration.
- Existing create, edit, detail, result, and list URLs remain valid.
- AI navigation manifest paths remain valid.
- Redirects and post-submit destinations remain unchanged unless the PRD explicitly changes the customer flow.

### 25.4 Dialog compatibility

Feature-specific dialogs may remain while the page shell migrates. They adopt shared overlays in a later atomic change after their behavior is covered by tests.

## 26. Migration Architecture

### 26.1 Route-family registry

Create a migration registry keyed by route name:

```typescript
export interface UiMigrationEntry {
  routeName: string;
  family: string;
  template: InnerPageTemplateKind;
  state: UiMigrationState;
}
```

The registry is validated against Vue Router in tests. It supports coverage reporting and rollout without treating navigation visibility as scope.

### 26.2 Feature flags

Use two layers:

- `innerPageShellV2`: enables the shared authenticated shell.
- Per-family enablement for converged content, such as `scheduleUiV2` or registry-driven family state.

Flags are rollout controls, not permissions. They may use the existing local settings mechanism. A disabled family renders `LegacyPageFrame` within the same shell.

### 26.3 Vertical-slice migration

For each family:

1. Add route UI metadata and coverage test.
2. Add behavior-parity component tests.
3. Wrap the page with `AppPageShell`.
4. Move page actions and toolbar controls.
5. Adopt shared states.
6. Adopt its primary template.
7. Add inspector support when useful.
8. Apply responsive and accessibility behavior.
9. Add six-language keys.
10. Remove obsolete local palette and shell styles.
11. Mark the family `converged` only after test and visual gates pass.

### 26.4 Schedule vertical slice

Schedule migration proves the architecture:

| Existing surface | Target composition |
| --- | --- |
| `schedule/list.vue` | Collection page + scheduler task strip + optional schedule inspector |
| `ScheduleTable.vue` | Feature table inside collection body; row overflow and column priority |
| `schedule/create.vue` | Form page + `ScheduleForm` + sticky actions |
| `schedule/edit.vue` | Form page + shared loading/error + dirty guard |
| `schedule/detail.vue` | Detail page + definition list + run/activity inspector |
| `ExecutionHistoryTable.vue` | Results/activity pattern |
| Status badge widgets | Shared presentation adapter with schedule-specific selector |

The existing schedule APIs and IPC tests remain unchanged.

### 26.5 Migration phases

#### Phase 0: Inventory and classification

- Validate 50 surfaces against active router components.
- Classify every route as excluded, legacy, shell, or converged.
- Decide Statistics retention before implementation.
- Capture representative screenshots and behavior tests.

Exit gate: route coverage report has no unclassified active customer page.

#### Phase 1: Tokens and shell foundations

- Add theme palettes and semantic tokens.
- Add `AppWorkspaceShell`, route host, inspector host, notice host, and shell store.
- Keep all feature pages in `LegacyPageFrame`.

Exit gate: shell can host current routes without behavior changes.

#### Phase 2: Shared templates and Schedule vertical slice

- Implement page shell and six template foundations.
- Migrate Schedule pages.
- Measure responsive, focus, table, and form behavior.

Exit gate: Schedule passes parity, accessibility, responsive, and visual tests.

#### Phase 3: High-exposure platform pages

- Insights.
- Settings and customization.
- Knowledge.
- Plugins, skills, providers, and subagents.
- Social accounts.

Exit gate: primary navigation no longer opens an incompatible page shell.

#### Phase 4: Automation families

- Campaign and social tasks.
- Search and email extraction.
- Yellow Pages and map scraper.

Exit gate: all six templates work in more than one domain.

#### Phase 5: Email and network families

- Email marketing overview and bulk send.
- Templates, filters, and email services.
- Received email and reply audit.
- Proxy management.

Exit gate: all 50 in-scope surfaces are converged or explicitly approved for deferral.

#### Phase 6: Cleanup and rollout

- Remove dormant duplicate styles and local palettes.
- Consolidate notices and confirmations.
- Remove compatibility `isMobile` use from converged pages.
- Resolve retained utility surfaces.
- Run full Electron E2E and visual review.

Exit gate: no converged route depends on legacy page-shell CSS.

## 27. Implementation File Map

### 27.1 New design and shell files

| Proposed file | Responsibility |
| --- | --- |
| `src/views/design/tokens.ts` | Typed light/dark primitive palettes |
| `src/views/styles/tokens.scss` | Semantic structural and Vuetify alias tokens |
| `src/views/types/uiConvergenceTypes.ts` | Route, shell, inspector, action, state, and template contracts |
| `src/views/store/appShell.ts` | Shell mode, navigation, inspector geometry |
| `src/views/store/appInspector.ts` | Typed inspector target and request generation |
| `src/views/store/appNotices.ts` | Bounded notice queue |
| `src/views/components/appShell/AppWorkspaceShell.vue` | Three-region authenticated shell |
| `src/views/components/appShell/AppCenterRouteHost.vue` | Route boundary and legacy/converged frame |
| `src/views/components/appShell/AppInspectorHost.vue` | Static typed inspector dispatch |
| `src/views/components/appShell/LegacyPageFrame.vue` | Safe compatibility geometry |
| `src/views/components/appShell/AppNoticeHost.vue` | Global notice presentation |
| `src/views/components/appShell/AppConfirmHost.vue` | Shared confirmation presentation |

### 27.2 New page-template files

| Proposed file | Responsibility |
| --- | --- |
| `src/views/components/pageTemplates/AppPageShell.vue` | Identity, status, action, toolbar, content hierarchy |
| `src/views/components/pageTemplates/AppPageHeader.vue` | Page heading and bounded controls |
| `src/views/components/pageTemplates/AppPageToolbar.vue` | Search, filters, sort, view, and bulk actions |
| `src/views/components/pageTemplates/AppPageSection.vue` | Flat section hierarchy |
| `src/views/components/pageTemplates/AppPageOverflowMenu.vue` | Infrequent actions |
| `src/views/components/pageTemplates/AppDataTable.vue` | Normalized table geometry and slots |
| `src/views/components/pageTemplates/PageStateView.vue` | Shared loading/empty/error/forbidden states |
| `src/views/components/pageTemplates/FormSection.vue` | Labelled form section |
| `src/views/components/pageTemplates/AdvancedSection.vue` | Accessible disclosure |
| `src/views/components/pageTemplates/StickyFormActions.vue` | Reachable form actions |
| `src/views/components/pageTemplates/DefinitionList.vue` | Semantic read-only metadata |
| `src/views/components/pageTemplates/RunReceipt.vue` | Compact terminal outcome |
| `src/views/components/pageTemplates/TaskStateStrip.vue` | Ongoing state and actions |
| `src/views/components/pageTemplates/TaskDecisionCard.vue` | Blocking customer decision |
| `src/views/components/pageTemplates/SettingsShell.vue` | Category-responsive settings layout |
| `src/views/components/pageTemplates/SettingFieldFrame.vue` | Label, help, control, and save state |
| `src/views/components/pageTemplates/LandingPage.vue` | Continue, attention, outcome, and suggested actions |

### 27.3 New composables and router support

| Proposed file | Responsibility |
| --- | --- |
| `src/views/composables/useResponsiveShell.ts` | Resize observation and shell mode |
| `src/views/composables/useAppInspector.ts` | Typed open/close/focus API |
| `src/views/composables/useCollectionState.ts` | Query, selection, paging, request generation |
| `src/views/composables/useUnsavedChangesGuard.ts` | Dirty snapshot and navigation guard |
| `src/views/composables/useSettingSaveState.ts` | Per-setting save sequencing |
| `src/views/composables/useAsyncPageState.ts` | Safe load state and stale-response guard |
| `src/views/router/uiMigrationRegistry.ts` | Route-family template and migration classification |
| `src/views/router/validateUiRouteCoverage.ts` | Development/test coverage validation |

### 27.4 Existing files to evolve

| Existing file | Change direction |
| --- | --- |
| `src/views/layout/layout.vue` | Reduce to shell composition and remove duplicated hosts |
| `src/views/plugins/vuetify.ts` | Register complete AiFetchly light/dark themes |
| `src/views/styles/index.scss` | Load semantic tokens before shared styles |
| `src/views/styles/var.scss` | Replace competing theme literals with aliases or retire |
| `src/views/styles/layout.scss` | Remove old fixed header/drawer geometry after shell rollout |
| `src/views/styles/mobile.scss` | Retire device-wide compatibility rules after page migration |
| `src/views/store/appMain.ts` | Preserve theme; replace width listener with shell-mode compatibility |
| `src/views/router/index.ts` | Add typed `ui` metadata and keep route paths/names stable |
| `src/views/router/routeMeta.d.ts` | Add typed nested `ui` contract |
| `src/views/components/breadcrumbs/breadcrumbs.vue` | Replace old fixed global breadcrumb usage with page context |
| `src/views/pages/insights/index.vue` | Replace card grid/local palette with landing pattern |
| `src/views/pages/systemsetting/index.vue` | Replace tree/card shell with SettingsShell while preserving setting APIs |
| `src/views/pages/schedule/*` | First full template migration |

## 28. Testing Strategy

### 28.1 Pure unit tests

Test without Vue mounting:

- Route migration registry coverage.
- Status projection precedence.
- Shell-mode threshold selection.
- Column-priority projection.
- Collection query reset rules.
- Stale request-generation rejection.
- Dirty-snapshot comparison.
- Setting save revision ordering.
- Translation-key parity.
- Token palette completeness.

### 28.2 Component tests

Use the existing happy-dom component configuration for:

- `AppPageShell` heading and slot placement.
- Primary-action limit and overflow behavior.
- Toolbar and bulk-selection transitions.
- Inspector static dispatch and stale response handling.
- Focus restoration.
- Shared page states.
- Sticky form actions and dirty guards.
- Settings save receipts.
- Task decisions and run receipts.
- Reduced-motion classes and semantic labels.
- Representative Schedule collection/form/detail flows with mocked renderer APIs.

Do not change the main-process Vitest environment to happy-dom.

### 28.3 Route integration tests

- Shell remains mounted across child navigation.
- Route params and names remain compatible.
- Inspector closes on owner-route change.
- Query-only navigation does not remount the entire shell.
- Legacy and converged pages coexist.
- Excluded routes remain classified.
- `visible: false` does not remove a route from coverage.

### 28.4 Electron E2E tests

Use the approved Playwright Electron boot path when implemented:

- Navigate from the new shell to representative feature families.
- Open a list row in the inspector and preserve list state.
- Navigate to the canonical detail route.
- Create and edit a Schedule with validation and dirty-state protection.
- Exercise running, permission, failure, retry, and completion states.
- Switch language and verify headings/actions update.
- Resize through wide, medium, and narrow modes without losing page state.
- Verify theme switching without page-local palette flashes.
- Confirm no new renderer process appears per page or inspector.

### 28.5 Visual regression matrix

Capture at minimum:

| Template | Wide | Medium | Narrow | Dark | Light |
| --- | --- | --- | --- | --- | --- |
| Landing | Yes | Yes | Yes | Yes | Yes |
| Collection | Yes | Yes | Yes | Yes | Yes |
| Form | Yes | Yes | Yes | Yes | Yes |
| Detail | Yes | Yes | Yes | Yes | Yes |
| Results | Yes | Yes | Yes | Yes | Yes |
| Settings | Yes | Yes | Yes | Yes | Yes |
| Task decision | Yes | Yes | Yes | Yes | Yes |

Also capture loading, first-use empty, no-results, error, forbidden, saved, and completed states.

### 28.6 Accessibility tests

- Automated accessible-name, role, and contrast checks where tooling supports them.
- Manual keyboard pass for every template.
- Focus trap and restoration for overlay inspector and confirmation.
- Table header and row selection semantics.
- Form error association.
- Status understanding in a desaturated view.
- Reduced-motion verification.

## 29. Observability and Diagnostics

Development diagnostics may expose:

- Current shell mode.
- Navigation and inspector open state.
- Active route and UI migration classification.
- Mounted inspector kind.
- Inspector request generation.
- Collection visible row count.
- Route transition and inspector-open timing.
- Stale response discard count.
- Notice queue depth.

Diagnostics must not expose record bodies, search text, form values, credentials, emails, tokens, or result content.

Suggested metrics:

- Converged route coverage by family.
- Route render p50/p95.
- Inspector open p50/p95.
- Page load-state duration by feature, without identifiers.
- Stale request discard count.
- Unsaved-navigation confirmation count.
- Shared error and retry presentation count by safe error code.
- Responsive mode distribution.
- Accessibility and localization defects found before rollout.

## 30. Rollout and Rollback

### 30.1 Rollout gates

1. Tokens and shell run with legacy pages without behavior changes.
2. Schedule vertical slice passes all gates.
3. High-exposure pages migrate behind family enablement.
4. Automation and email families migrate in bounded groups.
5. Full rollout occurs only after Electron E2E and visual review.

### 30.2 Rollback

- Disable a family’s converged state and render it through `LegacyPageFrame`.
- Keep route names, parameters, and APIs unchanged so rollback does not require data migration.
- Keep semantic tokens even if one family rolls back; legacy pages may safely inherit only outer-shell colors and geometry.
- Do not delete legacy feature styles until the family completes its stability window.

### 30.3 Cleanup trigger

Remove a legacy family path only after:

- Two stable releases or an equivalent approved observation window.
- No rollback during the window.
- Feature behavior, accessibility, localization, and visual tests remain green.
- Product confirms no retained legacy-only workflow.

## 31. Requirements Traceability

| PRD requirements | Technical implementation | Verification |
| --- | --- | --- |
| IPR-001–003 | Persistent `AppWorkspaceShell`, center route host, route-owned page heading | Route integration and E2E navigation tests |
| IPR-004–008 | Page action slots, toolbar, overflow, typed optional inspector | Component action and inspector tests |
| IPR-009–013 | Typed theme palettes, semantic SCSS aliases, token lint rule | Palette completeness, lint, and visual tests |
| IPR-014–018 | Collection template, selection, request generation, bounded data table | Collection component and performance tests |
| IPR-019–025 | Form sections, sticky actions, dirty guard, field-owned validation | Form component and E2E create/edit tests |
| IPR-026–031 | Detail/result templates, definition list, result toolbar, safe retry selector | Detail/results component and E2E tests |
| IPR-032–037 | SettingsShell, SettingFieldFrame, save sequencing, catalog composition | Settings component and API-mock tests |
| IPR-038–042 | Task presentation adapter, state strip, decision card, terminal receipt | State selector, component, and workflow tests |
| IPR-043–044 | Shared page-state union and stable route host | State fixture and route-loading tests |
| IPR-045–046 | Shell-mode service, overlay/sheet inspector, responsive actions | Responsive component and E2E resize tests |
| IPR-047 | Semantic templates and focus-restoration contract | Keyboard and focus tests |
| IPR-048–050 | Six-file key parity, flexible layout, reduced-motion CSS | Localization, text expansion, and motion tests |
| IPR-051–053 | LegacyPageFrame, API preservation, per-family migration registry | Compatibility and mixed-mode tests |
| IPR-054–056 | Route coverage validator and explicit exclusions | Registry coverage test and product retention record |

## 32. Risks and Mitigations

| Risk | Failure mode | Mitigation |
| --- | --- | --- |
| General template becomes a second framework | Feature work slows and types disappear | Keep templates composable and feature tables/forms domain-owned |
| Shell and parent chat design diverge | Two competing navigation/inspector systems | One `AppWorkspaceShell`; chat is a center/inspector adapter |
| Token values are duplicated | Dark/light drift and inconsistent states | Typed palette plus semantic aliases and literal-color lint |
| Route metadata becomes authorization | Hidden routes are skipped or exposed incorrectly | Metadata is presentation-only; preserve existing guards and APIs |
| Inspector applies stale response | Wrong record appears after fast selection | Request generation and owner-route validation |
| Inspector store retains sensitive data | Records persist after navigation | Store identifiers only; component clears fetched detail on close |
| Auto-save responses arrive out of order | UI reports older value as saved | Per-setting revision ordering or serialization |
| Dirty guard blocks safe navigation | Customers see excessive confirmation | Compare normalized meaningful fields and disable guard during submit |
| Legacy styles leak into converged pages | Visual drift and specificity bugs | Directory-scoped convergence styles and phased legacy removal |
| Hard-coded page colors survive | Theme switching flashes or loses contrast | Token lint, visual matrix, remove page dark selectors |
| Per-page resize listeners accumulate | Resize jank and memory growth | One ResizeObserver service and CSS containers |
| Table abstraction hides domain semantics | Cells become generic strings | Feature-owned slots, typed columns, optional wrapper only |
| Full page remount on query changes | Filters and scroll are lost | Stable shell/route keys and page-owned query handling |
| Shared notice callbacks become unsafe | Stale or arbitrary actions execute | Store action IDs, not closures; owning dispatcher validates lifecycle |
| E2E stack is duplicated | Conflicting test boot paths | Reuse approved Playwright Electron design |
| 50-page migration stalls halfway | Customers see two products | Family flags, LegacyPageFrame, coverage report, release gates |

## 33. Explicitly Rejected Alternatives

### 33.1 One renderer per inner page

Rejected. Vue Router and one application renderer already isolate page components sufficiently. Additional Electron renderers would increase memory, lifecycle complexity, and security surface without solving template consistency.

### 33.2 One schema-driven page renderer

Rejected. The domains contain different tables, forms, validation, decisions, and result cells. A universal schema would erase useful types and accumulate conditional behavior.

### 33.3 Rewrite all 50 pages before shipping

Rejected. A single cutover increases regression risk and delays feedback. Shared foundations plus family migration provide reversible progress.

### 33.4 Treat `meta.visible: false` as internal

Rejected. Current metadata hides navigation but does not prevent direct, linked, redirected, or AI-assisted access.

### 33.5 Replace Vuetify during convergence

Rejected. Framework replacement adds unrelated risk. Vuetify can consume the new tokens and shared composition patterns.

### 33.6 Put all details in route pages

Rejected. Full navigation for every selection loses list context. The inspector handles bounded detail while canonical routes remain available.

### 33.7 Put all actions in page headers

Rejected. It recreates the clutter removed by the parent redesign. Actions remain near their owning object and rare actions move to overflow.

### 33.8 Store full records in the inspector store

Rejected. It duplicates domain state, increases stale-data risk, and retains data after the page no longer owns it.

## 34. Definition of Done

The technical implementation is complete when:

- One authenticated `AppWorkspaceShell` hosts chat and inner routes.
- All 50 in-scope page surfaces have validated route UI metadata.
- All 56 PRD requirements have implementation and verification coverage.
- Dark and light themes use complete centralized semantic tokens.
- No converged page contains an unapproved local brand or semantic palette.
- Six composable templates plus the landing pattern are production-ready.
- Schedule proves the full vertical slice before broad rollout.
- Inspector state is typed, identifier-only, stale-safe, route-scoped, and focus-safe.
- Existing route names, parameters, renderer APIs, IPC behavior, database access, and worker architecture remain compatible.
- Shared loading, empty, error, forbidden, saved, decision, and completion states are implemented.
- Wide, medium, and narrow shell modes pass responsive tests.
- All six language files have key parity.
- Component tests remain isolated in the happy-dom configuration.
- Electron E2E tests reuse the approved Playwright architecture.
- No page, record, task, or inspector creates an additional Electron renderer.
- Mixed legacy/converged mode and rollback are tested.
- Legacy shell styles are removed only after each family’s stability gate.

## 35. Final Architecture Statement

Inner-page convergence is implemented as a renderer presentation architecture, not a new domain or process architecture.

The stable system is:

```text
one Electron renderer window
  -> one persistent authenticated shell
  -> one selected center route
  -> zero or one typed contextual inspector
  -> feature-owned data and behavior
  -> shared tokens, hierarchy, states, and accessibility
```

This structure keeps the product harmonious with the new chat workspace while allowing each feature to retain the workflow and data presentation its domain requires.
