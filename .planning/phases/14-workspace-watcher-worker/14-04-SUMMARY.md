---
phase: 14-workspace-watcher-worker
plan: 14-04-renderer-trust-card
subsystem: renderer
tags: [vue3, electron-renderer, ipc, trust-prompt, i18n, acquire-release-lifecycle]

requires: [14-03-main-ipc-integration]
provides:
  - WorkspaceTrustCard.vue — inline trust card (D-03) mirroring WorkspaceRequiredCard.vue. 4 TRS-03 option buttons (Preview / Trust instructions only / Trust all workspace AI config / Keep disabled). Preview fetches AGENTS.md content via previewWorkspaceAgents (main-process-supplied — renderer NEVER reads files, TRS-07). NOT a modal/banner.
  - src/views/api/workspaceWatch.ts — flat renderer API: acquireWorkspaceWatch / releaseWorkspaceWatch / previewWorkspaceAgents / setWorkspaceTrust (mapped to the 4 invoke channels from 14-03).
  - AiChatV2 subscriber filter (D-04) — onAifetchlyConfigChanged now compares event.workspaceId against the active watch token; refreshes on source:"user" (global) OR matching workspaceId. Non-matching ignored.
  - acquire/release lifecycle — acquireWorkspaceWatch on chat open with an approved workspace; releaseWorkspaceWatch on unmount/switch. Non-fatal on IPC failure (chat still works; /reload-config retries).
  - Per-session trust-card dismissal set (dismissedTrustWorkspaces) — persistence across app restart deferred to Phase 17 (AIFetchlyWorkspaceTrust entity).
affects: [14-05-i18n-boundary-tests]

tech-stack:
  added: []
  patterns: [inline Vuetify card (D-03, mirrors WorkspaceRequiredCard), additive event-payload extension (D-04 — Phase 13-04 subscriber was payload-blind so additive is safe), preview-only filesystem isolation (TRS-07), idempotent acquire-with-release-first for workspace switch]

key-files:
  created:
    - src/views/components/aiChatV2/WorkspaceTrustCard.vue
    - src/views/api/workspaceWatch.ts
    - test/vitest/main/components/WorkspaceTrustCard.test.ts
    - test/vitest/main/components/AiChatV2.workspaceTrust.test.ts
  modified:
    - src/views/components/aiChatV2/AiChatV2.vue   # +210 lines: trust card mount, subscriber filter, acquire/release lifecycle

decisions:
  - "[14-04 D-03]: inline card (not modal/banner) — trust decisions persist, low intrusion. Mounts only when: approved workspace + acquire returned a watch token + preview returned non-empty AGENTS.md + not dismissed this session."
  - "[14-04 D-04]: subscriber filter is ADDITIVE — event.workspaceId optional; source stays bare-string. Phase 13-04 subscriber ignored the payload arg (verified by reading AiChatV2.vue), so the extension cannot break it."
  - "[14-04 TRS-07]: hasAgents flag comes ONLY from previewWorkspaceAgents IPC. Renderer never touches the filesystem. WorkspaceTrustCard Preview pane renders main-process-supplied content."
  - "[14-04 Task 3 autonomous:false]": live-app UX (real Electron IPC, real Vuetify rendering, real dismissal) is NOT automatable in happy-dom — left as a human-verify checkpoint, NOT faked."

test-results:
  command: "npx vitest run --config test/vitest/main/components/vitest.config.mjs test/vitest/main/components/WorkspaceTrustCard.test.ts test/vitest/main/components/AiChatV2.workspaceTrust.test.ts"
  total: 17 passed (17)
  files:
    - WorkspaceTrustCard.test.ts (8) — 4 options render + dispatch; Preview fetch-once-and-cache; Keep-disabled emits without IPC; loading state. GREEN.
    - AiChatV2.workspaceTrust.test.ts (9) — (a) subscriber filter refreshes only on source:"user" or matching workspaceId [3 cases]; (b) trust-card mount condition [3 cases]; (c) acquire/release lifecycle [3 cases]. GREEN.
  note: "Component tests are EXCLUDED from `yarn testmain` (vite.main.config.mjs excludes test/vitest/main/components/**). Run via the components vitest config above. [intlify] 'aiChatV2.*' not-found warnings are PRE-EXISTING unrelated missing keys, not Phase 14."
  tsc-gate: clean (yarn testmain globalSetup, NOT bypassed)

human-verify:
  title: "Plan 14-04 Task 3 — live-app UX (autonomous:false)"
  why: "happy-dom cannot exercise real Electron IPC, Vuetify rendering, or cross-component dismissal persistence."
  checklist:
    - "Open a chat whose approved workspace contains <ws>/.aifetchly/AGENTS.md → WorkspaceTrustCard renders INLINE (not modal)."
    - "Click Preview → expands to show the workspace's AGENTS.md content (read-only, main-process-supplied)."
    - "Click 'Trust instructions only' → card disappears; verify only instructions are applied (commands stay disabled) via /status."
    - "Click 'Trust all workspace AI config' → card disappears; verify instructions+commands applied via /status."
    - "Click 'Keep disabled' → card disappears (per-session); workspace .aifetchly stays disabled until trust accepted."
    - "Edit <ws>/.aifetchly/AGENTS.md (trusted) → AiChatV2 context refreshes WITHOUT app restart (SC3)."
    - "Switch to a different approved workspace → old watch released, new acquired, trust card state updates correctly (SC2 renderer side)."
    - "Close the chat → releaseWorkspaceWatch fires; if no other consumers, worker stops (verify via /status watcherState)."

verification:
  must_haves_status: all automatable criteria GREEN; live-app items deferred to human-verify checklist above.
  - "WorkspaceTrustCard renders 4 TRS-03 options + Preview (main-supplied AGENTS.md, TRS-07)": GREEN
  - "Renderer API exposes acquire/release/preview/trust-set → 4 invoke channels": GREEN
  - "Subscriber filters by workspaceId (D-04 additive)": GREEN
  - "acquire/release wired to chat open/close; idempotent switch": GREEN

handoff:
  next-plan: 14-05-i18n-boundary-tests
  next-plan-needs: the workspaceTrust i18n keys used by WorkspaceTrustCard.vue (English fallbacks are inline so the card renders today, but 14-05 must add the workspaceTrust group to all 6 lang files for I18-01); the TRS-07 renderer-never-reads-workspace-config boundary test; the SC5 perf-backstop.

note: |
  Plan 14-04 was executed by a subagent that 429'd after Task 2 verification; Task 1 (renderer API + trust card) and Task 2 (subscriber filter + lifecycle) were both GREEN on disk and are committed here. Task 3 is the human-verify checklist above (autonomous:false by design). Finalized inline by the orchestrator after verifying 17/17 component tests GREEN.
