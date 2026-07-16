---
phase: 14-workspace-watcher-worker
plan: 14-03-main-ipc-integration
subsystem: main-process
tags: [typescript, electron, ipc, preload-whitelist, registerValidatedHandler, zod, lifecycle-hook, three-layer-module]

requires: [14-02-manager-trust-filter]
provides:
  - registerWorkspaceWatchHandlers(win, manager) — registers 4 NEW invoke channels (AIFETCHLY_WORKSPACE_WATCH_ACQUIRE / _RELEASE / _TRUST_PREVIEW / _TRUST_SET) via registerValidatedHandler with zod input schemas (WAT-06 / CFG-02 / TRS-03). The handlers construct a per-request WorkspaceWatchModule that delegates to WorkspaceWatchManager + WorkspaceResolver + WorkspaceModule (three-layer rule — no DB access in the IPC layer).
  - WorkspaceWatchModule — thin three-layer Module per CLAUDE.md. acquire resolves the approved workspace root via WorkspaceResolver BEFORE forwarding to the manager (CFG-02 — renderer paths never trusted); release delegates; previewAgents returns the AGENTS.md file BODY from the manager's cached snapshot (TRS-07 — never a path); setTrust updates approval via WorkspaceModule + triggers manager.rescan so the next changed event applies with updated trust.
  - WorkspaceWatchManagerSingleton — production wiring: owns the manager singleton, a synchronous approval cache backing the manager's trustResolver (the resolver signature is sync; WorkspaceResolver.resolve is async — bridged via cache populated on acquire/setTrust), and the BrowserWindow-aware emitter closure.
  - forwardManagerEvent(win, event) — adapts WorkspaceWatchManagerEvent → AIFETCHLY_CONFIG_CHANGED renderer payload (D-04 additive workspaceId; source stays bare-string).
  - Channel constants AIFETCHLY_WORKSPACE_WATCH_ACQUIRE/RELEASE + AIFETCHLY_WORKSPACE_TRUST_PREVIEW/SET in channellist.ts.
  - Preload whitelist entries for the 4 invoke channels (invoke-only — D-04 reuses AIFETCHLY_CONFIG_CHANGED for events, so receive/removeListener/removeAllListeners already cover the event side from Phase 13).
  - AIFetchlyConfigManager.setWorkspaceWatchManager(manager) — wires the singleton so getStatus().watcherState reflects the real manager state (DX-02). Widened watcherState type: "not-started" | "watching" | "failed".
  - background.ts before-quit shutdown hook (WAT-07 — graceful shutdown + SIGKILL after 2s, no orphan workers).
  - AifetchlyConfigChangedEvent extended additively with optional workspaceId + diff + diagnostic + message fields (D-04).
affects: [14-04-renderer-trust-card, 14-05-i18n-boundary-tests]

tech-stack:
  added: []
  patterns:
    - Three-layer Module (CLAUDE.md) — WorkspaceWatchModule has NO direct DB access; delegates to WorkspaceModule (existing) for approval writes and WorkspaceResolver for root resolution
    - Per-request module construction (mirror of SlashCommandModule pattern from Phase 13-03b)
    - registerValidatedHandler + lazySchema + zod for every invoke channel (WAT-06 — malformed input rejected at the boundary before the handler runs)
    - Sync approval cache bridging async WorkspaceResolver.resolve → sync trustResolver signature required by WorkspaceWatchManager
    - Additive event-payload extension (D-04) — bare-string `source` preserved so the Phase 13-04 subscriber that ignores the payload arg (AiChatV2.vue onAifetchlyConfigChanged) keeps working

key-files:
  created:
    - src/main-process/communication/workspace-watch-ipc.ts
    - src/modules/WorkspaceWatchModule.ts
    - src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts
    - test/vitest/main/ipc/workspace-watch-ipc.test.ts
    - test/vitest/main/service/AIFetchlyConfigManager.watcher.test.ts
  modified:
    - src/config/channellist.ts                                    # 4 channel constants
    - src/preload.ts                                               # 4 entries in the invoke whitelist
    - src/main-process/communication/index.ts                      # registerWorkspaceWatchHandlers(win, manager) call
    - src/service/workspaceWatch/WorkspaceWatchManager.ts          # +getWorkspaceSnapshot accessor (minimal additive)
    - src/service/aifetchlyConfig/AIFetchlyConfigManager.ts        # +getRegistrySync accessor + setWorkspaceWatchManager + widened watcherState + computeWatcherState
    - src/background.ts                                            # startup setWorkspaceWatchManager wiring + before-quit shutdown hook
    - src/views/api/slashCommands.ts                               # additive workspaceId + diff + diagnostic + message on AifetchlyConfigChangedEvent

decisions:
  - "[14-03 D-1]: WorkspaceWatchModule is a plain class (NOT extending BaseModule). Per CLAUDE.md: a Module that does not need DB access should not extend BaseModule. The module delegates trust-state writes to the existing WorkspaceModule and root resolution to WorkspaceResolver. This matches the SlashCommandModule pattern from Phase 13-03b. Verified by grep gate (0 typeorm/Repository/getDataSource/SqliteDb references in the file)."
  - "[14-03 D-2]: The 4 invoke channels use registerValidatedHandler (the NON-AI wrapper), NOT registerAiValidatedHandler. The watcher is not AI-serving — it loads local config files. CLAUDE.md's USER_AI_ENABLED rule applies only to handlers that execute AI work; the watcher's acquire/release/preview/setTrust do not. Same rationale as Phase 13-03b slash-command-ipc.ts (TRS-05 Strategy A)."
  - "[14-03 D-3]: Singleton wiring lives in a new file WorkspaceWatchManagerSingleton.ts. The plan's files_modified did not list it, but the IPC + background.ts wiring needs ONE owner for: (a) the manager instance, (b) the sync approval cache backing the manager's trustResolver, (c) the BrowserWindow-aware emitter closure. The singleton lazily constructs on first init call from registerCommunicationIpcHandlers (research §Anti-Patterns: never block app launch on the watcher). Rule 2 auto-add: missing critical wiring infrastructure."
  - "[14-03 D-4]: Sync approval cache bridges the async WorkspaceResolver.resolve → sync trustResolver signature required by WorkspaceWatchManager. The cache is populated on acquire (resolver returned an approved workspace) and setTrust (approveWorkspace write succeeded). The cache is the runtime source of truth between DB writes; the DB is the persistent source of truth. Known limitation: revoking via the existing workspace-revoke IPC (Phase 12) does NOT invalidate the cache — the watcher keeps applying trust until app restart. Phase 17 replaces this with the per-capability AIFetchlyWorkspaceTrust entity (proper source of truth, async-capable)."
  - "[14-03 D-5]: previewAgents reads from the manager's cached lastSnapshot (NOT a fresh disk scan). The snapshot was JUST produced by the worker — a fresh scan would duplicate work. Added a minimal getWorkspaceSnapshot accessor to WorkspaceWatchManager (3 lines) for this. TRS-07 boundary preserved: the IPC response carries the file BODY string, never the path; even a compromised renderer cannot re-read the file from the response."
  - "[14-03 D-6]: AifetchlyConfigChangedEvent extension is STRICTLY additive. The existing {source: "user", summary} path (Phase 13 slash-command-ipc.ts) is preserved verbatim. The workspace path adds {workspaceId, diff?, diagnostic?, message?}. The `source` field stays a bare string — renaming it to a `"user" | "workspace"` union was considered and rejected (A2 resolution: the Phase 13-04 subscriber ignores the payload arg, so additive workspaceId is safe AND renaming source would add risk for zero benefit). Verified by reading AiChatV2.vue line ~1918."
  - "[14-03 D-7]: setTrust throws on non-numeric workspaceId rather than returning false. registerValidatedHandler's try/catch surfaces this as a status:false envelope — fail-closed for invalid input. The schema accepts any string (matches the workspaceId convention used throughout the watcher stack); the runtime numeric check happens in the module. This is consistent with the existing WorkspaceModule.approveWorkspace(id: number) contract."

test-results:
  command: "yarn testmain run test/vitest/main/ipc/workspace-watch-ipc.test.ts test/vitest/main/service/AIFetchlyConfigManager.watcher.test.ts"
  total: 19 passed (19)
  files:
    - workspace-watch-ipc.test.ts (13) — acquire (3: delegates with consumerId `chat:<convId>`, fail-closed on resolver null, NEVER trusts renderer-provided workspaceRoot), release (2: delegates, uses renderer-provided id when resolver has no record), preview (3: returns CONTENT not path, returns null when no snapshot, zod rejects non-string id), setTrust (4: instructions scope approves + rescans, all scope also approves, zod rejects invalid scope, fails closed on non-numeric id), acquire malformed payload (1: zod rejects missing conversationId). GREEN.
    - AIFetchlyConfigManager.watcher.test.ts (6) — DX-02 integration: no-manager → "not-started", not-started → "not-started", running → "watching", restarting → "watching" (folded), failed → "failed", compile-time union-width assertion. GREEN.
  tsc-gate: clean (tsc --noEmit via vite.main.config.mjs globalSetup; NOT bypassed with AIFETCHLY_SKIP_TSC)

verification:
  must_haves_status: all GREEN
  - "Four NEW invoke channels registered via registerValidatedHandler with zod input schemas (WAT-06 / CFG-02 / TRS-03)": GREEN
  - "Every NEW invoke channel is in the preload invoke whitelist (invoke-only — D-04 reuses AIFETCHLY_CONFIG_CHANGED for events; receive/removeListener/removeAllListeners already cover it from Phase 13)": GREEN (grep AIFETCHLY_WORKSPACE_WATCH_ACQUIRE → 2 hits in preload.ts)
  - "WorkspaceWatchModule is a thin three-layer Module; NO DB access (no typeorm/Repository/getDataSource/SqliteDb imports)": GREEN (grep returns 0)
  - "IPC handler MUST NOT call WorkspaceWatchManager or DB directly — delegates through WorkspaceWatchModule": GREEN (workspace-watch-ipc.ts constructs `new WorkspaceWatchModule(...)` per request)
  - "IPC handler MUST NOT trust renderer-provided workspaceRoot — resolves via WorkspaceResolver from conversationId (CFG-02)": GREEN (zod schema accepts only {conversationId, workspaceId?}; workspaceRoot never appears in the request shape. Test asserts a renderer-supplied workspaceRoot is never forwarded.)
  - "WorkspaceResolver.resolve(conversationId) confirms workspace root BEFORE acquire (CFG-02)": GREEN (module.acquire awaits resolver.resolve; returns null on null)
  - "AIFETCHLY_CONFIG_CHANGED payload extended additively with optional workspaceId; existing `source` field retains bare-string type": GREEN (slashCommands.ts AifetchlyConfigChangedEvent; slash-command-ipc.ts emitConfigChanged unchanged)
  - "AIFetchlyConfigManager.getStatus().watcherState reflects real manager state (DX-02)": GREEN (computeWatcherState maps workerState → watcherState union; 6 tests cover all values)
  - "background.ts hooks WorkspaceWatchManager.shutdown() into before-quit (WAT-07)": GREEN (try/catch around getWorkspaceWatchManager()?.shutdown())
  - "MUST NOT block app launch on the watcher — the manager is initialized lazily on first acquire": GREEN (initWorkspaceWatchManager constructs the manager synchronously with no fork; fork happens on first acquire inside the manager)
  - "tsc --noEmit clean": GREEN (vitest globalSetup)

handoff:
  next-plan: 14-04-renderer-trust-card
  next-plan-needs:
    - The 4 invoke channels are wired and whitelisted; the renderer can import from @/config/channellist and call via windowInvoke (mirror src/views/api/slashCommands.ts pattern).
    - `AifetchlyConfigChangedEvent.workspaceId` is now in the type; Plan 14-04's renderer subscriber filters by active workspace.
    - The trust-card "Preview" action should invoke AIFETCHLY_WORKSPACE_TRUST_PREVIEW with the workspaceId returned from acquire; the response.data.content is the AGENTS.md body string (TRS-07 — render directly, never treat as a path).
    - The trust-card "Trust instructions only" / "Trust all workspace AI config" actions should invoke AIFETCHLY_WORKSPACE_TRUST_SET with the appropriate scope. Phase 14 binary gate approves for both scopes (WorkspaceTrustFilter.derivePhase14Trust); Phase 17 will branch on scope.
    - The "Keep disabled" action sends NO IPC — the trust card is just dismissed.
    - On chat-open: invoke AIFETCHLY_WORKSPACE_WATCH_ACQUIRE; cache the returned workspaceId string for release/preview/setTrust.
    - On chat-close / AiChatV2 unmount: invoke AIFETCHLY_WORKSPACE_WATCH_RELEASE with the cached workspaceId (or just conversationId — main resolves).
    - Plan 14-04 should add a subscriber filter so AIFETCHLY_CONFIG_CHANGED events only refresh the active conversation's cache (compare event.workspaceId against the cached workspaceId from acquire).

threat-model-mitigations:
  - T-14-Path-render (CFG-02 path spoofing): MITIGATED — zod schema accepts only {conversationId, workspaceId?}; workspaceRoot is NOT in the request shape. WorkspaceWatchModule.acquire re-resolves the root via WorkspaceResolver before forwarding to the manager. Test asserts a renderer-supplied workspaceRoot is never forwarded (the field is schema-stripped).
  - T-14-Leak-v2 (info disclosure via AIFETCHLY_CONFIG_CHANGED payload): MITIGATED — the event payload carries counts + diff metadata + workspaceId only, never raw file bodies. The preview content goes through a SEPARATE invoke channel returning a body string (TRS-07 — preview returns the file body, not a path the renderer could re-read).
  - T-14-07 (orphan worker on shutdown): MITIGATED — background.ts before-quit calls manager.shutdown() which sends shutdown + SIGKILL after 2s. WorkspaceWatchManager.shutdown() tested in 14-02 (case g).
  - T-14-Inject (tampering via invoke channels): MITIGATED — all 4 invoke channels use registerValidatedHandler + zod schemas. Unexpected fields rejected at the boundary before the handler runs. Tests cover the validation matrix (missing conversationId, non-string workspaceId, invalid scope enum).

deviations:
  rule_2_auto_add:
    - "WorkspaceWatchManagerSingleton.ts (NEW file): the plan's files_modified did not list this file but the wiring needs an owner for the singleton + sync approval cache + BrowserWindow-aware emitter closure. Rule 2 (missing critical wiring infrastructure). ~70 lines."
    - "WorkspaceWatchManager.getWorkspaceSnapshot(id) (3-line accessor added to 14-02 source): the preview flow (TRS-07) needs to read AGENTS.md content from the cached snapshot. The manager owns the snapshot cache; exposing it via a read-only accessor is the minimal-cohesive path. Rule 2 (missing critical functionality — preview requires it)."
    - "AIFetchlyConfigManager.getRegistrySync() (3-line accessor added in this plan): the singleton wiring shares the same AIFetchlyRuntimeRegistrySync instance so workspace snapshots apply through the same trust-filtered path as the global scan. Rule 2 (missing critical wiring)."
  rule_3_blocking_fix: []
  rule_4_architectural: []

known_limitations:
  - "Sync approval cache in WorkspaceWatchManagerSingleton does NOT auto-invalidate on revoke via the existing workspace-revoke IPC (Phase 12). Edge case: user revokes an active workspace mid-session; the watcher keeps applying trust for a few seconds until app restart. Acceptable for Phase 14 binary gate; Phase 17 replaces this cache with the per-capability AIFetchlyWorkspaceTrust entity (proper source of truth, async-capable)."

note: |
  Plan executed atomically across 2 commits (ea3649e6 Task 1: IPC + Module +
  channels + preload, cbaee8e7 Task 2: watcherState + shutdown + payload).
  Each independently green + tsc-clean. 108/108 Phase 13 + 14 tests GREEN
  after the plan — no regressions.

## Self-Check: PASSED

All 8 created/modified files exist on disk; both task commits (ea3649e6,
cbaee8e7) found in git history. 19/19 plan tests GREEN; 108/108 Phase 13+14
tests GREEN; tsc gate clean.
