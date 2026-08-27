# Unified Plugin Page and Block-Style Discovery - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-27
- **Owner**: AiFetchly Desktop Engineering
- **Scope**: Consolidate the current Plugins and Community Plugins destinations into one Plugin page, and replace the Community Plugin catalog presentation with a searchable, tag-filtered, block-style discovery flow.
- **Primary repository**: `/home/robertzeng/project/aiFetchly`
- **Related documents**:
  - `docs/prd/community-plugin-page-prd.md`
  - `docs/prd/community-plugin-page-technical-design.md`
  - `docs/prd/plugin-marketplace-support-prd.md`
  - `docs/prd/plugin-marketplace-support-technical-design.md`
  - `docs/prd/plugin-hub-managed-installation-prd.md`
  - `AGENTS.md`
- **Verified code anchors**:
  - `src/views/components/plugins/PluginManager.vue`
  - `src/views/components/plugins/PluginDiscoverTab.vue`
  - `src/views/components/plugins/PluginInstalledTab.vue`
  - `src/views/pages/communityPlugins/index.vue`
  - `src/views/api/communityPlugins.ts`
  - `src/entityTypes/communityPluginTypes.ts`
  - `src/views/utils/communityPluginCta.ts`
  - `src/service/PluginMarketplaceService.ts`
  - `src/views/router/index.ts`
  - `src/config/aiNavigationRouteManifest.ts`
  - `test/vitest/main/components/CommunityPluginsPage.test.ts`

## 1. Executive Summary

AiFetchly currently exposes two plugin destinations in the left navigation:

1. **Plugins**, which manages installed plugins and user-configured marketplaces.
2. **Community Plugins**, which browses the first-party AiFetchly Plugin Hub.

This separation follows backend source boundaries rather than the user's task. Users do not need to decide whether a plugin comes from the Community Hub or a configured marketplace before they can discover or manage it. They need one place to find, install, inspect, enable, disable, and troubleshoot plugins.

This PRD defines a unified Plugin experience with one left-navigation destination and four task-oriented sections:

```text
Plugins
├── Discover     Browse the AiFetchly Community Plugin Hub
├── Installed    Manage installed and built-in plugins
├── Sources      Browse and manage external plugin marketplaces
└── Issues       Review marketplace loading and validation errors
```

The Discover section uses a responsive block grid instead of a table. Each plugin card communicates identity, description, category, tags, access state, installed state, and the next available action. Search, tag filtering, and availability filtering help users narrow the catalog without repeated IPC calls.

The change preserves the existing Hub authentication, access decisions, installation pipeline, marketplace architecture, error handling, and live subscription refresh behavior. It is primarily an information architecture and renderer experience change.

## 2. Background and Current State

### 2.1 Current Plugin Manager

`PluginManager.vue` currently contains four tabs:

- Installed
- Discover
- Marketplaces
- Errors

The existing Discover tab lists plugins from user-configured marketplace caches in a table. It does not show the first-party Community Plugin Hub catalog.

### 2.2 Current Community Plugin Page

`src/views/pages/communityPlugins/index.vue` is a separate routed page. It already supports:

- Listing Community Hub plugins.
- Loading skeleton cards.
- Empty and retry states.
- Session-expired handling.
- Per-row Hub access decisions.
- Direct installation of eligible plugins.
- Installed-state rendering.
- Upgrade, sign-in, preview, and unavailable outcomes.
- Live reload after `user_info_updated` WebSocket events.

The current page does not provide a search control or interactive catalog filters. Its grid is implemented with Vuetify rows and columns, and its installed state is communicated primarily through a disabled footer button.

### 2.3 Existing Data Contract

`PluginCommunityEntry` already exposes the fields needed by the new Discover experience:

```typescript
interface PluginCommunityEntry {
  readonly slug: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly owner?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly access: PluginCommunityAccess;
  readonly installed: boolean;
}
```

The main-process service cross-references installed marketplace entries before returning the catalog, so `installed` is authoritative at list time. The service also supports search and category filtering, but the renderer can load the cached catalog once and filter locally for immediate interaction and stable filter facets.

## 3. Product Problem

### 3.1 Navigation Reflects Implementation, Not User Intent

Users see two plugin destinations and must understand AiFetchly's internal distinction between Community Hub plugins and general plugins. This creates unnecessary navigation choice and makes Community plugins appear unrelated to installed plugin management.

### 3.2 Discovery Is Fragmented

Community Hub plugins and external marketplace plugins use separate pages, separate labels, and different presentation patterns. A plugin installed from the Community page does not visibly connect to the Installed tab until the installed list is reloaded.

### 3.3 The Current Catalog Is Hard to Scan

A plugin catalog is capability-oriented content. Users compare names, descriptions, owners, categories, tags, and access states. A dense record table is useful for administration but is not the best primary presentation for discovery.

### 3.4 Installed State Is Not Prominent Enough

The current Community card renders Installed as a disabled action. Disabled controls can look unavailable or broken. Users need to recognize installed plugins before they reach the action row.

### 3.5 Catalog Findability Does Not Scale

Without search and tag filtering, a growing catalog becomes a long visual scan. Users need fast narrowing by name, description, owner, category, and tag.

## 4. Product Decision

AiFetchly will expose one visible **Plugins** destination. The AiFetchly Community Plugin Hub becomes the primary content of the **Discover** section. External marketplaces remain supported but move under **Sources**, where their source-management context is clearer.

The first implementation will not merge Community Hub entries and external marketplace entries into a single normalized result list. The two catalogs have different access models, status contracts, and installation flows. They will share one Plugin page while retaining distinct subviews.

This document supersedes the following UI requirements in earlier PRDs:

- The requirement for Community Plugins to remain a separate visible navigation page.
- The Community Plugin Page Stage 1 non-goal that deferred search and filter UI.
- The Plugin Marketplace PRD assumption that the external marketplace table is the primary Discover experience.

All backend, authentication, security, entitlement, installation, and marketplace persistence requirements in those documents remain in force unless explicitly changed here.

## 5. Goals

1. Provide exactly one visible Plugin destination in the left navigation.
2. Make the AiFetchly Community Plugin Hub easy to find from the Plugin page.
3. Present Community plugins in a responsive block-style catalog optimized for scanning.
4. Make installed state visible in the card header without relying on a disabled action.
5. Let users search by plugin name, description, owner, category, or tag.
6. Let users filter the catalog through a concise tag list above the plugin grid.
7. Let users filter by All, Available, or Installed state.
8. Keep installation and uninstallation state synchronized between Discover and Installed.
9. Preserve old routes, bookmarks, and AI navigation phrases through redirects and aliases.
10. Preserve all current Community Hub loading, error, access, sign-in, upgrade, and live-refresh behavior.
11. Meet the repository's accessibility, i18n, and UI-testing requirements.

## 6. Non-Goals

1. No unified backend schema for Community Hub and external marketplace results in this release.
2. No ratings, reviews, download counts, popularity rankings, or recommendation algorithm.
3. No new plugin logo/image contract. Cards must work without artwork.
4. No masonry layout. The product will use a regular grid with predictable reading and keyboard order.
5. No multi-tag Boolean query builder in the first release.
6. No server-side pagination in the first release.
7. No change to Hub entitlement decisions or ticket-based installation behavior.
8. No change to marketplace source persistence or direct-source installation.
9. No new analytics requirement unless a repository-wide product analytics system is introduced separately.
10. No database schema change is required for the UI consolidation.

## 7. Target Users and Jobs

### 7.1 Marketing Operator

**Job**: Find a plugin that performs a marketing task and install it without understanding repositories, manifests, or marketplace sources.

**Success**: Searches for a concept such as `SEO`, filters to a relevant tag, recognizes whether a plugin is already installed, and takes the correct action from one card.

### 7.2 Existing Plugin User

**Job**: Confirm what is installed and move from discovery to management.

**Success**: Sees an Installed badge in Discover, chooses Manage, and reaches the matching plugin detail without searching for it again.

### 7.3 Free or Signed-Out User

**Job**: Understand which plugins are available and what action unlocks restricted plugins.

**Success**: Sees clear Install, Sign in, Upgrade, Coming soon, or Unavailable outcomes without a misleading disabled control.

### 7.4 Power User or Team Admin

**Job**: Add, refresh, inspect, or remove external plugin marketplaces.

**Success**: Finds those operations in Sources without confusing them with the first-party curated Discover catalog.

## 8. Information Architecture

### 8.1 Left Navigation

Only the existing Plugins route is visible in the left navigation.

```text
Left navigation
└── Plugins
```

Community Plugins must not appear as a second visible item.

### 8.2 Plugin Page Sections

The Plugin page must expose these top-level sections in this order:

1. **Discover**
2. **Installed**
3. **Sources**
4. **Issues**

Discover is first because it communicates the available plugin ecosystem and is the replacement destination for Community Plugins. Installed remains one click away for recurring management tasks.

### 8.3 Sources Section

Sources groups the existing external marketplace catalog and marketplace management. The implementation may use secondary tabs or a segmented control:

```text
Sources
├── Browse sources       Existing PluginDiscoverTab content
└── Manage sources       Existing PluginMarketplacesTab content
```

Marketplace-specific errors may remain in the top-level Issues section so failures have one predictable destination.

### 8.4 Route Model

The canonical Plugin route remains:

```text
/plugins/management
```

The selected section must be representable in a query parameter:

```text
/plugins/management?tab=discover
/plugins/management?tab=installed
/plugins/management?tab=sources
/plugins/management?tab=issues
```

Requirements:

- Missing or invalid `tab` values fall back to `discover`.
- Changing a top-level section updates the query without a full page reload.
- Browser refresh restores the selected section.
- Back and forward navigation restore the previous section.
- Existing `/community-plugins/list` links redirect to `/plugins/management?tab=discover`.
- The legacy route remains hidden rather than being removed immediately.

### 8.5 AI Navigation

The `PluginsManagement` route becomes the AI-navigation target for both plugin management and Community Hub discovery.

It must retain aliases including:

- plugins
- plugin management
- community plugins
- plugin store
- plugin hub
- browse plugins
- discover plugins
- plugin marketplace page

The separate `CommunityPluginsList` entry in `aiNavigationRouteManifest.ts` must be replaced or made non-navigable so AI navigation does not send users to a deprecated page.

## 9. Discover Experience

### 9.1 Page Composition

The Discover content is ordered as follows:

```text
Discover
├── Search and refresh toolbar
├── Tag filter row
├── Result summary and availability filter
├── Catalog state region
│   ├── Loading
│   ├── Session expired
│   ├── Catalog error
│   ├── Empty catalog
│   ├── No matching results
│   └── Plugin grid
└── Install error alert, when applicable
```

The Plugin page owns the page title and top-level tabs. The Discover component must not render a second page-level `h1` or nested full-page container.

### 9.2 Reference Wireframe

```text
Plugins

[ Discover ] [ Installed ] [ Sources ] [ Issues ]

[ Search plugins by name, description, author, or tag... ] [ Refresh ]

[ All ] [ Productivity ] [ Scraping ] [ Marketing ] [ AI ] [ More ]

18 plugins                                           [ All | Available | Installed ]

┌──────────────────────────┐  ┌──────────────────────────┐
│ PDF Tools     [Installed]│  │ SEO Assistant       [Pro]│
│ AiFetchly · Productivity │  │ Community · Marketing    │
│                          │  │                          │
│ Extract, transform, and  │  │ Generate and analyze SEO │
│ process PDF documents.   │  │ content for campaigns.   │
│                          │  │                          │
│ [PDF] [Documents]        │  │ [SEO] [AI]               │
│                          │  │                          │
│ [Manage]                 │  │ [Upgrade]                 │
└──────────────────────────┘  └──────────────────────────┘
```

### 9.3 Grid Layout

The catalog must use a normal CSS grid with row-major DOM order.

Recommended baseline:

```css
.community-plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 16px;
  align-items: stretch;
}
```

Responsive expectations:

| Available content width | Expected columns |
|---|---:|
| Under 600px | 1 |
| 600px to 899px | 2 where space permits |
| 900px to 1279px | 3 where space permits |
| 1280px and above | 3-4 depending on navigation width |

The exact number of columns may be produced by `auto-fill`, but cards must never become narrower than 290px. The layout must not use masonry positioning because visual order must match DOM and keyboard order.

### 9.4 Card Anatomy

Every plugin card must reserve areas for:

1. **Header**: display name and status chip.
2. **Metadata**: owner and category.
3. **Description**: a maximum of three visible lines in the grid.
4. **Tags**: visible tags associated with the plugin.
5. **Footer action**: the next meaningful action.

Cards must have consistent minimum height. The footer action must remain aligned near the bottom even when descriptions have different lengths.

Cards must work without plugin artwork. A neutral puzzle icon may be used consistently, but the UI must not generate random colors or decorative placeholder art.

### 9.5 Installed Presentation

When `entry.installed === true`:

- Show an **Installed** status chip in the card header.
- Use `success` semantics with a tonal treatment and check-circle icon.
- Do not use a green card background.
- Do not communicate installed state only through a disabled button.
- Replace Install with **Manage** or **View details**.
- Manage switches to the Installed section and opens the matching plugin detail when a reliable plugin name mapping is available.

The Installed chip is state information. Manage is an action. They must remain visually and semantically separate.

### 9.6 Access and Action Matrix

The renderer must continue to use the Hub-provided `access.status` and `installMode`; it must not derive the user's plan.

| Hub/access state | Header status | Footer action | Behavior |
|---|---|---|---|
| `allowed`, `direct`, not installed | None or Available | Install | Installs through the existing Community install IPC flow |
| `allowed`, `direct`, installed | Installed | Manage | Opens installed plugin management |
| `allowed`, `ticket` | Coming soon | Preview | Disabled with explanatory tooltip |
| `subscription_required` | Upgrade required or Pro | Upgrade | Opens the existing marketing plans page |
| `login_required` | Sign-in required | Sign in | Opens the existing login flow |
| `forbidden` | Unavailable | No action | Card remains readable but cannot be acted on |
| `unavailable` | Unavailable | No action | Card remains readable but cannot be acted on |

Unavailable cards may use muted treatment, but body text must continue to meet contrast requirements. The current blanket opacity of `0.55` should not be retained if it causes low-contrast text.

## 10. Search Requirements

### 10.1 Search Control

Discover must include a search field above the tag list.

The control must include:

- A magnifying-glass leading icon.
- A visible label or accessible name.
- A clear action when text is present.
- Full-width presentation on small screens.
- A practical maximum width on desktop while allowing the toolbar to wrap.

Suggested English placeholder:

> Search plugins by name, description, author, or tag

### 10.2 Searchable Fields

Search is case-insensitive and must match substrings across:

- `displayName`
- `name`
- `description`
- `owner`
- `category`
- `tags[]`

Whitespace at the start and end of the query is ignored.

### 10.3 Search Execution

The initial release should filter the already-loaded catalog in the renderer rather than invoke IPC for every keystroke.

Reasons:

- Results update immediately.
- No debounce or repeated IPC round trip is required for normal typing.
- Tag facets remain derived from the complete catalog rather than shrinking with search results.
- The current cached catalog is already returned as an array and has no pagination contract.

If the Hub introduces pagination or a catalog size that makes local filtering unsuitable, a later release may move search server-side and add a facet response contract.

### 10.4 Search Result Ordering

When search is empty, preserve the Hub catalog order. When search is present, the first release may preserve catalog order rather than invent an unsupported relevance score.

Exact display-name matches may be promoted only if the behavior is deterministic and covered by tests. Popularity-based ranking is out of scope.

## 11. Tag Filter Requirements

### 11.1 Filter Source

The tag filter row is built from the complete loaded catalog. Candidate values include:

- `category`, when present.
- Every value in `tags[]`.

Values are trimmed, empty values are removed, and duplicate values are collapsed case-insensitively while preserving a stable display label.

### 11.2 Tag Ordering

Tags should be ordered by frequency across catalog entries, descending. Equal-frequency tags are ordered alphabetically for deterministic rendering.

### 11.3 Selection Model

The first release uses single selection:

- **All** is selected by default.
- Selecting one tag deselects the previous tag.
- Selecting All clears the tag filter.
- A plugin matches when its category or one of its tags equals the selected value, case-insensitively.

Single selection avoids an unclear AND/OR model and reduces zero-result combinations.

### 11.4 Tag Overflow

The UI should show a concise primary set, recommended at 8-12 tags depending on available width. If more tags exist:

- Show a **More** affordance, menu, or expandable row.
- The currently selected tag must remain visible even when it would normally be in the overflow set.
- The tag row must remain keyboard accessible.

An endlessly wrapping wall of chips is not acceptable because it pushes the catalog below the fold and makes scanning harder.

### 11.5 Card Tags

Cards may show a limited number of tags, recommended at three. If more exist, render a compact `+N` indication or allow the card detail view to show the complete list.

## 12. Availability Filter and Result Summary

Discover must provide a compact availability filter with:

- All
- Available
- Installed

Definitions:

- **Installed**: `entry.installed === true`.
- **Available**: not installed and has an actionable Install outcome.
- **All**: no availability restriction.

Restricted, coming-soon, and unavailable entries remain in All but are not considered Available.

The result summary must state the number of matching plugins after applying search, tag, and availability filters. Screen readers must receive updates without disruptive focus movement.

Search, selected tag, and availability are combined with logical AND:

```text
matchesSearch AND matchesSelectedTag AND matchesAvailability
```

## 13. Interaction Requirements

### 13.1 Install

When the user selects Install:

1. Disable or load only the selected card's Install action.
2. Prevent duplicate concurrent installation of the same plugin.
3. Call the existing `installCommunityPlugin(slug)` renderer API.
4. On success, immediately update that card to `installed: true`.
5. Emit an installed event to the Plugin page.
6. Reload the Installed list in the background.
7. Replace Install with Manage without requiring a full page reload.
8. Preserve the user's current search and filters.

Only one global install may remain in flight if that is the existing service constraint, but the UI must make the busy scope clear.

### 13.2 Manage Installed Plugin

When the user selects Manage:

1. Switch the top-level section to Installed.
2. Update the route query to `tab=installed`.
3. Open the matching `PluginDetailPanel` when the installed plugin name can be resolved.
4. If detail selection cannot be resolved, show the Installed list with the corresponding row still present.

### 13.3 Uninstall Synchronization

After uninstall succeeds in Installed:

1. Reload the Installed list.
2. Refresh or locally update the matching Community catalog entry.
3. Replace Installed/Manage with the correct access-dependent action.
4. Do not reset Discover search or filter state.

The source of truth remains the main-process installed plugin state. Local optimistic state must be reconciled on refresh.

### 13.4 Refresh

Refresh must:

- Force-refresh the Community Hub catalog using the existing API contract.
- Preserve search, tag, and availability selections.
- Recompute tags from the refreshed full catalog.
- Clear install errors only when a new request starts or the alert is dismissed.
- Prevent duplicate refresh requests while a refresh is already running.

### 13.5 Live Subscription Update

The extracted Discover component must retain the existing `WEBSOCKET_EVENT` subscription. A `user_info_updated` event triggers a forced catalog reload so newly available subscription plugins appear without navigating away.

The listener must be removed when the component is unmounted. The implementation must avoid registering duplicate listeners when users change tabs repeatedly.

## 14. UI State Requirements

| State | User-visible result | Required action |
|---|---|---|
| Initial loading | Skeleton cards in the expected grid | None |
| Refreshing with existing data | Keep existing results visible where practical and show refresh progress | None |
| Catalog empty | “No plugins available” with Refresh | Refresh |
| Search/filter has no matches | Query-aware no-results message | Clear filters |
| General catalog error | “Couldn't reach the Plugin Hub” | Retry |
| Session expired | Dedicated warning | Sign in again |
| Install failure | Closable error near the catalog toolbar/grid | Retry from the card |
| Install in progress | Loading state on selected card action | None |
| Installed successfully | Installed chip plus Manage action | Manage |
| Upgrade required | Upgrade status/action | Upgrade |
| Login required | Sign-in status/action | Sign in |
| Ticket install unavailable | Coming soon/Preview treatment | Read tooltip |

### 14.1 No-Matches Empty State

No matching results must be distinct from an empty Hub catalog.

Example:

```text
No plugins match “youtube automation”.
Try another search or clear your filters.

[ Clear filters ]
```

Clear filters resets:

- Search text.
- Selected tag to All.
- Availability to All.

It does not force a network refresh.

## 15. Component Boundaries

### 15.1 `PluginManager.vue`

The Plugin page owns:

- Top-level section selection.
- Route-query synchronization.
- Installed plugin collection.
- Plugin detail panel selection.
- Import and install-from-source dialogs.
- Cross-section refresh after install and uninstall.

### 15.2 `CommunityPluginCatalog.vue`

Extract the Community page content into a reusable component under:

```text
src/views/components/plugins/CommunityPluginCatalog.vue
```

The component owns:

- Full Community catalog entries.
- Loading, refresh, and error state.
- Search text.
- Selected tag.
- Availability filter.
- Derived tag facets.
- Derived filtered entries.
- Card rendering.
- Community install, upgrade, and sign-in actions.
- Live subscription refresh listener.

Recommended public component contract:

```typescript
defineEmits<{
  installed: [pluginName: string];
  manage: [pluginName: string];
}>();

defineExpose<{
  reload: (force?: boolean) => Promise<void>;
}>();
```

The exact installed identifier must use the value returned by the install result where possible rather than assuming `slug === installed plugin name`.

### 15.3 Legacy Community Page

The old page component should not be embedded directly in `PluginManager.vue` because it owns a full-page container and heading. It may be reduced to a compatibility wrapper during migration, but the preferred steady state is a route redirect with no duplicate catalog implementation.

### 15.4 External Marketplace Components

Existing `PluginDiscoverTab`, `PluginMarketplacesTab`, and `PluginMarketplaceErrorsTab` remain responsible for external marketplace behavior. Renaming or regrouping them must not change their service contracts.

## 16. Accessibility Requirements

1. Search has a persistent accessible label; placeholder text is not its only label.
2. All filter chips are keyboard reachable and expose selected state.
3. Cards follow DOM order matching their visible grid order.
4. If the entire card opens details, it must be keyboard operable and have a visible focus indicator; nested buttons must stop card activation.
5. Touch/click targets are at least 44px on touch layouts.
6. Body text meets WCAG AA contrast of at least 4.5:1.
7. Unavailable-state styling must not rely only on opacity or color.
8. Installed, upgrade-required, and unavailable states include text, not only icons or color.
9. Loading regions use `role="status"` or an equivalent accessible status pattern.
10. Result-count changes are announced politely without moving focus.
11. Tooltips are supplementary; essential state or action meaning must remain visible without hover.
12. Description truncation must not make the complete description permanently inaccessible; details or an accessible title/expansion path must expose it.

## 17. Responsive Requirements

### 17.1 Desktop

- Search and Refresh may share one toolbar row.
- Tag chips appear below the toolbar.
- Result count and availability filter share a row when space permits.
- Grid uses at least 290px per card.

### 17.2 Tablet

- Toolbar controls may wrap.
- Search receives the largest available width.
- Tags may horizontally scroll or use More; essential controls must not be clipped.
- Grid should normally show two columns.

### 17.3 Mobile/Narrow Window

- Search occupies the full row.
- Refresh remains a visible button, not hover-only behavior.
- Availability control fits without horizontal page overflow.
- Cards use one column.
- Card actions remain full-size and easily reachable.
- The top-level Plugin tabs may scroll horizontally with an obvious selected state.

## 18. Internationalization

All new or changed user-facing strings must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Recommended keys include:

```text
plugins.tabs.discover
plugins.tabs.installed
plugins.tabs.sources
plugins.tabs.issues
plugins.sources.browse
plugins.sources.manage
communityPlugins.searchLabel
communityPlugins.searchPlaceholder
communityPlugins.allTags
communityPlugins.moreTags
communityPlugins.filterAll
communityPlugins.filterAvailable
communityPlugins.filterInstalled
communityPlugins.resultCount
communityPlugins.noMatchesTitle
communityPlugins.noMatchesDescription
communityPlugins.clearFilters
communityPlugins.manage
communityPlugins.statusInstalled
communityPlugins.statusUpgradeRequired
communityPlugins.statusSignInRequired
communityPlugins.statusComingSoon
communityPlugins.statusUnavailable
```

Components must use the repository fallback convention:

```typescript
t("communityPlugins.manage") || "Manage"
```

## 19. Security and Trust Requirements

1. The renderer must continue to call the Hub only through existing main-process IPC APIs.
2. Raw marketing JWTs, plan codes, and token-store values must never be exposed to the Discover component.
3. The renderer must render Hub-provided `access` decisions and must not recreate entitlement logic.
4. Direct installation remains enforced in the main-process service, not only hidden in the UI.
5. Search and tag strings are rendered through Vue interpolation; no catalog HTML is rendered through `v-html`.
6. Existing external URL opening rules remain unchanged and use fixed/trusted targets.
7. No direct database access may be added to renderer components or IPC handlers.

## 20. Performance Requirements

1. Search and filter changes should update visible results within 100ms for the expected cached catalog size on a supported desktop.
2. Typing in search must not invoke IPC on each keystroke in the first implementation.
3. Only catalog refresh, install, sign-in, upgrade, and installed-list synchronization may cross the renderer/main-process boundary.
4. Tag frequency computation should be derived once per catalog update, not independently for every rendered card.
5. Filtered results must use computed state rather than mutating the full catalog.
6. Components hidden by tab navigation must not accumulate duplicate WebSocket listeners.
7. If real catalog sizes later create visible rendering delay, virtualization or server-side pagination requires a separate contract and PRD update.

## 21. Acceptance Criteria

### 21.1 Navigation and Routing

- **AC-NAV-01**: The left navigation contains exactly one visible Plugins destination and no visible Community Plugins destination.
- **AC-NAV-02**: Opening Plugins without a valid tab query shows Discover.
- **AC-NAV-03**: Discover, Installed, Sources, and Issues update and restore the `tab` query.
- **AC-NAV-04**: `/community-plugins/list` redirects to `/plugins/management?tab=discover`.
- **AC-NAV-05**: AI requests for “community plugins,” “plugin hub,” and “browse plugins” open the unified Discover section.

### 21.2 Catalog Layout

- **AC-UI-01**: Community Hub entries render as block cards in a regular responsive grid rather than a table.
- **AC-UI-02**: Every card shows display name, description, available owner/category metadata, tags, state, and one appropriate action.
- **AC-UI-03**: Card descriptions are visually clamped while the complete description remains accessible through the details path.
- **AC-UI-04**: Grid visual order matches DOM and keyboard order.
- **AC-UI-05**: Installed cards display an Installed status chip in the header and a Manage action in the footer.

### 21.3 Search and Filters

- **AC-FILTER-01**: Search matches name, display name, description, owner, category, and tags case-insensitively.
- **AC-FILTER-02**: Clearing search immediately restores results without an IPC call.
- **AC-FILTER-03**: The tag row contains All plus unique category/tag values derived from the full catalog.
- **AC-FILTER-04**: Selecting a tag filters entries by exact category/tag match and does not mutate the catalog.
- **AC-FILTER-05**: Availability filters correctly distinguish All, Available, and Installed.
- **AC-FILTER-06**: Search, tag, and availability filters combine using logical AND.
- **AC-FILTER-07**: The result count matches the number of rendered cards.
- **AC-FILTER-08**: No matches shows a query-aware empty state with Clear filters.
- **AC-FILTER-09**: Clear filters resets search, tag, and availability without refreshing the network catalog.

### 21.4 Installation State

- **AC-INSTALL-01**: Installing an eligible plugin changes its card to Installed without leaving Discover.
- **AC-INSTALL-02**: A successful install reloads the Installed collection in the background.
- **AC-INSTALL-03**: Manage switches to Installed and opens the matching plugin when the returned install identifier permits it.
- **AC-INSTALL-04**: Uninstalling from Installed returns the Discover card to the correct non-installed action after synchronization.
- **AC-INSTALL-05**: Search and filter state survive install, manage navigation, refresh, and uninstall synchronization.
- **AC-INSTALL-06**: Duplicate install activation is prevented while installation is in progress.

### 21.5 Access and Error States

- **AC-STATE-01**: The complete existing CTA matrix remains correct for direct, ticket, subscription-required, login-required, forbidden, and unavailable entries.
- **AC-STATE-02**: Session-expired errors show Sign in again rather than the generic retry state.
- **AC-STATE-03**: Hub errors show Retry and do not present stale entries as freshly loaded.
- **AC-STATE-04**: A `user_info_updated` event force-refreshes the catalog and does not register duplicate listeners.
- **AC-STATE-05**: Unavailable cards remain readable and meet contrast requirements.

### 21.6 Quality Gates

- **AC-QA-01**: All six supported language files contain every new key.
- **AC-QA-02**: `yarn test:components` passes.
- **AC-QA-03**: `yarn vue-check` passes.
- **AC-QA-04**: Component tests cover rendering, search, tags, availability, installed state, installation synchronization, no results, and error states.
- **AC-QA-05**: A router or E2E test verifies legacy redirect and tab-query restoration.
- **AC-QA-06**: A critical-flow E2E test covers Discover search, install, Installed synchronization, and return to Discover.

## 22. Test Plan

### 22.1 `CommunityPluginCatalog` Component Tests

Create or migrate tests under `test/vitest/main/components/` covering:

1. Loading skeleton rendering.
2. Card grid rendering for a representative catalog.
3. Search by display name.
4. Search by description.
5. Search by owner.
6. Search by category.
7. Search by tag.
8. Case-insensitive and trimmed search.
9. Tag derivation and frequency ordering.
10. Single-tag filtering.
11. Availability filtering.
12. Combined search, tag, and availability filtering.
13. Result count.
14. No-matches state and Clear filters.
15. Installed chip and Manage action.
16. Direct Install success and emitted identifier.
17. Install failure alert.
18. Upgrade, sign-in, preview, forbidden, and unavailable outcomes.
19. WebSocket forced reload.
20. Listener removal on unmount.

### 22.2 `PluginManager` Component Tests

Cover:

1. Top-level section labels and order.
2. Discover as the default section.
3. Route query initialization and updates.
4. Install event reloads Installed plugins.
5. Manage event selects Installed and opens details.
6. Uninstall refreshes the Community catalog.
7. Sources contains the existing external catalog and marketplace management.
8. Issues still renders marketplace errors.

### 22.3 Router and AI Navigation Tests

Cover:

1. Legacy Community route redirect.
2. Invalid tab fallback.
3. Back/forward tab restoration.
4. Community aliases resolve to `PluginsManagement`.
5. The deprecated Community route is not advertised as a separate visible destination.

### 22.4 E2E Critical Flow

Add or extend a Playwright Electron spec:

```text
Open Plugins
→ Discover is visible
→ Search for a known plugin
→ Select a tag
→ Install plugin
→ Card shows Installed
→ Choose Manage
→ Installed section opens matching plugin
→ Uninstall
→ Return to Discover
→ Card shows Install again
```

## 23. Rollout Plan

### Phase 1: Component Extraction

- Extract `CommunityPluginCatalog.vue` from the current page.
- Preserve all existing API calls, CTA decisions, loading/error states, and WebSocket behavior.
- Move/update existing component tests.

### Phase 2: Unified Navigation

- Add Community Discover content to `PluginManager.vue`.
- Reorder and rename top-level sections.
- Group external marketplace views under Sources.
- Hide the separate Community route from navigation.
- Add legacy redirect and tab-query behavior.
- Update AI navigation manifest and aliases.

### Phase 3: Discovery Controls and Cards

- Implement the regular grid and card anatomy.
- Add prominent installed/access status chips.
- Add local search.
- Add tag facets and overflow behavior.
- Add availability filtering and result count.
- Add no-matches state.

### Phase 4: Cross-Section Synchronization

- Emit install/manage events from the catalog.
- Reload Installed after install.
- Refresh Discover after uninstall.
- Preserve filter state through synchronization.

### Phase 5: Quality and Release

- Update all six languages.
- Complete component and E2E coverage.
- Run `yarn test:components` and `yarn vue-check`.
- Manually verify narrow, tablet, and desktop window sizes.
- Verify Community, subscription-required, and session-expired experiences.

## 24. Success Measures

The first release is successful when:

1. Users encounter one plugin destination instead of two.
2. A user can find a known plugin through search or one tag selection without scanning the complete catalog.
3. Installed plugins are recognizable from the card header within a quick visual scan.
4. Install and uninstall changes stay consistent across Discover and Installed without a manual app reload.
5. Existing Community Hub access and error behavior does not regress.
6. No supported language or critical Plugin Manager flow loses coverage.

Quantitative product analytics are not defined because the current scope does not establish an application analytics contract. If analytics are added later, recommended measurements are Discover visits, search usage, tag selection, zero-result rate, install conversion, Manage transitions, Upgrade selection, and install failure rate.

## 25. Risks and Mitigations

### R-1: Discover Naming Collision

**Risk**: Users may confuse the first-party Discover catalog with external marketplace browsing.

**Mitigation**: Make Discover the curated AiFetchly Hub experience and move external marketplace catalog browsing under Sources with explicit labels.

### R-2: Installed Identifier Mismatch

**Risk**: Community `slug` may not always equal the installed plugin's canonical `name`, causing Manage to open the wrong or no detail panel.

**Mitigation**: Use the `PluginSummary` returned by `installCommunityPlugin()` as the canonical post-install identifier. Do not assume slug/name equivalence in the renderer.

### R-3: Stale Cross-Section State

**Risk**: Discover shows Installed while the Installed list is stale, or uninstall does not update the card.

**Mitigation**: Centralize synchronization in `PluginManager.vue`, refresh authoritative state after mutations, and test both directions.

### R-4: Too Many Tag Chips

**Risk**: A large tag vocabulary pushes results below the fold and creates visual noise.

**Mitigation**: Rank by frequency, show a concise primary set, provide More, and keep the selected tag visible.

### R-5: Local Filtering Stops Scaling

**Risk**: A future catalog with thousands of entries may make client-side filtering or rendering slow.

**Mitigation**: Set a measurable 100ms interaction target. Introduce pagination/facets only when observed catalog size requires a new server contract.

### R-6: Hidden Listener Accumulation

**Risk**: Tab switching may repeatedly mount the catalog and register duplicate WebSocket listeners.

**Mitigation**: Pair listener registration/removal, verify lifecycle behavior in component tests, and choose explicit lazy/eager mounting behavior.

### R-7: Muted Cards Lose Readability

**Risk**: Applying opacity to unavailable cards reduces all child contrast.

**Mitigation**: Use explicit muted surface/border/status styling instead of blanket opacity and verify WCAG AA contrast.

## 26. Open Questions

1. **Sources presentation**: Should Browse sources and Manage sources be secondary tabs or one page with management above the external catalog? Recommendation: secondary tabs because both existing views are substantial.
2. **Default persistence**: Should Plugins always open Discover, or remember the user's last section? Recommendation: canonical navigation opens Discover; the route query preserves explicit/deep-linked state. Add persistent last-section behavior only after observing demand.
3. **Card details**: Should clicking the card open Community detail immediately in this release? Recommendation: make the action explicit and avoid whole-card navigation until the detail view contains more than the Stage 1 list row.
4. **Tag vocabulary**: Should categories and tags share one row or use separate filters? Recommendation: one combined row initially because the current contract has sparse optional metadata and users should not need to understand the distinction.
5. **Installed availability semantics**: Should restricted but already-installed plugins remain Manage-able if the user's plan changes? Recommendation: installed state and local management remain available; Hub access governs acquisition, not removal or inspection of already-installed local files. Confirm this against the managed-install entitlement policy before implementation.

## 27. Definition of Done

The feature is done only when:

- One visible Plugins navigation destination replaces the two-page structure.
- The Community Hub catalog is the Discover section of Plugin Manager.
- Discover uses the specified block grid, search, tag list, availability filter, and result count.
- Installed state is prominent and synchronized with Installed management.
- All current access, loading, error, sign-in, upgrade, and live refresh behavior is preserved.
- Legacy route and AI navigation compatibility are verified.
- Responsive and accessibility requirements are met.
- All six language files are updated.
- Required component and E2E tests pass.
- The implementation follows Model/Module/IPC boundaries and introduces no renderer or IPC database access.
