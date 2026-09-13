# Application Exit and System Tray — Technical Design

| Field | Value |
| --- | --- |
| Status | Proposed implementation; interfaces and files below are not yet implemented |
| Version | 1.0 |
| Date | 2026-09-11 |
| Product requirements | [PRD](application-exit-and-system-tray-prd.md) |
| Stack | Electron main process, TypeScript, Vue 3, Vuetify, existing worker transports |

## 1. Design summary

Introduce a main-process lifecycle coordinator that distinguishes window hiding from application termination. All normal exit requests enter one idempotent shutdown promise. The coordinator synchronously blocks new work and holds Electron quit while registered services close workers, browsers, and resources under one global deadline.

Add a tray controller and a renderer close-choice dialog. The renderer displays choices; the main process owns lifecycle state, process ownership, the deadline, and the final exit action. Renderer availability must never be required to complete an explicit quit.

This document specifies a design grounded in local source inspection, not a verified reproduction or a claim that cleanup is already implemented. Electron lifecycle, updater, tray, and process-containment details must be checked against the installed versions during implementation. The earlier online documentation check was unsuccessful; this document does not claim external API verification.

## 2. Existing code and integration inventory

| Existing location | Observed behavior / integration required |
| --- | --- |
| `src/background.ts` | Owns windows, `window-all-closed`, asynchronous `before-quit`, `will-quit`, activation, and development termination handling |
| `src/main-process/communication/contactExtraction-ipc.ts` | Cleanup calls worker `kill()` and drops reference; adapt to await observed termination |
| `src/childprocess/contact-extraction/ContactExtractionWorker.ts` | Already attempts browser cleanup on termination with a three-second timeout; preserve and strengthen cooperation |
| `src/modules/WorkerCoordinator.ts` | Concurrency slot counter/queue, not a process-handle registry; queued acquisitions need shutdown cancellation |
| `src/service/ToolJobRegistry.ts` | `shutdown()` signals jobs; cancellation must be followed by process termination verification |
| `src/service/workspaceWatch/WorkspaceWatchManager.ts` | Existing asynchronous shutdown and restart suppression; use as a participant |
| `src/modules/YellowPagesProcessManager.ts` | Existing `terminateAllProcesses()`; adapt deadline, descendant tracking, and exit confirmation |
| `src/modules/GoogleMapsModule.ts`, `YandexMapsModule.ts` | Spawn workers and contain per-worker termination paths; integrate ownership and shared deadline |
| `src/modules/WebsiteAnalysisQueue.ts`, `SearchModule.ts`, `EmailSearchTaskModule.ts` | Utility process spawners; ensure active and queued work is covered |
| `src/modules/socialtask.ts`, `buckEmailTaskModule.ts` | Additional utility process owners; include active job and state reconciliation |
| `src/service/ShellToolService.ts` | Existing detached launch and tree-kill logic; currently fire-and-forget termination is insufficient as completion proof |
| `src/modules/MCPClient.ts` | Owns spawned stdio server connections in some modes; close owned servers, disconnect external servers only |
| `src/service/SkillWorkerClient.ts`, `PythonRuntimeWorkerClient.ts` | Worker ownership; account for subprocesses started within workers |
| `src/service/hooks/`, `pluginCompat/PluginHookRegistrar.ts`, `DocSkillScriptRunnerService.ts` | Hook/script process owners; prevent late execution and register descendants |
| `src/service/embedding/LocalEmbeddingWorkerClient.ts`, `aiChatVoice/SherpaVoiceWorkerClient.ts` | Existing disposal APIs; wrap with awaited termination |
| `src/service/localAiRuntime/DisposableVoiceRuntimeProbe.ts` | Short-lived probe still requires tracking if exit overlaps startup |
| `src/service/outboundEmail/OutboundEmailWorkerStarter.ts` | Worker and side-effect completion coordination |
| `src/service/WebsiteContentScrapeService.ts` | Additional utility process scraper owner |
| `src/service/pluginSources/NpmPluginFetcher.ts`, `SkillEnvironmentManager.ts`, `aiChatVoice/VoiceModelDownloadService.ts` | Installer/download/extraction commands can remain active; cancellation and partial-output semantics required |
| `src/modules/ScheduleManager.ts` | Shutdown persists scheduler status and stops it; split dispatch freeze from final persistence as needed |
| `src/main-process/updater/ManualUpdateService.ts` | Direct `quitAndInstall()` path must be routed through cleanup |
| `src/main-process/updater/AppUpdateService.ts` | Automatic updater prompt/restart path must also participate |

This is an initial inventory, not an exhaustive certification. Before completing implementation, search all `spawn`, `fork`, `exec`, `execFile`, utility-process launches, Puppeteer launch/connect, subprocess libraries, retries, and direct exit calls. Include controllers such as proxy/search controllers and any processes started by dependencies. Record owner, transport, descendants, cleanup adapter, and test for each launch site.

## 3. Architecture and responsibility boundaries

Proposed files:

| File / area | Responsibility |
| --- | --- |
| `src/main-process/lifecycle/ApplicationLifecycleService.ts` | Authoritative state machine and exit arbitration |
| `src/main-process/lifecycle/ShutdownCoordinator.ts` | Ordered phases, deadlines, result aggregation |
| `src/main-process/lifecycle/OwnedProcessRegistry.ts` | Main-process ownership records and exit observation |
| `src/main-process/lifecycle/ProcessTreeTerminator.ts` | Platform-specific verified termination |
| `src/main-process/lifecycle/TrayController.ts` | Tray lifetime, icon, menu, restoration |
| `src/main-process/lifecycle/ShutdownParticipants.ts` | Compose existing owners; do not instantiate unused services at shutdown |
| `src/entityTypes/applicationLifecycle-type.ts` | Shared serializable request/state contracts |
| `src/main-process/communication/applicationLifecycle-ipc.ts` | Validate requests, authorize sender, call lifecycle service |
| `src/views/api/applicationLifecycle.ts` | Renderer bridge wrapper |
| `src/views/components/application/ApplicationCloseDialog.vue` | Localized choice and shutdown display |
| Existing root renderer, preload and IPC registration | Wire singleton dialog, allowlisted channels and state subscription |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Matching lifecycle translation keys |

Infrastructure lives in the main process. Worker-only shutdown helpers belong under `src/childprocess/`. Shared message types belong in `src/entityTypes/`. Task persistence remains in Modules and Models, using `Token`/`USERSDBPATH` via the existing base classes. No database repositories or direct SQLite access may be introduced in lifecycle IPC or workers.

## 4. Lifecycle state machine

Use one state enum and a separate pending-dialog token:

| State | Allowed transition | Trigger |
| --- | --- | --- |
| `visible` | `hidden` | Valid Keep running selection after tray readiness |
| `visible` | `quitting` | Explicit Exit/Quit |
| `hidden` | `visible` | Tray Open or second-instance activation |
| `hidden` | `quitting` | Tray/application Quit |
| `quitting` | `ready-to-exit` | Cleanup completes or global deadline expires |
| `ready-to-exit` | Process exits or updater takes control | Terminal action |

An ordinary close in `visible` prevents default and opens one dialog token. Dismissal consumes the token and stays visible. Exit from another source invalidates the token. Late dialog responses cannot hide or revive an application that is quitting.

`requestExit(reason)` sets `quitting` synchronously before its first await and returns the existing promise on repeated calls. No state transition back to visible is allowed after acceptance. A separate terminal intent distinguishes `quit` from `update-restart`: ordinary quit must not overwrite a pending accepted update restart; a later update request must not upgrade a shutdown already committed to ordinary quit. Serialize intent selection before cleanup begins.

### Electron event wiring

- Window `close`: prevent default only for the main window while ordinary close needs a choice, or while controlled cleanup still owns termination. Allow final window close when `ready-to-exit` is set.
- `before-quit`: synchronously call `event.preventDefault()` unless final exit is authorized; synchronously start/join `requestExit`. An `async` listener by itself is not a shutdown barrier.
- On cleanup completion: set the final-exit guard before calling `app.quit()` again. That second event must pass through without starting cleanup again.
- `window-all-closed`: preserve deliberate hidden mode; otherwise route to coordinated quit according to platform policy. Do not create a bypass to cleanup.
- `will-quit`: minimal synchronous final housekeeping only; required async cleanup must already be complete.
- Activation and second-instance handling: show hidden windows before focusing. Preserve existing protection against stale window references; do not initialize a second worker set.
- Signals/development parent messages: route supported normal termination requests through the same coordinator.
- OS session end: bypass the choice dialog and run best-effort cleanup if events are available. Do not assume every OS exit emits normal Electron quit events or permits a ten-second delay.
- Direct `app.exit()` and `process.exit()` calls: classify early-startup/crash paths separately; audit normal paths to eliminate cleanup bypasses. Keep a deliberate last-resort terminal fallback.

## 5. Shutdown ordering and deadlines

Use one monotonic deadline, ten seconds after accepting a normal exit. Stage timeouts are maximum allocations within that deadline, not independent durations added for each service.

| Phase | Target window | Required actions |
| --- | --- | --- |
| Freeze | 0–250 ms | Block new IPC work/spawns, pause schedulers and queues, disable retries/restarts, invalidate close dialog |
| Graceful stop and drain | Up to 6 s elapsed | Cancel active jobs, request worker/browser close, continue handling final worker results |
| Force and verify | Up to 9 s elapsed | Terminate remaining owned process trees; wait for exit and inspect recorded descendants |
| Finalize | Up to 10 s elapsed | Persist final task outcomes, close DB/connections, flush bounded logs, destroy tray, authorize terminal action |

Begin cleanup immediately rather than waiting for a development bridge to stop first. Within each dependency stage use settled result aggregation so one rejection does not skip siblings. Resource closers that can run independently may run concurrently. Persist worker results before closing the database. Background cancellation and disposal must not race a scheduler into launching replacement work.

Timeout wrappers alone do not cancel underlying promises. Pass a deadline and abort signal into adapters; check lifecycle state before late writes or spawns; stop accepting results at an explicit finalization barrier. Await in-flight persistence before DB close where the remaining budget allows. Record operations that cannot be drained before the deadline.

Keep the deadline timer referenced until termination is authorized. A blocked main event loop can prevent an in-process watchdog from firing; native process containment is required for stronger parent-death guarantees, and the ten-second target excludes an OS/event-loop hang.

## 6. Participant and process contracts

Illustrative interfaces (implementation must keep explicit return types and avoid `any`):

```typescript
export type ExitReason =
  | 'close-dialog'
  | 'tray'
  | 'application-menu'
  | 'programmatic'
  | 'update-restart'
  | 'os-session-end'
  | 'development-signal';

export interface ShutdownContext {
  readonly attemptId: string;
  readonly deadlineMonotonicMs: number;
  readonly signal: AbortSignal;
}

export interface ShutdownParticipant {
  readonly id: string;
  freeze(): void;
  stop(context: ShutdownContext): Promise<void>;
  finalize(context: ShutdownContext): Promise<void>;
}

export interface OwnedProcessIdentity {
  readonly id: string;
  readonly ownerId: string;
  readonly pid: number;
  readonly startedAtIdentity: string;
  readonly parentRecordId?: string;
  readonly isolatedProcessGroupId?: number;
  readonly ownership: 'spawned-by-app' | 'spawned-by-owned-worker';
}
```

The process registry stores transport-specific handles internally, an observed-exit promise, verified platform identity, and descendant records. It does not expose handles or termination commands to the renderer. A PID alone is not sufficient identity because it can be reused.

Register immediately on successful launch, including the pending-spawn interval before a PID becomes available. Attach error/exit listeners before asynchronous handshakes. A spawn admitted just before freeze must either register and shut down or be cancelled; no untracked gap is acceptable. Resolve pending browser-slot acquisitions with a typed cancellation outcome when shutting down.

Keep ownership records until termination is confirmed, even if a manager has dropped its current-worker pointer. A killed root must not erase living descendant records. Remove stale records only after observed exit or a verified identity mismatch. Never instantiate a lazy singleton solely to stop it.

## 7. Worker and browser cooperation

Add or adapt a validated shutdown message using each worker's existing transport (`process.send`/`message` or utility-process `postMessage`/parent port). Do not force all workers onto one transport as part of this feature.

Recommended message fields: `type`, `requestId`, `reason`, and `remainingMs`. Pass remaining duration across processes rather than assuming monotonic clocks share an origin. A worker acknowledgement reports local cleanup completion, but the parent must still observe process termination.

Worker shutdown sequence:

1. Set a local closing flag and reject new jobs.
2. Stop dequeuing and cancel in-flight operations where supported.
3. Close browser instances and subprocesses owned by the worker.
4. Send final results/status while main-process persistence remains available.
5. Acknowledge cleanup and exit; use a local timeout bounded by the parent allowance.

Report browser/subprocess identity as soon as each is launched, before completing unrelated asynchronous setup. Validate reports against the reporting worker's owned process tree; never trust an arbitrary PID supplied over IPC. Browser disconnect is not browser termination. Externally attached browser sessions must be disconnected without killing a user's browser.

Parent-disconnect handlers provide cooperative cleanup when possible. Workers cannot guarantee cleanup of non-cooperative descendants after abrupt death; containment and platform tests cover that limitation.

## 8. Platform process-tree termination

### Windows

Preferred strong containment is an application-owned Job Object with kill-on-close behavior for processes that can be assigned safely. This may require a maintained native dependency/helper and must be validated with Electron utility processes, child spawning, and packaging. No new native dependency is presumed selected by this document.

For controlled normal exit, a verified process-tree fallback may use `taskkill` with an argument array for a specific owned PID (`/PID`, `/T`, `/F`). Await the helper and verify results. A root that already exited may no longer provide a discoverable tree: retain descendant identity separately and terminate remaining verified descendants. Do not present `taskkill /T` alone as a parent-crash guarantee.

### macOS and Linux

For compatible application-launched commands, create an isolated process group at launch and record its ID. Signal a negative process-group ID only when ownership and isolation are established. Do not assume Electron utility processes have their own groups or signal the application's inherited group.

For other process types, maintain validated descendant identities and terminate leaves and roots as appropriate. Re-check descendants during cleanup to cover spawn races. Handle already-exited processes as success after verification and permission failures as failures. Processes escaping tracking/containment remain a documented limitation until covered by an adapter.

### Common rules

- Never kill by executable name, broad image-name matching, or an unvalidated renderer PID.
- Track start identity to prevent PID-reuse errors; ambiguous ownership is logged and not force-killed.
- Never kill the parent app's shared process group or an externally connected service.
- Include termination helpers in deadline accounting.
- Platform containment choice and its tests are a required implementation milestone. If a process family cannot be safely terminated, do not claim the complete cleanup release criterion is met.

## 9. Tray and renderer design

Create the tray through a main-process controller after application readiness. Hold a strong reference until true exit. Resolve icons from packaged assets and verify Windows, macOS template/icon appearance, and Linux environments. Main-process locale changes rebuild menu labels.

Before hiding, ensure a usable restore path exists. Tray construction success is insufficient evidence on environments without functional tray hosting; gate known unsupported environments and provide a fallback that keeps the window visible. A tray failure during startup must not fail application startup.

Mount one `ApplicationCloseDialog.vue` at the renderer root, independent of the active page. The dialog consumes a main-issued request token and sends one of `hide`, `exit`, or `cancel`. Keep a visible shutting-down state in the root shell and disable new task actions; the main process must enforce the same gate regardless of renderer state.

If the renderer is unavailable or fails to acknowledge the choice request within a short bounded timeout (proposed two seconds), main may show a localized native choice dialog. Ensure only one surface is active and invalidate late renderer responses. Explicit Quit always bypasses the renderer and choice fallback entirely.

## 10. IPC and localization

Proposed allowlisted operations:

| Operation | Payload | Result |
| --- | --- | --- |
| Get lifecycle state | None | State and background availability |
| Close choice event, main to renderer | Request token, background availability | Renderer acknowledgement |
| Submit close choice | Token and `hide` / `exit` / `cancel` | Accepted or typed rejection |
| Lifecycle changed event | State and user-facing phase key | UI updates |

Only the main application's authorized top-level renderer may submit choices. Validate enums, bounded token strings, and sender identity. Reject stale tokens and choices inconsistent with current state. Do not accept process IDs, shell commands, or arbitrary quit reasons from the renderer. Lifecycle IPC is not an AI feature and requires no AI entitlement check; modified AI task handlers retain their existing AI-enable-first rule before work.

Suggested translation namespace: `applicationLifecycle`, with keys `closeTitle`, `closeDescription`, `keepRunning`, `exit`, `open`, `exiting`, `stoppingTasks`, `trayUnavailable`, and optional pluralized active-task messages. Translate every introduced key into all six supported languages. Use the existing locale source for main menus; if it is renderer-only, add a validated locale synchronization adapter rather than hardcoding English.

## 11. Persistence and resource finalization

Freeze dispatch before asynchronous scheduler status writes. Reuse existing task controllers/Modules to persist final results and interrupted states; do not implement database updates in lifecycle IPC. Workers report status to main and never access the DB directly.

Produce an explicit per-subsystem mapping for queued, active, completed, cancelled, and uncertain outcomes before coding state transitions. Preserve deduplication and external operation IDs where available. Email/social side effects whose outcome is unknown must not be retried automatically merely because the app restarted.

After workers stop, drain accepted result handlers under the remaining deadline, then freeze result ingestion and close owned DB connections. Stop network reconnects, token-refresh timers, cron tasks, watchers, diagnostics intervals, development bridge, and log cleanup. Dispose only resources initialized in this session.

Move clean startup-marker removal away from the beginning of `before-quit`. Mark a clean shutdown after required cleanup succeeds. Record forced/incomplete outcomes separately so the next launch can distinguish them from a crash without calling them clean. Align changes with existing crash-reporting semantics and avoid recording sensitive process arguments.

No new database entity is required by default. If existing task schemas cannot represent necessary interruption semantics, add a separately reviewed migration rather than writing unsupported status values.

## 12. Updater and exceptional exits

Route `ManualUpdateService.quitAndInstall()` through lifecycle cleanup with a terminal callback that retains updater installation semantics. Inspect the automatic `update-electron-app` restart prompt path as well; it must invoke the same controlled callback or be configured so the application owns the restart prompt. Avoid relying only on an updater event emitted after window closure has already begun.

At finalization, invoke the selected terminal callback exactly once. Guard re-entrant quit/window events before invoking it. If update handoff throws or fails, log the failure and execute a bounded normal-exit fallback; do not enter background mode or restart cleanup indefinitely. Test both manual and automatic updates in packaged supported builds.

Early startup failures, single-instance losers, crash recovery, and OS shutdown have different available resources. Use an empty/partial participant set without creating services. Forced fallback via `app.exit()` is allowed only after the coordinator has attempted bounded cleanup and recorded the outcome. It cannot itself prove child-process termination.

## 13. Test plan and traceability

| Test area | Cases | PRD coverage |
| --- | --- | --- |
| Lifecycle unit tests | Re-entrant quit, stale dialog token, hide/restore, final-exit guard, terminal intent arbitration | AC-01, 03, 08 |
| Shutdown coordinator tests | Deadline, hung/rejecting participant, ordering, one failure does not skip others | AC-04, 05, 06, 15 |
| Registry/terminator tests | Spawn during freeze, PID reuse, root exits first, surviving descendant, permission failure, external process exclusion | AC-04, 05, 07, 14 |
| Worker adapter tests | Graceful browser close, ignored shutdown, acknowledgement without exit, no restart | AC-04, 06 |
| Task persistence tests | Late result drain, interrupted status mapping, uncertain side-effect retry prevention | AC-09 |
| Component tests | Choice rendering, dismissal/focus, repeat click, stale event, unavailable tray, progress, translations | AC-01, 02, 08, 10, 12 |
| Electron E2E | × → hide → restore → exit; renderer crash → exit; repeated requests | AC-01–04, 08, 13 |
| Packaged integration | Manual/automatic updater restart, OS session ending, platform tray behavior | AC-10, 11, 16 |

Place main-process tests in `test/vitest/main/`, component tests in `test/vitest/main/components/ApplicationCloseDialog.test.ts`, and E2E specs in `test/e2e/specs/` using `.test.ts` filenames. Add platform process fixtures under `test/` and keep shipped worker entry points under `src/childprocess/`.

Run `yarn testmain`, `yarn test:components`, and `yarn test:e2e` for the implementation, plus applicable existing worker/service suites. UI code and corresponding tests must be committed together. Use non-watch type checking appropriate to repository configuration; `yarn tsc` is documented as watch mode and is not a suitable unattended completion gate.

An independent test observer must outlive Electron and record process identity before exit. Assert disappearance of app-owned worker/browser identities after the budget and survival of unrelated fixtures. Do not rely solely on mocks or an empty in-app registry. Separate dev-server/watch processes from packaged application ownership.

Native tray UI may not be fully controllable through Playwright. Test controller behavior automatically, expose only test-build hooks if needed, and complete native interaction checks on Windows/macOS and supported Linux desktops. Do not ship test-only termination endpoints in production.

## 14. Implementation work packages

1. **Inventory and characterization:** capture a reproducible leftover-process case, enumerate launch sites, audit normal quit/update paths, map existing cleanup contracts and task states.
2. **Lifecycle core:** implement synchronous freeze, idempotent coordinator, deadline accounting, participant dependency order, and fake-clock tests.
3. **Process ownership:** register every launch family, adapt graceful worker messages, add verified platform tree termination and process-observer tests.
4. **Persistence and finalization:** drain results, reconcile interrupted tasks, stop reconnect/timer loops, close resources, align clean-shutdown markers.
5. **Tray and UI:** controller, restoration, choice token IPC, fallback, locale support, component and E2E coverage.
6. **Updater/platform integration:** manual and automatic restart, OS session-end behavior, startup/early-exit cases, packaged acceptance matrix.

Each completed logical unit receives a conventional git commit under repository policy. Do not commit incomplete runtime code. Keep implementation evidence tied to the PRD acceptance IDs.

## 15. Release risks and decisions to verify

| Risk | Mitigation / completion condition |
| --- | --- |
| An unregistered launch path remains | Complete launch inventory and representative process-family tests before release |
| A worker dies before reporting a browser | Register at creation; use containment where possible; test launch/shutdown races |
| Process-tree lookup misses reparented descendants | Persist identity while parent is alive; use OS containment where available |
| Timeout leaves background async callbacks active | Abort-aware adapters, freeze gates, persistence barrier, terminal fallback |
| Force kill interrupts external actions | Preserve uncertain outcomes and prevent blind retry |
| Tray exists but is inaccessible | Gate unsupported desktops; keep window visible on failure |
| Updating bypasses cleanup | Own both restart entry paths and verify actual installed updater event order |
| Main event loop hangs | State limitation explicitly; assess native containment, not timer-only guarantees |

Review installed Electron/Node APIs and native-helper packaging before choosing platform termination primitives. The design commits to the normal-exit behavior and evidence requirements, not to an unverified claim of universal process containment.

Roll out reliable shutdown before enabling the close-choice experience. If tray behavior regresses, disable the tray feature while retaining coordinated Exit. Completion requires recorded PRD acceptance evidence, no known uncovered process family, and packaged verification on release target platforms.
