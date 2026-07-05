---
phase: 14-workspace-watcher-worker
plan: 03
slug: main-ipc-integration
type: execute
wave: 3
depends_on: [14-02-manager-trust-filter]
files_modified:
  - src/config/channellist.ts
  - src/preload.ts
  - src/main-process/communication/workspace-watch-ipc.ts
  - src/main-process/communication/index.ts
  - src/modules/WorkspaceWatchModule.ts
  - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
  - src/background.ts
autonomous: true
requirements: [CFG-02, CTX-02, WAT-07]
tags: [typescript, electron, ipc, preload-whitelist, registerValidatedHandler, lifecycle-hook]

must_haves:
  truths:
    - "Four NEW invoke channels (AIFETCHLY_WORKSPACE_WATCH_ACQUIRE / _RELEASE / _PREVIEW / _TRUST_SET) are registered via registerValidatedHandler with zod input schemas (WAT-06 / CFG-02 / TRS-03)"
    - "Every NEW invoke channel is added to the preload invoke whitelist AND the relevant receive/removeListener/removeAllListeners whitelists IF it has event semantics (these 4 are invoke-only — no event receive entries needed; verify by reading preload.ts)"
    - "WorkspaceWatchModule is a thin three-layer Module (per CLAUDE.md): acquire/release/preview/setTrust delegate to WorkspaceWatchManager + WorkspaceResolver; it contains NO DB access (worker has none, and Phase 14 has no new entity)"
    - "The AIFETCHLY_CONFIG_CHANGED payload is extended additively with optional workspaceId; the existing source field retains its bare-string type (Phase 13-04 subscriber ignores the payload arg — verified by reading AiChatV2.vue line ~1918; additive extension cannot break it)"
    - "Manager singleton wires AIFetchlyConfigManager.getStatus().watcherState from 'not-started' (Phase 13 placeholder) to a real status reflecting the WorkspaceWatchManager (watching / not-started / failed) (DX-02)"
    - "background.ts hooks WorkspaceWatchManager.shutdown() into app 'before-quit' (WAT-07 no-orphan-workers guarantee)"
    - "WorkspaceResolver.resolve(conversationId) confirms the workspace root against stored approved state BEFORE acquire — renderer-provided paths are NEVER trusted directly (CFG-02)"
    - "Trust-set IPC updates the workspace approval state via the existing WorkspaceModule (no new entity); the next worker changed event re-applies with the new trust flags"
  artifacts:
    - "src/main-process/communication/workspace-watch-ipc.ts — registerWorkspaceWatchHandlers(win, manager)"
    - "src/modules/WorkspaceWatchModule.ts — three-layer Module (acquire/release/preview/setTrust)"
    - "Four channel constants in src/config/channellist.ts (AIFETCHLY_WORKSPACE_WATCH_ACQUIRE/RELEASE/PREVIEW/TRUST_SET)"
    - "Extended AIFetchlyConfigManager.getStatus() watcherState (real value, not 'not-started')"
    - "background.ts before-quit shutdown hook"
  prohibitions:
    - "IPC handler MUST NOT call WorkspaceWatchManager or DB directly — delegate through WorkspaceWatchModule (CLAUDE.md three-layer rule)"
    - "IPC handler MUST NOT trust renderer-provided workspaceRoot — resolve via WorkspaceResolver from conversationId (CFG-02)"
    - "MUST NOT add a new event-channel constant for AIFETCHLY_CONFIG_CHANGED (D-04 reuses the existing one — verified already in all 4 preload whitelists at lines 329/451/517/546)"
    - "MUST NOT block app launch on the watcher — the manager is initialized lazily on first acquire (research §Anti-Patterns)"
  key_links:
    - "AiChatV2.vue onMounted → AIFETCHLY_WORKSPACE_WATCH_ACQUIRE → WorkspaceWatchModule.acquire → WorkspaceResolver.resolve → WorkspaceWatchManager.acquire"
    - "Worker 'changed' event → WorkspaceWatchManager message handler → applyWorkspaceSnapshot(snapshot, trust) → emitConfigChanged(win, {source:'workspace', workspaceId, summary, diff})"
    - "background.ts before-quit → WorkspaceWatchManager.shutdown() → send shutdown + SIGKILL after 2s"
---

<objective>
Wire the manager from Plan 14-02 into the Electron main process: the four invoke-channel IPC handlers (acquire/release/preview/trust-set) via `registerValidatedHandler` + zod, the preload whitelist additions for the new invoke channels, the three-layer `WorkspaceWatchModule`, the `WorkspaceResolver`-backed root confirmation (CFG-02), the singleton wiring into `AIFetchlyConfigManager.getStatus()`, the `background.ts` before-quit shutdown hook (WAT-07), and the additive extension of the `AIFETCHLY_CONFIG_CHANGED` event payload with `workspaceId` (D-04 — reuses the existing channel, zero new event-channel whitelist entries).

Purpose: Connect the worker + manager into the app's runtime so that opening an AiChatV2 conversation acquires the watch, file changes flow through trust-filtered apply to the registry, and the renderer is notified with a workspace-scoped event it can filter on.

Output: The complete main-process integration layer; after this plan, the renderer can drive the watcher via IPC (Plan 14-04 adds the UI).
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
@.planning/phases/14-workspace-watcher-worker/14-02-SUMMARY.md

@docs/prd/aifetchly-local-extensibility-technical-design.md

# Phase 13 IPC patterns to mirror (registerValidatedHandler + emitConfigChanged shape)
@src/main-process/communication/slash-command-ipc.ts
@src/main-process/communication/_shared/registerValidatedHandler.ts
@src/main-process/communication/index.ts

# Preload 4-whitelist discipline (research §Pitfall 3)
@src/preload.ts

# AIFetchlyConfigManager singleton (getStatus watcherState placeholder)
@src/service/aifetchlyConfig/AIFetchlyConfigManager.ts

# Symbols from Plans 14-01 and 14-02 being consumed
@src/service/workspaceWatch/WorkspaceWatchManager.ts
@src/service/workspaceWatch/WorkspaceTrustFilter.ts
@src/service/workspaceWatch/WorkspaceConfigScanner.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Channel constants + preload whitelists + WorkspaceWatchModule + workspace-watch-ipc handlers</name>
  <files>src/config/channellist.ts, src/preload.ts, src/modules/WorkspaceWatchModule.ts, src/main-process/communication/workspace-watch-ipc.ts, src/main-process/communication/index.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Pitfall 3 preload 4 whitelists — verified AIFETCHLY_CONFIG_CHANGED already in invoke(329)/receive(451)/removeListener(517)/removeAllListeners(546))
    - docs/prd/aifetchly-local-extensibility-technical-design.md §10.1 (chat-open acquire flow + consumer IDs), §10.4 (switch flow), §13 (trust prompt IPC)
    - src/main-process/communication/slash-command-ipc.ts (the existing registerValidatedHandler + emitConfigChanged pattern — mirror exactly)
    - src/main-process/communication/_shared/registerValidatedHandler.ts (signature: registerValidatedHandler<TInput, TOutput>(channel, schema, handler))
    - src/main-process/communication/index.ts (where registerSlashCommandHandlers is called — add registerWorkspaceWatchHandlers adjacent)
    - src/preload.ts (lines ~325-548 — the 4 whitelists; identify exactly which lists need the new entries)
    - src/config/channellist.ts (lines ~299-313 — where AIFETCHLY_CONFIG_* constants live)
    - src/modules/WorkspaceModule.ts (existing — find the workspace approval state setter to call from setTrust)
  </read_first>
  <action>
    Add four channel constants to `src/config/channellist.ts` adjacent to the existing `AIFETCHLY_CONFIG_*` block: `AIFETCHLY_WORKSPACE_WATCH_ACQUIRE = "aifetchly-workspace-watch:acquire"`, `AIFETCHLY_WORKSPACE_WATCH_RELEASE = "aifetchly-workspace-watch:release"`, `AIFETCHLY_WORKSPACE_TRUST_PREVIEW = "aifetchly-workspace-trust:preview"`, `AIFETCHLY_WORKSPACE_TRUST_SET = "aifetchly-workspace-trust:set"`. Add doc comments per the existing convention (Renderer->Main invoke).

    Add the four invoke channels to `src/preload.ts` invoke whitelist ONLY (these are invoke channels, not event channels — they do NOT need receive/removeListener/removeAllListeners entries; verify by inspecting how SLASH_COMMAND_LIST is whitelisted vs AIFETCHLY_CONFIG_CHANGED). If the repo pattern requires all 4 lists be touched for invoke channels, follow the pattern — but the research confirms invoke-only channels need only the invoke list. Add a short comment per the Phase 13 convention.

    Create `src/modules/WorkspaceWatchModule.ts` per CLAUDE.md three-layer rule. The module is a thin facade: constructor takes the `WorkspaceWatchManager` singleton (or constructs/looks it up) plus a `WorkspaceResolver`-shaped helper. Methods: `acquire({conversationId, workspaceId?})` resolves the approved workspace root via WorkspaceResolver (CFG-02 — never trust the renderer path), then delegates to `manager.acquire({workspaceId, workspaceRoot, consumerId:\`chat:${conversationId}\`})`; `release({conversationId, workspaceId?})`; `previewAgents({workspaceId})` returns the trusted workspace AGENTS.md content string (read via the main-process WorkspaceConfigScanner or AIFetchlyConfigLoader — NEVER by the renderer, TRS-07); `setTrust({workspaceId, scope: "instructions" | "all"})` updates the workspace approval state via WorkspaceModule + triggers a manager.rescan(workspaceId) so the next changed event applies with updated trust. NO DB code in this module — it delegates.

    Create `src/main-process/communication/workspace-watch-ipc.ts` exporting `registerWorkspaceWatchHandlers(win: BrowserWindow, manager: WorkspaceWatchManager)` mirroring slash-command-ipc.ts. Use `registerValidatedHandler` for each of the four channels with zod input schemas: acquireRequestSchema ({conversationId: string, workspaceId?: string}), releaseRequestSchema (same), previewRequestSchema ({workspaceId: string}), setTrustRequestSchema ({workspaceId: string, scope: z.enum(["instructions","all"])}). Each handler constructs `new WorkspaceWatchModule(manager)` (or reuses a singleton) and delegates. Wire the manager's `configChangedEmitter` callback to call `emitConfigChanged(win, {source: "workspace", workspaceId, summary, diff})` — reuse the existing emitConfigChanged helper from slash-command-ipc.ts (extract it to a shared module OR re-implement here with the same webContents.isDestroyed guard).

    Register `registerWorkspaceWatchHandlers(win, manager)` in `src/main-process/communication/index.ts` adjacent to the existing `registerSlashCommandHandlers(win)` call.

    Write `test/vitest/main/ipc/workspace-watch-ipc.test.ts` covering: acquire delegates to manager.acquire with consumerId `chat:<conversationId>`; release delegates; preview returns a string (NOT a file path the renderer could re-read); setTrust rescans. Use a stubbed manager + stubbed WorkspaceResolver. Assert the renderer NEVER receives a raw absolute file path in any response (TRS-07 — preview content is the file body, not the path).
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs workspace-watch-ipc && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "AIFETCHLY_WORKSPACE_WATCH_ACQUIRE\|AIFETCHLY_WORKSPACE_WATCH_RELEASE\|AIFETCHLY_WORKSPACE_TRUST_PREVIEW\|AIFETCHLY_WORKSPACE_TRUST_SET" src/config/channellist.ts` returns ≥4
    - `grep -c "AIFETCHLY_WORKSPACE_WATCH_ACQUIRE" src/preload.ts` returns ≥1 (in the invoke whitelist)
    - `grep -c "registerWorkspaceWatchHandlers" src/main-process/communication/index.ts` returns ≥1
    - `src/modules/WorkspaceWatchModule.ts` exists and imports neither typeorm nor a repository (three-layer compliance)
    - workspace-watch-ipc test asserts acquire calls manager.acquire with consumerId matching `^chat:<conversationId>$`
    - preview test asserts the response is the file CONTENT (string body), not a path
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>Four invoke channels live via registerValidatedHandler + zod; preload whitelists updated; WorkspaceWatchModule is the three-layer delegate; WorkspaceResolver confirms roots (CFG-02).</done>
</task>

<task type="auto">
  <name>Task 2: AIFetchlyConfigManager watcherState integration + background.ts shutdown hook + emitConfigChanged payload extension</name>
  <files>src/service/aifetchlyConfig/AIFetchlyConfigManager.ts, src/background.ts, src/main-process/communication/workspace-watch-ipc.ts, src/views/api/slashCommands.ts, test/vitest/main/service/AIFetchlyConfigManager.watcher.test.ts</files>
  <read_first>
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-03a-SUMMARY.md (getStatus watcherState hardcoded 'not-started' — Phase 14 placeholder)
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts (existing getStatus + the watcherState placeholder at line ~144)
    - src/main-process/communication/slash-command-ipc.ts (emitConfigChanged — the JSON-stringified {source, summary} payload)
    - src/views/api/slashCommands.ts (AifetchlyConfigChangedEvent interface — add optional workspaceId)
    - src/background.ts (find the existing before-quit / will-quit hooks to extend)
    - src/views/components/aiChatV2/AiChatV2.vue (line ~1918 — confirm the subscriber uses `() =>` arrow ignoring the payload, so additive extension is safe; A2 resolution)
  </read_first>
  <action>
    Edit `src/service/aifetchlyConfig/AIFetchlyConfigManager.ts`: change `getStatus().watcherState` from the hardcoded `"not-started"` to a real value derived from an injected WorkspaceWatchManager reference. Add a `setWorkspaceWatchManager(manager)` method (called once during main-process startup, after the manager is constructed) that stores the reference. `getStatus()` returns `manager ? manager.getStatus().watcherState : "not-started"` — values include `"not-started"`, `"watching"`, `"failed"`. Update the `AIFetchlyConfigStatus.watcherState` type from the literal `"not-started"` to the union `"not-started" | "watching" | "failed"`. Keep `getStatus()` synchronous (manager.getStatus is sync).

    Edit `src/background.ts`: in the `app.on('before-quit')` or `app.on('will-quit')` handler (whichever exists — if none, add `before-quit`), call `WorkspaceWatchManager.getInstance().shutdown()` (or the singleton accessor established in Plan 14-03 Task 1). The shutdown sends the shutdown command + force-kills after 2s (WAT-07 — no orphan workers). Make the call non-blocking for the SIGTERM path but ensure SIGKILL happens synchronously enough that the process dies before Electron exits (use `worker.kill('SIGKILL')` in the timeout path).

    Extend the `emitConfigChanged` helper (in slash-command-ipc.ts OR workspace-watch-ipc.ts — wherever the workspace-changed path emits) to include `workspaceId` in the JSON-stringified payload: `{source: "workspace", workspaceId, summary, diff}`. The existing global reload path keeps `{source: "user", summary}` (do NOT rename "user" to "global" — A2 resolution: the Phase 13-04 subscriber ignores the payload arg, so additive workspaceId is safe and renaming source would add risk for zero benefit).

    Edit `src/views/api/slashCommands.ts`: extend the `AifetchlyConfigChangedEvent` interface with optional `readonly workspaceId?: string` and `readonly diff?: AIFetchlyConfigDiff`. Keep `source: string` (bare string — backward-compat). Add a doc comment noting Phase 14 additive extension (Plan 14-04 consumes `workspaceId` for filtering).

    Write `test/vitest/main/service/AIFetchlyConfigManager.watcher.test.ts` covering: (a) without setWorkspaceWatchManager → getStatus returns watcherState "not-started"; (b) with a stubbed manager returning watcherState "watching" → getStatus returns "watching"; (c) manager returning "failed" → getStatus returns "failed".
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs AIFetchlyConfigManager.watcher && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '"not-started" | "watching" | "failed"' src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` returns ≥1 (widened watcherState type)
    - `grep -c "setWorkspaceWatchManager" src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` returns ≥1
    - `grep -c "WorkspaceWatchManager\|workspaceWatchManager" src/background.ts` returns ≥1 (shutdown hook wired)
    - `grep -c "workspaceId" src/views/api/slashCommands.ts` returns ≥1 (additive field on AifetchlyConfigChangedEvent)
    - AIFetchlyConfigManager.watcher test asserts all 3 watcherState values
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>Manager singleton integrated (getStatus shows real watcher state); app shutdown cleanly terminates the worker (no orphans); AIFETCHLY_CONFIG_CHANGED carries workspaceId additively (D-04).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → main (invoke channels) | zod-validated via registerValidatedHandler; the four new channels accept only the documented shapes. |
| renderer-supplied workspaceRoot → main | NEVER trusted — main resolves the approved root via WorkspaceResolver from conversationId (CFG-02). |
| main → renderer (AIFETCHLY_CONFIG_CHANGED event) | Payload carries counts + diff metadata + workspaceId only — never raw file bodies or prompt content (T-13-Leak control preserved). |
| app shutdown → worker | Graceful shutdown command then SIGKILL after 2s — worker cannot orphan. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-14-Path-render | Spoofing | renderer-supplied workspaceRoot | high | mitigate | WorkspaceResolver.resolve(conversationId) confirms against stored approved workspace; the renderer path string is NEVER passed to the manager (CFG-02). IPC test verifies acquire delegates the resolved root, not the renderer value. |
| T-14-Leak-v2 | Info Disclosure | AIFETCHLY_CONFIG_CHANGED payload | medium | mitigate | Payload carries counts/diff/workspaceId only — never raw AGENTS.md content or command bodies. Preview content goes through a separate invoke channel returning a body string (not a path). Mirrors T-13-Leak mitigation. |
| T-14-07 | DoS / Resource exhaustion | background.ts shutdown path | medium | mitigate | before-quit calls manager.shutdown() which sends shutdown + SIGKILL after 2s — no orphan workers (WAT-07). |
| T-14-Inject | Tampering | registerValidatedHandler input schemas | medium | mitigate | All 4 invoke channels use zod schemas; unexpected fields rejected at the boundary before the handler runs. |
</threat_model>

<verification>
- `npx vitest run --config vite.main.config.mjs workspace-watch-ipc AIFetchlyConfigManager.watcher` green
- `yarn tsc --noEmit` clean
- `grep -c AIFETCHLY_WORKSPACE_WATCH_ACQUIRE src/preload.ts` ≥ 1 (invoke whitelist)
- `grep -c AIFETCHLY_WORKSPACE_WATCH_ACQUIRE src/config/channellist.ts` ≥ 1
- Manual: app shutdown leaves no lingering worker process (`ps aux | grep WorkspaceConfigWatchWorker` returns empty after quit)
</verification>

<success_criteria>
- CFG-02: WorkspaceResolver confirms workspace root before acquire (renderer paths never trusted)
- CTX-02: worker changed events flow through trust-filtered apply → registry → AIFETCHLY_CONFIG_CHANGED{source:"workspace", workspaceId} → assembler picks up the trusted block on next request (no restart)
- WAT-07: app shutdown cleanly terminates the worker (no orphan processes)
- DX-02: getStatus().watcherState reflects the real manager state
</success_criteria>

<output>
Create `.planning/phases/14-workspace-watcher-worker/14-03-SUMMARY.md` when done
</output>

## Artifacts this plan produces

**New files:**
- `src/main-process/communication/workspace-watch-ipc.ts` — registerWorkspaceWatchHandlers(win, manager)
- `src/modules/WorkspaceWatchModule.ts` — three-layer Module (acquire/release/preview/setTrust)
- `test/vitest/main/ipc/workspace-watch-ipc.test.ts`
- `test/vitest/main/service/AIFetchlyConfigManager.watcher.test.ts`

**Modified files:**
- `src/config/channellist.ts` — four channel constants
- `src/preload.ts` — four entries in the invoke whitelist
- `src/main-process/communication/index.ts` — registerWorkspaceWatchHandlers call
- `src/service/aifetchlyConfig/AIFetchlyConfigManager.ts` — setWorkspaceWatchManager + widened watcherState type + getStatus reads real state
- `src/background.ts` — before-quit → manager.shutdown() hook
- `src/views/api/slashCommands.ts` — additive `workspaceId?` + `diff?` on AifetchlyConfigChangedEvent
- `src/main-process/communication/workspace-watch-ipc.ts` OR slash-command-ipc.ts — emitConfigChanged extended payload (D-04)

**New symbols exported:**
- `registerWorkspaceWatchHandlers(win, manager)`
- `WorkspaceWatchModule` class (acquire, release, previewAgents, setTrust)
- Channel constants: `AIFETCHLY_WORKSPACE_WATCH_ACQUIRE`, `AIFETCHLY_WORKSPACE_WATCH_RELEASE`, `AIFETCHLY_WORKSPACE_TRUST_PREVIEW`, `AIFETCHLY_WORKSPACE_TRUST_SET`
- `AIFetchlyConfigManager.setWorkspaceWatchManager(manager)` + widened `watcherState` union
