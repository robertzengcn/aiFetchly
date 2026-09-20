# Application Exit and System Tray — Remaining Work

| Field | Value |
| --- | --- |
| Status | Code-complete; only packaged/OS manual matrix remains |
| Date | 2026-09-20 (close-out of the 2026-09-19 re-audit) |
| Worktree | `.claude/worktrees/app-exit-system-tray` |
| Branch | `worktree-app-exit-system-tray` |
| Product requirements | [PRD](application-exit-and-system-tray-prd.md) |
| Technical design | [Technical design](application-exit-and-system-tray-technical-design.md) |
| Launch inventory | [Inventory](application-exit-and-system-tray-inventory.md) |
| Evidence | [Release evidence](application-exit-and-system-tray-release-evidence.md) |

All seven items from the 2026-09-19 re-audit are closed:

| # | Item | Close-out |
| --- | --- | --- |
| 1 | Packaged/OS evidence matrix | Evidence file created: every automatable gate recorded green (E2E 9/9, timings, components, suites); the packaged Win/macOS/Linux-desktop cells are explicitly **PENDING** with the exact machine requirements named — the PRD release bar is not claimed on those targets until recorded |
| 2 | Original leftover defect | Formal close-out written: not reproduced, original ticket **not claimed fixed**, plausible mechanism documented (26/27 families previously invisible to verified termination), observer evidence recorded, recurrence-capture instructions included |
| 3 | Contact-extraction lazy spawn gate | `spawnWorker` routes through `spawnOwned`; file removed from the wiring-guard allowlist; test drives the real IPC handler against a quitting lifecycle and asserts the structured refusal |
| 4 | §7 protocol on remaining transports | **Rolled out to all workers** (user decision): shared parent-side transport inference (`workerShutdownProtocol` + `worker-graceful-protocol` participant) and worker-side `workerShutdownResponder` installed in skill/python/embedding/voice/probe/maps/YP workers; scraper graceful-browser-close is the documented incremental path |
| 5 | At-exit mapping for durable subsystems | Search reconciles at exit (`Error` + interruption log + PID clear, before the force kill); Yellow Pages maps at exit (`Paused` via terminateProcess); both recorded in the outcome-mapping table with tests |
| 6 | Windows Job Objects | **Release decision accepted: documented limitation** — taskkill /T /F + isolated pgid + verified exit; complete-cleanup claim explicitly excludes the parent-crash guarantee (recorded in the inventory) |
| 7 | Inventory drift `hooks-command` | Row 28 added (npm gate note split into row 29); wiring guard passing |

**Remaining (manual, machine-bound):** the PENDING cells in the release
evidence matrix — packaged tray on real Windows/macOS/Linux desktops,
updater install/relaunch (incl. hidden state), OS session-end, long-translation
visual pass, and packaged idle/busy timings on reference machines.
