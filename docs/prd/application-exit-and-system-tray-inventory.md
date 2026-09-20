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
| 2 | `yellow-pages` | src/modules/YellowPagesProcessManager.ts | utilityProcess.fork | Per-task worker; §7 responder installed (YellowPagesScraperProcess.ts) |
| 3 | `website-analysis` | src/modules/WebsiteAnalysisQueue.ts | utilityProcess.fork | Per-job scrape worker |
| 4 | `social-task` | src/modules/socialtask.ts | utilityProcess.fork | Per-taskrun worker |
| 5 | `bulk-email` | src/modules/buckEmailTaskModule.ts | utilityProcess.fork | Send worker |
| 6 | `search-scraper` | src/modules/SearchModule.ts | utilityProcess.fork | Stores PID in DB |
| 7 | `email-search` | src/modules/EmailSearchTaskModule.ts | utilityProcess.fork | |
| 8 | `google-maps` | src/modules/GoogleMapsModule.ts | child_process.spawn (ipc) | §7 responder installed (ipc send) |
| 9 | `yandex-maps` | src/modules/YandexMapsModule.ts | child_process.spawn (ipc) | §7 responder installed (ipc send) |
| 10 | `skill-worker` | src/service/SkillWorkerClient.ts | utilityProcess.fork | Lazy singleton; §7 responder installed (SkillWorker.ts) |
| 11 | `embedding-worker` | src/service/embedding/LocalEmbeddingWorkerClient.ts | utilityProcess.fork | Via injectable defaultFork; §7 responder installed |
| 12 | `voice-worker` | src/service/aiChatVoice/SherpaVoiceWorkerClient.ts | utilityProcess.fork | Via injectable defaultFork; §7 responder installed |
| 13 | `python-runtime-worker` | src/service/PythonRuntimeWorkerClient.ts | utilityProcess.fork | §7 responder installed |
| 14 | `outbound-email-worker` | src/service/outboundEmail/OutboundEmailWorkerStarter.ts | utilityProcess.fork | Via injectable defaultFork |
| 15 | `managed-browser-worker` | src/service/ManagedBrowserWorkerClient.ts | utilityProcess.fork | Supervisor also shuts sessions down gracefully |
| 16 | `managed-browser-cache-worker` | src/service/ManagedBrowserCacheWorkerClient.ts | utilityProcess.fork | |
| 17 | `workspace-watch` | src/service/workspaceWatch/WorkspaceWatchManager.ts | utilityProcess.fork | Restart path routes through the same gated defaultFork (restarter reuses ForkFn) |
| 18 | `hooks` | src/service/hooks/hookExecutionClient.ts | utilityProcess.fork | Via injectable defaultFork |
| 19 | `runtime-probe` | src/service/localAiRuntime/DisposableVoiceRuntimeProbe.ts | utilityProcess.fork | Short-lived probe, still tracked (§6 launch/shutdown overlap); §7 responder installed |
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
| Yellow Pages | Queued-not-started rows wait for the next-startup `handleTasksFromPreviousSession` path (documented gap) | ACTIVE processes: participant `terminateAllProcesses` → `terminateProcess` sets **Paused** + clears PID at exit; rows whose handle was already dropped fall to the next-startup previous-session path | untouched | none |
| Search scraper | Retry stays user-initiated | `SearchModule.reconcileInterruptedTasks` (participant stop, BEFORE the force kill): running rows → existing **Error** + interruption runtime-log + PID clear | untouched | none |
| Async tool jobs | `ToolJobRegistry.shutdown()` aborts queued+running and marks **cancelled** (existing) | same | untouched | email/social tool side effects already carry their own outcome records via ToolExecutionService; no auto-retry at startup exists |
| Bulk email send | Worker killed via registry; send logs record per-recipient state; no auto-retry on restart | same | untouched | **send outcome may be unknown** if killed mid-SMTP — recorded as non-sent in logs; blind retry prevented because batches require user initiation |
| Social tasks | Retry stays user-initiated | see the reconcile rows added with the social participant (below) | untouched | post/publish outcome may be unknown — taskrun status flow records interrupted, no auto-resume |
| Managed browser sessions | n/a | supervisor graceful stop + cache clear-on-exit preference | n/a | n/a |
| All other families | Short-lived commands; no durable task rows | n/a | n/a | n/a |

**No-blind-retry rule:** no subsystem auto-retries interrupted external
operations on restart; every retry path is user-initiated (retry buttons,
re-run task), which the PRD permits.

## §7 graceful-shutdown rollout (2026-09-20)

The validated shutdown message now reaches **every live registered worker** at
graceful-stop time, not just contact extraction:

- **Parent side** (`src/main-process/lifecycle/workerShutdownProtocol.ts` +
  the `worker-graceful-protocol` participant): transport is INFERRED
  structurally from the opaque registry handle (`.postMessage` for utility
  processes, `.send` for ipc children). Each live record receives
  `{type:"shutdown", requestId, reason, remainingMs}` bounded by half the
  remaining coordinator budget; the participant then waits one collective
  window for observed exits. Non-exiting workers remain owned by the
  force-and-verify phase — an ack is never treated as exit proof.
- **Worker side** (`src/childprocess/lib/workerShutdownResponder.ts`, shared):
  parse+validate the request, set the closing flag, ack with the correlatable
  requestId, run optional `closeOwnedResources`, and exit within a bounded
  watchdog (clamped to the parent budget). Installed in: SkillWorker,
  PythonRuntimeWorker, LocalEmbeddingWorker, AiChatVoiceWorker,
  RuntimeProbeWorker (parentPort transports), GoogleMapsWorker,
  YandexMapsWorker, YellowPagesScraperProcess (ipc transports), plus the
  original ContactExtractionWorker reference implementation.
- **Responder coverage now complete at every real worker ENTRY POINT**
  (2026-09-20 second pass): taskCode.ts (the shared worker behind
  social-task, search, email-search and outbound-email children),
  utilityCode.ts (legacy), websiteContentScraper, googleProxyCheck,
  hook-execution worker, workspace-config watch worker, managed-browser and
  managed-browser-cache workers — joining the first-pass Skill /
  PythonRuntime / Embedding / Voice / RuntimeProbe / GoogleMaps / YandexMaps /
  YellowPagesScraperProcess / ContactExtractionWorker installs.
- **Non-entry scraper classes** (googleScraper, bingScraper, baiduScraper,
  yandexScraper, searchScraper, userSearch, emailSearch, emailScraper,
  emailSend, emailCluster, scrapeManager) are LIBRARIES imported by the wired
  entry points above — they run inside processes whose entry now responds.
  Their Puppeteer instances close when the process exits; per-family
  `closeOwnedResources` hooks remain the incremental hardening path for
  browser-close-before-exit semantics. worker.ts (src/childprocess/worker.ts)
  is the deprecated legacy entry per CLAUDE.md and is not built by forge.
- **Graceful browser close**: scraper workers that hold Puppeteer instances
  still rely on the force-phase tree kill (verified, includes descendants);
  passing `closeOwnedResources` per scraper family is the incremental
  hardening path — the shared responder makes each a ~5-line change.

## Windows containment — release decision (design §8)

**v1 ships WITHOUT native Job Objects** (decision accepted 2026-09-20).
Windows containment is `taskkill /PID <pid> /T /F` (argument array, awaited)
plus liveness-verified exit; POSIX uses isolated process groups where owners
create them. The complete-cleanup claim **explicitly excludes** the
parent-crash guarantee a Job Object would give (a crash of the Electron
process itself before the coordinator runs). Implementing Job Objects needs
a maintained native helper plus Windows packaged tests that cannot run on
this machine — tracked as the follow-up if the leftover-process report ever
reproduces a parent-crash leak.
