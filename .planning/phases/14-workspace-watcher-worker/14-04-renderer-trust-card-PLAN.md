---
phase: 14-workspace-watcher-worker
plan: 04
slug: renderer-trust-card
type: execute
wave: 4
depends_on: [14-03-main-ipc-integration]
files_modified:
  - src/views/api/workspaceWatch.ts
  - src/views/components/aiChatV2/WorkspaceTrustCard.vue
  - src/views/components/aiChatV2/AiChatV2.vue
  - src/entityTypes/aiChatV2Types.ts
  - test/vitest/main/components/WorkspaceTrustCard.test.ts
  - test/vitest/main/components/AiChatV2.workspaceTrust.test.ts
autonomous: false
requirements: [TRS-03, TRS-04, CTX-02]
tags: [vue3, vuetify, electron-renderer, ipc, trust-card, subscriber-filter]

must_haves:
  truths:
    - "WorkspaceTrustCard.vue renders inline (NOT modal/banner) in AiChatV2 when an approved workspace contains .aifetchly AND is not yet trusted (D-03, SC1 trigger on chat open)"
    - "The card shows the four TRS-03 options: Preview / Trust instructions only / Trust all workspace AI config / Keep disabled"
    - "Preview expands to show the workspace's AGENTS.md content supplied by the main process via AIFETCHLY_WORKSPACE_TRUST_PREVIEW — the renderer NEVER reads the file directly (TRS-07)"
    - "Clicking Trust instructions only / Trust all calls AIFETCHLY_WORKSPACE_TRUST_SET and the card emits 'trusted' with the scope; clicking Keep disabled emits 'dismissed' and the dismissal is persisted so the card does not reappear on every chat open"
    - "The AiChatV2 onAifetchlyConfigChanged subscriber is extended to filter by event.workspaceId === activeWorkspaceId.value (OR event.source === 'user' for global events) before refreshing the command cache (D-04)"
    - "Editing a trusted <workspace>/.aifetchly/AGENTS.md updates the AiChatV2 context without app restart (SC3) — verified by the subscriber-filter test"
    - "Instruction blocks injected from a trusted workspace are clearly labeled by source (Phase 13 formatInstructionBlock + workspaceId in the labeled prefix); external/scraped content cannot flip a trust flag (TRS-04)"
  artifacts:
    - "src/views/api/workspaceWatch.ts — flat windowInvoke wrappers (acquireWorkspaceWatch/releaseWorkspaceWatch/previewWorkspaceAgents/setWorkspaceTrust)"
    - "src/views/components/aiChatV2/WorkspaceTrustCard.vue — inline trust card (4 options + Preview expand)"
    - "Extended src/views/components/aiChatV2/AiChatV2.vue (subscriber filter + WorkspaceTrustCard mount condition + acquire/release lifecycle)"
  prohibitions:
    - "Renderer MUST NOT read .aifetchly/AGENTS.md via fs/path — preview content comes ONLY through the AIFETCHLY_WORKSPACE_TRUST_PREVIEW invoke channel (TRS-07 — boundary-tested in Plan 14-05)"
    - "Renderer MUST NOT call worker IPC channels directly — only via src/views/api/workspaceWatch.ts wrappers (Phase 13 Pattern 1)"
    - "Trust card MUST NOT be a modal dialog (too intrusive for a trust decision) or a banner (trust must persist) — D-03 locks it as an inline card"
    - "Subscriber filter MUST NOT drop global events (source==='user') — only filter the workspace-origin events by workspaceId"
  key_links:
    - "AiChatV2.vue onMounted → activeWorkspace resolved → if (approved && contains(.aifetchly) && !trusted) render WorkspaceTrustCard → on trust: AIFETCHLY_WORKSPACE_TRUST_SET → manager.rescan → AIFETCHLY_CONFIG_CHANGED{workspaceId} → subscriber refresh"
    - "AiChatV2.vue onAifetchlyConfigChanged callback → if (event.source==='user' || event.workspaceId===activeWorkspaceId.value) → refreshSlashCommandCount()"
---

<objective>
Build the renderer-visible half of the watcher: the inline `WorkspaceTrustCard.vue` (D-03) with the four TRS-03 options and a main-process-supplied AGENTS.md preview, the flat `src/views/api/workspaceWatch.ts` renderer API mirroring Phase 13's slashCommands.ts, and the AiChatV2 subscriber extension that filters `AIFETCHLY_CONFIG_CHANGED` by `workspaceId` so workspace-origin refreshes reach only the relevant chat (D-04). After this plan, editing a trusted `<workspace>/.aifetchly/AGENTS.md` refreshes AiChatV2 context without an app restart (SC3).

Purpose: Surface the trust decision to the user (TRS-03) and complete the live-update loop (CTX-02 / SC3) — the user approves once, and workspace config edits flow into the AI context automatically without restarts.

Output: The trust card component, the renderer API, and the subscriber filter — the user-visible Phase 14 surface.

**Note:** This plan is `autonomous: false` because it includes a human-verify checkpoint for the live-app trust-card UX (the 4-option flow cannot be fully validated by happy-dom component tests alone).
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
@.planning/phases/14-workspace-watcher-worker/14-03-SUMMARY.md
@.planning/phases/13-global-context-and-built-in-slash-commands/13-04-SUMMARY.md

@docs/prd/aifetchly-local-extensibility-technical-design.md

# D-03 structural templates (mirror the WorkspaceRequiredCard.vue shape)
@src/views/components/aiChatV2/WorkspaceRequiredCard.vue
@src/views/components/aiChatV2/WorkspaceBadge.vue

# Existing subscriber (line ~1918 — confirmed uses `() =>` ignoring the payload arg, A2 resolved)
@src/views/components/aiChatV2/AiChatV2.vue

# Renderer API pattern (flat windowInvoke mirroring src/views/api/workspace.ts)
@src/views/api/slashCommands.ts
@src/views/api/workspace.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Renderer API (workspaceWatch.ts) + WorkspaceTrustCard.vue with Preview + 4 TRS-03 options</name>
  <files>src/views/api/workspaceWatch.ts, src/views/components/aiChatV2/WorkspaceTrustCard.vue, src/entityTypes/aiChatV2Types.ts, test/vitest/main/components/WorkspaceTrustCard.test.ts</files>
  <read_first>
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Code Examples → WorkspaceTrustCard.vue skeleton + i18n keys)
    - docs/prd/aifetchly-local-extensibility-technical-design.md §13 (trust prompt UX), §8.4 (D-04 event routing)
    - src/views/components/aiChatV2/WorkspaceRequiredCard.vue (114-line Vuetify v-card template — mirror the structure: v-card-item header with icon, v-card-text body, v-card-actions with v-spacer + buttons; defineProps/defineEmits shape; useI18n + t()||'fallback' pattern)
    - src/views/api/slashCommands.ts (the flat windowInvoke + windowReceive pattern — mirror for workspaceWatch.ts)
    - src/config/channellist.ts (the four AIFETCHLY_WORKSPACE_WATCH_* / AIFETCHLY_WORKSPACE_TRUST_* constants from Plan 14-03)
    - src/preload.ts (confirm windowInvoke is wired for the four channels — Plan 14-03 added them)
  </read_first>
  <behavior>
    - Renderer API: acquireWorkspaceWatch({conversationId, workspaceId?}) / releaseWorkspaceWatch({conversationId, workspaceId?}) / previewWorkspaceAgents(workspaceId): Promise<string> / setWorkspaceTrust({workspaceId, scope: "instructions"|"all"}) — flat windowInvoke wrappers, no namespace
    - WorkspaceTrustCard.vue accepts props {workspaceId, conversationId}; emits 'trusted' with scope OR 'dismissed'
    - Card renders 4 buttons in this order: Preview (toggles expand) / Keep disabled (text variant) / Trust instructions only (tonal variant) / Trust all workspace AI config (primary flat variant)
    - Preview expand fetches AGENTS.md content ONCE via previewWorkspaceAgents then caches in a ref; subsequent toggles just show/hide (no re-fetch)
    - Trust buttons call setWorkspaceTrust then emit 'trusted'; Keep disabled emits 'dismissed' WITHOUT calling any IPC (dismissal persistence is the parent's responsibility via existing workspace state)
    - All user-facing text via `t('workspaceTrust.x') || 'English fallback'` (the i18n group is added in Plan 14-05; the fallbacks make the card render correctly even before translations land)
    - Loading states: Preview fetch shows button loading; Trust buttons show loading until the IPC resolves
  </behavior>
  <action>
    Create `src/views/api/workspaceWatch.ts` mirroring `src/views/api/slashCommands.ts` shape: import `windowInvoke` from the preload renderer-side helper + the four channel constants from `src/config/channellist.ts`. Export the four functions. `previewWorkspaceAgents` returns `Promise<string>` (the file body — main-process-supplied, never a path). Add doc comments noting the renderer NEVER touches the filesystem (TRS-07).

    Add a `WorkspaceTrustScope` type ("instructions" | "all") and `WorkspaceWatchAcquireRequest` / `WorkspaceWatchReleaseRequest` / `WorkspaceTrustSetRequest` interfaces to `src/entityTypes/aiChatV2Types.ts` (or a new `workspaceWatchTypes.ts` if aiChatV2Types is overloaded — planner discretion; prefer aiChatV2Types.ts to match Phase 13 convention).

    Create `src/views/components/aiChatV2/WorkspaceTrustCard.vue` per the WorkspaceRequiredCard.vue template structure. Use Vuetify v-card / v-card-item / v-card-text / v-card-actions / v-btn / v-icon / v-expand-transition / v-spacer. defineProps<{workspaceId: string; conversationId: string}>(); defineEmits<{(e:"trusted", scope: WorkspaceTrustScope): void; (e:"dismissed"): void}>(). useI18n for all text with `||` fallbacks. Icon: `mdi-shield-lock-outline` (warning color). The preview expand uses a `<pre>` for the AGENTS.md content (read-only, monospace, scrollable max-height). Implement the four button handlers per the behavior spec.

    Write `test/vitest/main/components/WorkspaceTrustCard.test.ts` using @vue/test-utils + happy-dom: (a) renders all 4 buttons with the fallback text; (b) clicking Preview calls previewWorkspaceAgents (mocked) and the expand shows the content; second Preview click hides without re-fetching (mock called once); (c) clicking Trust all calls setWorkspaceTrust (mocked) and emits 'trusted' with scope 'all'; (d) clicking Keep disabled emits 'dismissed' without calling any IPC mock; (e) loading state shows on the button during the IPC call. Mock `@/views/api/workspaceWatch` with vi.mock.
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs WorkspaceTrustCard && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `src/views/api/workspaceWatch.ts` exports `acquireWorkspaceWatch`, `releaseWorkspaceWatch`, `previewWorkspaceAgents`, `setWorkspaceTrust`
    - `src/views/components/aiChatV2/WorkspaceTrustCard.vue` exists and `grep -c "mdi-shield-lock-outline" src/views/components/aiChatV2/WorkspaceTrustCard.vue` returns at least 1
    - The card defineProps include `workspaceId` and `conversationId`
    - Component test asserts all 4 buttons render and the 4 handler behaviors (Preview fetch-once, Trust calls IPC + emits, Keep disabled emits without IPC)
    - `grep -c "readFileSync\|path.join" src/views/api/workspaceWatch.ts src/views/components/aiChatV2/WorkspaceTrustCard.vue` returns 0 (renderer never reads files — TRS-07)
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>Trust card renders inline with the 4 TRS-03 options + main-process-supplied Preview; renderer API exposes the 4 IPC channels through flat windowInvoke wrappers; all component behaviors green.</done>
</task>

<task type="auto">
  <name>Task 2: AiChatV2 subscriber filter (D-04) + WorkspaceTrustCard mount condition</name>
  <files>src/views/components/aiChatV2/AiChatV2.vue, test/vitest/main/components/AiChatV2.workspaceTrust.test.ts</files>
  <read_first>
    - src/views/components/aiChatV2/AiChatV2.vue (lines ~370-390 imports, ~810-830 subscriber comments, ~1910-1945 the onAifetchlyConfigChanged callback and onBeforeUnmount cleanup)
    - src/views/api/slashCommands.ts (AifetchlyConfigChangedEvent interface — Plan 14-03 added optional workspaceId)
    - .planning/phases/14-workspace-watcher-worker/14-RESEARCH.md (§Pattern 6 D-04 Renderer Event Routing)
    - docs/prd/aifetchly-local-extensibility-technical-design.md §10.1 (chat-open acquire flow), §13 (trust prompt trigger)
    - .planning/phases/13-global-context-and-built-in-slash-commands/13-04-SUMMARY.md (the existing subscriber + onMounted/onBeforeUnmount wiring — preserve the cleanup discipline)
  </read_first>
  <action>
    Edit `src/views/components/aiChatV2/AiChatV2.vue`:

    (a) Extend the `onAifetchlyConfigChanged` callback (currently `() => { void refreshSlashCommandCount(); }` at line ~1918) to read the event payload and filter: `slashConfigUnsub = onAifetchlyConfigChanged((event) => { const isRelevant = event.source === "user" || (event.workspaceId !== undefined && event.workspaceId === activeWorkspaceId.value); if (!isRelevant) return; void refreshSlashCommandCount(); });`. The Phase 13 path (source==="user", no workspaceId) still refreshes; the Phase 14 workspace path refreshes only when the event is for the active workspace. Preserve the onBeforeUnmount cleanup (slashConfigUnsub()).

    (b) Add the WorkspaceTrustCard mount logic in onMounted (or in the template via v-if). Condition: an approved workspace is active AND `.aifetchly` exists for it AND the workspace is not yet trusted. Use existing workspace state/reactive properties where possible (the existing WorkspaceBadge/WorkspaceRequiredCard logic shows where approved-state lives). Mount `<WorkspaceTrustCard :workspaceId="..." :conversationId="..." @trusted="onTrustAccepted" @dismissed="onTrustDismissed" />` inline near the existing cards. Import the component + the renderer API at the top of the script setup.

    (c) Wire acquire/release: on chat open with an approved workspace, call `acquireWorkspaceWatch({conversationId, workspaceId})`; on chat switch call `releaseWorkspaceWatch({conversationId, workspaceId: oldId})` then `acquireWorkspaceWatch({conversationId, workspaceId: newId})`; on unmount call `releaseWorkspaceWatch({conversationId, workspaceId: activeWorkspaceId.value})`. Reuse the existing active-workspace reactive source. Make these non-blocking (void-prefix) and catch errors (log + non-fatal — chat still works if the watcher fails).

    (d) `onTrustAccepted(scope)` handler: hide the card (set a local `workspaceTrustDismissed[workspaceId] = true` reactive flag or equivalent); the trust-set IPC was already called inside the card. `onTrustDismissed()` handler: hide the card + persist the dismissal via the existing workspace state (so it doesn't reappear on next chat open). Persisting dismissal reuses the existing workspace state API — do NOT create a new persistence layer (Phase 17 adds the per-capability entity).

    Write `test/vitest/main/components/AiChatV2.workspaceTrust.test.ts` covering: (a) the subscriber filter — fire an onAifetchlyConfigChanged event with `source:"workspace", workspaceId:"w1"` while activeWorkspaceId is "w1" → refreshSlashCommandCount called; fire with workspaceId:"w2" → NOT called; fire with `source:"user"` → called (global events always refresh); (b) the card mount condition — approved workspace with `.aifetchly` + untrusted → card rendered; trusted or no `.aifetchly` → card NOT rendered; (c) acquire/release — onMounted with approved workspace calls acquireWorkspaceWatch with consumerId `chat:<conversationId>` (verify the IPC mock); onBeforeUnmount calls releaseWorkspaceWatch. Mock `@/views/api/workspaceWatch` + `@/views/api/slashCommands`.
  </action>
  <verify>
    <automated>cd .claude/worktrees/merry-stirring-scroll && npx vitest run --config vite.main.config.mjs AiChatV2.workspaceTrust && yarn tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - AiChatV2.vue's `onAifetchlyConfigChanged` callback now takes an `event` parameter (not the bare `() =>` arrow)
    - The filter logic matches: `event.source === "user" || event.workspaceId === activeWorkspaceId.value`
    - `grep -c "WorkspaceTrustCard" src/views/components/aiChatV2/AiChatV2.vue` returns at least 1 (import + usage)
    - `grep -c "acquireWorkspaceWatch\|releaseWorkspaceWatch" src/views/components/aiChatV2/AiChatV2.vue` returns at least 2 (acquire on mount/switch, release on unmount/switch)
    - Subscriber-filter test asserts: matching workspaceId refreshes, non-matching does NOT, global (source:"user") always refreshes
    - Card-mount test asserts the conditional rendering
    - `yarn tsc --noEmit` clean
  </acceptance_criteria>
  <done>AiChatV2 filters config-changed events by workspace; trust card mounts inline on untrusted-`.aifetchly` approved workspaces; acquire/release wired to chat lifecycle. Editing a trusted workspace AGENTS.md now refreshes AiChatV2 context with no app restart (SC3).</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human-verify live-app WorkspaceTrustCard UX + SC3 live-update + WAT-07 crash restart</name>
  <files>src/views/components/aiChatV2/WorkspaceTrustCard.vue, src/views/components/aiChatV2/AiChatV2.vue</files>
  <action>Drive the live Electron app (via the repo's tmux dev-session convention) through the 9-step manual QA checklist below to validate the renderer surface that happy-dom component tests cannot reach: real IPC, real chokidar file events, real persistence. This is a human-verify checkpoint because end-to-end trust-card UX + SC3 live update + WAT-07 crash restart require a running Electron app with a real forked worker process.</action>
  <verify>
    <automated>echo "Manual checkpoint — see how-to-verify steps; no automated command covers the live Electron + chokidar + IPC surface"</automated>
  </verify>
  <acceptance_criteria>
    - All 9 manual steps in how-to-verify pass (card inline, Preview toggles, Keep disabled persists, Trust all dismisses, SC3 live update under ~2s, switch-workspace, worker exits on close, worker restarts after manual kill)
  </acceptance_criteria>
  <done>User types "approved" (or describes issues); the live-app trust-card UX + SC3 live update + WAT-07 crash restart are confirmed end-to-end.</done>
  <what-built>
    Phase 14 renderer surface: WorkspaceTrustCard.vue (4 TRS-03 options + Preview), AiChatV2 subscriber filter by workspaceId, acquire/release on chat open/switch/close. Component tests cover rendering + IPC dispatch; this checkpoint validates the live-app UX those tests cannot reach (real Electron IPC, real chokidar file events, real persistence of dismissal).
  </what-built>
  <how-to-verify>
    1. Launch the app in dev (use the repo's tmux convention — start the dev server inside a detached tmux session so logs are reachable; do NOT run the dev script directly in the agent shell) and open an AiChatV2 conversation.
    2. Pick/approve a workspace that contains a `.aifetchly/AGENTS.md` file. Confirm the WorkspaceTrustCard appears inline (NOT a modal).
    3. Click "Preview" — confirm the AGENTS.md content expands inline (read-only). Click again — collapses without re-fetching.
    4. Click "Keep disabled" — confirm the card dismisses and the dismissal persists across remounts (close + reopen the chat — card should NOT reappear).
    5. Re-approve or reset trust; click "Trust all workspace AI config" — confirm the IPC succeeds and the card dismisses.
    6. With a trusted workspace active, edit `<workspace>/.aifetchly/AGENTS.md` in an external editor and save. Confirm the AiChatV2 context badge / command count refreshes within ~1-2 seconds WITHOUT an app restart (SC3).
    7. Switch to a different approved workspace — confirm the watcher switches (old workspace's `.aifetchly` edits no longer refresh this chat; new workspace's edits do).
    8. Close the chat — confirm `ps aux | grep WorkspaceConfigWatchWorker` shows the worker exited (assuming no other consumers).
    9. Kill the worker process manually (`kill <pid>`) while a chat is open — confirm it restarts automatically (WAT-07) and the context still refreshes on subsequent edits.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues. If SC3 (step 6) fails, attach the worker + main logs.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| main → renderer (event payload) | AIFETCHLY_CONFIG_CHANGED carries counts + diff + workspaceId; renderer treats all fields as untrusted display data. |
| renderer → filesystem | HARD BOUNDARY — renderer MUST NOT read `.aifetchly`/`AGENTS.md` directly. Preview content flows ONLY through AIFETCHLY_WORKSPACE_TRUST_PREVIEW (TRS-07, boundary-tested in Plan 14-05). |
| external/scraped content → trust | Trust state is main-process-authoritative (WorkspaceResolver + WorkspaceWatchModule); no renderer-side path can flip a trust flag (TRS-04). |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-14-03 | Tampering / Spoofing | WorkspaceTrustCard.vue (trust decision UX) | medium | mitigate | Trust is main-process-authoritative; the card only REQUESTS trust via IPC. Preview content is main-process-supplied (renderer cannot inject a fake preview). TRS-04: external content cannot override trust. |
| T-14-Leak-render | Info Disclosure | Preview path | medium | mitigate | previewWorkspaceAgents returns the file BODY (string), never an absolute path the renderer could re-read or exfiltrate. Boundary test (Plan 14-05) asserts no fs/path imports in src/views/** touching `.aifetchly` literals. |
| T-14-Filter-bypass | Tampering | Subscriber filter | low | accept | A bypass would only cause a stale UI refresh (cosmetic) — the trust gate is at the apply boundary (T-14-01), not the renderer filter. Filter is for UX relevance, not security. |
</threat_model>

<verification>
- `npx vitest run --config vite.main.config.mjs WorkspaceTrustCard AiChatV2.workspaceTrust` green
- `yarn tsc --noEmit` clean
- Live-app human-verify checkpoint (9 steps above) approved
</verification>

<success_criteria>
- TRS-03: 4-option trust card renders inline; Preview shows main-process-supplied AGENTS.md
- TRS-04: trust state is main-process-authoritative; external content cannot override
- CTX-02 / SC3: editing trusted workspace AGENTS.md refreshes AiChatV2 context without app restart
- D-04: subscriber filters by workspaceId; global events still refresh
</success_criteria>

<output>
Create `.planning/phases/14-workspace-watcher-worker/14-04-SUMMARY.md` when done
</output>

## Artifacts this plan produces

**New files:**
- `src/views/api/workspaceWatch.ts` — flat windowInvoke renderer API (4 wrappers)
- `src/views/components/aiChatV2/WorkspaceTrustCard.vue` — inline trust card (D-03, mirrors WorkspaceRequiredCard.vue)
- `test/vitest/main/components/WorkspaceTrustCard.test.ts`
- `test/vitest/main/components/AiChatV2.workspaceTrust.test.ts`

**Modified files:**
- `src/views/components/aiChatV2/AiChatV2.vue` — subscriber filter by workspaceId + WorkspaceTrustCard mount + acquire/release lifecycle wiring
- `src/entityTypes/aiChatV2Types.ts` — WorkspaceTrustScope + request interfaces (or new workspaceWatchTypes.ts)

**New symbols exported:**
- `acquireWorkspaceWatch`, `releaseWorkspaceWatch`, `previewWorkspaceAgents`, `setWorkspaceTrust` (from workspaceWatch.ts)
- `WorkspaceTrustCard` Vue SFC (default export)
- `WorkspaceTrustScope` type ("instructions" | "all")
