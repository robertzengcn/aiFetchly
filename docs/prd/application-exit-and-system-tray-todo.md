# Application Exit and System Tray — Remaining Work

| Field | Value |
| --- | --- |
| Status | Code-complete vs PRD 1.0 (2026-09-21 close-out); packaged/OS manual matrix (task 1) + leftover-ticket close-out (task 2) remain |
| Date | 2026-09-20 |
| Worktree | `.claude/worktrees/app-exit-system-tray` |
| Branch | `worktree-app-exit-system-tray` |
| Audited HEAD | `8896112f` plus **uncommitted** worker-responder WIP |
| Product requirements | [PRD](application-exit-and-system-tray-prd.md) |
| Technical design | [Technical design](application-exit-and-system-tray-technical-design.md) |
| Launch inventory | [Inventory](application-exit-and-system-tray-inventory.md) |
| Evidence log | [Release evidence](application-exit-and-system-tray-release-evidence.md) |

This file lists work that is **still not complete** relative to the PRD. Already on the branch and **not** re-opened here: close-choice dialog, tray hide/restore, coordinated 10s shutdown, spawn gate + registry for inventoried families, contact-extraction lazy-spawn gate, parent-side section-7 broadcast, search + contact at-exit reconcile, YP active-process Paused on terminate, six-language keys, observer/hidden-mode E2E, `hooks-command` inventory row, inventory FR-06 table refresh for search/YP (`8896112f`).

**Release bar (PRD section 8):** claim complete exit cleanup only when every process-spawning family is registered or has a documented, tested exclusion, **and** AC-01 through AC-16 have recorded evidence, including packaged verification on release targets.

Uncommitted in this worktree at audit time (do not treat as finished until committed + tested):

- `src/childprocess/websiteContentScraper.ts`
- `src/childprocess/googleProxyCheck.ts`
- `src/childprocess/hook-execution/HookExecutionWorker.ts`
- `src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts`
- `src/taskCode.ts`

Those files add the shared `workerShutdownResponder` but **do not** pass `closeOwnedResources`. They shrink the “no listener” set; they do not close Puppeteer/browser descendants.

---

## 1. Packaged / OS evidence matrix (FR-07, AC-10, AC-11, AC-12 visual, AC-16, PRD section 7)

### Why incomplete

Code exists for tray-create failure (window stays visible), Linux `isLinuxTrayHostPlausible`, `session-end` skipping the close dialog, and automatic updater `notifyUser: false` then `update-restart`.

The PRD does not treat that as done. Sections 7–8 require **recorded evidence** on packaged builds and real desktops. [application-exit-and-system-tray-release-evidence.md](application-exit-and-system-tray-release-evidence.md) still marks every packaged cell **PENDING**.

| Check | Why it is still open |
| --- | --- |
| Tray usable; Keep-running available (Windows / macOS / Linux desktop) | xvfb E2E with `AIFETCHLY_E2E_TRAY=1` is not a real notification-area / menu-bar. WSL2 cannot produce Windows or macOS tray evidence. Linux needs a session where the tray icon is actually reachable, not only that `Tray` constructed. |
| Updater restart including from hidden (AC-11) | Feed + app-owned prompt are coded. `quitAndInstall` after cleanup has **not** been run on a packaged GitHub build, including Exit-from-tray / hidden window then install/relaunch. Linux is n/a for this updater. |
| OS logout / shutdown avoids prompts (AC-16) | `app.on("session-end")` is wired. There is no Windows session-end (or macOS/Linux equivalent) run proving the dialog does not appear and cleanup is best-effort under OS deadlines. |
| Long-translation layout (de / fr / ja) | Keys and parity tests exist. Clipping of Keep-running / Exit / native fallback / tray labels on packaged UI was not visually checked. |
| Packaged idle ≤2 s / busy ≤10 s | Dev+E2E idle ~127–145 ms and busy ~156–197 ms are inside budget. The PRD requires packaged numbers **separate** from development/watch processes. |

Until those cells are filled, **do not claim AC-10, AC-11, AC-12 visual, or AC-16 verified on release targets.**

### Done looks like

A dated matrix (machine, OS, build artifact) with pass/fail for each cell. Failures get a fix or an explicit “not supported on this desktop” gate matching FR-07.

---

## 2. Original leftover-process defect (PRD sections 1 and 8.1)

### Why incomplete

The PRD says leftover processes after close must be **identified and reproduced** before claiming the defect is fixed.

What exists: could-not-reproduce on Linux/WSL2; plausible mechanism (previously unregistered families); observer E2E on an owned **test fixture** vs unrelated `sleep`.

What does **not** exist: PID / image / parent of the **user-reported** leftover; a packaged before/after observer for that family (scraper Chrome, utility process, etc.).

Fixture E2E is not a substitute for the original identity. The evidence file correctly says the original ticket is **not claimed fixed**. Keep it that way until reproduction or a signed packaged close-out.

### Done looks like

1. Reproduced leftover: named family, observer before Exit, gone after the budget, recorded in the inventory; **or**
2. Formal close-out that the original ticket stays **unverified**, with capture steps (`ps` / Process Explorer), and **no** release language that “the leftover bug is fixed.”

---

## 3. Worker-side graceful shutdown — CLOSED (code): §7 responder at EVERY real worker entry point

### Why incomplete

**Parent side is done:** `workerShutdownProtocol` + `worker-graceful-protocol` participant broadcasts `{type:"shutdown", requestId, reason, remainingMs}` to every live registered handle (`postMessage` / `send`). Ack is not exit proof; force-and-verify still runs.

**Worker-side `workerShutdownResponder` (committed):** SkillWorker, PythonRuntimeWorker, LocalEmbeddingWorker, AiChatVoiceWorker, RuntimeProbeWorker, GoogleMapsWorker, YandexMapsWorker, YellowPagesScraperProcess.

**Contact extraction:** custom section-7 handler in `ContactExtractionWorker` (ack + `gracefulShutdown`), not the shared helper — acceptable if it still closes owned browsers.

**Uncommitted WIP (listener only, no `closeOwnedResources`):** websiteContentScraper, googleProxyCheck, HookExecutionWorker, WorkspaceConfigWatchWorker, `taskCode.ts`.

**Still no shutdown listener (ignore the parent message, then force-kill):**

| Entry | Why it matters |
| --- | --- |
| `googleScraper.ts`, `bingScraper.ts`, `baiduScraper.ts` | Typical Puppeteer scrapers; leftover Chrome is the original defect class |
| `emailSearch.ts`, `emailScraper.ts`, `emailSend.ts`, `emailCluster.ts` | Search/send workers; emailSend is an in-flight side effect |
| `scrapeManager.ts`, `YellowPagesScraper.ts` (non-Process entry) | Alternate scrape entries |
| `managed-browser/index.ts`, `managed-browser-cache/index.ts` | Browser sessions / cache worker; supervisor stop is separate from worker protocol |
| Outbound-email worker entry (if not `emailSend.ts`) | Mid-SMTP uncertainty |

`closeOwnedResources` is **only defined** on the shared helper. **No production worker passes it.** FR-05 requires graceful worker/**browser** shutdown, then force. Design section 7: browser disconnect is not termination; workers must close instances and report descendant identity. Without that, force-phase tree-kill only sees descendants that are still discoverable as children of the worker PID. Reparented Chrome is the leak.

### Done looks like

Each scraper/browser worker:

1. Parses the section-7 request (shared responder or equivalent).
2. Sets a closing flag and stops new jobs.
3. Closes owned browsers/subprocesses via `closeOwnedResources`.
4. Reports descendant identity (or isolated pgid / job) so force-verify can see them.
5. Acks and exits within the parent allowance.

Tests: graceful close; ignored shutdown still force-killed in budget; ack-without-exit; no restart after freeze.

Until then, **do not claim complete browser-descendant cleanup.** Commit the WIP listeners, then add `closeOwnedResources` on Puppeteer owners — listeners alone are not this task.

---

## 4. At-exit mapping for social + bulk-email — CLOSED (code): durable-tasks participant (bulk-email → Error + [interrupted] note; social live-run registry → marker); tests in durableTaskReconciliation.test.ts

### Why incomplete

PRD: keep completed results; stop claiming queued work after Exit begins; map **running** work to an existing cancelled/interrupted state **at exit**; do not mark interrupted work successful or auto-retry uncertain email/social ops.

Now at Exit:

- Contact extraction → `failed` + reason (before worker stop).
- Search → `Error` + interruption log + PID clear (`reconcileInterruptedTasks`).
- Yellow Pages **active** processes → `Paused` + PID clear via `terminateProcess` if `kill()` succeeds. Queued-not-started and dropped-handle rows still wait for next-startup `handleTasksFromPreviousSession`.

Still missing a shutdown-participant reconcile:

| Subsystem | Gap |
| --- | --- |
| Social tasks (`socialtask`) | No `reconcileInterrupted*` at Exit. Inventory now says “see the reconcile rows added with the social participant” — **there is no social participant** in `ShutdownParticipants.ts`. Mid-post can remain “running.” |
| Bulk email (`buckEmailTaskModule`) | Worker is registry-killed; send logs may show per-recipient state. No at-exit pass that marks in-flight sends uncertain vs not-sent. Blind retry is avoided only because batches are user-initiated. |

### Done looks like

- At-exit reconcile for social taskruns and in-flight bulk-email rows, using **existing** statuses (no new schema unless a reviewed migration).
- Completed rows never flipped to success.
- Uncertain SMTP/publish recorded as uncertain/not-sent, never auto-retried.
- Inventory social row matches code (remove the fictional social participant).
- Tests mirroring `SearchModuleReconciliation.test.ts`.

---

## 5. Windows Job Objects / parent-crash containment (design section 8) — accepted limitation

### Why this stays on the list

Shipping **without** Job Objects was accepted:

- Windows: `taskkill /PID /T /F` + start-time identity + verified exit.
- POSIX: isolated pgid when the owner created one; otherwise descendant walk + SIGKILL.

Design section 8 treated containment as a required milestone. `taskkill /T` is not kill-on-close / parent-crash containment. The PRD: if a family cannot be safely terminated, do not claim complete cleanup.

Open work is **product language**, unless the decision is reversed:

- Inventory, evidence, and any “clean exit” claim must keep: complete-cleanup **excludes** parent-crash containment.
- If that is unacceptable, implement a maintained Job Object (or equivalent) and test utility processes + packaging.

### Done looks like

Keep the written exclusion everywhere “clean exit” is claimed, **or** implement and package Job Objects with process-family tests.

---

## 6. Documentation drift + WIP — CLOSED: inventory FR-06 rows match the code; responder WIP committed (see commits)

### Why incomplete

The five uncommitted child-process files install the shared responder without `closeOwnedResources` and without tests in this WIP. Leaving them uncommitted means HEAD still has those workers deaf to shutdown. Committing them without browser close would look like section-7 “done” while FR-05 browsers remain open.

### Done looks like

Commit the listeners **with** tests (parse shutdown, set closing flag, exit), **or** revert if they are not ready. Then continue task 3 for Puppeteer owners. Do not mix “listener added” with “browsers closed” in the inventory.

---

## Tests still missing for open items

| Gap | Tied to |
| --- | --- |
| Packaged tray on real Win / macOS / Linux desktop | Task 1 / AC-10 |
| Packaged updater install/relaunch, including hidden | Task 1 / AC-11 |
| OS session-end: no close dialog | Task 1 / AC-16 |
| Packaged idle/busy timings | Task 1 / PRD section 7 |
| Visual long-string pass (de/fr/ja) | Task 1 / AC-12 |
| `closeOwnedResources` on a real scraper family; ignored shutdown; ack without exit | Task 3 |
| At-exit mapping for social or bulk-email | Task 4 / AC-09 |
| Recurrence capture if the original leftover returns | Task 2 |
| Tests for the five uncommitted responder installs | Task 6 |

---

## Suggested order

1. Decide on the five uncommitted responder files: commit with tests, or revert (task 6).
2. Add `closeOwnedResources` (and descendant reporting) on google/bing/email/managed-browser scrapers (task 3).
3. At-exit reconcile for social and bulk-email; fix the inventory social row (task 4).
4. Keep Job Objects as an explicit non-claim (task 5) unless product reverses it.
5. Record the packaged/OS matrix on real machines (task 1).
6. Leave the original leftover ticket **unfixed** until a real leftover is captured (task 2).

Shutdown repair should stay enabled even if the optional tray experience needs rollback (PRD section 8).
