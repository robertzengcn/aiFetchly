# Application Exit and System Tray — Remaining Work

| Field | Value |
| --- | --- |
| Status | Remaining vs PRD 1.0 after 2026-09-19 re-audit |
| Date | 2026-09-19 |
| Worktree | `.claude/worktrees/app-exit-system-tray` |
| Branch | `worktree-app-exit-system-tray` |
| Audited HEAD | `cd3a8ee6` (working tree clean) |
| Product requirements | [PRD](application-exit-and-system-tray-prd.md) |
| Technical design | [Technical design](application-exit-and-system-tray-technical-design.md) |
| Launch inventory | [Inventory](application-exit-and-system-tray-inventory.md) |

This file lists work that is **still not complete** relative to the PRD release bar. Close-choice, tray hide/restore, coordinated 10s shutdown, spawn registration for the inventoried families, local shutdown reports, six-language keys, observer/hidden-mode E2E, and automatic-updater *code* routing are already in the branch and are **not** re-listed as open tasks.

**Release bar (PRD section 8):** claim complete exit cleanup only when every process-spawning family is registered or has a documented, tested exclusion, and AC-01 through AC-16 have recorded evidence (including packaged verification on release targets).

---

## Blocking — do not claim the PRD until these are done

### 1. Packaged / OS evidence matrix (FR-07, AC-10, AC-11, AC-12 visual, AC-16, PRD section 7)

- **Why incomplete:** Code exists for tray fallback, Linux desktop gating, `session-end` without the close dialog, and automatic updater (`notifyUser: false` then `update-restart`). There is **no recorded packaged run** on Windows, macOS, or supported Linux desktops for: tray usability, update-from-hidden install/relaunch, OS logout/shutdown avoiding prompts, long-translation layout, or packaged idle/busy timings. The PRD treats that evidence as a release criterion, not as optional follow-up.
- **Done looks like:** A written matrix (pass/fail + date + build) for packaged Win/macOS/Linux tray, updater restart including hidden state, OS session-end, and packaged idle (<=2s) / busy (<=10s) timings.

### 2. Reproduce or formally close the original leftover-process defect (PRD sections 1 and 8.1)

- **Why incomplete:** The inventory records that the user-reported leftover was **not reproduced** on Linux/WSL2. Observer E2E (owned fixture dies, unrelated process survives) is not the same as capturing the original leftover identity. The PRD forbids claiming that original defect is fixed without reproduction or a documented could-not-reproduce with process identity.
- **Done looks like:** A reproduced leftover family with before/after observer evidence, **or** an explicit “could not reproduce” signed off against named process families and packaged builds — without claiming the original ticket is fixed.

### 3. Gate contact-extraction lazy spawn (AC-05)

- **Why incomplete:** Crash-restart checks `isSpawnAllowed`. `spawnWorker()` / `ensureWorkerStarted()` do **not**. IPC can still start a worker after Exit has begun. `ownedSpawnWiringGuard.test.ts` allowlists `contactExtraction-ipc.ts`, so this hole will not fail that guard.
- **Done looks like:** `ownedSpawnAllowed` / `isSpawnAllowed` before every contact-extraction spawn (lazy init and restart); wiring-guard allowlist removed for this file; a test that quitting refuses a new extraction worker.

---

## Functional / design gaps (honest incomplete claims)

### 4. Worker shutdown protocol on remaining transports (design section 7, FR-05 graceful stop)

- **Why incomplete:** Contact extraction is the reference implementation (`type`, `requestId`, `reason`, `remainingMs`, ack, then observed exit). Other registered families are force-killed via the registry. They do not get the validated shutdown message. Worker-side Puppeteer browsers are a documented residual leak until those workers report descendants.
- **Done looks like:** Each worker family rejects new jobs, closes owned browsers/subprocesses, acks, and exits within the parent allowance; parent still observes process death; descendant reporting from scraper workers — **or** an explicit release note that complete graceful-browser cleanup is not claimed.

### 5. At-exit task outcome mapping for every durable subsystem (FR-06, AC-09)

- **Why incomplete:** Contact extraction is reconciled at Exit (`failed` + “Application exited while extraction was in progress”) with unit tests. Yellow Pages / search / social still depend on **next-startup** previous-session flows or existing task-status paths. That is weaker than mapping running work at shutdown. No per-subsystem persistence tests except contact extraction.
- **Done looks like:** At-exit (not only next-startup) mapping for every durable task family; completed rows untouched; uncertain email/social side effects not auto-retried; tests for at least one family besides contact extraction.

### 6. Windows Job Objects / spawn-time process groups (design section 8)

- **Why incomplete:** Terminator uses `taskkill /PID /T /F` plus verified exit on Windows, and optional isolated pgid on POSIX. Native Job Objects are not implemented. Design treats containment choice as a required milestone. The inventory already calls this a limitation — complete-cleanup must not be claimed until that is accepted in writing or implemented.
- **Done looks like:** Job Objects (or another chosen containment) packaged and tested, **or** a release decision that v1 ships with the taskkill/pgid limitation explicitly out of the complete-cleanup claim.

### 7. Inventory drift: `hooks-command` (PRD section 8 inventory completeness)

- **Why incomplete:** `CommandHookExecutor` gates and registers `hooks-command`. That owner is missing from [application-exit-and-system-tray-inventory.md](application-exit-and-system-tray-inventory.md). A missing family in the inventory blocks claiming the inventory is complete.
- **Done looks like:** Inventory row (registered family #28 or equivalent) with file, transport, and test note; wiring-guard still passing.

---

## Tests still missing for open items

| Gap | Tied to |
| --- | --- |
| Packaged updater restart (manual + automatic, including hidden) | Task 1 / AC-11 |
| Packaged tray + OS session-end matrix | Task 1 / AC-10, AC-16 |
| Contact-extraction spawn refused while quitting (remove wiring-guard allowlist) | Task 3 / AC-05 |
| Worker adapter: graceful close, ignored shutdown, ack without exit, descendant browsers | Task 4 |
| Interrupted-status mapping for a non-contact-extraction subsystem | Task 5 / AC-09 |
| Packaged idle/busy timing on a reference machine | Task 1 / PRD section 7 |

---

## Suggested order

1. Gate contact-extraction spawn + drop the wiring-guard allowlist (task 3) — small, correctness.
2. Add `hooks-command` to the inventory (task 7) — documentation.
3. Decide Job Objects vs documented limitation (task 6) — product call.
4. Decide whether remaining workers get the section-7 protocol in this release (task 4).
5. At-exit mapping for remaining durable task families (task 5).
6. Packaged/OS/updater evidence matrix (task 1) and leftover-process close-out (task 2).

Shutdown repair should stay enabled even if the optional tray experience needs rollback (PRD section 8).
