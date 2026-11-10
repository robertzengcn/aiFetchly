# Application Exit and System Tray — Product Requirements

| Field | Value |
| --- | --- |
| Status | Draft for implementation; no runtime changes included |
| Version | 1.0 |
| Date | 2026-09-11 |
| Product | AiFetchly desktop application |
| Technical companion | [Technical design](application-exit-and-system-tray-technical-design.md) |

## 1. Problem and intended outcome

A user reports that processes remain running after closing AiFetchly. Closing the window currently gives no explicit choice between leaving automation running and exiting completely. Users need control over background operation and confidence that choosing Exit stops the application's work and releases its processes.

Deliver two distinct behaviors: **Exit application**, which completes a bounded shutdown, and **Keep running in system tray**, which hides the window while preserving active work. The tray icon must provide Open and Exit actions.

This proposal is based on source inspection. The exact leftover process reported by the user has not been reproduced or identified. Implementation must capture process identity and reproduce the issue before claiming the original defect is fixed.

## 2. Current evidence

- `src/background.ts` calls `app.quit()` after all windows close on non-macOS platforms; macOS deliberately remains active.
- Its `before-quit` callback performs asynchronous cleanup without synchronously preventing the quit event. The design must explicitly hold application termination until cleanup completes.
- Cleanup already exists for tool jobs, contact extraction, schedulers, WebSocket connections, workspace watching, and diagnostics. Coverage and termination confirmation are incomplete at the application boundary.
- The contact extraction worker attempts browser cleanup on termination, with a three-second local timeout. Its main-process cleanup function calls `kill()` and clears the handle without awaiting exit.
- Process ownership spans scrapers, shell commands, hooks, local AI workers, MCP servers, downloads, and other services. A window-level change alone cannot resolve all process leaks.

## 3. Goals and non-goals

### Goals

1. Make closing behavior explicit and understandable.
2. Keep supported automation running while the application is hidden.
3. Route every normal exit action through one shutdown procedure.
4. Stop accepting new work as soon as exit begins.
5. Stop application-owned workers and browser descendants, escalating after a deadline.
6. Preserve completed results and accurately represent interrupted work.
7. Avoid terminating unrelated user applications.
8. Support localized, accessible UI and automated regression coverage.

### Non-goals for version 1

- Starting automatically at login or running as an operating-system service.
- Continuing tasks after an explicit Exit.
- Preventing OS sleep or guaranteeing task execution while the computer sleeps.
- Adding a remembered close preference; version 1 asks on each ordinary close.
- Reworking every task engine or promising exactly-once external actions.
- Guaranteeing cleanup after power loss, a kernel failure, or an uncatchable process kill.
- Building a tray dashboard with per-task controls.

## 4. Users and scenarios

| Scenario | Expected result |
| --- | --- |
| User finishes work and clicks × | User chooses Exit; owned processes stop |
| User wants scraping to continue | User chooses Keep running; window hides and work continues |
| User needs to return | Tray Open restores the same session |
| User wants to stop hidden automation | Tray Exit starts shutdown immediately |
| User launches AiFetchly again while hidden | Existing instance becomes visible; no duplicate workers |
| User exits during a task | Completed results remain; unfinished work is marked appropriately |
| Worker or browser becomes unresponsive | Deadline triggers forced cleanup of owned processes |
| Renderer crashes before exit | Main process can still accept and execute an exit action |

## 5. Interaction requirements

### FR-01: Close choice

For an ordinary user close of the main window, prevent destruction and show one dialog:

> **Close AiFetchly?**
>
> Exit stops running tasks. Keep running hides the window and lets tasks continue in the system tray.

Primary choices: **Keep running in system tray** and **Exit application**. Escape or dismissing the dialog keeps the window open. Repeated close actions must not stack dialogs. Do not persist a choice in version 1.

If there is a trustworthy active-task count, show a localized pluralized message. If counts are incomplete, omit the count rather than report zero. Users must not need to understand workers or process IDs.

### FR-02: Background mode

Create and retain an application tray icon before hiding the window. Hiding must not destroy the renderer, cancel tasks, clear shared window references, or close browser sessions needed by active work.

Background operation applies while the machine is awake and services are available. Essential scheduling must be owned by the main process or workers rather than depend on a visible renderer or renderer timers.

### FR-03: Tray actions

The tray menu provides **Open AiFetchly** and **Exit application**. Supported click activation also restores the window; platform-specific tray menu behavior must remain usable. Restoration shows, restores from minimized state when needed, and focuses the existing window.

Exit from the tray bypasses the close-choice dialog. Once shutdown starts, disable repeated task-start and restore actions; repeated Exit requests join the same shutdown operation.

### FR-04: Explicit exit

Tray Exit, the application menu Quit action, supported quit shortcuts, and programmatic normal quit must use the same cleanup path. The close dialog's Exit button uses that path too. Explicit quit must never accidentally select background mode.

Show **Exiting AiFetchly…** and **Stopping running tasks…** in a visible window during cleanup. Do not reopen a hidden window solely to show progress. A tray tooltip/menu may show the exiting state where supported. Once accepted, exit is not cancellable in version 1.

### FR-05: Bounded termination

Use a target global shutdown budget of ten seconds from acceptance of Exit. This is a normal-operation product target, not a guarantee against OS hangs or permission failures.

Stop new work first; request graceful worker/browser shutdown; then force-stop remaining owned processes within the remaining budget. Confirm termination rather than treating a sent signal as proof of exit. Log failed cleanup without allowing a single failed service to skip other cleanup.

If the budget expires, the application must not hang indefinitely. Record known cleanup failures locally and terminate through a final fallback. A forced fallback with an unverified surviving process is a failed cleanup outcome, not a successful clean exit.

### FR-06: Data and task semantics

Keep completed results. Stop claiming queued work after exit begins. Preserve pending queued work according to its existing restart policy. Map running tasks to an existing supported cancelled/interrupted state; introduce a new state only with an explicit schema and consumer migration.

External operations such as sending email or posting content may complete remotely before local confirmation arrives. Record uncertainty where supported and do not automatically retry these operations on restart. Do not label all interrupted work completed or automatically resume it.

### FR-07: Platform behavior and tray fallback

| Platform/event | Required behavior |
| --- | --- |
| Windows window × | Close choice; tray icon near notification area |
| macOS window close | Close choice; menu-bar tray icon; explicit Cmd+Q exits |
| macOS activation | Restore/show the existing main window or safely recreate it |
| Linux with working tray support | Same close choice and tray workflow |
| Tray unavailable or creation fails | Keep window accessible; offer Exit or dismiss; never hide into an inaccessible state |
| OS logout/shutdown | No interactive close-choice dialog; best-effort cleanup subject to OS deadlines |
| Update restart | Cleanup then updater restart/install; do not convert to background mode or ordinary quit |

If tray support cannot be established reliably on a desktop environment, keep the background option disabled. Explicit platform checks and packaged manual tests are required.

### FR-08: Localization and accessibility

All new dialog text, menu labels, progress text, errors, and accessibility labels must have keys in English, Chinese, Spanish, French, German, and Japanese. Vue UI uses `t()` with English fallbacks; main-process menus use the selected locale through an established or dedicated locale adapter.

Provide keyboard navigation, visible focus, correct dialog semantics, focus restoration after dismissal, and layouts that accommodate long translations. Exit must require deliberate activation rather than being triggered by dismissing a dialog.

### FR-09: Diagnostics and privacy

Record a local shutdown attempt ID, reason, phase durations, process categories, forced termination count, and verification failures. Do not log command arguments, credentials, scraped content, or full environment variables. No new remote telemetry is required.

## 6. Acceptance criteria

| ID | Acceptance criterion |
| --- | --- |
| AC-01 | Clicking × shows exactly one choice dialog; dismissing preserves the window and tasks |
| AC-02 | Keep running hides the window only after tray readiness; active test work continues |
| AC-03 | Tray Open restores existing state without duplicate initialization |
| AC-04 | Tray Exit and dialog Exit both stop workers and descendant browsers |
| AC-05 | At shutdown entry, queued starts, retries, and worker restarts are blocked |
| AC-06 | A worker ignoring graceful shutdown is force-stopped within the target budget on supported test machines |
| AC-07 | An unrelated browser and unrelated Node process survive exit tests |
| AC-08 | Repeated Exit, ×, and quit requests cause one cleanup run without dialogs reopening |
| AC-09 | Completed data survives; interrupted work is not falsely marked successful or blindly retried |
| AC-10 | Tray failure leaves the application reachable |
| AC-11 | Update restart still installs/relaunches after cleanup, including exit from hidden state |
| AC-12 | All six languages and keyboard interactions pass UI checks |
| AC-13 | Main-process-owned exit works with an unresponsive renderer |
| AC-14 | A process observer outside the application confirms no owned worker/browser remains after a successful exit |
| AC-15 | Normal exit produces a cleanup report; forced/incomplete shutdown does not produce a misleading clean marker |
| AC-16 | OS shutdown avoids prompts; abnormal termination is documented as outside normal-exit guarantees |

## 7. Quality targets and verification

- Idle exit target: within two seconds on supported reference machines.
- Busy exit target: within ten seconds, including forced cleanup and finalization.
- Successful controlled test runs: zero surviving owned worker/browser processes and zero unrelated processes terminated.
- Hidden-mode test: a representative task continues for at least one minute, produces results, and can be restored and exited.
- Measure packaged builds separately from development, where build/watch processes may intentionally outlive Electron.

Required validation includes lifecycle unit tests, Vue component tests (`yarn test:components`), main-process tests (`yarn testmain`), and Electron E2E tests (`yarn test:e2e`). Native tray interactions and OS shutdown require platform manual checks or suitable OS automation in addition to Playwright.

## 8. Delivery and release criteria

1. Inventory and reproduce: identify reported leftovers; enumerate process owners and existing cleanup contracts.
2. Implement reliable exit: shared coordinator, spawn gate, process registry, bounded cleanup, task finalization.
3. Implement tray and close dialog: restoration, localization, accessible states, fallback behavior.
4. Integrate updater and platform events; complete process-family and packaged-platform tests.

Release only when every process-spawning family is registered or has a documented, tested exclusion and AC-01 through AC-16 have recorded evidence. A missing mandatory process owner blocks claiming complete exit cleanup. Shutdown repair should remain enabled if the optional tray experience needs rollback.

## 9. Decisions and remaining implementation checks

Decided defaults: always ask on ordinary close; explicit Exit has no second prompt; no launch-at-login setting; no automatic resume of uncertain external operations; ten-second target budget.

Before implementation completion, confirm packaged target operating systems, tray icon assets, actual updater event order, task-state mappings for each subsystem, and supported process containment mechanisms. These are engineering checks rather than reasons to delay documenting the proposed behavior.
