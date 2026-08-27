# Unified Plugin Page Discovery: Remaining Implementation Gaps

## Document information

- **Status:** Gaps found
- **Audit date:** 2026-08-28
- **Worktree:** `worktree-unified-plugin-page`
- **Source requirements:**
  - [Unified Plugin Page and Block-Style Discovery PRD](./unified-plugin-page-discovery-prd.md)
  - [Unified Plugin Page and Block-Style Discovery Technical Design](./unified-plugin-page-discovery-technical-design.md)

## Purpose

This document records requirements that are not implemented, are only partially implemented, or cannot yet be accepted because their required verification is missing or failing. It is the closure checklist for the unified Plugin page work.

The core Discover, Installed, Sources, and Issues experience is present. Local filtering, install and uninstall synchronization, route redirects, AI aliases, translations, component tests, and finite TypeScript checks are also present. The feature is not complete because the gaps below still violate the PRD Definition of Done or technical completion criteria.

## Status definitions

- **Not implemented:** Required behavior or infrastructure is absent.
- **Partial:** Some behavior exists, but it does not meet the complete requirement.
- **Verification gap:** The implementation appears present, but the mandated test or manual evidence is absent or failing.

## Product and implementation gaps

### UPD-GAP-01: Prevent duplicate Community Hub refresh requests

- **Status:** Not implemented
- **Priority:** High
- **Requirements:** PRD section 13.4; technical design section 14.3
- **Current evidence:** `CommunityPluginCatalog.reload()` starts a new request without checking `loading` or `refreshing`. The Refresh button uses `:loading="refreshing"` but is disabled only by `loading`.
- **Reason it remains open:** Vuetify's loading presentation does not prevent the button click handler from running. Repeated clicks can start overlapping forced refresh calls. The request counter prevents stale presentation updates, but it does not satisfy the requirement to prevent duplicate refresh requests.
- **Completion task:** Disable the Refresh button while either `loading` or `refreshing` is true, or add a manual-refresh in-flight guard. Keep WebSocket race protection intact.
- **Required test:** Trigger Refresh twice before the first promise resolves and assert that only one forced catalog request is made.

### UPD-GAP-02: Provide keyboard-accessible access to the complete card description

- **Status:** Partial
- **Priority:** High
- **Requirements:** `AC-UI-03`; PRD accessibility requirement 12; technical design sections 8.4 and 15.4
- **Current evidence:** The visible description is correctly clamped to three lines, but the full text is exposed only through a native `title` attribute on a non-focusable `<div>`.
- **Reason it remains open:** Keyboard users cannot focus the description to reveal a native title tooltip, and native title behavior is not a reliable accessible details path. The technical design requires the full description to be reachable by hover and keyboard focus.
- **Completion task:** Add a focusable, accessible tooltip or explicit details/expansion control that exposes the complete description without changing the regular grid order.
- **Required test:** Focus the description/details affordance and assert that the complete description is available to assistive technology.

### UPD-GAP-03: Make the Preview explanation keyboard-accessible

- **Status:** Partial
- **Priority:** Medium
- **Requirements:** PRD sections 9.6 and 16; technical design sections 8.3 and 15.4
- **Current evidence:** Ticket-based entries render a visible Coming soon status and a disabled Preview button with a native `title` attribute.
- **Reason it remains open:** Disabled buttons are not keyboard-focusable, so the explanation in the title attribute cannot reliably be reached without a pointer. The design calls for an accessible tooltip wrapper while keeping Coming soon visible outside hover.
- **Completion task:** Place the disabled Preview control inside a focusable tooltip activator or render visible explanatory text associated with the control.
- **Required test:** Navigate to the Preview explanation using only the keyboard and assert that the explanatory text is exposed.

### UPD-GAP-04: Meet the 44px touch-target requirement

- **Status:** Not implemented
- **Priority:** Medium
- **Requirements:** PRD accessibility requirement 5 and responsive section 17.3
- **Current evidence:** Tag chips use `small`, card tags use `x-small`, availability buttons use `small`, and card action buttons have no touch-layout minimum-size override. The component styles contain no mobile/touch rule that enforces a 44px interactive target.
- **Reason it remains open:** The compact Vuetify sizes are below the required 44px target on touch layouts. Responsive wrapping prevents page overflow but does not enlarge interactive hit areas.
- **Completion task:** Add touch/narrow-layout styles or component sizing that provides at least a 44px hit area for interactive chips and buttons without making informational status chips interactive.
- **Required verification:** Measure the rendered hit boxes at a narrow/touch viewport and add a component or E2E assertion for the minimum target size where practical.

## Test and acceptance gaps

### UPD-GAP-05: Implement the critical Plugin Hub E2E flow

- **Status:** Not implemented
- **Priority:** Blocker
- **Requirements:** `AC-QA-06`; PRD section 22.4; technical design section 18.6
- **Current evidence:** `test/e2e/specs/unifiedPluginDiscovery.test.ts` contains the required install-to-uninstall scenario only as `test.skip`.
- **Reason it remains open:** The E2E harness has no `FakePluginHub` loopback server or state-seeding support for the Community Plugin IPC channels. Without deterministic Hub fixtures, the test cannot exercise search, tag selection, install, Manage, Installed synchronization, uninstall, and return to Discover.
- **Completion task:** Add a deterministic Plugin Hub E2E fixture and state-seeding path, then implement and enable the full critical flow.
- **Acceptance sequence:**
  1. Open Plugins and confirm Discover.
  2. Search for a known fixture plugin.
  3. Select a fixture tag.
  4. Install the plugin.
  5. Confirm Installed status and Manage action.
  6. Open Manage and confirm the matching Installed detail.
  7. Uninstall the plugin.
  8. Return to Discover and confirm the correct non-installed action.

### UPD-GAP-06: Make the active unified Plugin E2E tests pass under authentication

- **Status:** Verification gap
- **Priority:** Blocker
- **Requirements:** `AC-QA-05`, `AC-QA-06`, and the PRD Definition of Done
- **Current evidence:** A focused run of `yarn build:e2e && yarn playwright test test/e2e/specs/unifiedPluginDiscovery.test.ts` produced three failures and one skipped test. The active tests reached `#/login?redirect=/plugins/management` instead of the authenticated Plugin page.
- **Reason it remains open:** The spec assumes an authenticated application shell but does not seed or establish an authenticated session. As a result, it cannot currently verify the navigation destination, legacy redirect result, or top-level tabs.
- **Completion task:** Use the repository's authenticated E2E fixture or seed the required local session before navigation. Keep the test isolated from real external services.
- **Completion condition:** All active tests in `unifiedPluginDiscovery.test.ts` pass, and the critical flow in UPD-GAP-05 is no longer skipped.

### UPD-GAP-07: Test browser back/forward tab restoration

- **Status:** Verification gap
- **Priority:** High
- **Requirements:** `AC-NAV-03`; PRD sections 8.4 and 22.3; technical design section 18.4
- **Current evidence:** Component tests verify initial query selection and a Manage-triggered push to `tab=installed`. They do not navigate through multiple tabs and then exercise router back and forward history.
- **Reason it remains open:** The route watcher appears to implement restoration, but the required behavior has no direct regression test. A future watcher or query synchronization change could break browser history while the current tests remain green.
- **Completion task:** Add a router-backed component or E2E test that selects multiple sections, calls back and forward, and asserts the active section after each history transition.

### UPD-GAP-08: Test Discover state retention across top-level section changes

- **Status:** Verification gap
- **Priority:** High
- **Requirements:** `AC-INSTALL-05`; technical design decisions TD-6 and TD-7; technical design section 18.4
- **Current evidence:** Catalog tests prove that filters survive catalog refresh. Plugin Manager tests do not set Discover search/tag/availability state, navigate to Installed, and return to Discover.
- **Reason it remains open:** The implementation relies on retained `v-window-item` content. That lifecycle behavior is important to filter preservation and WebSocket listener stability but is not exercised by the current shallow component stubs.
- **Completion task:** Mount with behaviorally accurate window/catalog components or cover the flow in E2E. Assert that search, selected tag, availability, and listener count are unchanged after Discover to Installed to Discover navigation.

### UPD-GAP-09: Test the real router records instead of copied fixtures

- **Status:** Verification gap
- **Priority:** Medium
- **Requirements:** `AC-NAV-04`, `AC-NAV-05`, `AC-QA-05`; technical design section 18.5
- **Current evidence:** `unifiedPluginNavigation.test.ts` reconstructs the canonical and legacy route definitions inside the test. It does not import the application's actual route records. The real-route E2E redirect test currently fails at the authentication boundary.
- **Reason it remains open:** A copied route fixture can remain green if the production router changes or loses the redirect metadata. It verifies the fixture rather than the authored route table.
- **Completion task:** Export or otherwise load the actual route records in the router test, or make the authenticated real-route E2E test authoritative.

### UPD-GAP-10: Record responsive and accessibility manual verification

- **Status:** Verification gap
- **Priority:** Medium
- **Requirements:** PRD rollout Phase 5, Definition of Done, and technical completion items 11-12
- **Current evidence:** The repository contains responsive CSS and component assertions, but no audit artifact records narrow, tablet, and desktop checks or keyboard/screen-reader verification for this feature.
- **Reason it remains open:** Static CSS and shallow component tests do not prove actual grid columns, overflow behavior, focus order, tooltip access, touch sizes, or contrast in the rendered Vuetify application.
- **Completion task:** Run and record manual or browser-automated checks at representative narrow, tablet, and desktop widths. Include keyboard-only navigation, focus visibility, result announcements, unavailable-card contrast, and 44px target measurements.

## Verification already passing

The following checks passed during the 2026-08-28 audit:

| Command | Result |
|---|---|
| `yarn test:components` | 45 test files passed; 285 tests passed |
| `yarn vue-typecheck` | Passed |
| `yarn typecheck` | Passed |
| Focused unified Plugin Playwright spec | Failed: 3 failed, 1 skipped |

## Closure order

1. Build the authenticated `FakePluginHub` E2E fixture and enable the critical flow.
2. Fix refresh duplicate-request handling and add its concurrency test.
3. Replace inaccessible native-title behavior for descriptions and Preview explanations.
4. Enforce and verify 44px touch targets.
5. Add real-router history, state-retention, and redirect coverage.
6. Complete responsive and accessibility verification.
7. Re-run `yarn test:components`, `yarn vue-typecheck`, `yarn typecheck`, and `yarn test:e2e`.

The feature can move to **complete** only after every blocker is closed and all required verification commands pass without skipped critical-flow coverage.
