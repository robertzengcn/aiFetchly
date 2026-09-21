# Application exit and system tray — implementation audit TODO

Audit date: 2026-09-21. Reviewed worktree: `.claude/worktrees/app-exit-system-tray`, baseline commit `ef96dab2`.

Requirements reviewed: the PRD and technical design at `/home/robertzeng/project/aiFetchly/docs/prd/application-exit-and-system-tray-{prd,technical-design}.md`. Code references below are relative to this worktree root.

**Verdict: requirements are not fully implemented. There are runtime defects as well as missing release evidence. Do not describe this implementation as code-complete or as verified complete process cleanup.** The lifecycle state machine, shared quit routing, tray controller, localized close dialog, spawn wrappers, coordinator, reporting, and tests exist. Their presence does not establish end-to-end correctness.

This is a fresh audit; it preserves the earlier TODO and evidence files as history. In particular, earlier tasks 3 and 4 marked “CLOSED (code)” do not establish browser cleanup or durable social interruption handling. No runtime fixes were made in this audit.

## Verification performed

| Check | This audit's result |
| --- | --- |
| `yarn vitest --config vite.main.config.mjs run test/vitest/main/lifecycle` | 14 files, 159 tests passed; configured `tsc --noEmit` prerequisite passed |
| `yarn test:components` | 76 files, 534 tests passed; unrelated existing missing-i18n-key warnings appeared |
| Four temporary deterministic reproduction tests using the production registry/terminator/coordinator and existing `FakeProcessOps` | All four reproduced the erroneous outcomes described in T01, T02, T04 and T14; temporary test removed after execution |
| Full `yarn testmain`, Electron E2E, packaged builds, native tray, actual OS logout, actual updater install/relaunch | Not run in this audit; historical results are not fresh verification |
| Original reported leftover process | Not reproduced or identified; existing evidence also explicitly says this |

Local execution logs: `/tmp/aifetchly-lifecycle-audit-tests.log`, `/tmp/aifetchly-lifecycle-audit-components.log`, `/tmp/aifetchly-lifecycle-audit-reproductions.log`. These are local evidence, not committed artifacts or portable release evidence.

## Requirement coverage

“Partial” means relevant code exists but defects or missing behavior prevent accepting the requirement. “Unverified” means acceptance evidence is missing, not proof that the feature fails.

| Requirement | Current assessment | Outstanding tasks |
| --- | --- | --- |
| FR-01 close choice | Partial: singleton/token flow exists; renderer/native handoff can show both surfaces | T11 |
| FR-02 background mode | Implemented basic hide/session preservation; real representative workload and usable Linux tray not established | T10, T17 |
| FR-03 tray actions | Partial: restore works normally but click/activation can reopen during shutdown | T12 |
| FR-04 explicit exit/progress | Shared exit route and progress exist; terminal fallback incomplete | T09, T12 |
| FR-05 bounded verified termination | Partial: major ownership, descendant, admission and deadline defects | T01–T06, T09, T14 |
| FR-06 results/task semantics | Partial: some reconciliation exists; durability, ordering and error-file defects remain | T06–T08 |
| FR-07 platforms/tray/update/OS exit | Partial: wrong OS event target, inadequate Linux detection, packaged evidence missing | T09, T10, T13, T17 |
| FR-08 localization/accessibility | All six lifecycle translation namespaces and component tests exist; real dialog naming/layout checks remain | T16, T17 |
| FR-09 diagnostics/privacy | Reports exist; raw error text and clean-outcome handling remain unsafe/incomplete | T14, T15 |

| Acceptance criterion | Assessment |
| --- | --- |
| AC-01 one dialog/dismiss | Partial; T11 |
| AC-02 hidden work continues | Basic path exists; real work/native host evidence pending, T10/T17 |
| AC-03 restore same session | Implemented ordinary path; shutdown restoration guard missing, T12 |
| AC-04 workers and browsers stop | Fails in reproduced ownership/tree scenarios, T01/T02/T04 |
| AC-05 queued starts/retries blocked | Partial process gates; scheduler/job/slot admission incomplete, T05/T06 |
| AC-06 ignored shutdown bounded | Coordinator tests pass; full-tree, helper and terminal guarantees incomplete, T02/T09 |
| AC-07 unrelated browser/Node survive | Identity checks incomplete; existing observer only uses unrelated `sleep`, T03/T17 |
| AC-08 one cleanup under repeated requests | Existing unit coverage passes; fallback-surface race remains, T11 |
| AC-09 data/interrupted work | Partial, T07/T08 |
| AC-10 inaccessible tray fallback | Constructor failure handled; desktop-name heuristic insufficient, T10/T17 |
| AC-11 updater installs/relaunches | Routes exist; silent handoff failure and packaged evidence outstanding, T09/T17 |
| AC-12 six locales/keyboard | Component suite passes; accessible naming and real layout evidence outstanding, T16/T17 |
| AC-13 renderer-independent exit | Main-owned explicit exit implemented; historical E2E exists, not rerun here |
| AC-14 external observer sees no owned survivors | Test fixture coverage exists; does not cover actual worker/browser trees, T01–T05/T17 |
| AC-15 honest report/clean marker | False-success paths reproduced; persistence/marker problems, T14 |
| AC-16 OS exit without prompts | Windows event wired to wrong object; platform checks outstanding, T13/T17 |

## Detailed TODOs

Priority: P1 = correctness/release blocker; P2 = required hardening, UI correctness or evidence. All boxes below are open.

### T01 — P1: close worker resources before exiting and retain descendant ownership

- [ ] Fix worker shutdown cooperation and wire descendant reporting into production. PRD FR-05, AC-04/14/15; design §§6–8.
- Evidence: `src/childprocess/lib/workerShutdownResponder.ts:95–106` sends an acknowledgement and, without a callback, immediately calls `process.exit(0)`. A source search finds **no production `closeOwnedResources` argument** and no consumer of `isShuttingDown()` outside the helper. For example, `src/childprocess/google-maps/GoogleMapsWorker.ts:825` installs it without closing its live browser; its separate start-message listener remains independent.
- `OwnedProcessRegistry.recordDescendantReport()` has no production caller. `ProcessTreeTerminator.terminateAll()` filters out exited roots. A worker that exits first can therefore orphan its unregistered browser, which will never enter force verification. The generic responder also races the managed-browser supervisor's own graceful close.
- Reproduced with the existing fake process table: register root, create child, mark root observed-exited, terminateAll; child remains alive and `verificationFailures` is empty.
- Required change: wire browser/subprocess closure, stop worker job intake/dequeue, report identities at launch, validate/store them before parent exit, and retain descendants independently. Acknowledge actual cleanup outcome; observe exit separately. Ensure worker shutdown callbacks cannot mask browser-close failures.
- Done when: real scraper/browser tests cover successful close, hanging close, root exits before browser, spawn during shutdown, duplicate requests, and no late worker jobs. Observer must verify browser descendants after Electron exit.

### T02 — P1: terminate and verify the complete transitive process tree

- [ ] Replace direct-child-only force cleanup. PRD FR-05, AC-04/06/14/15; design §8.
- Evidence: `processOps.ts:listChildren()` uses `pgrep -P`; `ProcessTreeTerminator.ts:terminateRecord()` obtains that one-level list, kills the root, and signals those PIDs. It never recursively discovers grandchildren. Windows takes no descendant snapshot and verifies only the root after `taskkill /T`.
- Reproduced: root → browser → browser-renderer, only root registered. Force cleanup kills root/browser, leaves renderer alive, and returns zero verification failures.
- `ShellToolService.ts:261–268` launches detached but does not pass `isolatedProcessGroupId` when registering, so the existing group path is unused there. An already-exited group leader is skipped even if group members remain.
- Required change: capture the complete verified tree before root death, handle reparenting, retain all members, use established isolated groups where applicable, and verify every member on every platform. Discovery failure must not silently mean an empty tree.
- Done when: tests cover 3+ levels, leader-first exit, surviving group member, children spawned during discovery, failed enumeration, and Windows child survival despite root disappearance.

### T03 — P1: enforce identity checks for every process being killed

- [ ] Close PID-reuse and ambiguous-ownership gaps. PRD goal 7/AC-07; design §8.
- Evidence: `OwnedProcessRegistry.verifyIdentity()` can return `unknown`, but the terminator proceeds to signal/taskkill anyway. Windows `readStartTimeIdentity()` always returns null. Discovered children are raw PIDs, not start-identity records, and are signalled after asynchronous discovery/root termination without identity rechecks. The macOS implementation explicitly documents second-granularity identity limitations.
- Required change: establish reliable identities/containment for supported platforms; revalidate descendants before signaling; record ambiguous ownership as incomplete cleanup rather than killing it. Preserve external browser/service exclusions.
- Done when: deterministic PID reuse between discovery and kill never signals the replacement; unknown identities cannot target unrelated processes; packaged tests keep unrelated Chrome and Node alive. This is a normal-exit safety requirement, separate from the optional stronger parent-crash containment decision.

### T04 — P1: resolve pending utility-process PIDs and never discard unverified spawns

- [ ] Wire pending-spawn lifecycle and registration failures. PRD FR-05; design §6.
- Evidence: `ownedSpawn.ts:registerOwnedProcess()` snapshots `process.pid`; `OwnedProcessRegistry.setPid()` has no production caller. Utility-process PIDs may not yet exist before their spawn event. The registry attaches exit only, with no spawn/error resolution.
- `ProcessTreeTerminator.ts` treats a null-PID record whose handle kill fails or is absent as already exited, marks it exited and forgets it without proof. The temporary reproduction confirmed an unresolved record disappears with zero verification failures.
- Registration exceptions are only logged in `ownedSpawn.ts`; no failed-registration record is supplied to the shutdown report despite the comment claiming that coverage.
- Required change: attach spawn/error/exit listeners immediately, resolve identity when PID arrives, account for launches admitted just before freeze, and keep unresolved/unregistered live processes as explicit failures until positively resolved.
- Done when: delayed-PID launch, launch error without exit, kill failure, registration failure, and spawn/freeze races cannot produce a false clean report.

### T05 — P1: cover long-running installer processes currently excluded from ownership

- [ ] Register, gate and cancel skill environment installation; re-audit all exclusions. PRD release criterion and design §2 inventory.
- Evidence: `SkillEnvironmentManager.ts:212–234` uses raw `spawn`; `prepare()` runs `pip install` with `PIP_INSTALL_TIMEOUT_MS = 5 * 60 * 1000` (line 18). It has no lifecycle gate/registry integration. `ownedSpawnWiringGuard.test.ts` excludes the whole file as though its processes were safe one-shots. A five-minute installer is not bounded by the ten-second exit requirement.
- Required change: track venv/pip processes and descendants, cancel them within the shared budget, stop late launches after awaits, and define cleanup of partial environments. Review other allowlisted main-process launchers individually with tested reasons; import strings/file-level regex matches do not prove every launch is covered.
- Done when: exit during actual installation leaves no owned installer/subprocess and no usable-but-partial environment; runtime exclusion tests and launch inventory match code.

### T06 — P1: freeze task admission and queue dispatch synchronously

- [ ] Implement actual participant freeze and queued-acquisition cancellation. PRD FR-05/06, AC-05; design §§5–6/11.
- Evidence: all participant `freeze()` methods in `ShutdownParticipants.ts` are no-ops. `ScheduleManager.handleAppShutdown():553` awaits persistence before stopping dispatch. `WorkerCoordinator.acquireBrowserSlot()/releaseBrowserSlot()` have no shutdown mode and release queued waiters normally. `ToolJobRegistry.start()` accepts jobs after `shutdown()` because shutdown clears state without setting a closed flag. Generic IPC wrappers have no lifecycle admission check.
- Spawn gating prevents some new processes, but not new remote work, queue claims, dispatch to existing workers, or side effects performed before reaching a spawn wrapper. Worker `isShuttingDown()` is unused (T01).
- Required change: synchronous freeze of initialized schedulers/job registries, typed cancellation of queued slot waits, work-admission checks on actual task entry paths, and shutdown checks after async waits. Retain AI-enable-first behavior on AI IPC handlers.
- Done when: accepting exit blocks starts, retries, slot transfers, existing-worker dispatch and remote work in the same tick; queued durable work keeps its documented restart policy.

### T07 — P1: order final result draining, reconciliation and database closure

- [ ] Implement the design's persistence barrier and resource finalization. PRD FR-06/AC-09; design §§5/11.
- Evidence: coordinator runs all stop methods concurrently. Contact/search/bulk/social reconciliation runs while worker shutdown and result handlers can still modify those rows. There is no tracked in-flight result drain, explicit result-ingestion barrier, or DB-close participant. Abort occurs only after finalization, and most adapters ignore the signal. Timed-out stop promises can continue writing into later phases.
- Required change: freeze dispatch; accept/drain final results; stop/verify workers; settle active task outcomes with conditional updates; stop ingestion; drain accepted writes and close initialized databases/connections within the remaining budget. Report undrained work as incomplete. Do not instantiate unused modules/singletons solely for shutdown (current participants call constructing getters and create modules even on early/no-user exits).
- Done when: late completion versus interruption race preserves completed results, writes cannot continue past the barrier, timed-out adapters respect cancellation, and logout/early startup closes only initialized resources.

### T08 — P1: repair bulk-email interruption storage and durable social outcomes

- [ ] Correct the newly added task reconciliation. PRD FR-06/AC-09; design §11.
- Evidence: `durableTaskReconciliation.ts:reconcileBulkEmailAtExit()` passes `[interrupted] ...` to `updateTaskErrorFile()`. `BuckEmailTask.model.ts:82` stores that string into `entity.error_file`, a **file-path field**, replacing the previous log path. The normal sender passes an actual `errorLogfile` path. No interruption file is written by reconciliation.
- `socialtask.ts:277–298` only reads the run ID, removes an in-memory entry, and writes `log.info`; it does not persist a task-run interruption/uncertainty state. The generic `reconcileSocialAtExit()` helper with `markRunInterrupted()` is not the production social path. Entries can also be removed by child exit before the concurrent reconcile reaches them.
- Both helpers swallow persistence failures; bulk reconciliation returns all selected IDs even if writes failed. The coordinator therefore cannot accurately report failed task finalization. The bulk update is not conditioned on the row still being Processing when written.
- Required change: append interruption/uncertainty to the actual log or a supported durable field, preserve existing log paths, persist social outcomes in the Model/Module layers, return truthful results, and protect completed rows against concurrent reconciliation. Avoid database-business logic in communication-layer helpers. Migrate schemas/consumers explicitly if no supported state exists.
- Done when: restart exposes uncertainty correctly, existing logs remain accessible, completed work is unchanged, failed writes make shutdown incomplete, and uncertain email/post operations are not automatically retried. Tests must exercise production adapters and real persistence, not just generic fake interfaces.

### T09 — P1: enforce the deadline through terminal exit and updater handoff

- [ ] Add a bounded last-resort terminal fallback and deadline-aware adapters. PRD FR-05/07; design §§5/8/12.
- Evidence: `background.ts:runTerminalExitSequence()` calls `app.quit()` or returns immediately after the updater callback; it has no watchdog for a quit prevented by a window/unload handler or an updater callback that returns without quitting. Only thrown updater errors fall back. Startup-specific forced-exit logic is not a normal-exit watchdog.
- `ShutdownCoordinator.ts:runWithBudget()` explicitly `unref()`s deadline timers contrary to the design; pending promises do not themselves keep Node alive. `processOps.ts` helper invocations have no timeout/abort, and the terminator receives the global remaining budget while the coordinator stops waiting at the earlier force-phase cap. Timed-out helper work continues.
- Required change: keep one referenced monotonic deadline through terminal handoff; bound and cancel process helpers; prevent late force work racing finalization; persist incomplete outcome and call the deliberate final fallback if normal quit/install does not terminate. Respect shorter OS deadlines.
- Done when: hanging helper, beforeunload cancellation, rejected/hanging participant, thrown updater handoff and silent updater non-exit all terminate within the supported budget without false clean reports or repeated cleanup.

### T10 — P1: establish a usable Linux tray host before hiding

- [ ] Replace the desktop-name heuristic with reliable support gating. PRD FR-07/AC-10; design §9.
- Evidence: `TrayController.ts:isLinuxTrayHostPlausible()` returns true whenever `XDG_CURRENT_DESKTOP` is nonempty and the session is not tty. This does not establish a tray host; for example, a GNOME session can have a desktop name without a working tray extension. Successful Tray construction is explicitly insufficient under the design.
- Required change: verify supported host availability or conservatively disable background mode for unverified environments; account for host loss before hiding. Keep Exit/Cancel and the main window accessible.
- Done when: supported Linux desktops with and without tray hosting are tested; no host cannot lead to an unreachable hidden app. Record Windows/macOS icon/menu appearance too (T17).

### T11 — P2: invalidate renderer choice before native fallback takes ownership

- [ ] Fix the renderer/native dialog race. PRD FR-01/AC-01/08; design §9.
- Evidence: `CloseChoiceFlow.ts:runNativeFallback()` keeps the original renderer token live while awaiting the native result and explicitly lets concurrent renderer responses win. A renderer that resumes just after the two-second timeout can open its queued Vue dialog while the native dialog is active. A stale Vue surface can remain after native dismissal.
- Required change: separate native-flow ownership, invalidate renderer token before opening native UI, dismiss/ignore delayed renderer requests, and prevent late acknowledgements/submissions from affecting the native decision. Recover flow state when send/submit IPC fails.
- Done when: delay renderer delivery/ack beyond the timeout; exactly one actionable surface exists, and late renderer replies cannot hide/exit or leave a stuck dialog.

### T12 — P2: block every restore/activation path after exit acceptance

- [ ] Guard tray click, activation and second-instance restoration. PRD FR-03/04; design §4.
- Evidence: `TrayController.clickHandler` calls `restore()`, which checks only `destroyed`, not `exiting`. `background.ts:showMainWindowFromTray()` calls `win.show()/focus()` even when lifecycle restoration returns false because shutdown started. `activate` and `onSecondInstanceActivate` also lack a quitting guard and can recreate a window.
- Required change: reject all restoration/recreation once quitting, including direct click and second-instance paths; disable menu actions visibly as appropriate.
- Done when: exit from hidden state plus tray click, dock activation, second launch and missing-window activation neither shows nor creates a window and does not restart initialization.

### T13 — P1: attach Windows session-end events to the correct Electron object

- [ ] Replace the ineffective OS shutdown wiring. PRD FR-07/AC-16; design §4.
- Evidence: `background.ts:1525–1532` casts `app` to a generic event emitter and attaches `session-end`. The installed `node_modules/electron/electron.d.ts` declares `query-session-end`/`session-end` on BaseWindow/BrowserWindow (e.g. lines 2342/2439 and 4604/4821), not App. The cast conceals the invalid API usage.
- Required change: wire supported window session-end events during window creation; set OS-shutdown intent before ordinary close handling, bypass interactive dialogs, and use best-effort OS-appropriate cleanup. Assess macOS/Linux mechanisms separately rather than assuming this Windows hook covers them.
- Done when: tests emit the correct window events and native logout/restart checks confirm no close-choice prompt and no avoidable process leftovers. Do not label this as merely missing manual evidence: the existing Windows listener is wrong.

### T14 — P1: make cleanup reports and startup markers reflect failures

- [ ] Remove false-success paths and persist an explicit incomplete outcome. PRD FR-09/AC-15; design §11.
- Evidence: a thrown participant provider in `ShutdownCoordinator.run()` is logged but leaves an empty participant list and can return `clean:true`. The temporary reproduction confirmed this. Unresolved spawns and missing descendants also yield zero verification failures (T01/T02/T04).
- `ShutdownParticipants.ts:reportSinkAdapter()` unconditionally clears the startup marker despite its “only on verified clean” comment; `background.ts:will-quit` clears it again. `appendShutdownReport()` swallows persistence errors, so the caller can remove the marker even when no durable report exists. No reader of `shutdown-reports.jsonl` was found in startup handling.
- Required change: make setup/registration/finalization failures affect the outcome, report persistence success explicitly, and preserve either a clean marker transition or a durable forced/incomplete marker consumed on startup. Missing reports must not masquerade as clean termination.
- Done when: failing provider, report-write denial, incomplete worker verification and task-write failure cannot produce a clean outcome; next startup distinguishes clean, forced/incomplete and abnormal termination.

### T15 — P2: sanitize shutdown diagnostic errors by construction

- [ ] Stop serializing arbitrary exception messages into shutdown reports. PRD FR-09.
- Evidence: `ShutdownCoordinator.describeError()` retains `Error.message`, applying truncation and a path regex only. Messages containing tokens, command arguments, URLs with credentials, environment values or scraped text remain possible. Force-hook `verificationFailures` are not passed through this sanitizer, and `ShutdownReportWriter` serializes the report as supplied.
- Required change: use allowlisted error codes/categories and safe structured metadata; redact at the report boundary as defense in depth. Keep attempt ID, reason, phase timings, categories, forced count and verification status.
- Done when: sentinel credentials, arguments, content, Windows paths and URLs injected into participant/terminator failures never appear in the persisted report.

### T16 — P2: finish real-dialog accessibility and long-translation checks

- [ ] Give the actual dialog an accessible name and verify keyboard/layout behavior with real Vuetify rendering. PRD FR-08/AC-12.
- Evidence: `ApplicationCloseDialog.vue` uses `aria-role="dialog"` on its card (invalid ARIA attribute), while the outer `v-dialog` is not connected to the existing title ID with `aria-labelledby`. Its three actions occupy a single row in a 520px dialog; translated layout has no recorded visual evidence.
- Required change: label the actual dialog container correctly, remove invalid semantics, verify focus entry/trap/return and Escape, and allow long action labels to fit. Verify progress remains visible and understandable after renderer remount/state synchronization.
- Done when: accessibility-tree/keyboard tests and six-language checks pass, including German/French long labels and unavailable-tray fallback. Add/update UI tests with the fix.

### T17 — P2 release gate: replace fixture-only and stale claims with complete acceptance evidence

- [ ] Complete the release matrix and reconcile documentation. PRD §§1/7/8, AC-01–16; design §§13–15.
- Existing observer spawns a heartbeat fixture and unrelated `sleep`; it neither exercises an actual browser family nor checks unrelated Chrome and Node. It probes PIDs without start identities, and its idle timing assertion allows ten seconds although the idle target is two. The hidden test's heartbeat is not evidence of application result persistence or essential scheduling during a real task.
- Required evidence: actual scraper/worker/browser families, ignored graceful stop, multiple descendants, pending launch/freeze race, external process survival, interrupted/uncertain task persistence, representative hidden task for at least 60 seconds, and externally observed process identities after exit.
- Record dated packaged Windows/macOS/supported Linux results: native tray restoration/failure, real manual and automatic updater install/relaunch including hidden state, OS logout without prompts, idle ≤2s/busy ≤10s, six-language keyboard/layout checks. Keep explicit parent-crash containment limitations; Job Objects are a design decision, not proof of controlled-exit coverage.
- Original defect: capture the reported leftover family/PID/start identity/build with before/after evidence, or explicitly leave the original ticket unverified. Do not call it fixed based on a heartbeat fixture.
- Update inventory, earlier TODO closed headings and release evidence. Remove “code-complete”/“every automatable gate green” claims until the runtime gaps above are fixed and current required suites pass. Run full main-process, component, Electron E2E and applicable worker/service suites after fixes; source-scan allowlists are not substitutes for process tests.

## Suggested implementation order

1. Fix ownership, worker cleanup, transitive termination and identity safety (T01–T05).
2. Freeze admission and implement ordered durable finalization (T06–T08).
3. Enforce terminal deadlines, honest reports and privacy (T09/T14/T15).
4. Correct OS events and tray/dialog restoration behavior (T10–T13/T16).
5. Execute the packaged acceptance matrix and update all claims (T17).

Keep reliable shutdown enabled if the optional tray experience must be disabled. Each fix should include the listed behavioral regression coverage and a separate logical commit under repository policy.
