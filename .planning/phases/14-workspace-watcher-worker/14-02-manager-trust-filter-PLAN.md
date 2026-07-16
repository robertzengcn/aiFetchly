---
phase: 14-workspace-watcher-worker
plan: 02
slug: manager-trust-filter
type: execute
wave: 2
depends_on: [14-01-worker-foundation]
files_modified:
  - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
  - src/service/workspaceWatch/WorkspaceTrustFilter.ts
  - src/service/workspaceWatch/WorkspaceWatchManager.ts
  - src/service/workspaceWatch/WorkspaceWatchRestarter.ts
  - test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts
  - test/vitest/main/service/workspaceWatch/WorkspaceTrustFilter.test.ts
  - test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.test.ts
  - test/vitest/main/service/workspaceWatch/WorkspaceWatchRestarter.test.ts
autonomous: true
requirements: [WAT-01, WAT-03, WAT-04, WAT-07, TRS-01]
tags: [typescript, electron, lifecycle, ref-counting, crash-restart, trust-filter, ipc]

must_haves:
  truths:
    - "AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot(snapshot, trust) drops untrusted instructions + commands BEFORE delegating to the existing applySnapshot (TRS-01); the global ~/.aifetchly path still calls applySnapshot directly (always trusted)"
    - "WorkspaceTrustFilter.derivePhase14Trust(workspaceApproved) returns AIFetchlySourceTrust with instructions=commands=workspaceApproved, agents=hooks=skills=false (Phase 14 binary gate; per-capability entity is Phase 17)"
    - "WorkspaceWatchManager.acquire({workspaceId, workspaceRoot, consumerId}) is idempotent for the same consumerId; tracks per-workspace consumer sets; 0→1 transition spawns the worker; 1→0 transition shuts it down (WAT-01)"
    - "WorkspaceWatchManager.release(workspaceId, consumerId) removes the consumer; 0 consumers → unwatch-workspace sent + watched map entry deleted; if no workspaces remain, worker is shutdown (WAT-03)"
    - "WorkspaceWatchManager.switchWorkspace(oldId, newId, newRoot, consumerId) = release(old) + acquire(new) + rescan(new) producing an immediate snapshot for renderer refresh (SC2)"
    - "Exactly ONE child_process worker serves ALL acquired workspaces (multiplexed inside the worker via watch-workspace commands); there is NEVER one worker per workspace"
    - "WorkspaceWatchRestarter enforces max 3 restarts within a sliding 60s window; on exceeding → stops auto-watch + surfaces an error diagnostic; resets the window after a quiet period (WAT-07)"
    - "On worker crash (child exit) with watched.size>0 and under the restart cap: manager re-forks, re-sends watch-workspace for every entry in the watched map, requests a full rescan per workspace (WAT-07)"
    - "Every worker→main message is zod-validated via workerEventSchema.safeParse BEFORE handler dispatch; on failure → log, terminate worker, restart under the cap (WAT-06)"
  artifacts:
    - "src/service/workspaceWatch/WorkspaceWatchManager.ts — ref-counted lifecycle (acquire/release/switchWorkspace/rescan/shutdown), worker fork, message dispatch"
    - "src/service/workspaceWatch/WorkspaceWatchRestarter.ts — sliding 60s window restart-cap accounting"
    - "src/service/workspaceWatch/WorkspaceTrustFilter.ts — binary Phase 14 trust derivation (approved → instructions+commands)"
    - "Extended src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts with applyWorkspaceSnapshot method (TRS-01)"
  prohibitions:
    - "Manager MUST NOT call applySnapshot directly with a raw workspace snapshot — ALWAYS route workspace snapshots through applyWorkspaceSnapshot(snapshot, trust) (TRS-01 / research §Pitfall 8)"
    - "Manager MUST NOT trust the renderer-provided workspace path — main resolves the approved root via WorkspaceResolver before acquire (CFG-02; the WorkspaceResolver integration lands in Plan 14-03's IPC handlers, but the manager's acquire signature takes an already-resolved root)"
    - "Manager MUST NOT make trust decisions inside the worker — trust is main-process-authoritative, applied at the apply boundary (research §Anti-Patterns)"
    - "WorkspaceWatchRestarter MUST NOT respawn infinitely — the 3/60s cap is a hard floor; exceeded → stop auto-watch + diagnostic (research §Pitfall 6)"
  key_links:
    - "acquire() 0→1 transition → ensureWorker() → child_process.fork(WORKER_ENTRY) → worker.on('message') → workerEventSchema.safeParse"
    - "child.on('exit') → WorkspaceWatchRestarter.recordRestart(now) → if under cap: re-fork + re-send watch-workspace per watched entry → if over cap: surface error"
    - "applyWorkspaceSnapshot(snapshot, trust) → trust-filter → applySnapshot(filteredSnapshot) → AIFetchlyContextStore.replaceInstructions"
---

<objective>
Build the main-process half of the watcher architecture: (1) the TRS-01 trust filter that drops untrusted workspace instructions/commands BEFORE the existing blind `applySnapshot` mutates the registry (the single largest Phase-13 delta per research §Pitfall 8); (2) the reference-counted `WorkspaceWatchManager` that owns the worker child-process lifecycle (one worker for all acquired workspaces, 0→no worker, switch = release+acquire+rescan); (3) the crash-restart accounting (max 3/60s + full rescan on restart); (4) main-side zod validation of every worker→main message with terminate-on-malformed.

Purpose: Make workspace config safe to apply (trust enforced BEFORE registry mutation, not UI-disabled after) and make the worker lifecycle robust (no orphan workers, no infinite restart loops, no leaked chokidar watchers on workspace switch).

Output: `WorkspaceWatchManager` (the orchestrator Plan 14-03's IPC handlers will drive), `WorkspaceWatchRestarter` (crash cap), `WorkspaceTrustFilter` (binary Phase 14 trust), and the `applyWorkspaceSnapshot(snapshot, trust)` extension on the Phase 13-03a registry-sync module.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/14-workspace-watcher-worker/14-CONTEXT.md
@.planning/phases/14-workspace-watcher-worker/14-RESEARCH.md
@.planning/phases/14-workspace-watcher-worker/14-01-SUMMARY.md

@docs/prd/aifetchly-local-extensibility-technical-design.md

# Phase 13 surfaces being extended (READ BEFORE EDITING)
@src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
@src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
@src/service/aifetchlyConfig/AIFetchlyContextStore.ts

# Symbols from Plan 14-01 being consumed
@src/service/workspaceWatch/WorkspaceWatchProtocol.ts
@src/service/workspaceWatch/WorkspaceConfigScanner.ts
@src/entityTypes/aifetchlyWorkspaceWatchTypes.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: TRS-01 trust filter — applyWorkspaceSnapshot(snapshot, trust) + WorkspaceTrustFilter + tests</name>
  <files>src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts, src/service/workspaceWatch/WorkspaceTrustFilter.ts, test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts, test/vitest/main/service/workspaceWatch/WorkspaceTrustFilter.test.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Pattern 5 Trust Filtering Before Apply, §Pitfall 8 applySnapshot Blind Apply)
    - docs/prd/aifetchly-local-extensibility-technical-design.md §8.2 (trust filtering before registry mutation), §13.1 (Phase 14 binary gate vs Phase 17 per-capability)
    - src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts (the existing applySnapshot — lines ~48-86 per research; confirm it has NO trust param)
    - src/entityTypes/aifetchlyConfigTypes.ts (the AIFetchlySourceTrust interface added in Plan 14-01 Task 1)
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md (how the registry-sync + context-store are wired)
  </read_first>
  <behavior>
    - applyWorkspaceSnapshot(snapshot, trust): when trust.instructions=false → instructions array is replaced with [] before applySnapshot; when trust.commands=false → commands array replaced with []; agents/hooks/skills always [] in Phase 14 (gated false)
    - The existing applySnapshot method signature is UNCHANGED (backward-compat: global ~/.aifetchly path still calls it directly)
    - WorkspaceTrustFilter.derivePhase14Trust(true) returns {instructions:true, commands:true, agents:false, hooks:false, skills:false}
    - WorkspaceTrustFilter.derivePhase14Trust(false) returns all-false
    - Untrusted workspace snapshot flowing through applyWorkspaceSnapshot results in ZERO new entries in CommandRegistry (source=workspace) and ZERO new instruction blocks in AIFetchlyContextStore
  </behavior>
  <action>
    Edit `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts`: add a new public method `applyWorkspaceSnapshot(snapshot: AIFetchlyConfigSnapshot, trust: AIFetchlySourceTrust): AIFetchlySnapshotApplyResult`. The method constructs a filtered snapshot via spread + conditional empty-arrays: instructions become `trust.instructions ? snapshot.instructions : []`, commands become `trust.commands ? snapshot.commands : []`, and delegates to the existing `this.applySnapshot(filtered)`. Do NOT modify the existing applySnapshot signature or behavior. Import AIFetchlySourceTrust from `src/entityTypes/aifetchlyConfigTypes`. Add a doc comment citing design §8.2 + TRS-01 and explicitly noting that callers MUST route workspace snapshots through this method, NOT applySnapshot directly (research §Pitfall 8 — blind-apply is the security failure mode).

    Create `src/service/workspaceWatch/WorkspaceTrustFilter.ts` exporting `derivePhase14Trust(workspaceApproved: boolean): AIFetchlySourceTrust`. Phase 14 is binary: approved → instructions+commands trusted; else nothing. agents/hooks/skills are always false (Phase 17 adds the per-capability entity). Add a doc comment noting this is a temporary Phase 14 binary derivation; the per-capability source-of-trust will live behind the same interface in Phase 17.

    Write `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts` covering (per research §Validation Architecture TRS-01 cases):
    (a) untrusted workspace snapshot: applyWorkspaceSnapshot with all-false trust → registry.list().filter(c => c.source==="workspace").length === 0 AND contextStore.getInstructionBlocks has no workspace block;
    (b) trusted-for-instructions-only (instructions:true, commands:false): workspace instructions registered, workspace commands dropped;
    (c) fully-trusted (Phase 14 approved): both registered;
    (d) the existing applySnapshot (global path) is UNCHANGED — call it with a global snapshot and confirm commands still register (regression guard).
    Construct real CommandRegistry + AIFetchlyContextStore + AIFetchlyRuntimeRegistrySync instances with a tmpdir (mirror Phase 13-03b's real-instance test stack — no mocks for the 3-method collaborator).

    Write `test/vitest/main/service/workspaceWatch/WorkspaceTrustFilter.test.ts` as a 2-case table: derivePhase14Trust(true) → {instructions:true, commands:true, agents:false, hooks:false, skills:false}; derivePhase14Trust(false) → all-false.
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs AIFetchlyRuntimeRegistrySync.trust WorkspaceTrustFilter && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "applyWorkspaceSnapshot" src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` returns ≥1 (method defined)
    - `grep -c "applyWorkspaceSnapshot.*snapshot.*trust" src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` returns ≥1 (signature has trust param)
    - The existing `applySnapshot(snapshot)` method is preserved unchanged (diff shows only ADDITIONS, no modification of existing method body)
    - Untrusted case: `registry.list().filter(c => c.source === "workspace")` has length 0 after applyWorkspaceSnapshot
    - Trusted-for-instructions-only case: instructions registered, commands dropped
    - Global applySnapshot regression case still registers commands
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>TRS-01 enforced: workspace snapshots flow through a trust filter that drops untrusted instructions/commands BEFORE the registry/cache mutation; the global path is unchanged; all 4 trust cases green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: WorkspaceWatchManager (ref-counted lifecycle + worker fork + message dispatch + crash restart) + WorkspaceWatchRestarter</name>
  <files>src/service/workspaceWatch/WorkspaceWatchManager.ts, src/service/workspaceWatch/WorkspaceWatchRestarter.ts, test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.test.ts, test/vitest/main/service/workspaceWatch/WorkspaceWatchRestarter.test.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Pattern 1 fork-IPC spawnWorker, §Pattern 3 Reference-Counted Lifecycle, §Pitfall 2 Switch Race, §Pitfall 6 Restart Loop, §Pitfall 7 Orphan Worker)
    - docs/prd/aifetchly-local-extensibility-technical-design.md §9.3 (WatchedWorkspaceState + acquire/release), §9.8 (crash handling — max 3/60s + full rescan + /reload-config retry), §10.1 + §10.4 (switch flow + immediate snapshot)
    - src/childprocess/contact-extraction/ContactExtractionWorker.ts (fork-IPC template — the manager side mirrors spawnWorker + on('message') + on('exit'))
    - src/service/workspaceWatch/WorkspaceWatchProtocol.ts (workerEventSchema, workerCommandSchema from Plan 14-01)
    - src/entityTypes/aifetchlyWorkspaceWatchTypes.ts (WatchedWorkspaceState type)
  </read_first>
  <behavior>
    - acquire({workspaceId, workspaceRoot, consumerId, reason?}): idempotent (same consumerId on an existing workspace = no-op); new workspace → ensureWorker() (0→1 transition) + send watch-workspace command
    - release(workspaceId, consumerId): removes consumer; 0 consumers → send unwatch-workspace + delete watched entry; if watched.size becomes 0 → shutdownWorker()
    - switchWorkspace(oldId, newId, newRoot, consumerId): if oldId → release(oldId, consumerId); acquire({workspaceId:newId, workspaceRoot:newRoot, consumerId}); rescan(newId) — produces an immediate fresh snapshot
    - rescan(workspaceId): sends rescan-workspace command; the worker's response (changed event) flows through the message handler → trust filter (Plan 14-02 Task 1's applyWorkspaceSnapshot via a callback the IPC layer in Plan 14-03 supplies) → emits AIFETCHLY_CONFIG_CHANGED
    - shutdown(): sends shutdown command, awaits up to 2s, then force-kills (worker.kill('SIGKILL')) if still alive (no orphan workers — research §Pitfall 7)
    - Message dispatch: every worker.on('message') payload is safeParsed via workerEventSchema; on failure → terminateAndRestart('malformed-message') (logs the parse error, increments restart counter, re-forks); on success → handleWorkerEvent (snapshot/changed/diagnostic/error)
    - Crash handling (child.on('exit')): if watched.size===0 → expected shutdown, no-op; if watched.size>0 → WorkspaceWatchRestarter.recordRestart(now); under cap → re-fork + re-send watch-workspace for every watched entry + rescan all; over cap → set status to 'failed', emit error diagnostic, stop auto-watch
  </behavior>
  <action>
    Create `src/service/workspaceWatch/WorkspaceWatchRestarter.ts` exporting `WorkspaceWatchRestarter` class with: `recordRestart(timestamp: number): {canRestart: boolean; restartCount: number}` maintaining a sliding 60s window of restart timestamps (array pruned to entries within `now - 60_000`); `canRestart()` returns `restartCount < 3`; `reset()` clears the window (called after a configurable quiet period, e.g. 60s of no crashes — research §9.8). Use `maxRestarts = 3` and `windowMs = 60_000` constants. Pure logic, no Electron/child_process imports.

    Create `src/service/workspaceWatch/WorkspaceWatchManager.ts` per research §Pattern 3. Constructor takes an `applySnapshotCallback` (the bridge to Plan 14-02 Task 1's `applyWorkspaceSnapshot(snapshot, trust)` — injected so the manager has NO direct dependency on AIFetchlyRuntimeRegistrySync; this makes it unit-testable with a stub) plus a `configChangedEmitter` callback (the bridge to the IPC layer that emits AIFETCHLY_CONFIG_CHANGED — also injected). Maintain `private readonly watched = new Map<string, WatchedWorkspaceState>()` and `private worker: ChildProcess | null = null`.

    Implement `spawnWorker()` per research §Pattern 1: `fork(WORKER_ENTRY, [], {stdio:["inherit","inherit","inherit","ipc"], env:{...process.env, WORKER_TYPE:"aifetchly-config"}})` where WORKER_ENTRY resolves to the bundled worker path (mirror how ContactExtractionWorker is resolved — `path.join(__dirname, "..", "childprocess", "aifetchly-config", "WorkspaceConfigWatchWorker")`). Wire `worker.on('message', raw => { const parsed = workerEventSchema.safeParse(raw); if (!parsed.success) return this.terminateAndRestart('malformed-message'); this.handleWorkerEvent(parsed.data); })` and `worker.on('exit', (code, signal) => this.handleWorkerExit(code, signal))`. Add `worker.on('error', err => log + treat as crash)`.

    Implement `send(cmd: WorkspaceWatchCommand)`: guard `if (this.worker?.connected) this.worker.send(cmd)`. Implement `terminateAndRestart(reason)`: log + kill current worker + `recordRestart` + if under cap `spawnWorker()` + re-send watch-workspace per watched entry + rescan all; if over cap set status 'failed' + emit error diagnostic.

    Implement `handleWorkerEvent(event)`: switch on event.type — 'snapshot'/'changed' → update watched.get(workspaceId).lastSnapshot → invoke `applySnapshotCallback(event.snapshot, trust)` where trust is derived via WorkspaceTrustFilter from the workspace's approval state (the manager reads approval via an injected `trustResolver: (workspaceId) => boolean` — the IPC layer in Plan 14-03 supplies a WorkspaceResolver-backed implementation); 'diagnostic' → forward to emitter as a diagnostic; 'error' → log + if !recoverable terminateAndRestart.

    Write `WorkspaceWatchRestarter.test.ts` table-driven: (a) 3 restarts within 60s → canRestart returns false on the 4th; (b) restart timestamps older than 60s are pruned → canRestart returns true again; (c) reset() clears the window.

    Write `WorkspaceWatchManager.test.ts` using a STUBBED `child_process.fork` (inject a fake fork that returns an EventEmitter pretending to be a ChildProcess — do NOT spawn a real worker in unit tests). Cover: (a) acquire 0→1 spawns worker, acquire same consumerId again is a no-op, acquire second consumer on same workspace adds to the set without re-spawning; (b) release to 0 consumers sends unwatch + deletes entry + shuts down worker when watched.size===0; (c) switchWorkspace = release+acquire+rescan sequence (verify order via spy on `send`); (d) malformed worker message → terminateAndRestart called (verify restart counter incremented + worker re-spawned); (e) crash exit with watched.size>0 under cap → re-fork + re-send watch-workspace for each watched entry; (f) crash exit over cap (4th in 60s) → status 'failed' + no re-fork + error emitted; (g) shutdown sends shutdown command then force-kills after timeout.
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs WorkspaceWatchManager WorkspaceWatchRestarter && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "class WorkspaceWatchManager" src/service/workspaceWatch/WorkspaceWatchManager.ts` returns 1
    - `grep -c "fork(" src/service/workspaceWatch/WorkspaceWatchManager.ts` returns ≥1
    - `grep -c "workerEventSchema.safeParse\|safeParse" src/service/workspaceWatch/WorkspaceWatchManager.ts` returns ≥1 (WAT-06 enforced in main)
    - WorkspaceWatchManager tests cover all 7 cases (a-g) above
    - Switch-workspace test asserts the `send` spy was called with `unwatch-workspace` BEFORE `watch-workspace` for the new id (SC2 ordering)
    - Restart-cap test asserts the 4th crash in 60s sets status 'failed' and does NOT re-fork
    - Malformed-message test asserts terminateAndRestart is invoked on safeParse failure
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>Manager owns the worker lifecycle (acquire/release/switch/rescan/shutdown) with per-workspace consumer ref counting, restart-cap crash handling (max 3/60s), and main-side zod validation of every worker message (WAT-06). Plan 14-03 wires it into the IPC layer.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| worker → main (IPC event) | Main treats every worker→main message as UNTRUSTED — safeParse before any state mutation or registry apply (WAT-06). |
| snapshot → registry/cache | The trust-filter boundary: `applyWorkspaceSnapshot(snapshot, trust)` drops untrusted instructions/commands BEFORE `applySnapshot` mutates the registry (TRS-01). |
| workspace approval → trust derivation | `WorkspaceTrustFilter.derivePhase14Trust` is the only place workspace approval state becomes trust flags — single chokepoint, no other code path can flip a trust flag. |
| crash → restart decision | `WorkspaceWatchRestarter` is the only place restart-cap accounting happens — bounded 3/60s, no infinite respawn. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-14-01 | Tampering / Elevation | AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot (TRS-01) | high | mitigate | Trust filter drops untrusted instructions/commands BEFORE applySnapshot. Single chokepoint — manager ALWAYS routes workspace snapshots through applyWorkspaceSnapshot, never applySnapshot directly (encoded as a prohibition + tested). |
| T-14-06b | Tampering | WorkspaceWatchManager message dispatch (worker→main) | high | mitigate | workerEventSchema.safeParse on every message; failure → terminateAndRestart. Test covers the malformed-message path. |
| T-14-04 | DoS | WorkspaceWatchRestarter (crash loop) | medium | mitigate | Sliding 60s window, max 3 restarts; exceeded → status 'failed' + stop auto-watch + emit diagnostic. `/reload-config` (Phase 13) is the manual retry. |
| T-14-Orphan | Resource exhaustion | WorkspaceWatchManager.shutdown | medium | mitigate | shutdown() sends shutdown command, awaits 2s, then SIGKILL — no orphan workers (research §Pitfall 7). |
| T-14-Switch | Tampering (stale state) | switchWorkspace race | medium | mitigate | Serialized release(old)+acquire(new)+rescan(new) on the manager side; Node IPC is per-process ordered; immediate rescan guarantees a fresh snapshot reaches the renderer (SC2). |
</threat_model>

<verification>
- `npx vitest run --config vite.main.config.mjs AIFetchlyRuntimeRegistrySync.trust WorkspaceTrustFilter WorkspaceWatchManager WorkspaceWatchRestarter` — all 4 test files green
- `yarn tsc --noEmit` clean
- `grep -c "applyWorkspaceSnapshot" src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` ≥ 1
- Manual reasoning: the manager has NO direct dependency on AIFetchlyRuntimeRegistrySync or the Electron BrowserWindow — both are injected as callbacks (test-friendly + isolates concerns)
</verification>

<success_criteria>
- TRS-01: untrusted workspace instructions/commands never reach the registry (tested at the apply boundary, not UI-disabled)
- WAT-01: one worker for all acquired workspaces; 0 watched → no worker
- WAT-03: acquire/release/rescan/shutdown with per-workspace consumer ref counting
- WAT-04: switch = release+acquire+immediate snapshot (SC2)
- WAT-07: crash → bounded restart (max 3/60s) + full rescan; exceeded → stop + diagnostic
- WAT-06: malformed worker message → terminate + restart (main-side safeParse)
</success_criteria>

<output>
Create `.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md` when done
</output>

## Artifacts this plan produces

**New files:**
- `src/service/workspaceWatch/WorkspaceWatchManager.ts` — ref-counted lifecycle + worker fork + message dispatch + crash handling
- `src/service/workspaceWatch/WorkspaceWatchRestarter.ts` — sliding 60s window restart-cap accounting
- `src/service/workspaceWatch/WorkspaceTrustFilter.ts` — Phase 14 binary trust derivation
- `test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts`
- `test/vitest/main/service/workspaceWatch/WorkspaceTrustFilter.test.ts`
- `test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.test.ts`
- `test/vitest/main/service/workspaceWatch/WorkspaceWatchRestarter.test.ts`

**Modified files:**
- `src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts` — add `applyWorkspaceSnapshot(snapshot, trust)` method (existing applySnapshot unchanged)

**New symbols exported:**
- `WorkspaceWatchManager` class (acquire, release, switchWorkspace, rescan, shutdown, getStatus)
- `WorkspaceWatchRestarter` class (recordRestart, canRestart, reset)
- `derivePhase14Trust(workspaceApproved)` function
- `AIFetchlyRuntimeRegistrySync.prototype.applyWorkspaceSnapshot(snapshot, trust)` method
