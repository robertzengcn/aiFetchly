# Application Exit — Process Launch Inventory

| Field | Value |
| --- | --- |
| Date | 2026-09-17 |
| Worktree | `.claude/worktrees/app-exit-system-tray` |
| Basis | Full-source audit of spawn/fork/exec/execFile/execFileSync/utilityProcess.fork/puppeteer launch/connect sites |
| Requirements | [PRD](application-exit-and-system-tray-prd.md) §1/§8.1, [design](application-exit-and-system-tray-technical-design.md) §2/§6, [TODO](application-exit-and-system-tray-todo.md) tasks 1-3 |

Every site below is **REGISTERED** (spawn-gated + OwnedProcessRegistry-tracked via
`src/main-process/lifecycle/ownedSpawn.ts`) or **EXCLUDED** with a reason and its
coverage mechanism. Registration means: new work is refused once the lifecycle
enters `quitting` (AC-05), and the force-and-verify phase observes termination
of the recorded PID with start-time identity (AC-04/AC-14).

## Registered launch families (main process)

| # | Family (ownerId) | File | Transport | Notes |
| --- | --- | --- | --- | --- |
| 1 | `contact-extraction` | src/main-process/communication/contactExtraction-ipc.ts | child_process.spawn (Electron RUN_AS_NODE) | Original adoption; crash-restart also gated |
| 2 | `yellow-pages` | src/modules/YellowPagesProcessManager.ts | utilityProcess.fork | Per-task worker |
| 3 | `website-analysis` | src/modules/WebsiteAnalysisQueue.ts | utilityProcess.fork | Per-job scrape worker |
| 4 | `social-task` | src/modules/socialtask.ts | utilityProcess.fork | Per-taskrun worker |
| 5 | `bulk-email` | src/modules/buckEmailTaskModule.ts | utilityProcess.fork | Send worker |
| 6 | `search-scraper` | src/modules/SearchModule.ts | utilityProcess.fork | Stores PID in DB |
| 7 | `email-search` | src/modules/EmailSearchTaskModule.ts | utilityProcess.fork | |
| 8 | `google-maps` | src/modules/GoogleMapsModule.ts | child_process.spawn (ipc) | |
| 9 | `yandex-maps` | src/modules/YandexMapsModule.ts | child_process.spawn (ipc) | |
| 10 | `skill-worker` | src/service/SkillWorkerClient.ts | utilityProcess.fork | Lazy singleton |
| 11 | `embedding-worker` | src/service/embedding/LocalEmbeddingWorkerClient.ts | utilityProcess.fork | Via injectable defaultFork |
| 12 | `voice-worker` | src/service/aiChatVoice/SherpaVoiceWorkerClient.ts | utilityProcess.fork | Via injectable defaultFork |
| 13 | `python-runtime-worker` | src/service/PythonRuntimeWorkerClient.ts | utilityProcess.fork | |
| 14 | `outbound-email-worker` | src/service/outboundEmail/OutboundEmailWorkerStarter.ts | utilityProcess.fork | Via injectable defaultFork |
| 15 | `managed-browser-worker` | src/service/ManagedBrowserWorkerClient.ts | utilityProcess.fork | Supervisor also shuts sessions down gracefully |
| 16 | `managed-browser-cache-worker` | src/service/ManagedBrowserCacheWorkerClient.ts | utilityProcess.fork | |
| 17 | `workspace-watch` | src/service/workspaceWatch/WorkspaceWatchManager.ts | utilityProcess.fork | Restart path routes through the same gated defaultFork (restarter reuses ForkFn) |
| 18 | `hooks` | src/service/hooks/hookExecutionClient.ts | utilityProcess.fork | Via injectable defaultFork |
| 19 | `runtime-probe` | src/service/localAiRuntime/DisposableVoiceRuntimeProbe.ts | utilityProcess.fork | Short-lived probe, still tracked (§6 launch/shutdown overlap) |
| 20 | `website-content-scrape` | src/service/WebsiteContentScrapeService.ts | utilityProcess.fork | Per-request worker |
| 21 | `google-proxy-check` | src/controller/proxy-controller.ts | utilityProcess.fork | Per-request check |
| 22 | `mcp-server` | src/modules/MCPClient.ts | child_process.spawn (stdio) | Owned stdio servers; external transport connections are never registered |
| 23 | `shell-tool` | src/service/ShellToolService.ts | child_process.spawn (detached) | Existing tree-kill retained; registry adds verified backstop |
| 24 | `npm-plugin-fetch` / `npm-plugin-extract` | src/service/pluginSources/NpmPluginFetcher.ts | spawn (npm pack / tar) | Long-running install path; see #29 for the gate note |
| 25 | `git-plugin-fetch` | src/service/pluginSources/GitPluginFetcher.ts | spawn (git) | Via injectable defaultSpawn |
| 26 | `git-marketplace-fetch` | src/service/pluginMarketplaces/GitMarketplaceFetcher.ts | spawn (git) | Via injectable defaultSpawn |
| 27 | `doc-skill-script` | src/service/DocSkillScriptRunnerService.ts | child_process.spawn | Skill scripts |
| 28 | `hooks-command` | src/service/hooks/executors/CommandHookExecutor.ts | child_process.spawn | User hook commands; refused with a structured failure result while quitting (covered by the wiring guard) |
| 29 | `npm-plugin-fetch` / `npm-plugin-extract` (gated) | src/service/pluginSources/NpmPluginFetcher.ts | spawn (npm pack / tar) | Split row: both transports gated AND registered |

## Excluded launch sites (documented + rationale)

| Site | Transport | Exclusion rationale / coverage |
| --- | --- | --- |
| src/utils/windowsOpenWith.ts | OS `open`/`start` | Fire-and-forget OS launcher (opens a URL/file in the user's app); not app-owned work. OS owns lifetime. |
| src/controller/searchProcessKill.ts | kill helpers | Termination helper, not a launcher. |
| src/utils/packagedWorkerPath.ts | fs only | Path resolution, no process. |
| src/modules/lib/function.ts, src/modules/lib/pipUtils.ts | execFile/spawnSync one-shots (pip show/install, version probes) | Awaited seconds-scale commands; SystemDependencyInstaller drives them and has its own audit/cancel UX. Covered by force-phase descendant capture only if still running; accepted residual (≤ pip install duration). |
| src/service/SystemDependencyInstaller.ts | spawnSync probes | Synchronous version probes — cannot outlive their caller. Installs route through pipUtils (above). |
| src/service/SkillEnvironmentManager.ts | spawnSync probes | Same: `--version` probes only. |
| src/service/WorkspaceKeyService.ts | execFileAsync (git one-shots) | Awaited seconds-scale git status operations. |
| src/service/PortableWorkspaceMemoryGitStatusService.ts | execFileAsync (git) | Same. |
| src/controller/extramoduleController.ts | execFile (pip show) | Same pattern. |
| src/service/ChunkingService.ts | exec one-shot | Same pattern. |
| src/service/MCPToolService.ts | child_process helpers | One-shot list/probe helpers over MCP config; long-lived servers are #22. |
| src/modules/socialScraper.ts | exec/spawn helpers (legacy) | Legacy scraper utility paths; modern scraper workers are #4/#6/#20. |
| src/modules/browserManager.ts (puppeteer.launch/connect) | Puppeteer | Executed **inside worker processes** (scraper workers above), not in main. Main-process-owned supervisor sessions (#15) have verified shutdownAll. Worker-side browsers are covered by the force phase once workers report descendants (design §7) — the contact-extraction worker protocol is the reference implementation; per-family reporting tracked as follow-up. |
| src/childprocess/** (worker entry points) | n/a | Worker-side code; cannot register from main. |

## Leftover-process reproduction status (PRD §1 / §8.1)

- **Reproduction:** The exact user-reported leftover was **not reproduced** on this
  machine (Linux/WSL2). Recorded observer evidence instead: the E2E suite
  (`test/e2e/specs/applicationLifecycle.test.ts`) plus the process-observer spec
  exercise real spawned trees through actual application exit and verify every
  recorded owned PID disappears while unrelated fixtures survive (AC-07/AC-14).
- **Plausible root causes addressed by registration:** before this change, 26 of
  27 launch families were invisible to the force-and-verify phase — a worker that
  ignored (or outlived) its owner's own cleanup stayed running after Exit. All
  main-process families are now recorded, so the verified terminator covers them.
- **Residual leak windows (honest):** worker-side Puppeteer browsers until
  per-family descendant reporting lands; exec one-shots listed above for their
  (seconds-scale) duration; Win32 PID-reuse granularity (see registry §8 note).

## Family coverage tests

- `test/vitest/main/lifecycle/ownedSpawn.test.ts` — structural handle accepts
  UtilityProcess AND ChildProcess shapes; registration best-effort; gate refuses
  at shutdown (AC-05).
- `test/vitest/main/lifecycle/ProcessTreeTerminator.test.ts` — real-tree kill +
  group kill verification (the mechanism every registered family inherits).
- `test/e2e/specs/applicationLifecycle.test.ts` + the process-observer spec —
  application-level exit coverage.

## Task outcome mapping (PRD FR-06 / AC-09)

Per-subsystem mapping of queued / running / completed / cancelled / uncertain
outcomes at exit. No new task states were introduced (existing vocabulary only).

| Subsystem | Queued at exit | Running at exit | Completed | Uncertain external ops |
| --- | --- | --- | --- | --- |
| Contact extraction | Retry stays user-initiated (RETRY handler); nothing auto-runs | `reconcileInterruptedExtractions` marks in-flight rows **failed** with "Application exited while extraction was in progress" (participant stop, before worker shutdown) | untouched | none (no email/post side effects) |
| Yellow Pages | Previous-session rows marked failed at NEXT startup by `handleTasksFromPreviousSession` (existing behavior) | `terminateAllProcesses` (participant stop); rows reconcile at next startup via the same previous-session path | untouched | none |
| Search scraper | PIDs stored in DB; worker killed via registry force phase; status reconciled by existing task-status flow | same | untouched | none |
| Async tool jobs | `ToolJobRegistry.shutdown()` aborts queued+running and marks **cancelled** (existing) | same | untouched | email/social tool side effects already carry their own outcome records via ToolExecutionService; no auto-retry at startup exists |
| Bulk email send | Worker killed via registry; send logs record per-recipient state; no auto-retry on restart | same | untouched | **send outcome may be unknown** if killed mid-SMTP — recorded as non-sent in logs; blind retry prevented because batches require user initiation |
| Social tasks | Same as search scraper (worker + taskrun rows) | same | untouched | post/publish outcome may be unknown — taskrun status flow records interrupted, no auto-resume |
| Managed browser sessions | n/a | supervisor graceful stop + cache clear-on-exit preference | n/a | n/a |
| All other families | Short-lived commands; no durable task rows | n/a | n/a | n/a |

**No-blind-retry rule:** no subsystem auto-retries interrupted external
operations on restart; every retry path is user-initiated (retry buttons,
re-run task), which the PRD permits.
