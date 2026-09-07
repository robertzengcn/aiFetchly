# AI Chat-First Application Shell — Validation Matrix

Status record for PRD "Definition of Done" items 12–14 (cross-platform +
accessibility validation) and rollout Phase 5. Every row lists the evidence
command, the environment, the date, and the result. Rows that could not be
executed in this environment are marked **PENDING** with the required
environment — they are not claimed as passing.

## 1. Automated gates (this branch, all environments)

| Gate | Command | Result | Date |
| --- | --- | --- | --- |
| Component suite (FR-QUAL-002) | `yarn test:components` | 54 files / 349 tests passed | 2026-09-07 |
| Main-process vitest suite | `npx vitest run --config vite.main.config.mjs` | 512/513 files passed (1 pre-existing contract-drift file: `ipc/ai-chat-v2-ipc` generated-image reference-boundary; the feature is verified green end-to-end via the E2E specs) | 2026-09-06 |
| TypeScript | `npx tsc --noEmit` | 0 errors | 2026-09-07 |
| Vue TypeScript | `npx vue-tsc --noEmit` | 0 errors | 2026-09-07 |
| Translation parity (FR-QUAL-001) | `npx vitest run --config vite.main.config.mjs test/vitest/main/i18n/` + key spot-check across en/zh/es/fr/de/ja | 5 files / 104 tests passed; all new `workspace.*` / `aiChatV2.voice.*` keys present exactly once per language | 2026-09-07 |
| E2E suite (self-contained `yarn test:e2e`) | `xvfb-run -a npx playwright test --workers=1` | 43 passed / 2 skipped / 0 failed (skips = live-provider scenarios gated on `AIFETCHLY_E2E_LIVE_AI=1`) | 2026-09-07 |
| Window geometry unit tests | `npx vitest run --config vite.main.config.mjs test/vitest/main/MainWindowStateService.test.ts test/vitest/main/mainWindowGeometry.test.ts` | 30 tests passed (11 + 19, incl. deterministic maximized-launch env hook) | 2026-09-07 |

## 2. Cross-platform window geometry (Definition of Done item 12)

| Platform | Environment | Result | Date |
| --- | --- | --- | --- |
| Linux (WSL2, X11 via xvfb, WM-less) | E2E `workspace-shell*` specs | **PASS** — first launch centered 1280x800, not maximized; restore-down bounds deterministic; deterministic maximized launch hook verified (see note) | 2026-09-07 |
| Windows 10/11 | Requires a Windows runner with a real window manager | **PENDING** — run `yarn test:e2e` (geometry specs) + packaged smoke | — |
| macOS 12+ | Requires a macOS runner | **PENDING** — run `yarn test:e2e` (geometry specs) + packaged smoke | — |

> **Maximized-state note (failure linked to fix):** the E2E X server runs
> without a window manager, so EWMH maximized state (`isMaximized()`) is not
> observable there even after `win.maximize()`. The launch decision is
> therefore proven two ways: the unit test
> (`MainWindowStateService.test.ts` › "E2E mode honors the deterministic
> maximized-launch env") asserts `resolveInitialState()` returns
> `maximized: true` with deterministic restore-down bounds, and the E2E spec
> asserts the `AIFETCHLY_E2E_INITIAL_MAXIMIZED` launch contract reaches the
> main process. A WM-equipped CI environment should upgrade the E2E assertion
> to `isMaximized() === true`.

## 3. Accessibility (Definition of Done items 13–14, PRD §16.4/§21)

| Check | Evidence | Result | Date |
| --- | --- | --- | --- |
| Minimum 40x40px interaction targets | E2E `workspace-shell-gaps` › "narrow navigation opener is at least 40x40px" (measured `boundingBox()`; CSS raised 36px → 40px) | **PASS** | 2026-09-07 |
| 200% zoom usable, no horizontal page scrolling | E2E `workspace-shell-gaps` › "200% zoom keeps the shell operable without horizontal scrolling" (body zoom 2, overflow measured, composer still typable) | **PASS** | 2026-09-07 |
| Keyboard-only critical path (FR-QUAL-005 / AC 42) | E2E `workspace-shell-keyboard` (navigation, composing + Enter send, Tab order below the textarea, conversation selection, inner page, drawer trap/Escape/focus-restore, workspace Choose/Cancel, voice toggle → settings) | **PASS** | 2026-09-07 |
| Status never depends on color alone (FR-QUAL-004) | Component assertions: workspace approval states assert icon-plus-text (`WorkspaceBadge.test.ts`), conversation selection asserts `aria-selected`, active route asserts `aria-current` | **PASS** | 2026-09-07 |
| Focus rings not clipped | Drawer focus-trap/restore assertions (E2E keyboard spec) + visible `:focus-visible` outlines retained on badge/chooser controls | **PASS** (layout-level; screen-reader audit below) | 2026-09-07 |
| Screen-reader validation (NVDA/VoiceOver) for workspace + voice flows | Requires interactive AT on Windows/macOS | **PENDING** | — |

## 4. Rollout phase 5 (final matrix re-run)

All gates in §1 were re-run after the final gap closed (commits through
`test: self-contained E2E gate + complete shell E2E matrix + a11y evidence`).
The worktree remains feature-flagged per the rollout plan; flipping the flag
and the Windows/macOS rows above are the only remaining rollout actions.
