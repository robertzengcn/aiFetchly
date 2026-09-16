# Application Exit and System Tray — Remaining Work

| Field | Value |
| --- | --- |
| Status | Incomplete vs PRD 1.0 |
| Date | 2026-09-16 |
| Worktree | `.claude/worktrees/app-exit-system-tray` |
| Branch | `worktree-app-exit-system-tray` |
| Basis | Source audit of PRD + technical design against this worktree (including uncommitted WIP) |
| Product requirements | [PRD](application-exit-and-system-tray-prd.md) |
| Technical design | [Technical design](application-exit-and-system-tray-technical-design.md) |

This file lists work that is **not complete** relative to the PRD release bar. The lifecycle core (close-choice dialog, tray hide/restore, coordinated shutdown, 10-second budget, local shutdown reports, six-language strings, unit/component/E2E slice) is already in the worktree and is **not** re-listed here.

**Release bar (PRD section 8):** claim complete exit cleanup only when every process-spawning family is registered or has a documented, tested exclusion, and AC-01 through AC-16 have recorded evidence.

---

## Blocking — must finish before claiming the PRD

### 1. Inventory and reproduce leftover processes (PRD sections 1 and 8.1; design WP1)

- **Why incomplete:** The PRD forbids claiming the original leftover-process defect is fixed until process identity is captured and the issue is reproduced. This worktree has no recorded leftover PID/family, no launch-site inventory table with owner/transport/cleanup adapter/test, and no characterization of the user-reported leftovers.
- **Done looks like:** A written inventory of every spawn / fork / exec / utilityProcess.fork / Puppeteer launch/connect site; a reproduced leftover case (or a documented could-not-reproduce with observer evidence); each family marked registered or excluded with a test.

### 2. Register every owned process family (FR-05, AC-04, AC-14; design sections 2, 6, WP3)

- **Why incomplete:** Production OwnedProcessRegistry.register() is used only by contact extraction (src/main-process/communication/contactExtraction-ipc.ts). Force-and-verify only sees registered PIDs. Unregistered workers (maps, search, email, MCP, shell/hooks, skill/Python/embedding/voice, installers/downloads, Google/Yandex maps, socialtask, WebsiteAnalysisQueue, WebsiteContentScrapeService, buckEmailTaskModule, proxy controller, etc.) can outlive Exit.
- **Done looks like:** Every spawn family registers immediately on successful launch (including pending-spawn before PID exists), reports descendants, and is covered by a process-family test — or has a documented, tested exclusion.

### 3. Adopt the spawn gate on every launcher (FR-05, AC-05)

- **Why incomplete:** isSpawnAllowed / assertSpawnAllowed exist, but only the contact-extraction spawn + crash-restart path consults them. spawnGate.ts (WIP comment) admits Yellow Pages, workspace watch, MCP, and tool-job workers still rely on the force phase. After Exit begins, those families can still start, retry, or restart work.
- **Done looks like:** Every process-spawning site refuses new work once quitting is set; tests prove queued starts, retries, and worker restarts are blocked at shutdown entry.

### 4. Persist interrupted / uncertain task outcomes (FR-06, AC-09; design section 11, WP4)

- **Why incomplete:** There is no per-subsystem mapping of queued, running, completed, cancelled, and uncertain outcomes. Lifecycle participants stop owners; they do not reconcile task rows. External side effects (email send, social post) have no do-not-blindly-retry-on-restart adapter in this feature.
- **Done looks like:** Explicit mapping per subsystem; completed results kept; running work mapped to an existing cancelled/interrupted state (new schema only with migration); uncertain external ops recorded and not auto-retried.

### 5. Route automatic updater restart through cleanup (FR-07, AC-11; design section 12)

- **Why incomplete:** ManualUpdateService.quitAndInstall() is routed through the lifecycle port. AppUpdateService still leaves discovery, download, and the restart prompt inside update-electron-app. An automatic restart can skip coordinated cleanup or convert to ordinary quit/background mode. No packaged test of update-from-hidden.
- **Done looks like:** Automatic restart uses the same terminal intent (update-restart) and cleanup promise; hidden-state update still installs/relaunches; packaged evidence on supported targets.

### 6. Independent observer of app-owned workers/browsers after Exit (AC-14; PRD section 7)

- **Why incomplete:** ProcessTreeTerminator Linux integration kills a synthetic sleep tree and probes with kill(pid,0). That is not an observer of AiFetchly-owned scraper/browser/utility-process identities after a real application exit. Packaged vs development-server processes are not separated in evidence.
- **Done looks like:** An observer process that outlives Electron, records owned worker/browser identities before Exit, asserts they are gone after the budget, and asserts unrelated Chrome/Node fixtures survive (AC-07).

---

## Functional / acceptance gaps

### 7. Windows Job Objects and spawn-time process groups (design section 8)

- **Why incomplete:** Terminator uses taskkill /PID /T /F on Windows and optional isolated pgid on POSIX. Real app spawn sites do not create Job Objects or isolated groups. Design treats containment choice as a required milestone; taskkill /T is not a parent-crash guarantee.
- **Done looks like:** Chosen containment is implemented, packaged, and tested per family — or explicitly documented as a remaining limitation so complete-cleanup is not claimed.

### 8. Worker shutdown protocol on all transports (design section 7)

- **Why incomplete:** Design requires a validated shutdown message (type, requestId, reason, remainingMs) per existing transport. Contact extraction still shuts down via SIGTERM/SIGINT, not that IPC. Other workers were not adapted.
- **Done looks like:** Each worker family rejects new jobs, closes owned browsers/subprocesses, sends final results, acks, and exits within the parent allowance; parent still observes process death.

### 9. Linux / desktop tray host gating (FR-07, AC-10)

- **Why incomplete:** Background mode is disabled if tray construction fails, and E2E disables tray unless AIFETCHLY_E2E_TRAY=1. There is no explicit check for desktops where a tray object exists but is not usable (PRD: explicit platform checks and packaged manual tests).
- **Done looks like:** Known-unsupported environments keep Keep-running disabled; packaged manual checks on Windows, macOS, and supported Linux desktops.

### 10. Tray exiting state while hidden (FR-04)

- **Why incomplete:** Progress overlay lives in the renderer. Hidden windows are not reopened (correct). Tray tooltip/menu is not updated to an exiting state, so a user who Exit-from-tray has no tray-level Exiting affordance.
- **Done looks like:** Where the platform supports it, tooltip/menu shows exiting and restore/task-start stay disabled until termination.

### 11. OS logout / shutdown evidence (AC-16)

- **Why incomplete:** app session-end starts coordinated exit without the close-choice dialog. There is no OS automation or packaged manual record that logout/shutdown avoids prompts and does best-effort cleanup under OS deadlines.
- **Done looks like:** Recorded check on Windows session-end (and macOS/Linux equivalents if available); abnormal kill documented as outside normal-exit guarantees.

### 12. Hidden-mode representative task (PRD section 7 quality target)

- **Why incomplete:** E2E hide/restore does not keep a real task running for at least one minute, producing results, then restore and Exit.
- **Done looks like:** A hidden-mode test (or packaged manual) with a representative scraper/tool job that continues at least one minute, writes results, restores, then exits cleanly.

### 13. Timing targets (PRD section 7)

- **Why incomplete:** Idle exit within two seconds and busy exit within ten seconds on reference machines are not measured. Design deadline is ten seconds in code; product targets are unverified, especially packaged vs local development.
- **Done looks like:** Measured idle/busy runs on supported machines; packaged numbers recorded separately from watch processes.

### 14. Full six-language + keyboard UI pass (FR-08, AC-12)

- **Why incomplete:** Keys exist in en/zh/es/fr/de/ja and there are component/i18n-parity tests. There is no recorded keyboard/focus/long-translation layout pass across all six languages.
- **Done looks like:** UI checks for dialog, native fallback, tray labels, progress text; Escape/cancel does not Exit; focus restoration; long German/French strings do not clip actions.

---

## Tests still required by the PRD / design section 13

| Gap | Reason |
| --- | --- |
| Task persistence tests (late drain, interrupted mapping, no blind retry) | AC-09 / FR-06 not implemented, so no tests |
| Packaged updater restart (manual + automatic, including hidden) | AC-11 |
| Packaged tray / OS session-end matrix | AC-10, AC-16, design WP6 |
| Process-observer after real app Exit; unrelated process survival | AC-07, AC-14 |
| Worker adapter: graceful close, ignored shutdown, ack-without-exit, no restart | Design section 13; only contact-extraction SIGTERM path exists |
| Registry: spawn during freeze on real launch sites | AC-05 only gated for contact extraction |
| testmain / test:components / test:e2e recorded green on this branch | Audit was source-only; no completion gate run attached to this file |

---

## Uncommitted WIP on this worktree (do not treat as finished)

At audit time git status showed uncommitted edits in lifecycle, dialog, i18n, ToolJobRegistry.getActiveJobCount(), spawn-gate comments, and tests. Finish or revert that slice before treating the branch as a complete unit.

---

## Suggested order

1. Launch inventory + leftover reproduction (task 1)
2. Register families + spawn gate (tasks 2-3)
3. Worker shutdown messages + containment (tasks 7-8)
4. Task-state finalization (task 4)
5. Updater automatic path (task 5)
6. Observer + packaged platform/updater/tray evidence (tasks 6, 9-14)

Shutdown repair should stay enabled even if the optional tray experience needs rollback (PRD section 8).
