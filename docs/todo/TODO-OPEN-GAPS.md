# AI Chat-First Application Shell — Open Gaps

> **Status 2026-09-04: all gaps closed.** Details per item below.

## Resolved Tasks

### 1. `AuthenticatedWorkspaceLayout.test.ts` Component Test — RESOLVED

- **Delivered**: `test/vitest/main/components/AuthenticatedWorkspaceLayout.test.ts` (7 tests, all passing) covering shell composition, sidebar DOM identity across route changes, exactly-once summary bootstrap, the selection coordinator (routing-first, no duplicate handshake on reselect, new-chat from an inner page), ownership boundaries (no history loads / run starts / detail subscriptions from the layout), and the narrow drawer focus contract (open → first element focused, Tab wrap trap, Escape close, focus restored to the opener).
- **Enabling work**: `AppWorkspaceShell.vue` gained the missing narrow-drawer focus management (design §13) — focus capture on open, Tab wrap trap (including re-capturing focus that escaped the region), Escape close, and restore to the opening control.

### 2. Automated Keyboard-Only Navigation Test — RESOLVED

- **Delivered**: `test/e2e/specs/workspace-shell-keyboard.test.ts` — a single keyboard-driven critical path (Tab / Shift+Tab / Enter / Escape / typing only; `.focus()` merely seeds the start element): keyboard new-chat, typing + Enter send (optimistic user turn asserted in the transcript), the full composer tab chain (mic → mode/model/tool-approval selector activators → context indicator → spoken-response toggle → send, in design §10.1 order), keyboard expansion of the collapsed "Other chats" folder and keyboard conversation selection (`aria-selected` flip on a previously unselected row), keyboard navigation to Insights and back, and the narrow drawer keyboard cycle (open → trapped Tab → Escape close → focus restored to the opener).
- **Hardening added while stabilizing the combined runs** (intermittent "still on the inner page after New chat" flake):
  - `AuthenticatedWorkspaceLayout.vue` now routes to the chat center unconditionally (`ensureChatRoute`). Reading `route.name` before pushing was racy during a pending lazy navigation — the reactive route still names the previous route, so a rapid Plugins → New chat click skipped the push and stranded the user on the departing page (FR-SHELL-010). vue-router resolves same-location pushes as a harmless duplicated-navigation failure.
  - `test/e2e/support/devServerWarmup.ts` (+ `test.beforeAll` in both shell specs) requests the lazy inner-page modules before any Electron renderer connects, so vite's on-demand dep-optimization full-page reload ("optimized dependencies changed. reloading") cannot land mid-test and swallow a click. Two consecutive combined runs: 9 passed / 1 skipped / 0 failed.

### 3. E2E Spec Path Naming Discrepancy — RESOLVED (by design)

- The technical design §23.3 itself directs: "Use the repository's actual existing filenames when they differ; extend existing coverage instead of creating duplicate suites." The E2E suite's actual convention is `test/e2e/specs/*.test.ts` consumed through the shared `e2eTest` fixture harness (isolated temp roots, sanitized env, readiness gating). `test/e2e/specs/workspace-shell.test.ts` follows that convention; creating a root-level `.spec.ts` outside the harness would reduce isolation guarantees. No further action.
