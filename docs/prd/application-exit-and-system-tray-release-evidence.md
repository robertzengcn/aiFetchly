# Application Exit and System Tray — Release Evidence

| Field | Value |
| --- | --- |
| Date | 2026-09-20 |
| Worktree | `.claude/worktrees/app-exit-system-tray` (branch `worktree-app-exit-system-tray`) |
| Requirements | [PRD](application-exit-and-system-tray-prd.md) §7/§8, [TODO](application-exit-and-system-tray-todo.md) tasks 1–2 |
| Inventory | [Inventory](application-exit-and-system-tray-inventory.md) |

## 1. Automated evidence (this machine, Linux/WSL2 dev + E2E build)

| Check | Result | Evidence |
| --- | --- | --- |
| Close choice / hide-restore / repeated quit / crashed-renderer exit | PASS | `test/e2e/specs/applicationLifecycle.test.ts` 6/6 |
| Observer: owned worker dies with app, unrelated survives | PASS | `applicationLifecycleObserver.test.ts` (kill(pid,0) probes from the test process after Electron exits) |
| Hidden-mode representative task ≥60s with output, restore, clean exit | PASS | same spec (heartbeat marker advances across hide→restore) |
| Idle exit timing | PASS | 127–145 ms measured (PRD target ≤2 s) |
| Busy exit timing (1 owned worker) | PASS | 156–197 ms measured (PRD target ≤10 s) |
| Component suite (dialog i18n/keyboard/phase) | PASS | 534/534 (`yarn test:components`) |
| Main-process suites (lifecycle/protocol/registry) | PASS | 173+/173+ |
| tsc + vue-tsc | PASS | 0 errors |
| Spawn-gate + registry wiring | PASS | `ownedSpawnWiringGuard` source scan (every launch site gated; no register-without-gate drift) |

## 2. Packaged / OS evidence matrix (PRD release bar)

| Check | Win (packaged) | macOS (packaged) | Linux (desktop) | Status |
| --- | --- | --- | --- | --- |
| Tray usable; Keep-running available | **PENDING — needs Windows machine** | **PENDING — needs macOS machine** | Code-gated (`isLinuxTrayHostPlausible`); xvfb E2E passes with opt-in | Cannot be produced on this WSL2 dev box |
| Updater restart incl. from-hidden (AC-11) | **PENDING — packaged run** | **PENDING — packaged run** | n/a (updater is Win/mac only) | Code path routed (`notifyUser:false` + `update-restart` intent); install handoff unverified on real targets |
| OS logout/shutdown avoids prompts (AC-16) | **PENDING — session-end run** | **PENDING** | **PENDING** | `session-end` handler coded; no OS automation here |
| Long-translation layout (de/fr/ja) | **PENDING — visual pass** | **PENDING** | **PENDING** | Keys + parity tests exist; visual clipping needs eyes on packaged builds |
| Packaged idle ≤2 s / busy ≤10 s | **PENDING** | **PENDING** | **PENDING** | Dev+E2E numbers far inside budget; packaged numbers need reference machines |

**Honest release statement:** the code-complete bar is met and every
automatable gate is green. The PRD's packaged/OS evidence items above require
physical Windows/macOS machines and real desktop sessions; they are the
remaining manual matrix. Until recorded, do not claim AC-10/11/12-visual/16
as verified on release targets.

## 3. Original leftover-process defect — close-out (PRD §1/§8.1)

**Status: NOT reproduced; original ticket is NOT claimed fixed.**

- The user-reported leftover could not be reproduced on this Linux/WSL2
  machine across dev and E2E builds. No specific PID/family identity from
  the original report exists to capture.
- Mechanism analysis (inventory): before this branch, 26 of 27 launch
  families were invisible to any verified termination — a worker that
  ignored or outlived its owner's own cleanup stayed running after Exit.
  That is the plausible class for the report, and every main-process family
  is now spawn-gated + registry-tracked with force-and-verify termination
  plus the §7 graceful protocol.
- Recorded observer evidence: owned fixtures die with the app while
  unrelated processes survive (both E2E specs; kill(pid,0) probes made by
  the test process, which outlives Electron).
- Residual, honestly stated: worker-side Puppeteer browsers until
  per-scraper `closeOwnedResources` lands (force-phase tree-kill covers
  them); seconds-scale exec one-shots listed in the inventory; Win32
  PID-reuse granularity; and the explicit no-Job-Objects parent-crash
  exclusion.
- If the original report recurs: capture `ps -ef`/Process Explorer output
  before terminating, note the build, and attach it to the inventory — the
  registry + shutdown report (`diagnostics/shutdown-reports.jsonl`) will
  name the family.
