# Inner-Page UI Convergence Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-12
- **Owner**: AiFetchly Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Primary areas**: Customer-facing routed pages, shared page templates, design-system convergence, responsive behavior, accessibility, and incremental migration
- **Parent product contract**: [`AI Chat Workspace UI Redesign PRD`](./ai-chat-workspace-ui-redesign-prd.md)
- **Parent technical design**: [`AI Chat Workspace UI Redesign Technical Design`](./ai-chat-workspace-ui-redesign-technical-design.md)
- **Technical design**: [`Inner-Page UI Convergence Technical Design`](./inner-page-ui-convergence-technical-design.md)
- **Visual reference**: [`AI Chat Workspace Redesign Preview`](../design/ai-chat-workspace-redesign-preview.html)

## 1. Executive Summary

AiFetchly will progressively migrate its customer-facing inner pages into the visual and interaction system established by the AI Chat Workspace UI Redesign. The migration will make Chat, Insights, Automations, Search, Knowledge, Plugins, Accounts, Scheduling, and Settings feel like one application without forcing every feature into the chat layout.

The application will keep one persistent global shell: the main navigation and workspace/conversation sidebar remain on the left, the selected feature occupies the center, and an optional contextual inspector appears on the right. Inner pages will use shared composition patterns for page identity, search, filters, primary actions, collections, forms, details, results, settings, task state, loading, errors, and empty states.

The current router has approximately 69 active route-to-page mappings. Several route variants reuse one Vue component for create, edit, detail, or provider modes. After deduplication, the application has 54 distinct active routed page components. This PRD targets 50 customer-facing inner-page surfaces. The chat/dashboard surface is covered by the parent PRD; login and 404 use smaller separate treatments; the apparently legacy Statistics page requires a retain-or-retire decision before redesign. A commented Extra Modules route is inactive and excluded.

The migration will not rewrite business logic, database behavior, IPC contracts, or feature workflows merely to change presentation. Pages will move incrementally by feature family. Shared templates will supply consistent hierarchy and behavior, while feature components retain their domain-specific content.

## 2. Relationship to the Parent PRD

### 2.1 Dependency direction

This PRD is downstream of the [`AI Chat Workspace UI Redesign PRD`](./ai-chat-workspace-ui-redesign-prd.md).

The parent PRD remains authoritative for:

- The persistent application sidebar and workspace/conversation hierarchy.
- The focused center surface and collapsible right inspector.
- Minimal-header principles.
- Status ownership and progressive disclosure.
- Background-run and renderer-performance architecture.
- Chat, tool execution, plan, artifact, Activity, and Context behavior.
- Artifact isolation and security.

This PRD extends those decisions to customer-facing non-chat routes. If the documents conflict, the parent PRD owns the global shell and chat-specific behavior; this PRD owns inner-page templates and migration scope.

### 2.2 Shared product principle

Consistency comes from repeated hierarchy and behavior, not identical page structure. A chat transcript, data table, configuration form, and settings catalog may use different layouts while sharing:

- The same application shell.
- The same surface, typography, spacing, border, radius, and color tokens.
- The same action hierarchy.
- The same status semantics.
- The same loading, empty, error, permission, and completion patterns.
- The same inspector behavior.
- The same keyboard, responsive, and localization expectations.

### 2.3 No duplicated shell

Inner pages must not recreate global navigation, workspace navigation, account controls, or a second application header. Route changes replace the center feature surface and its contextual inspector only.

## 3. Background and Current State

### 3.1 Current page architecture

AiFetchly uses Vue Router, Vue 3, Vuetify, and a route-oriented center area. Current pages frequently build their own combinations of containers, cards, tree views, tables, form controls, title bars, alerts, and action groups.

This creates several inconsistencies:

- Similar list pages use different search, filtering, action, and empty-state patterns.
- Create and edit forms place actions in different locations.
- Status appears in page headers, cards, tables, alerts, and buttons with no single owner.
- Details often require full route navigation even when an inspector would preserve context better.
- Pages contain nested cards whose borders and padding compete with the new flatter chat workspace.
- Hidden route metadata is sometimes mistaken for customer inaccessibility.
- Responsive behavior differs by feature.
- Loading, error, and permission experiences are feature-specific.

### 3.2 Visibility is not authorization

`meta.visible: false` generally means that a route is hidden from menu presentation. It does not prevent a customer from reaching that route through a button, redirect, deep link, AI navigation, or direct URL. Create, edit, detail, result, and settings routes remain customer-facing unless an explicit authorization boundary prevents access.

The current `asyncRoutes` list does not provide a role-based exclusion list. This PRD therefore excludes pages only when they are inactive infrastructure, separately scoped, or explicitly retired. It does not exclude a page merely because it is absent from the menu.

## 4. Scope Inventory

### 4.1 Customer-facing inner-page scope

| Area | Distinct page surfaces | Primary examples |
| --- | ---: | --- |
| Insights and discovery | 1 | Insights home |
| Settings and customization | 9 | General settings, MCP, AI provider, skills, hooks, plugins, AI memory, subagents, About |
| Campaign and social-task workflows | 6 | Campaign list/editor, social-task list/editor/run/history/results |
| Search and data extraction | 10 | Search, email extraction, Yellow Pages, map scraper |
| Email marketing | 14 | Overview, bulk tasks, logs, send form, templates, filters, services, received mail, reply audit |
| Proxy and social accounts | 5 | Proxy list/editor/import, social account list/editor |
| Knowledge library | 1 | Knowledge catalog |
| Scheduling | 4 | Schedule list/create/edit/detail |
| **Total** | **50** | Customer-facing inner-page surfaces |

One Vue component may support several route modes. The count represents distinct routed presentation surfaces, not an estimate of implementation components or engineering tasks.

### 4.2 Separate or excluded surfaces

| Surface | Treatment |
| --- | --- |
| Dashboard/chat | Governed by the parent PRD and not counted as an inner-page migration |
| Login | Customer-visible but outside the authenticated application shell; receives a separate compact branding and accessibility pass |
| 404 | Utility surface; adopts shared typography, color, spacing, and button tokens without a full template migration |
| Statistics | Appears legacy or unlinked; product must confirm retention before redesign investment |
| Extra Modules | Commented/inactive route; no migration work |

### 4.3 Shared components are not counted as pages

Dialogs, table widgets, form fields, approval cards, banners, and inspectors are migration dependencies but are not counted as routed pages. They will be updated through the shared design system and template implementation.

## 5. Goals

1. Make all customer-facing inner pages feel native to the new application shell.
2. Replace page-specific layout conventions with shared composable templates.
3. Reduce duplicate UI code for headers, toolbars, forms, status, empty states, and inspectors.
4. Preserve feature behavior while migrating presentation incrementally.
5. Give each page one clear primary action and predictable secondary actions.
6. Place status and decisions next to the object or workflow that owns them.
7. Move technical detail, history, diagnostics, and selected-record detail into the contextual inspector where appropriate.
8. Establish consistent keyboard, focus, responsive, localization, and reduced-motion behavior.
9. Allow future pages to adopt the design system without inventing a new local layout.
10. Avoid redesign effort on inactive or retired pages.

## 6. Non-Goals

This initiative does not require:

- Rewriting feature business logic solely for visual consistency.
- Replacing existing Module, Model, IPC, or database architecture.
- Converting all routes in one release.
- Forcing every page into a three-column layout when no inspector is useful.
- Making every screen visually identical.
- Replacing Vuetify in one migration.
- Changing customer permissions or route authorization.
- Redesigning inactive Extra Modules pages.
- Redesigning the legacy Statistics page before its retention is confirmed.
- Moving diagnostics or unsafe technical payloads into trusted renderer surfaces without existing security controls.

## 7. Product Principles

1. **One persistent shell.** Navigation does not disappear or rebuild when the customer enters a feature.
2. **One primary action.** Each page gives strongest emphasis to the action most likely to advance the customer’s current task.
3. **Action near object.** Row actions belong to rows, run actions belong to run state, and form actions belong to the form.
4. **Status has one owner.** A status is not repeated in the header, alert, card, table, and tab simultaneously.
5. **Progressive disclosure.** The center shows outcomes and decisions; the inspector shows history, diagnostics, and secondary detail.
6. **Flat before carded.** Spacing and separators establish structure before raised cards.
7. **Templates compose.** Pages combine collection, form, detail, result, settings, and task-state patterns instead of extending one giant page component.
8. **Behavior before decoration.** Migration preserves working feature behavior before page-specific styling is removed.
9. **Customer accessibility determines scope.** Hidden navigation metadata is not treated as an authorization boundary.
10. **Shared states are product features.** Loading, empty, error, permission, and completion states are designed and tested, not improvised.
11. **Responsive behavior is structural.** Small screens change surface ownership rather than merely shrinking desktop columns.
12. **Color supports meaning.** Text, icons, accessible names, and placement carry state independently of color.

## 8. Shared Application Shell

### 8.1 Wide-screen structure

```text
┌──────────────────┬──────────────────────────────────┬──────────────────┐
│ Global sidebar   │ Inner page                       │ Context inspector│
│                  │                                  │                  │
│ New chat         │ Minimal page identity            │ Selected record  │
│ Search           │ Contextual toolbar               │ History          │
│ Automations      │                                  │ Activity         │
│ Customize        │ Page content                     │ Diagnostics      │
│                  │                                  │                  │
│ Workspaces       │                                  │                  │
│ Conversations    │                                  │                  │
└──────────────────┴──────────────────────────────────┴──────────────────┘
```

### 8.2 Shell responsibilities

The shared shell provides:

- Persistent global navigation.
- Persistent workspace and conversation navigation.
- A center page header with title and optional short description.
- A page toolbar slot.
- A main content slot.
- One optional contextual inspector.
- Responsive sidebar and inspector behavior.
- Shared focus restoration when overlays close.
- Shared loading and route-transition behavior.

### 8.3 Center header

The center header may contain:

- Page title.
- Short breadcrumb or context label when it prevents ambiguity.
- At most one summarized status owned by the page-level object.
- One primary action.
- Inspector toggle.
- Overflow menu.

The center header must not become a container for filters, full status history, bulk actions, diagnostic controls, or every possible feature action.

### 8.4 Inspector ownership

The right inspector is optional. It is appropriate for:

- Selected record details.
- Current and recent run activity.
- History and audit information.
- Diagnostics and safe technical detail.
- Related context that should not replace the main task.

It must not duplicate the full center page or become mandatory for completing basic workflows.

## 9. Shared Visual Language

### 9.1 Visual source

The initial token direction follows the parent redesign preview:

- Near-black canvas and shell.
- Neutral dark sidebar and surfaces.
- Low-contrast one-pixel separators.
- Restrained burnt-orange accent for selection and primary action.
- Green success, amber attention, and red failure semantics.
- Compact UI typography and monospace only for technical values.
- Functional motion rather than decorative motion.

Exact production tokens must be centralized before template rollout. Pages must not copy literal preview values into local style blocks.

### 9.2 Token behavior

| Token family | Product rule |
| --- | --- |
| Canvas | Application background; never used as an input background |
| Normal surface | Default page, toolbar, row, and panel surface |
| Raised surface | Menus, overlays, selected inspectors, or intentionally elevated regions only |
| Hover surface | Subtle state change without layout movement |
| Selected surface | Neutral selection plus restrained accent indicator |
| Border | Low-contrast structural separation |
| Accent | Primary action, selection, focus-related emphasis; not decoration |
| Success | Completed or healthy state with icon and text |
| Warning | Required attention, waiting, or recoverable issue with icon and text |
| Danger | Failure or destructive action with explicit label |
| Focus | Visible keyboard focus independent of hover and selection |

### 9.3 Spacing and radius

- Use a 4px base spacing scale: 4, 8, 12, 16, 20, 24, and 32px.
- Use compact spacing inside table rows and controls.
- Use comfortable spacing between page sections.
- Use approximately 7px radius for controls, 11px for panels, and 16px for major overlays.
- Do not apply the largest radius to every card, field, and button.

### 9.4 Surface hierarchy

Pages should prefer:

```text
Section title
────────────────────────────────────────
Content
```

over:

```text
[ Card [ Card [ Field or table ] ] ]
```

Cards are reserved for objects that need independent selection, drag behavior, strong semantic grouping, or elevation.

## 10. Shared Template System

### 10.1 Template composition model

Templates define layout contracts, not feature logic. A routed feature page may combine:

- One primary page template.
- Zero or more supporting templates.
- Shared state and decision surfaces.
- Feature-owned content and business behavior.

Illustrative composition:

```vue
<AppPageShell>
  <template #header>
    <PageIdentity />
    <PagePrimaryAction />
    <PageOverflowMenu />
  </template>

  <template #toolbar>
    <PageSearch />
    <PageFilters />
  </template>

  <FeatureCollection />

  <template #inspector>
    <FeatureInspector />
  </template>
</AppPageShell>
```

The names are product-level contracts and may change during technical design.

## 11. Template A: Collection and List

### 11.1 Applicable pages

Use for campaign, task, search-history, extraction-history, Yellow Pages, bulk-email task, template, filter, service, inbox, reply-audit, proxy, social-account, and schedule collections.

### 11.2 Anatomy

```text
Schedules                              [New schedule]  [•••]

[Search schedules…]  [Status ▾] [Owner ▾]       Sort: Updated ▾
───────────────────────────────────────────────────────────────
□  Weekly lead report       Active       Tomorrow      Jianze
□  Reply audit              Paused       Friday        Jianze
□  Contact extraction       Failed       2 hours ago   Jianze
```

### 11.3 Requirements

- Place search, filters, view controls, and sorting below the header.
- Show one primary create action.
- Put rare page-level actions in overflow.
- Reveal bulk actions only after selection.
- Open selected-record detail in the right inspector when this preserves list context.
- Keep business result columns in the center and move diagnostic detail to the inspector.
- Use subtle row separators and hover/selected states instead of a card per row.
- Preserve filters, selection, and scroll position when the inspector opens or closes.
- Truncate long values predictably and expose the full value accessibly.
- Paginate, incrementally load, or virtualize large collections.

### 11.4 Inspector example

```text
Schedule details

Weekly lead report
Active

Next run       Tomorrow, 09:00
Last result    248 contacts
Workspace      market-system

[Run now] [Pause]

Recent activity
✓ Completed  Yesterday
✓ Completed  Monday
```

## 12. Template B: Create and Edit Form

### 12.1 Applicable pages

Use for campaign, social-task, search, email extraction, Yellow Pages, map-scraper, email-send, template, filter, service, proxy, social-account, and schedule creation or editing.

### 12.2 Anatomy

```text
Create schedule                                      Draft

Basic information
──────────────────────────────────────────────────────────────
Name
[ Weekly lead report                              ]

Workspace
[ market-system                                  ▾]

Schedule
[ Every Monday ▾ ] [ 09:00 ]

Execution
──────────────────────────────────────────────────────────────
Task
[ Contact extraction                             ▾]

Advanced settings                                      [Show]

──────────────────────────────────────────────────────────────
                                      [Cancel] [Create schedule]
```

### 12.3 Requirements

- Use an objective title such as `Create schedule` or `Edit email service`.
- Group related fields into flat sections.
- Keep essential fields visible and collapse genuinely advanced settings.
- Place help and validation next to the relevant field.
- Do not use a generic top-page error when the failing field can be identified.
- Use a sticky action bar for long forms.
- Give only the save/create action primary emphasis.
- Keep cancel secondary and destructive actions separated.
- Preserve unsaved values when safe and warn before meaningful data loss.
- Use a short step rail only when the workflow has distinct stages that cannot fit one coherent page.
- Avoid a wizard for ordinary single-page forms.

## 13. Template C: Detail and Inspection

### 13.1 Applicable pages

Use for search tasks, email-extraction tasks, Yellow Pages tasks, email-send logs, received email, reply audits, schedules, and other durable records.

### 13.2 Anatomy

```text
Weekly lead report                         Active     [Run now] [•••]
Schedule / Marketing automation

Next run       Tomorrow, 09:00
Last run       Completed in 4m 18s
Results        248 contacts

Overview     Runs     Results     Configuration
───────────────────────────────────────────────────────────────
Current configuration
Workspace        market-system
Source           Google Maps
Location         Sydney
```

### 13.3 Requirements

- Present identity, authoritative status, and primary action first.
- Use tabs only for distinct information sets.
- Do not repeat the same status across multiple surfaces.
- Show metadata as compact definition rows rather than disabled form fields.
- Keep complete logs, diagnostics, and technical metadata in Activity or the inspector.
- Enter the shared form template for editing.
- Place destructive actions in overflow and require appropriate confirmation.
- Preserve the global shell and feature context when opening related resources.

## 14. Template D: Results and Activity

### 14.1 Applicable pages

Use for social-task runs and results, search results, email-extraction results, Yellow Pages results, email-send history, and other result datasets.

### 14.2 Anatomy

```text
Contact extraction results                    Completed
248 contacts · 4 warnings · 6m 12s

[Search results…] [All records ▾]        [Export ▾]

Name                 Email                 Source       Quality
──────────────────────────────────────────────────────────────
Acme Marketing       hello@acme.com        Website      High
Example Studio       contact@example.com   LinkedIn     Medium
```

Run receipt:

```text
✓ Extraction completed · 248 records · 4 warnings     View activity
```

### 14.3 Requirements

- Communicate the run outcome once in a compact run strip or receipt.
- Keep business results in the center and execution diagnostics in Activity.
- Link warning counts to filtered affected records.
- Place export in the result toolbar.
- Show `Retry failed` only when failed records exist and retry is safe.
- Allow progressive results without excessive row movement.
- Preserve selection, filters, and scroll while inspecting a result.
- Use bounded pagination or virtualization for large datasets.
- Let the inspector show source detail, validation state, and result history.

## 15. Template E: Settings and Catalog

### 15.1 Applicable pages

Use for general settings, MCP, AI providers, skills, hooks, plugins, AI memory, subagents, About, and catalog-like knowledge management.

### 15.2 Anatomy

```text
Settings

General  AI providers  Skills  MCP  Memory  Advanced
───────────────────────────────────────────────────────────────

AI behavior
Model provider
Choose the provider used for new conversations.
[ OpenAI-compatible                                ▾]

Custom instructions
Applied to every new AI conversation.
[                                                     ]
[                                                     ]

Diagnostics                                      [Open activity]
───────────────────────────────────────────────────────────────
                                            Changes saved
```

### 15.3 Requirements

- Use tabs for approximately five to seven major categories.
- Use a compact category rail or grouped category control when more categories are required.
- Do not add a third permanent sidebar beside the global sidebar and inspector.
- Give each setting a label, explanation, control, and state.
- Auto-save small independent settings and show a quiet saved receipt.
- Use explicit save only when multiple values must be committed together.
- Explain permission-sensitive effects before activation.
- Collapse diagnostics or move them into Activity.
- Render plugin, skill, subagent, provider, and knowledge catalogs with the collection template inside the settings/catalog shell.
- Open catalog item detail in an inspector or focused detail surface.
- Use the same shell and simple information hierarchy for About; do not create a unique visual system.

## 16. Template F: Task State and Decision

### 16.1 Purpose

Task state is a supporting template layered onto collections, forms, details, or results. It represents running, paused, queued, awaiting permission, awaiting user input, failed, interrupted, cancelled, or completed work.

### 16.2 Running example

```text
Search extraction

◌ Running · Processing page 18 of 40        [Stop]
───────────────────────────────────────────────────────────────
```

### 16.3 Decision example

```text
! Permission required
This task needs access to open an external browser.

                                  [Cancel] [Review permission]
```

### 16.4 Failure example

```text
× Search stopped
The browser could not load the target website.

Error details are available in Activity.

                                      [Dismiss] [Retry]
```

### 16.5 Requirements

- Give each workflow one authoritative status surface.
- Keep active status close to its content.
- Present permission and user-input requirements as decision surfaces.
- Explain failures in customer language and keep technical detail in Activity.
- Make retry primary only when retrying is available and safe.
- Convert completed work into a compact receipt.
- Keep sidebar status lightweight rather than duplicating page detail.
- Use text, icon, and accessible state in addition to color.

## 17. Insights and Landing Pattern

Insights and feature overview pages use a restrained landing pattern built from recent outcomes, required attention, and suggested next actions.

```text
Insights
Continue your work and review recent outcomes.

Recent activity
───────────────────────────────────────────────────────────────
Contact extraction completed        248 contacts       10m
Reply audit needs review             12 messages        1h
Schedule failed                       View issue         2h

Suggested actions
───────────────────────────────────────────────────────────────
Connect an email service
Create your first schedule
Review reply approvals
```

Requirements:

- Prioritize work continuation, outcomes, and attention.
- Avoid a grid of equally weighted statistic cards.
- Use the same row, status, spacing, and action patterns as operational pages.
- Do not present decorative metrics without a customer decision or next action.

## 18. Feature-to-Template Mapping

| Feature group | Primary template | Supporting templates |
| --- | --- | --- |
| Insights | Landing | Task state |
| Settings | Settings/catalog | Collection, detail |
| Campaign | Collection | Form |
| Social tasks | Collection | Form, task state, results |
| Search | Form | Collection, detail, results |
| Email extraction | Form | Collection, detail, results |
| Yellow Pages | Collection | Form, results |
| Map scraper | Form | Task state, results |
| Email marketing overview | Landing | Collection |
| Bulk email | Collection | Form, task state |
| Email templates | Collection | Form/detail |
| Email filters | Collection | Form/detail |
| Email services | Collection | Form/detail |
| Received email | Collection | Detail |
| Reply audit | Collection | Detail, decision |
| Proxy | Collection | Form |
| Knowledge | Settings/catalog | Detail |
| Social accounts | Collection | Form |
| Schedules | Collection | Form, detail, task state |

The mapping is a starting contract. A technical design may split a large page into additional components without creating a new visual pattern.

## 19. Action Placement

| Action type | Placement |
| --- | --- |
| Create primary record | Center header primary action |
| Search, filter, sort, view | Toolbar below header |
| Edit selected record | Inspector or detail page action |
| Row-specific operation | Row overflow or inspector |
| Bulk action | Contextual toolbar shown after selection |
| Save/create form | Sticky form action bar |
| Cancel form | Secondary action beside save/create |
| Destructive action | Overflow or danger zone with confirmation |
| Run, pause, resume, stop | Task-state surface owned by the run |
| Retry | Failure surface when safe and available |
| Export | Results toolbar |
| Diagnostics | Activity or inspector |
| Rare configuration | Page overflow or advanced section |

## 20. Shared State Requirements

### 20.1 Loading

- Keep the global shell interactive.
- Use skeleton rows or fields shaped like expected content.
- Use a spinner for a bounded operation, not as the only full-page representation.
- Preserve existing content during background refresh where safe.

### 20.2 First-use empty state

An empty state contains:

- A direct statement of what is absent.
- One short explanation of the feature’s value.
- One primary next action when the customer can resolve the empty state.

### 20.3 No search results

- Keep active search and filter controls visible.
- Explain that existing records may be hidden by filters.
- Offer `Clear filters`.
- Do not reuse the first-use empty state.

### 20.4 Error

- Explain what failed and what the customer can do next.
- Preserve entered data where possible.
- Put technical detail and identifiers in Activity.
- Avoid exposing raw stack traces in the center page.

### 20.5 Permission denied or unavailable

- Name the unavailable capability.
- Explain where it can be enabled when the customer has authority.
- Do not imply that retry will work without a permission change.

### 20.6 Saved and completed

- Use a quiet, temporary saved receipt for independent settings.
- Use a compact durable receipt for completed runs.
- Avoid large permanent green banners.

## 21. Responsive Requirements

### 21.1 Wide screens: 1280px and above

- Keep the global sidebar visible.
- Allow the contextual inspector to remain open.
- Show primary table columns.
- Keep long form content between approximately 640 and 760px where practical.

### 21.2 Medium screens: 900–1279px

- Allow the global sidebar to collapse.
- Open the inspector as a right overlay.
- Collapse secondary filters into a filter menu.
- Preserve the primary action and page identity.

### 21.3 Narrow screens: below 900px

- Show one primary surface at a time.
- Present the sidebar as a drawer.
- Present the inspector as a full-height sheet.
- Keep long-form actions sticky and reachable.
- Hide or reorganize low-priority table columns.
- Permit stacked result rows where a table cannot remain usable.
- Retain text labels for primary actions.
- Do not replace all actions with unexplained icons.

## 22. Accessibility Requirements

- All page templates support keyboard-only operation.
- Focus order follows visible hierarchy.
- Opening an inspector moves focus only when the customer explicitly requests it or a blocking decision requires it.
- Closing overlays restores focus to the originating control.
- Tables expose meaningful headers and selection state.
- Lists use appropriate list or tree semantics.
- Tabs follow standard ARIA tab behavior.
- Menus and overflow actions follow standard menu behavior.
- Form controls have programmatic labels, help, validation, and error association.
- Status never depends on color alone.
- Icon-only buttons have localized accessible names.
- Motion respects `prefers-reduced-motion`.
- Body text and interactive states meet WCAG AA contrast.
- Loading and completion announcements are restrained and do not repeat on every progress update.

## 23. Localization Requirements

All new or changed customer-facing strings, accessible names, empty states, errors, statuses, and action labels must be added to all supported languages:

- English.
- Chinese.
- Spanish.
- French.
- German.
- Japanese.

Templates receive stable machine state and map it to localized presentation. They must not persist localized status strings as domain state.

Layouts must tolerate longer translations without clipping primary actions or hiding validation.

## 24. Performance Requirements

- Route changes must not recreate the entire application shell.
- The sidebar and already-loaded navigation remain responsive during page loading.
- Large tables use bounded pages, incremental loading, or virtualization.
- Opening an inspector must not reload the entire collection.
- Page templates avoid mounting inactive full-detail components.
- Background refresh does not replace stable content with a blocking loader.
- Search input uses bounded request frequency appropriate to the backing API.
- Shared tokens and base styles are centralized rather than duplicated across page bundles.
- Migration must not introduce one Electron renderer per page, record, task, or inspector.

## 25. Functional Requirements

### 25.1 Shell and hierarchy

- **IPR-001**: All migrated authenticated pages must render inside the persistent application shell defined by the parent PRD.
- **IPR-002**: Route navigation must replace the center feature surface without duplicating global navigation.
- **IPR-003**: A migrated page must expose one center identity header and no generic application-level duplicate header.
- **IPR-004**: A migrated page must give at most one action primary visual emphasis at a time, excluding a blocking decision surface.
- **IPR-005**: Search, filtering, sorting, and view controls must appear in a contextual toolbar rather than the identity header.
- **IPR-006**: Infrequent page-level actions must be placed in an overflow menu or advanced section.
- **IPR-007**: A contextual inspector must be optional and scoped to the active page or selected record.
- **IPR-008**: The inspector must not duplicate the complete center page.

### 25.2 Visual system

- **IPR-009**: Migrated pages must consume centralized color, spacing, typography, radius, border, elevation, focus, and motion tokens.
- **IPR-010**: Migrated pages must prefer spacing and separators over unnecessary nested cards.
- **IPR-011**: Accent color must be reserved for selection, primary actions, and intentional emphasis.
- **IPR-012**: Semantic states must include text or accessible labels and cannot rely on color alone.
- **IPR-013**: Page-local styles must not duplicate the shared token palette.

### 25.3 Collections

- **IPR-014**: Collection pages must use a common search, filter, sort, selection, and empty-state pattern.
- **IPR-015**: Bulk actions must appear only when applicable records are selected.
- **IPR-016**: Row selection must preserve list context when opening an inspector or detail overlay.
- **IPR-017**: Large collections must use bounded rendering.
- **IPR-018**: Business data must remain in the collection while technical diagnostics move to Activity or the inspector.

### 25.4 Forms

- **IPR-019**: Create and edit pages must use objective page titles.
- **IPR-020**: Forms must group related fields into recognizable sections.
- **IPR-021**: Field validation must appear next to its owning field when possible.
- **IPR-022**: Long forms must keep their primary commit action reachable.
- **IPR-023**: Destructive operations must be separated from normal save/create actions.
- **IPR-024**: Unsaved meaningful changes must be preserved or guarded before navigation.
- **IPR-025**: Advanced settings must be collapsed when they are not required for the common path.

### 25.5 Details and results

- **IPR-026**: Detail pages must present identity, authoritative state, and primary action before secondary metadata.
- **IPR-027**: Stable metadata must use readable definition rows rather than disabled inputs.
- **IPR-028**: Result pages must separate business results from execution diagnostics.
- **IPR-029**: Result filters, selection, and scroll position must survive inspector interaction.
- **IPR-030**: Export must be placed in the result toolbar.
- **IPR-031**: Retry must appear only when retry is available and safe.

### 25.6 Settings and catalogs

- **IPR-032**: Settings must use a shared category-navigation pattern that does not create a third permanent sidebar.
- **IPR-033**: Every setting must provide a label, explanation, control, and state.
- **IPR-034**: Independent settings should auto-save with a quiet receipt.
- **IPR-035**: Multi-field atomic changes must use an explicit save action.
- **IPR-036**: Permission-sensitive settings must explain impact before activation.
- **IPR-037**: Plugin, skill, subagent, provider, and knowledge catalogs must reuse collection and detail patterns.

### 25.7 Task state

- **IPR-038**: Each workflow must have one authoritative active status surface.
- **IPR-039**: Permission and user-input requirements must appear as focused decision surfaces.
- **IPR-040**: Customer-facing failure copy must explain recovery while Activity owns technical detail.
- **IPR-041**: Completed work must collapse into a compact receipt.
- **IPR-042**: Sidebar state must remain lightweight and must not duplicate the full task-state surface.

### 25.8 Shared states, responsive behavior, and accessibility

- **IPR-043**: Templates must provide standardized loading, first-use empty, no-results, error, permission, saved, and completed states.
- **IPR-044**: The global shell must remain operable while a route is loading.
- **IPR-045**: The inspector must become an overlay or sheet when width cannot support three columns.
- **IPR-046**: Primary actions must retain accessible text labels at narrow widths.
- **IPR-047**: All migrated templates must support keyboard navigation and predictable focus restoration.
- **IPR-048**: All migrated text and accessible names must be localized in all six supported languages.
- **IPR-049**: Templates must tolerate long translations and text scaling.
- **IPR-050**: Motion must respect reduced-motion preferences.

### 25.9 Migration and compatibility

- **IPR-051**: Migration must preserve existing business behavior before legacy layout styles are removed.
- **IPR-052**: Existing APIs, IPC channels, and persistence behavior must not change solely to satisfy visual migration.
- **IPR-053**: One feature family may migrate independently without requiring all 50 surfaces to change in the same release.
- **IPR-054**: Hidden navigation metadata must not be used as evidence that a page is inaccessible to customers.
- **IPR-055**: The inactive Extra Modules route must remain outside migration scope unless separately reactivated.
- **IPR-056**: The Statistics page must not receive full redesign work until product retention is confirmed.

## 26. Migration Strategy

### 26.1 Per-page migration sequence

For every page:

1. Assign a primary and supporting template.
2. Inventory current actions, states, fields, columns, navigation, permissions, and error behavior.
3. Record behavioral parity tests before visual migration.
4. Preserve current API and domain behavior.
5. Replace the outer layout with the shared page shell.
6. Move search, filters, sorting, and view controls into the page toolbar.
7. Move rare actions into overflow.
8. Replace nested presentation cards with sections where cards do not represent independent objects.
9. Move selected-record detail, history, and diagnostics into the inspector where appropriate.
10. Replace local loading, empty, error, permission, and completion presentations with shared states.
11. Verify responsive, keyboard, focus, reduced-motion, and six-language behavior.
12. Compare the migrated page beside the new chat workspace.
13. Remove obsolete page-specific layout styles after parity is verified.

### 26.2 Migration phases

#### Phase 0: Inventory and baseline

- Confirm the 50-surface inventory.
- Resolve whether Statistics is retained or retired.
- Capture screenshots and behavior checks for representative page families.
- Identify repeated local components and styles.

Exit gate: every in-scope page has a template assignment and behavior inventory.

#### Phase 1: Foundations

- Centralize tokens.
- Implement the shared page shell, page identity, toolbar, overflow, section, state, and inspector contracts.
- Establish responsive breakpoints and focus behavior.

Exit gate: template foundations render beside the new chat UI without visual-system drift.

#### Phase 2: Highest-exposure platform pages

- Insights.
- Settings and customization.
- Knowledge.
- Plugins, skills, providers, and subagents.
- Social accounts.
- Scheduling.

Exit gate: the primary navigation no longer leads directly from the new shell into visibly incompatible page layouts.

#### Phase 3: Core automation workflows

- Campaign and social tasks.
- Search and email extraction.
- Yellow Pages and map scraper.

Exit gate: collection, form, detail, result, and task-state templates work across at least two domain families.

#### Phase 4: Email marketing and network utilities

- Bulk email, templates, filters, services, received email, and reply audit.
- Proxy management.

Exit gate: remaining customer-facing inner pages use the shared template system.

#### Phase 5: Cleanup and convergence

- Remove obsolete layout styles and duplicated local state components.
- Confirm Login and 404 token alignment.
- Archive Statistics if retirement is approved, or migrate it if retained.
- Run full visual, accessibility, localization, responsive, and performance review.

Exit gate: no in-scope route presents the previous page shell or an unapproved local design system.

## 27. Testing Requirements

### 27.1 Template component tests

- Header action limits and overflow placement.
- Toolbar search/filter behavior.
- Collection selection and inspector interaction.
- Sticky form actions and unsaved-change handling.
- Detail status ownership.
- Result filtering and scroll preservation.
- Settings auto-save and explicit-save receipts.
- Task-state decisions and terminal receipts.
- All shared loading, empty, error, permission, and completion states.

### 27.2 Accessibility tests

- Keyboard traversal and activation.
- Focus entry and restoration for menus, inspectors, dialogs, and sheets.
- Table/list/tab/menu semantics.
- Form labels, descriptions, validation, and errors.
- Status understanding without color.
- Reduced-motion behavior.
- Automated accessibility checks plus manual keyboard review.

### 27.3 Responsive tests

- Wide persistent inspector.
- Medium overlay inspector.
- Narrow sidebar drawer and full-height inspector sheet.
- Long localized labels.
- Table column priority and stacked-result fallback.
- Sticky form actions without covering fields or validation.

### 27.4 Regression tests

- Existing API calls and submissions remain unchanged unless separately specified.
- Create/edit/detail route modes retain behavior.
- Deep links continue to open the correct record.
- Customer permissions and AI navigation continue to work.
- Filters, selections, drafts, and scroll positions follow their specified lifetime.

### 27.5 Visual tests

Maintain representative visual baselines for:

- One collection page.
- One long form.
- One detail page.
- One large result page.
- One settings page.
- Each task-state decision.
- Wide, medium, and narrow layouts.
- Loading, empty, error, and completed states.

## 28. Success Metrics

- Percentage of in-scope pages using the shared shell and templates.
- Number of page-specific header, toolbar, empty-state, and status implementations removed.
- Task completion and error-recovery success on representative workflows.
- Inspector usage versus unnecessary detail-route navigation.
- UI-related accessibility defects per migrated feature.
- Missing translation defects.
- Route transition and large-list performance against baseline.
- Visual inconsistency findings during design review.
- Customer-reported navigation or action-location confusion.

Metrics must not contain customer content, secrets, result bodies, or form values.

## 29. Risks and Mitigations

| Risk | Customer impact | Mitigation |
| --- | --- | --- |
| One giant template becomes hard to maintain | Pages become coupled and inflexible | Use composable templates and slots with feature-owned logic |
| Visual migration changes feature behavior | Existing workflows regress | Record parity first and migrate outer presentation incrementally |
| `visible: false` pages are skipped | Customers reach visibly old pages | Classify access from real navigation and authorization, not menu metadata |
| Inspector becomes overloaded | Details become hard to find | Scope inspector to selected context with stable sections and lazy detail |
| Too many nested sidebars | Center content becomes cramped | Keep one global sidebar; use tabs or compact in-page category navigation |
| Every surface becomes a card | New UI feels heavy and fragmented | Prefer flat sections and separators; reserve cards for independent objects |
| Status is duplicated | Customers cannot identify the authoritative state | Assign one owning status surface per object or run |
| Migration takes too long | Application remains visually split | Ship by feature family after shared foundations |
| Shared tokens drift | Pages look similar but not coherent | Centralize tokens and prohibit local palette copies |
| Narrow tables become unusable | Customers lose access to results | Define column priority, overlays, and stacked-record fallback |
| Auto-save hides failure | Customers believe settings were saved | Show saving/saved/error state beside the setting and preserve input |
| Old styles are removed too early | Behavior and layout break | Remove page-specific styles only after parity tests pass |

## 30. Acceptance Criteria

1. The original chat workspace PRD links to this PRD, and this PRD links back to the parent product and technical contracts.
2. The in-scope inventory distinguishes route mappings from distinct page surfaces.
3. Exactly 50 customer-facing inner-page surfaces are included in the initial convergence scope.
4. Dashboard/chat, Login, 404, Statistics, and inactive Extra Modules receive the separate treatments defined in this PRD.
5. Migrated pages retain the persistent global shell.
6. Collection, form, detail, results, settings/catalog, and task-state templates are available as composable patterns.
7. Insights uses the landing pattern rather than an equal-weight metric-card grid.
8. Each migrated page has one primary action and predictable secondary-action placement.
9. Search and filters do not crowd the identity header.
10. Status appears on one authoritative owning surface.
11. Selected-record detail and diagnostics use the inspector where this preserves task context.
12. The center page remains usable without the inspector.
13. Shared loading, empty, no-results, error, permission, saved, and completed states are implemented.
14. Large collections and results use bounded rendering.
15. Forms keep primary actions reachable and protect meaningful unsaved changes.
16. Settings communicate saving, success, and failure beside the affected setting.
17. Wide, medium, and narrow responsive modes meet this PRD’s structural behavior.
18. Keyboard, focus, contrast, reduced-motion, and non-color status requirements pass.
19. All changed customer-facing text exists in all six supported languages.
20. Feature APIs, persistence, and business behavior remain compatible unless changed by a separate approved requirement.
21. No migrated page introduces a separate Electron renderer for a route, record, task, or inspector.
22. Page-specific visual styles are removed only after behavioral and visual parity is verified.
23. The Statistics page is either formally retained and migrated or retired without wasted redesign work.
24. No active customer-facing inner route remains on the unapproved legacy page shell at completion.

## 31. Definition of Done

This PRD is complete when:

- All 56 `IPR` functional requirements are implemented or explicitly deferred through an approved follow-up.
- The 50 in-scope page surfaces have an authoritative template assignment.
- The shared shell and visual tokens match the parent chat workspace contract.
- The six page templates and landing pattern are reusable across feature families.
- Representative pages pass component, regression, visual, responsive, accessibility, and localization testing.
- All in-scope routes preserve working business behavior.
- The old page shell and duplicated local presentation patterns are removed from migrated pages.
- Retained utility surfaces use shared tokens.
- Retired surfaces are removed from customer navigation and documented as retired.

## 32. Final Product Definition

The successful result is one AiFetchly application with multiple task-appropriate workspaces:

- The left side always answers where the customer is and what work exists.
- The center always presents the current task with one clear hierarchy.
- The right side reveals selected context, history, and technical detail without displacing the task.
- Lists, forms, details, results, settings, and task decisions behave consistently.
- Features remain specialized without looking like unrelated applications.
- New pages start from approved templates instead of inventing another local shell.

The inner-page migration is therefore a product-architecture convergence effort, not a cosmetic reskin of 50 independent screens.
