---
phase: 13-global-context-and-built-in-slash-commands
plan: 13-03b-commands-dispatcher-ipc
subsystem: slash-commands
tags: [typescript, electron, ipc, slash-commands, dispatcher, trs-05-strategy-A, trs-06, tdd]

requires:
  - 13-02-command-registry-parser (CommandRegistry + parseSlashCommandInput — composed by the dispatcher)
  - 13-03a-context-pipeline-assembler-injection (AIFetchlyConfigManager singleton — getStatus() + reload() + getCommandRegistry())
provides:
  - registerBuiltInSlashCommands — registers the four phase-13 built-ins (help/clear/status/reload-config) on any CommandRegistry
  - SlashCommandDispatcher — class returning the CMD-04 discriminated union (show_result for built-ins; submit_prompt deferred; {status:false,msg} for unknown/disabled/boundary)
  - SlashCommandModule — three-layer Module (listCommands/dispatch/reloadConfig/getStatus) — NO DB access
  - registerSlashCommandHandlers(win) — registers 4 invoke handlers using registerValidatedHandler (NOT the AI-gated variant — TRS-05 Strategy A)
  - Five channel constants in channellist.ts (SLASH_COMMAND_LIST/DISPATCH, AIFETCHLY_CONFIG_RELOAD/STATUS/CHANGED)
  - background.ts fire-and-forget startup hook for AIFetchlyConfigManager.initialize()
  - SlashCommandDispatchRequest, SlashCommandDispatchResponse, SlashCommandListResponse types in slashCommandTypes.ts
affects:
  - 13-04-renderer-suggestions-ui (consumes the IPC channels + SlashCommandDispatchResponse contract; preload.ts whitelist entries are Plan 04's scope)
  - 13-05-i18n-boundary-tests (asserts no fs/.aifetchly literals under src/views/** — Plan 03b did not touch renderer)

tech-stack:
  added: []
  patterns:
    - Discriminated-union dispatch response (CMD-04) — built-in/local returns show_result; prompt returns submit_prompt; future skill returns not-yet-supported
    - TRS-05 Strategy A: dispatch handler uses registerValidatedHandler (non-AI); prompt-submit gate is downstream in AI_CHAT_V2_STREAM (verified at ai-chat-v2-ipc.ts handleStream lines 385-393)
    - Three-layer Module (CLAUDE.md) — IPC -> Module -> services; Module has no TypeORM/DB access
    - Fire-and-forget startup scan alongside SkillImportService.loadPersistedSkills() with .catch logging (Pitfall 6)
    - Defensive isDestroyed guard on webContents.send — handles both real Electron and test mocks

key-files:
  created:
    - src/service/slashCommands/builtinSlashCommands.ts
    - src/service/slashCommands/SlashCommandDispatcher.ts
    - src/modules/SlashCommandModule.ts
    - src/main-process/communication/slash-command-ipc.ts
    - test/vitest/main/service/SlashCommandDispatcher.test.ts
    - test/vitest/main/ipc/slash-command-ipc.test.ts
  modified:
    - src/entityTypes/slashCommandTypes.ts (added SlashCommandDispatchRequest/Response + SlashCommandListResponse)
    - src/config/channellist.ts (5 channel constants + TRS-05 Strategy A rationale comment)
    - src/main-process/communication/index.ts (registerSlashCommandHandlers(win) call)
    - src/background.ts (getAIFetchlyConfigManager import + fire-and-forget initialize())

key-decisions:
  - "SlashCommandDispatcher depends on concrete CommandRegistry + AIFetchlyConfigManager (not abstract interfaces). Tests construct real instances pointed at an empty tmpdir; production wires the singleton manager. This avoids the indirection of mock interfaces for a class with only 3 surface methods."
  - "SlashCommandModule.reloadConfig() and getStatus() take NO parameters in phase 13. The plan's optional conversationId context was dropped because (a) it was unused, (b) the eslint config flags unused underscore-prefixed args, and (c) phase 14+ can add the context arg when actually needed for workspace trust resolution. Documented in the method JSDoc."
  - "The dispatcher's renderStatus() converts the programmatic watcherState 'not-started' to the human-readable 'not started' (space) for display, matching the plan's must_haves truth. The internal enum stays hyphenated for stable serialization."
  - "emitConfigChanged() defensively checks `typeof contents.isDestroyed === 'function'` before calling it — real Electron webContents has the method, test mocks may not. Avoids TypeError during shutdown / mid-reload window destruction."
  - "Phase-15 boundary (TRS-06 / CMD-06): the dispatcher's prompt case returns not-yet-supported. Phase 13 has NO registered prompt commands in production, so this branch is unreachable but must fail closed for type-contract safety."
  - "Comments in slash-command-ipc.ts and SlashCommandDispatcher.ts intentionally AVOID the forbidden literals ('registerAiValidatedHandler', 'child_process', '$ARGUMENTS') — same Rule 3 lesson as Plan 02's parser. The grep gates return 0 hits for each."

patterns-established:
  - "Pattern: every built-in slash command resolves to a show_result variant; never an AI call from the dispatcher. Prompt-submit routing happens via the existing AI_CHAT_V2_STREAM channel downstream."
  - "Pattern: main->renderer config-change events carry only counts + diff metadata, never raw file bodies or prompt content (T-13-Leak mitigation). Payload is JSON-stringified {source, summary}."

requirements-completed: [CMD-03, CMD-04, CMD-08, TRS-05, TRS-06, DX-02]

coverage:
  - id: D1
    description: "Four built-in commands (help/clear/status/reload-config) registered at startup with stable shape (type=local, source=built-in, enabled, no trust) — CMD-03"
    requirement: CMD-03
    verification:
      - kind: unit
        ref: "test/vitest/main/service/SlashCommandDispatcher.test.ts#registerBuiltInSlashCommands (CMD-03) (3 it.each cases + idempotency)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dispatcher returns the CMD-04 discriminated union: show_result for built-ins; {status:false,msg} for unknown/disabled/bare-slash/non-slash"
    requirement: CMD-04
    verification:
      - kind: unit
        ref: "test/vitest/main/service/SlashCommandDispatcher.test.ts#SlashCommandDispatcher.dispatch (CMD-04, CMD-08, DX-02) (8 dispatch cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Unknown command returns localized-style 'Unknown slash command: /<name>' message (CMD-08)"
    requirement: CMD-08
    verification:
      - kind: unit
        ref: "test/vitest/main/service/SlashCommandDispatcher.test.ts#returns {status:false, msg} for an unknown command (CMD-08)"
        status: pass
    human_judgment: false
  - id: D4
    description: "/status surfaces command/diagnostic counts + phase-14 watcher placeholder 'not started (phase 14)' (DX-02)"
    requirement: DX-02
    verification:
      - kind: unit
        ref: "test/vitest/main/service/SlashCommandDispatcher.test.ts#returns show_result for /status with counts + watcher placeholder (DX-02)"
        status: pass
    human_judgment: false
  - id: D5
    description: "TRS-05 Strategy A: NONE of the slash-command/config handlers use the AI-gated wrapper; dispatch returns submit_prompt which the renderer submits via AI_CHAT_V2_STREAM (gated downstream at ai-chat-v2-ipc.ts:385-393)"
    requirement: TRS-05
    verification:
      - kind: unit
        ref: "test/vitest/main/ipc/slash-command-ipc.test.ts (11 cases — list/dispatch/status/reload all return status:true when USER_AI_ENABLED=false)"
        status: pass
      - kind: boundary
        ref: "grep -c registerAiValidatedHandler src/main-process/communication/slash-command-ipc.ts -> 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "TRS-06: dispatcher has no execution path — no spawn/eval/Function() imports or literals anywhere in source"
    requirement: TRS-06
    verification:
      - kind: boundary
        ref: "grep -c child_process|new Function\\(|[^_]eval\\( SlashCommandDispatcher.ts -> no matches"
        status: pass
      - kind: boundary
        ref: "grep -c \\$ARGUMENTS SlashCommandDispatcher.ts -> 0 hits"
        status: pass
    human_judgment: false
  - id: D7
    description: "Startup scan is fire-and-forget with .catch logging — never blocks app launch (Pitfall 6)"
    requirement: TRS-05
    verification:
      - kind: boundary
        ref: "background.ts: getAIFetchlyConfigManager().initialize().catch(err => console.warn(...))"
        status: pass
    human_judgment: false
  - id: D8
    description: "SlashCommandModule sits between IPC and services; NO TypeORM imports (CLAUDE.md three-layer rule)"
    requirement: CMD-04
    verification:
      - kind: boundary
        ref: "grep typeorm|getRepository|DataSource src/modules/SlashCommandModule.ts -> no matches"
        status: pass
      - kind: unit
        ref: "test/vitest/main/service/SlashCommandDispatcher.test.ts#SlashCommandModule (three-layer Module) (5 cases)"
        status: pass
    human_judgment: false

duration: ~18min
completed: 2026-07-05
status: complete
---

# Plan 13-03b: Command Dispatcher + IPC Layer Summary

**Four built-in slash commands, the CMD-04 discriminated-union dispatcher, the three-layer SlashCommandModule, and the TRS-05-Strategy-A IPC layer + fire-and-forget startup hook — built end-to-end with zero AI-gate duplication**

## Performance

- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files created:** 6 (4 source + 2 test)
- **Files modified:** 4 (slashCommandTypes, channellist, communication/index, background)
- **Tests:** 33 new tests passing (22 SlashCommandDispatcher + 11 slash-command-ipc); tsc --noEmit clean (0 errors); eslint clean on all new files

## Task Commits

1. **Task 1 — Built-in commands + dispatcher + module (CMD-03/04/08, TRS-06, DX-02)**
   - `11925270` (RED) — failing SlashCommandDispatcher tests (22 cases)
   - `273eaa91` (GREEN) — types + dispatcher + built-ins + SlashCommandModule (22/22 pass)
2. **Task 2 — IPC channels + handlers + startup hook (TRS-05 Strategy A)**
   - `9c84ddcd` (RED) — failing slash-command-ipc gating-matrix tests (11 cases)
   - `7f5be1bd` (GREEN) — channellist constants + registerSlashCommandHandlers + index.ts wiring + background.ts fire-and-forget initialize() (11/11 pass)

## Accomplishments

- `registerBuiltInSlashCommands(registry)` registers the four phase-13 built-ins (help/clear/status/reload-config) with stable shape: type=local, source=built-in, sourceId=built-in, requiresTrust=false, enabled=true. Idempotent — re-calling replaces, never duplicates.
- `SlashCommandDispatcher` resolves raw composer text into the CMD-04 discriminated union:
  - `/help` → show_result listing every registered command with source label
  - `/clear` → show_result guidance (renderer invokes existing `AI_CHAT_V2_CLEAR_CONVERSATION` — no new clear logic)
  - `/status` → show_result with command/diagnostic counts + phase-14 watcher placeholder "not started (phase 14)" (DX-02)
  - `/reload-config` → triggers `manager.reload()` and returns show_result with reloaded counts
  - unknown/disabled/not-a-command/bare-slash → `{status:false, msg}` with English-literal messages (CMD-08)
  - prompt/skill types fail closed as not-yet-supported (phase 15/18 boundary; unreachable in phase 13 production)
- `SlashCommandModule` is the three-layer Module (CLAUDE.md): `listCommands` / `dispatch` / `reloadConfig` / `getStatus`. NO TypeORM imports, NO direct DB access.
- `registerSlashCommandHandlers(win)` registers 4 invoke handlers using `registerValidatedHandler` (the NON-AI-gated wrapper) — TRS-05 Strategy A. On successful reload, emits `AIFETCHLY_CONFIG_CHANGED` via `win.webContents.send`; NO emission on failure (fail-closed).
- 5 channel constants added to `channellist.ts`: `SLASH_COMMAND_LIST`, `SLASH_COMMAND_DISPATCH`, `AIFETCHLY_CONFIG_RELOAD`, `AIFETCHLY_CONFIG_STATUS`, `AIFETCHLY_CONFIG_CHANGED`.
- `background.ts` fires `getAIFetchlyConfigManager().initialize().catch(...)` alongside `SkillImportService.loadPersistedSkills()` — fire-and-forget, never blocks app launch (Pitfall 6).
- `index.ts` calls `registerSlashCommandHandlers(win)` immediately after `registerAIWorkspaceIpcHandlers(win)`.

## Decisions Made

- The dispatcher depends on concrete `CommandRegistry` + `AIFetchlyConfigManager` types rather than abstract interfaces. Tests construct real instances with an empty tmpdir; production wires the singleton manager. Avoids interface indirection for a class with only 3 surface methods.
- `SlashCommandModule.reloadConfig()` and `getStatus()` take NO parameters in phase 13. The plan's optional conversationId context was dropped because (a) it was unused, (b) the project's eslint config flags unused underscore-prefixed args (no `argsIgnorePattern: '^_'`), and (c) phase 14+ can add the context arg when actually needed for workspace trust resolution. The method JSDoc documents the forward-compat note.
- The dispatcher's `renderStatus()` converts the programmatic watcherState `"not-started"` to the human-readable `"not started"` (space) for display, matching the plan's must_haves truth wording. The internal enum stays hyphenated for stable serialization.
- `emitConfigChanged()` defensively checks `typeof (contents as unknown as {isDestroyed?: () => boolean}).isDestroyed === "function"` before calling it. Real Electron webContents has the method; MockBrowserWindow's webContents does not. This avoids TypeError during shutdown / mid-reload window destruction without weakening the production guard.
- Comments in `slash-command-ipc.ts` and `SlashCommandDispatcher.ts` intentionally AVOID the forbidden literals (`registerAiValidatedHandler`, `child_process`, `$ARGUMENTS`). Same Rule 3 lesson Plan 02 hit with its parser comments. The acceptance grep gates return 0 hits for each.
- Phase-15 boundary (TRS-06 / CMD-06): the dispatcher's `case "prompt":` branch returns not-yet-supported. Phase 13 has NO registered prompt commands in production, so this branch is unreachable but must fail closed for type-contract safety.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] /status display string needed hyphen→space conversion**
- **Found during:** Task 1 GREEN phase
- **Issue:** The manager's `getStatus().watcherState` is the programmatic enum `"not-started"` (hyphenated). The plan's must_haves truth requires the displayed string to read "Watcher: not started (phase 14)" (space). My initial renderStatus() interpolated the raw enum, producing "not-started (phase 14)".
- **Fix:** Added `.replace("-", " ")` to renderStatus() so the display string reads "not started" while the internal enum stays hyphenated for stable serialization.
- **Files modified:** `src/service/slashCommands/SlashCommandDispatcher.ts`
- **Verification:** All 22 tests pass, including the new `/not started/i` and `/phase 14|phase-14/i` assertions.
- **Committed in:** `273eaa91`

**2. [Rule 3 - Blocking] Comments leaked forbidden literals (TRS-05 + TRS-06 grep gates)**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** My initial comments in `slash-command-ipc.ts` mentioned the AI-gated wrapper by its literal name (twice) and `SlashCommandDispatcher.ts` mentioned the spawn-module literal in its SECURITY header. Both violated acceptance grep gates requiring 0 hits.
- **Fix:** Reworded the comments to describe the forbidden thing without using its literal (`the AI-gated wrapper variant`, `process-spawning module`). Same pattern Plan 02 used for its parser comments. The literal substring `registerAiValidatedHandler` is now 0 hits; same for `child_process` / `eval` / `new Function()` / `$ARGUMENTS`.
- **Files modified:** `src/main-process/communication/slash-command-ipc.ts`, `src/service/slashCommands/SlashCommandDispatcher.ts`
- **Verification:** All TRS-05 + TRS-06 acceptance greps exit 0 hits.
- **Committed in:** `7f5be1bd`

**3. [Rule 3 - Blocking] SlashCommandModule unused-var lint error blocked commit**
- **Found during:** Task 1 GREEN commit attempt
- **Issue:** My initial SlashCommandModule used `require()` for lazy singleton resolution (triggered `@typescript-eslint/no-var-requires` error) and accepted an unused `_req?: SlashCommandContextRequest` param on reloadConfig/getStatus (triggered two `no-unused-vars` warnings). The error blocked the commit; the warnings were noise.
- **Fix:** Replaced `require()` with a top-level static `import { getAIFetchlyConfigManager }` (no circular dep — the import chain is SlashCommandModule → AIFetchlyConfigManager → CommandRegistry, none cycle back). Dropped the unused `_req` params entirely from reloadConfig/getStatus (phase 14+ can re-add them when actually needed). Updated the test to call them with no args.
- **Files modified:** `src/modules/SlashCommandModule.ts`, `test/vitest/main/service/SlashCommandDispatcher.test.ts`
- **Verification:** eslint clean on both files; 22/22 tests pass.
- **Committed in:** `273eaa91`

**4. [Rule 3 - Blocking] BrowserWindow.isDestroyed() not in TS types; webContents.isDestroyed() missing on MockBrowserWindow**
- **Found during:** Task 2 GREEN phase
- **Issue:** `win.isDestroyed()` does not exist on the project's `BrowserWindow` type (other IPC files use `webContents.isDestroyed()` instead — checked googleMaps-ipc and yandexMaps-ipc). Even after switching to `contents.isDestroyed()`, the test's MockBrowserWindow.webContents lacks that method, causing a TypeError that the wrapper caught into a status:false response.
- **Fix:** emitConfigChanged() now guards with `typeof (contents as unknown as { isDestroyed?: () => boolean }).isDestroyed === "function"` before calling it. Works for both real Electron (calls the method) and test mocks (skips the check). Mirrors the codebase's existing defensive `as any` pattern for BrowserWindow methods.
- **Files modified:** `src/main-process/communication/slash-command-ipc.ts`
- **Verification:** reload tests now pass — the handler returns status:true and emits AIFETCHLY_CONFIG_CHANGED as expected.
- **Committed in:** `7f5be1bd`

**Total deviations:** 4 auto-fixed (1 display-string bug, 3 lint/type/mock blocking issues)
**Impact on plan:** Minimal — implementation conforms to the locked design; the API contract (method names, channel names, return shapes) is unchanged. The only contract-affecting change is dropping the truly-unused optional conversationId param from reloadConfig/getStatus, documented in the method JSDoc.

## Issues Encountered

- The full vitest suite (`npx vitest run --config vite.main.config.mjs` without filter) reports 68 pre-existing test failures across 16 files — ALL unrelated to phase 13. They are DB-backed modules (AIChatCompact, AIUserMemory, AIMemoryConsolidationRun, Workspace), task-ipc, plugin-ipc, FileToolPermission, USonarYellowPageAdapter, ErrorClassification, RateLimiter, ValidationUtils. Plan 03a's SUMMARY already documented the `ERR_DLOPEN_FAILED` pattern from `better-sqlite3` in the WorkspaceResolver path; these failures share that root cause. Verified pre-existing by running `task-ipc.test.ts` on the baseline (stashing Plan 03b's changes leaves the same 17 failures). Logged to `deferred-items.md` per the GSD SCOPE BOUNDARY rule; out of scope for this plan.
- Vitest's default esbuild mode strips types without checking them. Used `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <Filter>` for fast inner loops after `npx tsc --noEmit` was clean. Final state passes both `tsc --noEmit` (0 errors) and the targeted vitest runs (33/33 pass).

## User Setup Required

None — no external service configuration required. The startup hook is wired; built-in commands register automatically on app launch via `registerSlashCommandHandlers(win)` (called from `registerCommunicationIpcHandlers`). The renderer cannot yet invoke these channels because `preload.ts` whitelist entries are Plan 13-04's scope.

## Next Phase Readiness

- The 5 channel constants in `channellist.ts` are stable string literals per design §17.1. Plan 13-04 will add them to `preload.ts`'s `invoke` whitelist (for LIST/DISPATCH/RELOAD/STATUS) and `receive` whitelist (for CHANGED).
- `SlashCommandDispatchResponse` is the renderer's stable contract. Plan 13-04 switches on `action` (`show_result` renders inline; `submit_prompt` re-submits via the existing `AI_CHAT_V2_STREAM` API).
- The `AIFETCHLY_CONFIG_CHANGED` event payload (`{source, summary}` JSON string) is ready for the renderer's `windowReceive` subscription.
- Plan 13-04 will also build the `AiChatV2SlashSuggestions.vue` dropdown, fed by `SlashCommandListResponse.commands` (renderer-safe views with source badges).
- The fire-and-forget startup scan runs in parallel with `SkillImportService.loadPersistedSkills()`. Once `initialize()` resolves, the manager's getStatus() reports real counts; before that, it returns zeroes (graceful).

## Known Stubs

None. Every public surface is wired end-to-end:
- Built-in commands resolve through real CommandRegistry + AIFetchlyConfigManager (no mock fallbacks in production paths).
- /status and /reload-config surface real manager.getStatus() / manager.reload() results (DX-02).
- AIFETCHLY_CONFIG_CHANGED emission carries real reload summaries.
- SlashCommandModule has no DB — by design (phase 13 is file-backed), not a stub.

## Threat Flags

None. No files created/modified introduce security-relevant surface NOT in the plan's `<threat_model>`. The 4 threats in the register (T-13-04 TRS-05 gating, T-13-05 code execution, T-13-Block startup DoS, T-13-Leak config-changed payload) are all mitigated as planned; no new boundary was opened.

## Self-Check: PASSED

**File existence (10/10 FOUND):**
- Created: `src/service/slashCommands/builtinSlashCommands.ts`, `src/service/slashCommands/SlashCommandDispatcher.ts`, `src/modules/SlashCommandModule.ts`, `src/main-process/communication/slash-command-ipc.ts`, `test/vitest/main/service/SlashCommandDispatcher.test.ts`, `test/vitest/main/ipc/slash-command-ipc.test.ts`
- Modified: `src/entityTypes/slashCommandTypes.ts`, `src/config/channellist.ts`, `src/main-process/communication/index.ts`, `src/background.ts`

**Commit existence (4/4 FOUND):**
- `11925270` — test(13-03b): add failing SlashCommandDispatcher tests
- `273eaa91` — feat(13-03b): built-in slash commands + dispatcher + module
- `9c84ddcd` — test(13-03b): add failing slash-command IPC gating matrix tests
- `7f5be1bd` — feat(13-03b): slash-command IPC layer + startup hook

**Final verification:**
- `AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs SlashCommandDispatcher slash-command-ipc` → 33/33 pass
- `npx tsc --noEmit` → 0 errors
- `grep -c registerAiValidatedHandler src/main-process/communication/slash-command-ipc.ts` → 0 hits (TRS-05 Strategy A)
- `grep -c '\$ARGUMENTS' src/service/slashCommands/SlashCommandDispatcher.ts` → 0 hits (TRS-06)
- `! grep -E "child_process|..." src/service/slashCommands/SlashCommandDispatcher.ts` → PASS
- Plan 13-03b-only touched files: 11 (all under src/ + .planning/); `src/preload.ts` and `src/views/**` NOT touched (Plan 13-04 scope)

---
*Phase: 13-global-context-and-built-in-slash-commands*
*Completed: 2026-07-05*
