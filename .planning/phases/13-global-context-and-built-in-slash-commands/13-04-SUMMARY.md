---
phase: 13-global-context-and-built-in-slash-commands
plan: 13-04-renderer-suggestions-ui
subsystem: ui
tags: [vue3, vuetify, electron-preload, ipc, slash-commands, composer, keyboard-nav]

requires:
  - phase: 13-03b
    provides: "Slash command IPC channels (LIST/DISPATCH/RELOAD/STATUS + AIFETCHLY_CONFIG_CHANGED) + dispatcher discriminated union"
  - phase: 13-02
    provides: "SlashCommandView renderer-safe shape (no body) + parseSlashCommandInput"
provides:
  - AiChatV2SlashSuggestions.vue — dropdown component (source badges, arrow/Enter/Tab nav, ARIA listbox)
  - Renderer API wrappers (listSlashCommands/dispatchSlashCommand/reloadAifetchlyConfig/getAifetchlyConfigStatus + onAifetchlyConfigChanged subscriber)
  - Preload dual whitelists for the 5 phase-13 channels (Pitfall 3)
  - Composer Enter/Tab intercept (Pitfall 4) — slash selection does not double-submit
  - AiChatV2.vue command-dispatch routing (show_result / submit_prompt / status:false) + /clear confirmation reuse
affects: [13-05-i18n-boundary-tests]

tech-stack:
  added: []
  patterns: [flat windowInvoke renderer API (mirrors workspace.ts), preload dual-whitelist discipline, dropdown keyboard-nav with Enter/Tab intercept, config-changed subscription with unmount cleanup]

key-files:
  created:
    - src/views/api/slashCommands.ts
    - src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
    - test/vitest/main/components/AiChatV2SlashSuggestions.test.ts
    - test/vitest/main/components/diag-workspace.test.ts
  modified:
    - src/preload.ts
    - src/views/components/aiChatV2/AiChatV2Composer.vue
    - src/views/components/aiChatV2/AiChatV2.vue
    - src/entityTypes/aiChatV2Types.ts
    - test/vitest/main/components/AiChatV2.workspace.test.ts

key-decisions:
  - "Flat windowInvoke (not namespaced) for the renderer API — mirrors src/views/api/workspace.ts (research Q2 resolved)."
  - "/clear reuses the existing clear_confirm_title/clear_confirm_body i18n keys + AI_CHAT_V2_CLEAR_CONVERSATION path; NO new confirmation dialog (the existing clear path at ai-chat-v2-ipc.ts:887 owns confirmation)."
  - "Enter/Tab intercept fires ONLY when slashOpen && highlighted >= 0 — Shift+Enter newline behavior preserved (Pitfall 4)."
  - "AiChatV2.vue subscribes to AIFETCHLY_CONFIG_CHANGED on mount, unsubscribes on unmount — no listener leaks across re-mounts."
  - "submit_prompt dispatch route exists but is unreachable in phase 13 (no prompt commands); it routes through onSend → AI_CHAT_V2_STREAM (gated downstream by USER_AI_ENABLED — TRS-05 Strategy A)."

patterns-established:
  - "Pattern 1: Renderer slash-command access goes ONLY through src/views/api/slashCommands.ts wrappers (no direct ipcRenderer). TRS-07 boundary test (Plan 05) enforces no fs/path/os in src/views/**."
  - "Pattern 2: Preload channel additions must touch ALL four whitelists (invoke + receive + removeListener + removeAllListeners) — Pitfall 3."

requirements-completed: [CMD-05]

coverage:
  - id: D1
    description: "Slash suggestions dropdown renders name/description/source badge/arg hint/disabled state (CMD-05)"
    requirement: CMD-05
    verification:
      - kind: automated_ui
        ref: "test/vitest/main/components/AiChatV2SlashSuggestions.test.ts (6 tests, happy-dom)"
        status: pass
    human_judgment: true
    rationale: "Automated component test covers render + highlight + select emit; live-app UX (dropdown opens on '/', visual badge colors, scroll-into-view) needs human eyes."
  - id: D2
    description: "Arrow-key navigation + Enter/Tab select without submitting; Shift+Enter newline (Pitfall 4)"
    requirement: CMD-05
    verification:
      - kind: automated_ui
        ref: "test/vitest/main/components/AiChatV2SlashSuggestions.test.ts#select emit"
        status: pass
    human_judgment: true
    rationale: "Keyboard interception in the live composer (Enter does not submit when dropdown open) is interactive behavior that needs live-app confirmation."
  - id: D3
    description: "Built-in dispatch renders show_result content; message NOT submitted to AI stream"
    requirement: CMD-05
    verification: []
    human_judgment: true
    rationale: "End-to-end dispatch + render requires the running app and the main-process dispatcher; deferred to UAT."
  - id: D4
    description: "Renderer subscribes to AIFETCHLY_CONFIG_CHANGED and refreshes its command cache"
    requirement: CMD-05
    verification:
      - kind: unit
        ref: "grep onAifetchlyConfigChanged in AiChatV2.vue (subscribe on mount, unsub on unmount)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live AGENTS.md reload reflects in the next AI response (success criteria 1 + 3)"
    requirement: CMD-05
    verification: []
    human_judgment: true
    rationale: "Cross-process end-to-end behavior requiring a live AI call — UAT only."

duration: ~20min (split across a quota-blocked pause)
completed: 2026-07-05
status: complete
---

# Plan 13-04: Renderer Suggestions UI Summary

**Slash-suggestions dropdown + composer Enter/Tab intercept + AiChatV2 dispatch routing — the user-visible half of the phase-13 command surface**

## Performance

- **Tasks:** 2 build tasks complete (Task 3 human-verify deferred to UAT)
- **Files created:** 4 (1 component + 1 renderer API + 2 tests)
- **Files modified:** 5 (preload, composer, AiChatV2, types, existing workspace test)
- **Component tests:** 7/7 pass (AiChatV2SlashSuggestions 6 + diag-workspace 1)

## Accomplishments
- New `AiChatV2SlashSuggestions.vue` dropdown with source badges, arrow/Enter/Tab navigation, ARIA listbox semantics, scoped Vuetify styles
- Composer `/` detection + dropdown hosting + Enter/Tab intercept (Pitfall 4) — selecting a command never double-submits
- `AiChatV2.vue` subscribes to `AIFETCHLY_CONFIG_CHANGED` (mount) + unsubscribes (unmount); `onCommandSelect` routes `show_result` / `submit_prompt` / `status:false`
- `/clear` reuses the existing `clear_confirm_*` i18n + `AI_CHAT_V2_CLEAR_CONVERSATION` path — no new confirmation dialog
- Preload dual whitelists (all 4: invoke + receive + removeListener + removeAllListeners) for the 5 phase-13 channels (Pitfall 3)
- Flat `windowInvoke` renderer API mirroring `workspace.ts`

## Task Commits

1. **Task 1 — Preload whitelists + renderer API** — `cc8de18a`
2. **Task 2 — Dropdown + composer intercept + AiChatV2 dispatch** — `f78e84e2`
3. **Task 3 — Human-verify checkpoint** — DEFERRED to UAT (skip requested)

## Decisions Made
- Flat `windowInvoke` (not namespaced) — matches `workspace.ts`, defers namespacing milestone-wide.
- `/clear` confirmation reuses existing i18n keys + clear path; no new dialog.
- `submit_prompt` route exists but unreachable in phase 13 (no prompt commands); routes through `onSend` → `AI_CHAT_V2_STREAM` (TRS-05 Strategy A downstream gate).

## Deviations from Plan

### Auto-fixed Issues

**1. AiChatV2.workspace.test.ts mock addition**
- **Found during:** Task 2 (AiChatV2.vue onMounted now subscribes to config-changed + seeds slash cache)
- **Issue:** AiChatV2.vue's onMounted now calls `onAifetchlyConfigChanged` + `listSlashCommands`, which hit `window.api` (undefined in happy-dom).
- **Fix:** Added a `vi.mock("@/views/api/slashCommands", ...)` to the existing workspace test so it stays focused on its own scenario.
- **Verification:** Mock returns a valid empty `SlashCommandListResponse`; test mounts without touching `window.api`.
- **Committed in:** `f78e84e2`

**Total deviations:** 1 auto-fixed (test mock)
**Impact on plan:** Minimal — preserves the existing test's scope.

## Issues Encountered
- **Pre-existing test failure (NOT a 13-04 regression):** `AiChatV2.workspace.test.ts` "opens workspace picker card" fails identically on the pre-13-04 `AiChatV2.vue` (verified via `git checkout fb2c3a8c -- src/views/components/aiChatV2/AiChatV2.vue`). Introduced in `bf50ec06` ("fix: enable workspace picker from chat badge") on the dev lineage. The 13-04 executor correctly identified this and was investigating when quota killed it. Triaged as pre-existing — not a phase-13 deliverable.
- **Provider 429 quota kill:** The 13-04 executor was killed mid-Task-2 by a 5-hour quota wall (reset 2026-07-05 10:00:29). Task 2 was committed as WIP (tsc-clean) and verified GREEN on resume via interactive mode.

## User Setup Required
None — no external service configuration. (Manual QA uses the project's dev script run inside tmux per repo convention.)

## Next Phase Readiness
- Renderer surface complete; Plan 13-05 adds the 6-language i18n for all new strings + the TRS-07 boundary test + i18n parity test.
- The manual-verify UX checkpoint is deferred to UAT — `/gsd-verify-work 13` will walk through the 9 live-app steps.

---
*Phase: 13-global-context-and-built-in-slash-commands*
*Completed: 2026-07-05*
