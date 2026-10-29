# Unified Plugin Page and Block-Style Discovery - Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-27
- **Owner**: AiFetchly Desktop Engineering
- **Product requirements**: `docs/prd/unified-plugin-page-discovery-prd.md`
- **Primary repository**: `/home/robertzeng/project/aiFetchly`
- **Implementation scope**: Electron renderer architecture, Vue Router migration, component extraction, local catalog filtering, cross-tab state synchronization, i18n, and UI tests.
- **Related technical documents**:
  - `docs/prd/community-plugin-page-technical-design.md`
  - `docs/prd/plugin-marketplace-support-technical-design.md`
  - `docs/prd/plugin-hub-managed-installation-technical-design.md`
  - `docs/prd/ai-app-navigation-tool-technical-design.md`
- **Verified implementation anchors**:
  - `src/views/components/plugins/PluginManager.vue`
  - `src/views/components/plugins/PluginInstalledTab.vue`
  - `src/views/components/plugins/PluginDiscoverTab.vue`
  - `src/views/components/plugins/PluginMarketplacesTab.vue`
  - `src/views/components/plugins/PluginMarketplaceErrorsTab.vue`
  - `src/views/pages/communityPlugins/index.vue`
  - `src/views/pages/systemsetting/plugins.vue`
  - `src/views/api/communityPlugins.ts`
  - `src/views/api/plugins.ts`
  - `src/entityTypes/communityPluginTypes.ts`
  - `src/views/utils/communityPluginCta.ts`
  - `src/views/utils/apirequest.ts`
  - `src/views/router/index.ts`
  - `src/views/layout/layout.vue`
  - `src/config/aiNavigationRouteManifest.ts`
  - `src/views/utils/aiNavigationResultHandler.ts`
  - `test/vitest/main/components/CommunityPluginsPage.test.ts`

## 1. Summary

This design implements the unified Plugin product experience without changing the existing Community Hub backend contract. The renderer will:

1. Extract the current Community Plugins page into a reusable `CommunityPluginCatalog` component.
2. Add a presentational `CommunityPluginCard` component.
3. Add pure catalog filtering/facet helpers.
4. Reorganize `PluginManager` into Discover, Installed, Sources, and Issues sections.
5. Wrap the two external marketplace views in a `PluginSourcesTab` component.
6. Make `/plugins/management?tab=discover` the canonical Community Hub destination.
7. Redirect the legacy Community route and move AI-navigation aliases to `PluginsManagement`.
8. Synchronize install and uninstall state through `PluginManager` component events and exposed reload methods.

No new IPC channel, service method, database entity, migration, worker, or Hub endpoint is required. The current Community API already returns all fields needed by the grid and already enforces access at the main-process service boundary.

## 2. Constraints and Existing Guarantees

### 2.1 Repository Constraints

The implementation must follow `AGENTS.md`:

- No `any` in new TypeScript.
- Every function has an explicit return type.
- User-facing text is translated in all six language files.
- UI changes include component tests and critical flows include E2E coverage.
- IPC handlers never access the database directly.
- Completed logical units are committed automatically with conventional commit messages.

### 2.2 Existing Community API Contract

The renderer API is already sufficient:

```typescript
listCommunityPlugins(
  filter?: PluginCommunityFilter
): Promise<PluginCommunityEntry[] | null>;

installCommunityPlugin(
  slug: string
): Promise<PluginSummary | null>;

openCommunityPlansPage(): Promise<void>;
```

The implementation will call `listCommunityPlugins({ forceRefresh })` without `search` or `category` so the renderer owns an unfiltered catalog for local facets.

### 2.3 Existing Security Guarantee

The Community API is non-AI-gated by design. The renderer receives catalog rows with an `access` decision but never receives the marketing token or raw plan information. Installation eligibility is rechecked by `PluginMarketplaceService.installCommunityPlugin`; hiding or showing a renderer button is not the enforcement boundary.

### 2.4 Existing Installed-State Guarantee

`PluginMarketplaceService.listCommunityPlugins()` cross-references installed marketplace entries each time it maps cached Hub entries. Therefore:

- `entry.installed` is authoritative when the list response is created.
- Calling `listCommunityPlugins({ forceRefresh: false })` after uninstall is sufficient to recompute installed state without forcing a Hub network refresh.
- A successful install returns a `PluginSummary`; its `name` is the canonical installed-plugin identifier for opening `PluginDetailPanel`.

### 2.5 Existing Live-Update Guarantee

The current Community page listens on `WEBSOCKET_EVENT`. When it receives:

```typescript
{
  type: "message",
  data: { type: "user_info_updated" }
}
```

it force-refreshes the Community catalog. The extracted component must preserve this lifecycle exactly.

## 3. Architecture Overview

### 3.1 Component Hierarchy

```text
pages/systemsetting/plugins.vue
└── PluginManager.vue
    ├── v-tabs / v-window
    │   ├── Discover
    │   │   └── CommunityPluginCatalog.vue
    │   │       └── CommunityPluginCard.vue × N
    │   ├── Installed
    │   │   └── PluginInstalledTab.vue
    │   ├── Sources
    │   │   └── PluginSourcesTab.vue
    │   │       ├── PluginDiscoverTab.vue
    │   │       └── PluginMarketplacesTab.vue
    │   └── Issues
    │       └── PluginMarketplaceErrorsTab.vue
    ├── PluginDetailPanel.vue
    ├── PluginImportDialog.vue
    ├── PluginInstallSourceDialog.vue
    └── Uninstall confirmation dialog
```

### 3.2 Runtime Data Flow

```text
Renderer route
  /plugins/management?tab=discover
        │
        ▼
PluginManager
  validates route.query.tab
        │
        ▼
CommunityPluginCatalog
  listCommunityPlugins({ forceRefresh: false })
        │
        ▼ IPC
Existing community-plugin-ipc
        │
        ▼
PluginMarketplaceService
  reads/refreshes Hub cache
  cross-references installed plugins
        │
        ▼
PluginCommunityEntry[]
        │
        ▼
Renderer pure helpers
  buildTagFacets(allEntries)
  filterCommunityPlugins(allEntries, filters)
        │
        ▼
CommunityPluginCard[]
```

### 3.3 Mutation Flow

```text
User clicks Install
  │
  ▼
CommunityPluginCard emits install(slug)
  │
  ▼
CommunityPluginCatalog.onInstall(entry)
  │ installCommunityPlugin(entry.slug)
  ▼
PluginSummary { name, ... }
  ├── optimistically set clicked entry.installed = true
  ├── remember canonical name for Manage
  └── emit installed(summary.name)
          │
          ▼
      PluginManager.loadInstalledPlugins()

User clicks Manage
  │
  ▼
CommunityPluginCatalog emits manage(canonicalName)
  │
  ▼
PluginManager
  sets selectedName
  navigates to ?tab=installed
  opens PluginDetailPanel

User uninstalls
  │
  ▼
PluginManager.doUninstall()
  ├── uninstallPlugin(name)
  ├── reload installed list
  └── communityCatalogRef.reload(false)
          │
          ▼
      main process recomputes entry.installed
```

## 4. Design Decisions

### TD-1: Keep Hub and External Marketplace Catalogs Separate

**Decision**: Discover renders only the first-party Community Hub catalog. Sources owns the external marketplace catalog and source management.

**Reason**: The two result models differ in access semantics and installation detail. Combining them now would require a new normalized view model that either loses Hub entitlement information or leaks marketplace-specific status into Community cards.

**Trade-off**: Users cannot search both catalogs with one query in this release. They do, however, have one Plugin page and task-oriented labels.

### TD-2: Filter the Full Community Catalog Locally

**Decision**: Fetch the unfiltered Community catalog once, then perform search, tag, and availability filtering in pure renderer code.

**Reason**: The current API has no pagination, the complete catalog is already returned as an array, and local filtering keeps facets stable while avoiding IPC per keystroke.

**Trade-off**: A future very large catalog may require server-side search and facet metadata. That change must introduce an explicit pagination/facet contract rather than silently changing this helper.

### TD-3: Use a Regular CSS Grid

**Decision**: Use `display: grid` with `repeat(auto-fill, minmax(290px, 1fr))`.

**Reason**: DOM order, visual order, screen-reader order, and keyboard order remain aligned. The browser handles column count based on available width.

**Trade-off**: Consistent row alignment leaves some whitespace inside shorter cards. This is preferable to masonry's unpredictable scanning order.

### TD-4: Separate Status From Action

**Decision**: Render installed/access state in a header chip and the available action in the footer.

**Reason**: A disabled Installed button combines state and action and can appear broken. A chip is non-interactive state; Manage is a clear action.

### TD-5: Use Route Query as Top-Level Tab State

**Decision**: `route.query.tab` is the canonical externally addressable section state. `PluginManager` keeps a synchronized local tab ref for stable Vuetify rendering.

**Reason**: Refresh, deep links, AI navigation defaulting, and browser history all need deterministic behavior.

**Trade-off**: Synchronization needs guards to avoid watcher loops. The parsing and navigation logic is isolated and tested.

### TD-6: Keep Filter State in the Catalog Component

**Decision**: Search, selected tag, and availability live inside `CommunityPluginCatalog` and are not added to the URL in the first release.

**Reason**: The PRD requires top-level tab deep-linking, not shareable filter URLs. Keeping filter state local avoids a noisy query contract.

**Trade-off**: Copying the URL does not reproduce a search. Filter URL support can be added later without changing the API.

### TD-7: Keep the Catalog Instance Alive After First Mount

**Decision**: Do not conditionally destroy `CommunityPluginCatalog` when switching top-level tabs. Use `v-window-item`'s retained content behavior and do not add a surrounding `v-if` keyed to the active tab.

**Reason**: Search/filter state must survive Manage navigation and Installed synchronization. It also prevents repeated WebSocket listener registration.

**Verification**: A component test switches Discover → Installed → Discover and asserts that search text and listener count remain unchanged.

### TD-8: Use the Install Result's Canonical Name

**Decision**: After a new install, emit `summary.name`, not the Hub slug, as the canonical installed-plugin identifier.

**Reason**: The install pipeline returns the persisted plugin identity. This avoids assuming Hub `slug` and installed `name` are always identical.

**Fallback**: For entries already installed on initial load, use `entry.name`, which the current `PluginCommunityEntry` contract documents as the marketplace canonical name. If no name is available, navigate to Installed without opening detail.

### TD-9: Preserve the Legacy Named Route as a Redirect

**Decision**: Keep `CommunityPlugins` and `CommunityPluginsList` route names temporarily, mark them invisible/non-AI-navigable, and redirect both to the canonical Plugin route.

**Reason**: Existing bookmarks and any name-based internal references continue to resolve during the migration window.

**Trade-off**: Two deprecated route records remain until a later cleanup release.

### TD-10: No Backend Changes

**Decision**: Do not add filter fields, IPC channels, database columns, or Hub response fields for this work.

**Reason**: All required card/filter data already exists. Renderer filtering is a presentation concern, while install eligibility remains enforced by the existing service.

## 5. File Impact Map

### 5.1 New Files

| File | Responsibility |
|---|---|
| `src/views/components/plugins/CommunityPluginCatalog.vue` | Catalog state, local filters, loading/errors, API actions, WebSocket lifecycle |
| `src/views/components/plugins/CommunityPluginCard.vue` | Presentational card, status, tags, and typed action events |
| `src/views/components/plugins/PluginSourcesTab.vue` | Secondary Browse/Manage source tabs and cross-refresh behavior |
| `src/views/utils/communityPluginFilters.ts` | Pure normalization, facet construction, and filtering helpers |
| `src/views/utils/pluginManagerRoute.ts` | Pure tab-query parsing and route-query construction helpers |
| `test/vitest/main/components/CommunityPluginCatalog.test.ts` | Catalog rendering and interaction coverage |
| `test/vitest/main/components/CommunityPluginCard.test.ts` | Card state/action/accessibility coverage |
| `test/vitest/main/components/PluginManager.test.ts` | Top-level routing and cross-tab synchronization coverage |
| `test/vitest/main/components/communityPluginFilters.test.ts` | Pure search/facet/filter cases under the component CI gate |
| `test/vitest/main/components/pluginManagerRoute.test.ts` | Tab query parsing and query preservation |

### 5.2 Modified Files

| File | Change |
|---|---|
| `src/views/components/plugins/PluginManager.vue` | New top-level sections, route sync, new child refs/events |
| `src/views/router/index.ts` | Canonical metadata plus invisible legacy redirects |
| `src/config/aiNavigationRouteManifest.ts` | Replace Community route entry with PluginsManagement aliases |
| `src/views/pages/communityPlugins/index.vue` | Remove after tests/routes migrate, or temporarily reduce to wrapper |
| `test/vitest/main/components/CommunityPluginsPage.test.ts` | Migrate assertions to the extracted catalog test, then remove/rename |
| `src/views/lang/en.ts` | New/renamed labels |
| `src/views/lang/zh.ts` | New/renamed labels |
| `src/views/lang/es.ts` | New/renamed labels |
| `src/views/lang/fr.ts` | New/renamed labels |
| `src/views/lang/de.ts` | New/renamed labels |
| `src/views/lang/ja.ts` | New/renamed labels |

### 5.3 Unchanged Files

These contracts are reused without modification:

- `src/views/api/communityPlugins.ts`
- `src/entityTypes/communityPluginTypes.ts`
- `src/main-process/communication/community-plugin-ipc.ts`
- `src/service/PluginMarketplaceService.ts`
- `src/model/*`
- TypeORM entities and migrations
- Preload allowlists
- Worker/child-process code

## 6. Shared Type Design

### 6.1 Top-Level Plugin Tabs

Create `src/views/utils/pluginManagerRoute.ts`:

```typescript
import type { LocationQuery, LocationQueryValue } from "vue-router";

export const PLUGIN_MANAGER_TABS = [
  "discover",
  "installed",
  "sources",
  "issues",
] as const;

export type PluginManagerTab = (typeof PLUGIN_MANAGER_TABS)[number];

export function parsePluginManagerTab(
  value: LocationQueryValue | LocationQueryValue[] | undefined
): PluginManagerTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return PLUGIN_MANAGER_TABS.includes(candidate as PluginManagerTab)
    ? (candidate as PluginManagerTab)
    : "discover";
}

export function withPluginManagerTab(
  query: LocationQuery,
  tab: PluginManagerTab
): LocationQuery {
  return { ...query, tab };
}
```

The cast is constrained by the runtime membership check. No broad `any` is introduced.

### 6.2 Availability Filter

Create in `communityPluginFilters.ts`:

```typescript
export const COMMUNITY_AVAILABILITY_FILTERS = [
  "all",
  "available",
  "installed",
] as const;

export type CommunityAvailabilityFilter =
  (typeof COMMUNITY_AVAILABILITY_FILTERS)[number];

export interface CommunityCatalogFilters {
  readonly search: string;
  readonly selectedTagKey: string | null;
  readonly availability: CommunityAvailabilityFilter;
}

export interface CommunityTagFacet {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}
```

### 6.3 Card Event Contract

`CommunityPluginCard.vue` accepts immutable entry data and emits user intent:

```typescript
const props = defineProps<{
  entry: PluginCommunityEntry;
  installing: boolean;
}>();

defineEmits<{
  install: [entry: PluginCommunityEntry];
  manage: [entry: PluginCommunityEntry];
  upgrade: [];
  signin: [];
}>();
```

The card does not import renderer APIs. This keeps it presentational and independently testable.

### 6.4 Catalog Public Contract

```typescript
defineEmits<{
  installed: [pluginName: string];
  manage: [pluginName: string];
}>();

defineExpose<{
  reload: (force?: boolean) => Promise<void>;
}>();
```

`installed` signals that the Installed collection is stale. `manage` signals navigation intent with a canonical identifier.

### 6.5 Sources Public Contract

```typescript
defineExpose<{
  reloadBrowse: () => Promise<void>;
}>();
```

`PluginSourcesTab` internally handles `PluginMarketplacesTab@changed` by reloading its `PluginDiscoverTab` ref. `PluginManager` only needs `reloadBrowse()` after a plugin is imported from another source.

## 7. Pure Catalog Helpers

### 7.1 Normalization

All filter comparisons use one deterministic normalizer:

```typescript
export function normalizeCommunityFilterValue(value: string): string {
  return value.trim().toLowerCase();
}
```

Do not use locale-dependent case mapping for identity keys. Display labels preserve the first non-empty catalog spelling.

### 7.2 Search Document

```typescript
export function communityPluginSearchDocument(
  entry: PluginCommunityEntry
): string {
  return [
    entry.displayName,
    entry.name,
    entry.description,
    entry.owner ?? "",
    entry.category ?? "",
    ...(entry.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();
}
```

The helper uses string interpolation data only. No HTML is produced.

### 7.3 Per-Entry Facet Values

Category and tags can repeat the same term. Count each normalized value at most once per plugin:

```typescript
interface NormalizedFacetValue {
  readonly key: string;
  readonly label: string;
}

export function communityEntryFacetValues(
  entry: PluginCommunityEntry
): NormalizedFacetValue[] {
  const labels = [
    ...(entry.category ? [entry.category] : []),
    ...(entry.tags ?? []),
  ];
  const byKey = new Map<string, string>();

  for (const rawLabel of labels) {
    const label = rawLabel.trim();
    const key = normalizeCommunityFilterValue(label);
    if (key && !byKey.has(key)) byKey.set(key, label);
  }

  return [...byKey.entries()].map(([key, label]) => ({ key, label }));
}
```

### 7.4 Facet Construction

```typescript
export function buildCommunityTagFacets(
  entries: readonly PluginCommunityEntry[]
): CommunityTagFacet[] {
  const facets = new Map<string, { label: string; count: number }>();

  for (const entry of entries) {
    for (const value of communityEntryFacetValues(entry)) {
      const current = facets.get(value.key);
      facets.set(value.key, {
        label: current?.label ?? value.label,
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  return [...facets.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
}
```

### 7.5 Availability Semantics

Use the existing `ctaFor()` helper so availability never becomes a second entitlement implementation:

```typescript
export function matchesCommunityAvailability(
  entry: PluginCommunityEntry,
  availability: CommunityAvailabilityFilter
): boolean {
  if (availability === "all") return true;
  if (availability === "installed") return entry.installed;
  return ctaFor(entry) === "install";
}
```

This correctly excludes upgrade, sign-in, preview, forbidden, and unavailable cards from Available.

### 7.6 Combined Filtering

```typescript
export function filterCommunityPlugins(
  entries: readonly PluginCommunityEntry[],
  filters: CommunityCatalogFilters
): PluginCommunityEntry[] {
  const search = normalizeCommunityFilterValue(filters.search);

  return entries.filter((entry) => {
    const matchesSearch =
      !search || communityPluginSearchDocument(entry).includes(search);
    const facetKeys = new Set(
      communityEntryFacetValues(entry).map((value) => value.key)
    );
    const matchesTag =
      !filters.selectedTagKey || facetKeys.has(filters.selectedTagKey);
    const matchesAvailability = matchesCommunityAvailability(
      entry,
      filters.availability
    );

    return matchesSearch && matchesTag && matchesAvailability;
  });
}
```

The helper preserves input order and does not mutate entries.

### 7.7 Visible Facets and Overflow

The catalog displays a primary limit of ten facets. If the selected facet is outside the first ten, include it as the final visible facet so selection never disappears:

```typescript
export function visibleCommunityTagFacets(
  facets: readonly CommunityTagFacet[],
  selectedKey: string | null,
  limit = 10
): CommunityTagFacet[] {
  const primary = facets.slice(0, limit);
  if (!selectedKey || primary.some((facet) => facet.key === selectedKey)) {
    return primary;
  }
  const selected = facets.find((facet) => facet.key === selectedKey);
  if (!selected) return primary;
  return [...primary.slice(0, Math.max(0, limit - 1)), selected];
}
```

The More menu renders all non-visible facets. Counts come from the full catalog, not current search results.

## 8. `CommunityPluginCard.vue` Design

### 8.1 Rendering Structure

```text
v-card.community-plugin-card
├── header
│   ├── display name
│   └── status chip
├── metadata line
│   ├── owner
│   └── category
├── description (3-line visual clamp)
├── visible tags (max 3 + overflow count)
└── actions
    └── action derived from ctaFor(entry)
```

### 8.2 Status Descriptor

Extend `communityPluginCta.ts` with presentation-only status metadata or create a card-local typed function:

```typescript
interface CommunityCardStatus {
  readonly key:
    | "installed"
    | "upgrade_required"
    | "signin_required"
    | "coming_soon"
    | "unavailable";
  readonly color: "success" | "secondary" | "warning" | "default";
  readonly icon: string;
}

export function statusForCommunityEntry(
  entry: PluginCommunityEntry
): CommunityCardStatus | null {
  if (entry.installed) {
    return { key: "installed", color: "success", icon: "mdi-check-circle" };
  }
  const cta = ctaFor(entry);
  if (cta === "upgrade") {
    return {
      key: "upgrade_required",
      color: "secondary",
      icon: "mdi-arrow-up-bold-circle-outline",
    };
  }
  if (cta === "signin") {
    return { key: "signin_required", color: "warning", icon: "mdi-login" };
  }
  if (cta === "preview") {
    return { key: "coming_soon", color: "default", icon: "mdi-clock-outline" };
  }
  if (cta === "none") {
    return { key: "unavailable", color: "default", icon: "mdi-cancel" };
  }
  return null;
}
```

This function translates access decisions into presentation but does not grant access. `ctaFor()` remains the single renderer action decision helper.

### 8.3 Action Rendering

| `ctaFor(entry)` | Render |
|---|---|
| `install` | Primary Install button; loading when `installing` |
| `installed` | Tonal/text Manage button; never disabled |
| `preview` | Disabled Preview button inside accessible tooltip wrapper |
| `upgrade` | Secondary Upgrade button |
| `signin` | Outlined Sign in button |
| `none` | Visible Unavailable text, no interactive control |

Buttons emit intent only. API errors remain owned by the catalog.

### 8.4 Description and Tags

Description clamp:

```css
.community-plugin-card__description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
```

The full description must be available in this release even when the visible copy is clamped. Put the complete text in an accessible tooltip triggered by both hover and keyboard focus, retain it as the description element's accessible name, and use plain interpolation rather than `v-html`. A future detail view may replace the tooltip, but it is not required for this release.

Render at most three tags. For remaining tags, render a non-interactive `+N` chip with an accessible label such as “3 more tags.”

### 8.5 Card CSS

```css
.community-plugin-card {
  min-height: 240px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.community-plugin-card__body {
  flex: 1 1 auto;
}

.community-plugin-card--unavailable {
  background: rgb(var(--v-theme-surface-variant));
  border-color: rgb(var(--v-theme-outline));
}
```

Do not apply blanket opacity to the card. Vuetify theme tokens preserve dark/light compatibility.

### 8.6 Stable Test Selectors

Use these selectors or equivalent stable names:

```text
community-plugin-card-<slug>
community-plugin-status-<slug>
community-plugin-install-<slug>
community-plugin-manage-<slug>
community-plugin-upgrade-<slug>
community-plugin-signin-<slug>
community-plugin-preview-<slug>
```

Selectors must not depend on translated labels.

## 9. `CommunityPluginCatalog.vue` Design

### 9.1 State

```typescript
const entries = ref<PluginCommunityEntry[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref<string | null>(null);
const installError = ref<string | null>(null);
const installBusySlug = ref<string | null>(null);
const search = ref("");
const selectedTagKey = ref<string | null>(null);
const availability = ref<CommunityAvailabilityFilter>("all");
const installedNameBySlug = ref(new Map<string, string>());
let activeLoadRequest = 0;
```

Use immutable entry-array replacement after install so computed filters update predictably.

### 9.2 Derived State

```typescript
const sessionExpired = computed<boolean>(() =>
  isSessionExpiredMessage(errorMessage.value)
);

const tagFacets = computed<CommunityTagFacet[]>(() =>
  buildCommunityTagFacets(entries.value)
);

const filteredEntries = computed<PluginCommunityEntry[]>(() =>
  filterCommunityPlugins(entries.value, {
    search: search.value,
    selectedTagKey: selectedTagKey.value,
    availability: availability.value,
  })
);

const hasActiveFilters = computed<boolean>(() =>
  Boolean(
    search.value.trim() ||
      selectedTagKey.value ||
      availability.value !== "all"
  )
);
```

### 9.3 Loading and Race Protection

Network and WebSocket refreshes can overlap. Ignore stale responses:

```typescript
async function reload(force = false): Promise<void> {
  const requestId = ++activeLoadRequest;
  if (entries.value.length === 0) loading.value = true;
  else refreshing.value = true;
  errorMessage.value = null;

  try {
    const data = await listCommunityPlugins({ forceRefresh: force });
    if (requestId !== activeLoadRequest) return;
    entries.value = data ?? [];
  } catch (error: unknown) {
    if (requestId !== activeLoadRequest) return;
    errorMessage.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    if (requestId === activeLoadRequest) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}
```

The main-process service already coalesces forced Hub refreshes. Renderer request IDs solve only presentation order.

### 9.4 Install

```typescript
async function onInstall(entry: PluginCommunityEntry): Promise<void> {
  if (installBusySlug.value) return;
  installBusySlug.value = entry.slug;
  installError.value = null;

  try {
    const installed = await installCommunityPlugin(entry.slug);
    if (!installed) throw new Error(
      t("communityPlugins.installFailed") || "Install failed"
    );

    installedNameBySlug.value.set(entry.slug, installed.name);
    entries.value = entries.value.map((candidate) =>
      candidate.slug === entry.slug
        ? { ...candidate, installed: true }
        : candidate
    );
    emit("installed", installed.name);
  } catch (error: unknown) {
    installError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    installBusySlug.value = null;
  }
}
```

Do not continue when the API returns `null`. The card should not falsely display Installed.

### 9.5 Manage

```typescript
function onManage(entry: PluginCommunityEntry): void {
  emit(
    "manage",
    installedNameBySlug.value.get(entry.slug) ?? entry.name
  );
}
```

### 9.6 Clear Filters

```typescript
function clearFilters(): void {
  search.value = "";
  selectedTagKey.value = null;
  availability.value = "all";
}
```

This function does not reload the catalog.

### 9.7 WebSocket Lifecycle

```typescript
function onWebSocketEvent(event: unknown): void {
  const candidate = event as
    | { type?: string; data?: { type?: string } }
    | null;
  if (
    candidate?.type === "message" &&
    candidate.data?.type === "user_info_updated"
  ) {
    void reload(true);
  }
}

onMounted((): void => {
  void reload(false);
  windowReceive(WEBSOCKET_EVENT, onWebSocketEvent);
});

onUnmounted((): void => {
  windowRemoveListener(WEBSOCKET_EVENT, onWebSocketEvent);
});
```

Retain the exact callback reference for removal.

### 9.8 Template State Precedence

Render states in this order:

1. Session-expired alert.
2. General catalog error alert.
3. Install error alert, independently closable.
4. Initial loading skeleton.
5. Empty full catalog.
6. No matching results.
7. Plugin grid.

If refresh fails while entries are already visible, keep the entries visible and show the error alert. Do not erase a previously rendered catalog solely because a later refresh failed. This differs from initial load, where no catalog exists.

### 9.9 Catalog Grid

```css
.community-plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(290px, 100%), 1fr));
  gap: 16px;
  align-items: stretch;
}
```

`min(290px, 100%)` prevents overflow in a very narrow Electron window.

### 9.10 Result Announcement

Render the count in a polite live region:

```vue
<div class="text-body-2" aria-live="polite" aria-atomic="true">
  {{ t("communityPlugins.resultCount", { count: filteredEntries.length }) }}
</div>
```

Do not move focus when results change.

## 10. `PluginSourcesTab.vue` Design

### 10.1 Purpose

This wrapper removes external marketplace coordination from `PluginManager` and gives Sources a clear secondary navigation level.

### 10.2 Structure

```vue
<v-tabs v-model="sourceTab" density="compact">
  <v-tab value="browse">{{ browseLabel }}</v-tab>
  <v-tab value="manage">{{ manageLabel }}</v-tab>
</v-tabs>

<v-window v-model="sourceTab" class="mt-4">
  <v-window-item value="browse">
    <PluginDiscoverTab ref="browseRef" />
  </v-window-item>
  <v-window-item value="manage">
    <PluginMarketplacesTab @changed="onMarketplacesChanged" />
  </v-window-item>
</v-window>
```

### 10.3 Refresh Coordination

```typescript
const browseRef = ref<{ reload: () => Promise<void> } | null>(null);

async function reloadBrowse(): Promise<void> {
  await browseRef.value?.reload();
}

async function onMarketplacesChanged(): Promise<void> {
  await reloadBrowse();
}

defineExpose({ reloadBrowse });
```

Sources uses local `sourceTab = "browse"`. No URL query is added in the first release.

## 11. `PluginManager.vue` Refactor

### 11.1 State

```typescript
const route = useRoute();
const router = useRouter();
const tab = ref<PluginManagerTab>(parsePluginManagerTab(route.query.tab));
const communityRef = ref<{ reload: (force?: boolean) => Promise<void> } | null>(null);
const sourcesRef = ref<{ reloadBrowse: () => Promise<void> } | null>(null);
```

Rename the existing generic `load()` to `loadInstalledPlugins()` for clarity.

### 11.2 Query-to-Tab Synchronization

```typescript
watch(
  () => route.query.tab,
  (value): void => {
    const parsed = parsePluginManagerTab(value);
    if (tab.value !== parsed) tab.value = parsed;
  }
);
```

### 11.3 Tab-to-Query Synchronization

Use an explicit tab update handler rather than a two-way watcher:

```typescript
async function selectTab(value: unknown): Promise<void> {
  if (!isPluginManagerTab(value)) return;
  tab.value = value;
  if (parsePluginManagerTab(route.query.tab) === value) return;
  await router.push({
    name: "PluginsManagement",
    query: withPluginManagerTab(route.query, value),
  });
}
```

Add a pure guard:

```typescript
export function isPluginManagerTab(value: unknown): value is PluginManagerTab {
  return (
    typeof value === "string" &&
    PLUGIN_MANAGER_TABS.some((candidate) => candidate === value)
  );
}
```

Template:

```vue
<v-tabs :model-value="tab" @update:model-value="selectTab">
```

`router.push` creates expected back-button history for user tab changes. The route watcher updates local state for back/forward navigation.

### 11.4 Default Query Canonicalization

If `tab` is missing or invalid, render Discover immediately. Optionally normalize the URL with `router.replace` on mount:

```typescript
onMounted(async (): Promise<void> => {
  await loadInstalledPlugins();
  if (route.query.tab !== "discover" && !isPluginManagerTab(route.query.tab)) {
    await router.replace({
      name: "PluginsManagement",
      query: withPluginManagerTab(route.query, "discover"),
    });
  }
});
```

Do not add a new history entry for normalization.

### 11.5 Top-Level Template

```vue
<v-tabs :model-value="tab" @update:model-value="selectTab">
  <v-tab value="discover">...</v-tab>
  <v-tab value="installed">...</v-tab>
  <v-tab value="sources">...</v-tab>
  <v-tab value="issues">...</v-tab>
</v-tabs>

<v-window :model-value="tab" class="mt-4">
  <v-window-item value="discover">
    <CommunityPluginCatalog
      ref="communityRef"
      @installed="onCommunityInstalled"
      @manage="onCommunityManage"
    />
  </v-window-item>
  <v-window-item value="installed">...</v-window-item>
  <v-window-item value="sources">
    <PluginSourcesTab ref="sourcesRef" />
  </v-window-item>
  <v-window-item value="issues">
    <PluginMarketplaceErrorsTab />
  </v-window-item>
</v-window>
```

### 11.6 Install Synchronization

```typescript
async function onCommunityInstalled(_pluginName: string): Promise<void> {
  await loadInstalledPlugins();
}
```

Do not automatically switch tabs after install. The user remains in their search context and chooses Manage when ready.

### 11.7 Manage Navigation

```typescript
async function onCommunityManage(pluginName: string): Promise<void> {
  selectedName.value = pluginName;
  await selectTab("installed");
}
```

The detail panel is outside the window, so setting `selectedName` can open it as the Installed tab becomes active.

### 11.8 Uninstall Synchronization

```typescript
async function doUninstall(): Promise<void> {
  if (!uninstallTarget.value) return;
  const name = uninstallTarget.value;
  uninstallTarget.value = null;
  showUninstall.value = false;

  await uninstallPlugin(name);
  if (selectedName.value === name) selectedName.value = null;
  await Promise.all([
    loadInstalledPlugins(),
    communityRef.value?.reload(false),
  ]);
}
```

`Promise.all` is safe because both operations are read-only after uninstall completes. If one reload fails, the mutation has still succeeded; each child owns its display error.

### 11.9 Import and Source Synchronization

```typescript
async function onImported(): Promise<void> {
  await Promise.all([
    loadInstalledPlugins(),
    sourcesRef.value?.reloadBrowse(),
  ]);
}
```

Community does not require a forced Hub refresh after arbitrary source import. Its installed cross-reference is Hub-marketplace-provenance-specific. A later reconciliation call can be added if product semantics change.

## 12. Router Migration

### 12.1 Canonical Route

Add Community discovery AI metadata to the existing child:

```typescript
{
  path: "management",
  component: () => import("@/views/pages/systemsetting/plugins.vue"),
  name: "PluginsManagement",
  meta: {
    visible: true,
    title: "route.plugins",
    icon: "mdi-puzzle",
    aiNavigable: true,
    aiAliases: [
      "plugins",
      "plugin management",
      "community plugins",
      "plugin store",
      "plugin hub",
      "browse plugins",
      "discover plugins",
      "plugin marketplace page",
    ],
    aiDescription:
      "Discover community plugins and manage installed plugins and sources",
  },
}
```

### 12.2 Legacy Redirect Records

Use two explicit top-level records. They preserve both existing route names and paths without mounting `Layout` or relying on nested redirect behavior:

```typescript
{
  path: "/community-plugins",
  name: "CommunityPlugins",
  redirect: {
    name: "PluginsManagement",
    query: { tab: "discover" },
  },
  meta: {
    visible: false,
    aiNavigable: false,
    title: "route.community_plugins",
  },
},
{
  path: "/community-plugins/list",
  name: "CommunityPluginsList",
  redirect: {
    name: "PluginsManagement",
    query: { tab: "discover" },
  },
  meta: {
    visible: false,
    aiNavigable: false,
    title: "route.community_plugins",
  },
},
```

Do not attach `Layout` to these records. They are compatibility aliases only and must immediately resolve to the canonical route.

### 12.3 Left-Navigation Result

`layout.vue` renders a route only when `item.meta.visible` is truthy. Setting the Community parent and child to `visible: false` removes both from navigation without modifying layout logic.

### 12.4 AI Navigation Manifest

Replace:

```typescript
{
  routeName: "CommunityPluginsList",
  path: "/community-plugins/list",
  ...
}
```

with:

```typescript
{
  routeName: "PluginsManagement",
  path: "/plugins/management",
  titleKey: "route.plugins",
  visible: true,
  aiNavigable: true,
  aiAliases: [
    "plugins",
    "plugin management",
    "community plugins",
    "plugin store",
    "plugin hub",
    "browse plugins",
    "discover plugins",
    "plugin marketplace page",
  ],
  aiDescription:
    "Discover community plugins and manage installed plugins and sources",
}
```

The current AI navigation result contains only `routeName`; it cannot carry query state. This is acceptable because `PluginManager` defaults a missing query to Discover.

## 13. Legacy Page Removal

### 13.1 Preferred End State

After route and tests migrate:

- Delete `src/views/pages/communityPlugins/index.vue`.
- Delete or rename `CommunityPluginsPage.test.ts` after transferring its assertions.
- Keep route names only as redirect records.

### 13.2 Temporary Wrapper Alternative

If a phased merge requires the old component path to exist temporarily:

```vue
<template>
  <CommunityPluginCatalog />
</template>

<script setup lang="ts">
import CommunityPluginCatalog from
  "@/views/components/plugins/CommunityPluginCatalog.vue";
</script>
```

This avoids duplicate business logic. Do not retain two copies of catalog loading and CTA behavior.

## 14. Error and Concurrency Design

### 14.1 Catalog Load Errors

- Initial load failure: no cards; show session-specific or general error state.
- Refresh failure with existing cards: preserve cards and show an alert.
- Retry: call `reload(true)`.
- New request: clear the prior catalog error.

### 14.2 Install Errors

- Store separately from catalog load errors.
- Show the API-provided safe error message.
- Keep current entries and filters.
- Clear when dismissed or when a new install starts.
- Never mark the entry installed when the API returns `null` or throws.

### 14.3 Duplicate Actions

- `installBusySlug !== null` prevents concurrent installs in the current component.
- The clicked card receives `installing=true`.
- Other Install buttons should be disabled while one global install is in flight if the service supports only one safe install at a time.
- Refresh is disabled while `refreshing=true`.

### 14.4 Stale Load Responses

Use `activeLoadRequest` to ignore out-of-order renderer promises. Do not attempt to cancel IPC because the existing transport has no cancellation contract.

### 14.5 Unmount During Request

Increment `activeLoadRequest` in `onUnmounted` so late responses cannot update component state after disposal:

```typescript
onUnmounted((): void => {
  activeLoadRequest += 1;
  windowRemoveListener(WEBSOCKET_EVENT, onWebSocketEvent);
});
```

## 15. Accessibility Implementation

### 15.1 Search

- Provide a translated `label`; do not rely only on placeholder.
- Use `prepend-inner-icon="mdi-magnify"`.
- Use `clearable` and preserve keyboard access to clear.

### 15.2 Tag Chips

- Use a single-select `v-chip-group` or equivalent radio semantics.
- All is a real selectable option.
- Expose selected state to assistive technology.
- More opens a keyboard-operable menu/list.

### 15.3 Availability Filter

- Use a single-select segmented control or chip group with a visible group label.
- Do not encode All/Available/Installed only through color.

### 15.4 Cards

- The card itself is not clickable in the first release; explicit buttons avoid nested interactive semantics.
- Header chips include visible text.
- Footer contains at most one primary action.
- Disabled Preview includes a tooltip, but Coming soon remains visible outside hover.

### 15.5 Results and Loading

- Loading grid has `role="status"` and translated `aria-label`.
- Result count uses `aria-live="polite"`.
- No-results state includes a real Clear filters button.
- Focus remains in search/filter controls when results update.

### 15.6 Contrast

- Use Vuetify theme tokens and explicit status chips.
- Remove `.community-plugin-unavailable { opacity: 0.55; }`.
- Do not use disabled styling for readable informational content.

## 16. Responsive Implementation

### 16.1 Toolbar

```css
.community-plugin-toolbar {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.community-plugin-search {
  flex: 1 1 360px;
  max-width: 560px;
}
```

At narrow width, search takes the full line and Refresh remains visible.

### 16.2 Filter Summary Row

Use `display:flex`, `justify-content:space-between`, and wrapping. The result count precedes the availability control in DOM order.

### 16.3 Grid

Use the grid rule from §9.9. Avoid hardcoded Vuetify `md=4` columns because the chat dock and navigation rail change actual content width independently of viewport breakpoints.

### 16.4 Top-Level Tabs

Use Vuetify tab overflow behavior and keep the selected tab visible. Do not reduce labels to icons because the four destinations are task concepts.

## 17. Internationalization Design

### 17.1 Key Structure

Add the same keys to all supported language files:

```typescript
plugins: {
  tabs: {
    discover: "Discover",
    installed: "Installed",
    sources: "Sources",
    issues: "Issues",
  },
  sources: {
    browse: "Browse sources",
    manage: "Manage sources",
  },
  // existing keys...
},
communityPlugins: {
  searchLabel: "Search plugins",
  searchPlaceholder: "Search by name, description, author, or tag",
  allTags: "All",
  moreTags: "More",
  filterLabel: "Availability",
  filterAll: "All",
  filterAvailable: "Available",
  filterInstalled: "Installed",
  resultCount: "{count} plugins",
  noMatchesTitle: "No matching plugins",
  noMatchesDescription: "Try another search or clear your filters.",
  clearFilters: "Clear filters",
  manage: "Manage",
  moreTagCount: "{count} more tags",
  statusInstalled: "Installed",
  statusUpgradeRequired: "Upgrade required",
  statusSignInRequired: "Sign in required",
  statusComingSoon: "Coming soon",
  statusUnavailable: "Unavailable",
  // existing keys...
}
```

### 17.2 Pluralization

Use Vue I18n pluralization if the existing project configuration supports it. Otherwise, keep `{count}` interpolation and accept the language-specific translation form. Do not construct translated sentences by concatenating fragments.

### 17.3 Fallbacks

Every new component call follows:

```typescript
t("communityPlugins.manage") || "Manage"
```

Tests may provide empty namespaces and assert English fallback where that is the existing test convention.

## 18. Test Architecture

### 18.1 Pure Filter Tests

File: `test/vitest/main/components/communityPluginFilters.test.ts`

Cases:

1. Normalizer trims and lowercases.
2. Search document contains every searchable field.
3. Empty optional values do not produce errors.
4. Category and duplicate tag count once per plugin.
5. Facets sort by count then label.
6. Labels preserve first catalog spelling.
7. Search matches name, display name, description, owner, category, and tags.
8. Search is case-insensitive and trims input.
9. Tag filtering uses exact normalized facet identity.
10. Available uses `ctaFor(entry) === "install"`.
11. Installed uses `entry.installed`.
12. Search, tag, and availability use logical AND.
13. Input order and input arrays are unchanged.
14. Selected overflow facet remains visible.

### 18.2 Card Tests

File: `test/vitest/main/components/CommunityPluginCard.test.ts`

Cases:

- Installed chip plus Manage action.
- Available card emits Install with entry.
- Ticket card shows Coming soon and disabled Preview.
- Subscription card emits Upgrade.
- Login-required card emits Sign in.
- Forbidden/unavailable card exposes readable status and no action.
- Three visible tags plus `+N` overflow.
- Description and metadata rendering.
- Stable `data-testid` values.
- No blanket opacity class.

### 18.3 Catalog Tests

Migrate all current `CommunityPluginsPage.test.ts` cases and add:

- Loads with `{ forceRefresh: false }`.
- Initial skeleton and empty catalog.
- Search updates cards without another API call.
- Tag and availability controls update cards.
- Result count and no-results state.
- Clear filters restores results without API call.
- Successful install sets local installed state and emits canonical returned name.
- `null` install result shows failure and does not set installed.
- Manage emits transient canonical name or entry.name fallback.
- Refresh preserves filters.
- Refresh failure preserves existing cards.
- Session-expired and general error precedence.
- `user_info_updated` triggers `{ forceRefresh: true }`.
- Unrelated WebSocket messages do not refresh.
- Unmount removes the exact listener.
- Overlapping reloads ignore stale response order.

### 18.4 Plugin Manager Tests

Mount `PluginManager` with router and stub heavy child components. Verify:

- Discover is default for missing/invalid query.
- Query values select each top-level section.
- User selection pushes query while preserving unrelated query keys.
- Browser back/forward route changes update the local tab.
- Community installed event reloads `listPlugins` but does not switch tabs.
- Manage event switches to Installed and passes name to detail panel.
- Successful uninstall reloads Installed and calls catalog `reload(false)`.
- Import reloads Installed and Sources browse.
- Tab order is Discover, Installed, Sources, Issues.
- Catalog state survives a round trip through Installed.

### 18.5 Router and AI Navigation Tests

Add focused tests for:

- `/community-plugins` redirect target.
- `/community-plugins/list` redirect target.
- Legacy route metadata is invisible and non-AI-navigable.
- `PluginsManagement` metadata and manifest aliases include Community terms.
- AI navigation to `PluginsManagement` succeeds and defaults to Discover.
- Manifest no longer advertises `CommunityPluginsList`.

Existing matcher/catalog tests under `test/vitest/utilitycode/` must remain green.

### 18.6 E2E Test

Add or extend a spec under `test/e2e/specs/` with mocked/stable Hub fixtures where the E2E harness permits:

```text
Navigate to Plugins
→ assert one Plugins menu item
→ assert Discover selected
→ search for a fixture plugin
→ choose a fixture tag
→ install
→ assert Installed chip and Manage action
→ Manage
→ assert Installed tab and plugin detail
→ uninstall
→ return to Discover
→ assert Install action restored
→ visit /community-plugins/list
→ assert canonical Discover route
```

### 18.7 Verification Commands

```bash
yarn test:components
yarn vue-typecheck
yarn typecheck
yarn test:e2e
```

Use `yarn vue-typecheck`, not the watch-mode `yarn vue-check`, for finite CI verification. The PRD names `yarn vue-check` because it is the developer command, but the implementation handoff should use the non-watch script.

## 19. Security Review

### 19.1 Trust Boundaries

```text
Untrusted/remote metadata
  Hub displayName, description, owner, category, tags
        │
        ▼
Main process validates/maps catalog
        │
        ▼
IPC serializable PluginCommunityEntry
        │
        ▼
Vue interpolation only
```

### 19.2 Required Controls

- Never render catalog fields with `v-html`.
- Never construct an external URL from a tag, owner, or description.
- Keep Upgrade and Sign in on existing fixed main-process actions.
- Keep installation enforcement in `PluginMarketplaceService`.
- Do not expose token or plan data to renderer state.
- Do not add direct repository/database access to components.
- Treat route query as untrusted and validate against a closed tab set.

### 19.3 No New AI Gate

This is plugin management, not an AI feature request. Do not add `USER_AI_ENABLED` checks to Community list/install handlers as part of this renderer refactor. Existing non-AI-gated behavior is intentional so Community users can browse the upgrade funnel.

## 20. Performance and Memory

### 20.1 Complexity

For `N` catalog entries and `T` total category/tag values:

- Facet construction: `O(N + T)` per catalog refresh.
- Search/filter: `O(N × searchable text length)` per control update.
- Rendering: `O(M)` for `M` matched cards.

The expected Community catalog is small enough for this approach. The 100ms interaction target must be verified with a synthetic large fixture.

### 20.2 Computed Caching

- `tagFacets` depends only on `entries`.
- `filteredEntries` depends on entries and filter state.
- `visibleFacets` depends on facets and selected tag.
- Do not call facet builders inline in the template.

### 20.3 Component Retention

One retained catalog instance stores one entry array, computed views, and one WebSocket listener. Do not create a second compatibility page instance in parallel with PluginManager.

### 20.4 Future Scaling Trigger

Revisit local filtering when any of these are observed:

- More than 1,000 catalog entries in production.
- Filter interaction consistently exceeds 100ms on supported hardware.
- Initial DOM rendering causes visible multi-frame stalls.
- Hub introduces pagination that prevents a complete facet set.

At that point, design server-side search, pagination, and facets as one contract. Do not partially move only search to IPC while leaving misleading local tag counts.

## 21. Migration and Implementation Sequence

Each phase is a logical commit unit under `AGENTS.md`.

### Commit 1: Pure Helpers

```text
feat: add community plugin catalog filtering helpers
```

- Add route tab helper.
- Add search/facet/filter helper.
- Add pure tests.
- No UI changes yet.

### Commit 2: Extract Catalog and Card

```text
refactor: extract reusable community plugin catalog
```

- Add card and catalog components.
- Move current page logic without changing navigation.
- Make old page a wrapper temporarily.
- Migrate and expand component tests.
- Add all six language updates required by new controls.

### Commit 3: Add Sources Wrapper

```text
refactor: group external plugin marketplace sources
```

- Add `PluginSourcesTab`.
- Move marketplace refresh coordination into wrapper.
- Add component tests.

### Commit 4: Unify Plugin Manager

```text
feat: unify plugin discovery and management page
```

- Update PluginManager tabs/order.
- Add route-query state.
- Wire install/manage/uninstall synchronization.
- Add PluginManager tests.

### Commit 5: Route and AI Migration

```text
refactor: redirect community plugin navigation
```

- Hide and redirect legacy routes.
- Move aliases to PluginsManagement.
- Update route and AI navigation tests.
- Remove the obsolete wrapper page when no import remains.

### Commit 6: E2E Coverage

```text
test: cover unified plugin discovery flow
```

- Add critical E2E flow.
- Verify all required commands.

Do not commit broken intermediate states. If component extraction and wrapper migration cannot compile independently, combine Commit 2's related files into one complete unit.

## 22. Rollback Strategy

### 22.1 Renderer Rollback

The change has no data migration. Reverting the renderer/navigation commits restores the old pages without converting persisted data.

### 22.2 Route Compatibility

Keep legacy redirects for at least one release after rollout. If the unified page is reverted, the old component route can be restored using the same route names.

### 22.3 Backend Compatibility

Because no IPC or service contract changes, the new renderer and old renderer remain compatible with the same main-process implementation during development builds.

## 23. Observability and Diagnostics

No new product analytics system is introduced. Existing safe error messages remain visible in the catalog.

During development:

- Use component tests to verify filter counts and mutation state.
- Use existing marketplace errors in Issues for source health.
- Avoid permanent `console.log` statements.
- If temporary debug logging is needed, remove it before commit.

Potential future product events, if an analytics contract is added, are listed in the paired PRD and are outside this implementation.

## 24. Alternatives Considered

### 24.1 Add Community as a Fifth Tab

Rejected because it preserves two discovery concepts: Community and Discover. Users would still need to understand source taxonomy.

### 24.2 Merge Both Catalog APIs Into One Renderer List

Deferred because the result types and actions differ. A correct merger needs a discriminated union, unified detail behavior, source labels, and conflict rules for duplicate plugin identities.

### 24.3 Use Existing `PluginDiscoverTab` for Community Results

Rejected because it is a table tied to `PluginMarketplacePluginSummary` and marketplace-specific detail/status. Retrofitting Hub access states into it would couple two distinct contracts.

### 24.4 Server-Side Search on Every Keystroke

Rejected for the current catalog because it adds latency, IPC traffic, debounce state, and unstable facets without solving a demonstrated scale problem.

### 24.5 Store Filters in Pinia

Rejected because filter state is local to one catalog instance and does not need cross-page/global ownership. Component retention satisfies the required navigation behavior with less coupling.

### 24.6 Use Masonry Cards

Rejected because masonry changes visual scan order and makes keyboard progression harder to predict.

### 24.7 Remove Legacy Routes Immediately

Rejected because old bookmarks and AI/tool references may still target the route name or path. Invisible redirects are cheap and safe.

## 25. Requirement Traceability

| PRD requirement | Technical design |
|---|---|
| One visible Plugin destination | §12 router migration |
| Discover/Installed/Sources/Issues | §3, §10, §11 |
| Block-style responsive grid | §3.1, §9.9, §16 |
| Prominent Installed state | §8.2-§8.3 |
| Search all catalog fields | §7.2, §7.6 |
| Tag list and More overflow | §7.3-§7.7 |
| All/Available/Installed | §6.2, §7.5 |
| Combined AND filtering | §7.6 |
| Install synchronization | §3.3, §9.4, §11.6 |
| Uninstall synchronization | §11.8 |
| Manage opens Installed detail | §9.5, §11.7 |
| Preserve filters | §4 TD-6/TD-7, §11 |
| Legacy route redirect | §12.2 |
| AI aliases | §12.4 |
| WebSocket plan refresh | §9.7 |
| Loading/error/no-results states | §9.8, §14 |
| Accessibility | §15 |
| All six languages | §17 |
| Component and E2E tests | §18 |
| No backend/schema change | §4 TD-10, §5.3 |

## 26. Resolved Implementation Assumptions

### A1: Existing Installed Plugin Name

Use `entry.name` for an entry reported as installed by the catalog and use `summary.name` immediately after installation. Add a fixture where `slug`, marketplace entry name, and installed manifest name differ. If that test exposes an unreliable backend identifier, stop Manage deep-linking for that entry and open the Installed tab without detail; do not expand the backend contract inside this feature.

### A2: Refresh Failure With Cached UI

Retain successfully loaded entries when a later refresh fails. Show a translated non-blocking warning above the cached results and provide Retry. Use the blocking error state only when no catalog has ever loaded successfully.

## 27. Definition of Technical Completion

Implementation is technically complete when:

1. `PluginManager` is the sole visible plugin navigation destination.
2. Community discovery renders through one extracted catalog implementation.
3. Filtering helpers are pure, typed, deterministic, and tested.
4. Cards render installed/access state independently from actions.
5. Install and uninstall state reconcile through authoritative main-process reads.
6. Top-level tab state survives refresh and browser history through a validated query.
7. Legacy paths and names redirect to canonical Discover.
8. AI navigation resolves Community phrases to `PluginsManagement`.
9. No database, IPC, preload, worker, or Hub contract is changed.
10. All new text is translated in six language files.
11. Accessibility and responsive behavior match this design.
12. Component, utility, route/AI, TypeScript, Vue TypeScript, and E2E verification pass.
13. No temporary logs, duplicate listeners, stale page implementation, or dead imports remain.
