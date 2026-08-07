---
status: partial
phase: 14-workspace-watcher-worker
source: [14-01-SUMMARY.md, 14-02-SUMMARY.md, 14-03-SUMMARY.md, 14-04-SUMMARY.md, 14-05-SUMMARY.md]
started: 2026-07-06T13:45:29Z
updated: 2026-07-06T14:01:58Z
---

## Current Test

[testing paused — user skipped UAT and opted to proceed to Phase 15; all checkpoints unrun]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running app instance, start it fresh (yarn start or your usual launch command). App boots without workspace-watcher errors in the console (no WorkspaceWatchManager / aifetchly-config stack traces). Watcher initialized but idle — no worker spawned yet. Main window renders normally.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 2. Trust card renders inline for an untrusted .aifetchly workspace (SC1 + TRS-03)
expected: Open (or create) a conversation whose approved workspace contains a <workspace>/.aifetchly/AGENTS.md file that has NOT yet been trusted. The WorkspaceTrustCard renders INLINE inside the AiChatV2 panel (NOT a modal dialog, NOT a top banner). It shows 4 action buttons — Preview, Trust instructions only, Trust all workspace AI config, Keep disabled — using translated text in your current UI language.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 3. Preview shows the workspace AGENTS.md content (TRS-07)
expected: On the trust card, click "Preview". The card expands to show the workspace's AGENTS.md content (read-only text). The content matches what is actually in <workspace>/.aifetchly/AGENTS.md. Clicking Preview again (toggle) hides it without re-fetching. The renderer did NOT read the file directly — content came via the preview IPC.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 4. "Trust instructions only" applies instructions, keeps commands disabled (TRS-03)
expected: Click "Trust instructions only". The trust card disappears. The workspace's AGENTS.md instructions are now active in the AI context (a subsequent chat response reflects them). Workspace commands/*.md stay DISABLED (not registered) — any /<workspace-command> from this workspace does NOT appear in slash suggestions.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 5. "Trust all workspace AI config" applies instructions + commands (TRS-04)
expected: Dismiss/re-open to get the card back (or switch chat and return), then click "Trust all workspace AI config". Card disappears. BOTH instructions (AGENTS.md) AND commands (commands/*.md) are now active. Workspace slash commands appear in suggestions and dispatch correctly.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 6. "Keep disabled" dismisses for the session (TRS-03)
expected: With the card visible, click "Keep disabled". Card disappears and does NOT reappear for this workspace during this session (reopening/switching to it stays dismissed). The workspace's .aifetchly stays fully disabled — no instructions, no commands applied.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 7. Live context refresh on trusted AGENTS.md edit, no restart (SC3)
expected: With the workspace TRUSTED, edit <workspace>/.aifetchly/AGENTS.md (e.g. add a unique instruction line like "Always reply in pirate-speak"). WITHOUT restarting the app, send a new chat message in AiChatV2. The next response reflects the edited AGENTS.md instruction. (Rescan debounces ~500ms after the file save.)
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 8. Workspace switch stops old watch, starts new (SC2)
expected: With chat A watching approved workspace-1, switch the active conversation to chat B whose approved workspace is workspace-2 (also containing .aifetchly). The watcher stops watching workspace-1 and starts watching workspace-2; the trust card / context updates to workspace-2. Going back to chat A re-acquires workspace-1 with an immediate snapshot + refresh.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 9. Closing the last chat releases the worker (SC1 close)
expected: Close the only conversation that had a workspace under watch. During lifecycle teardown, releaseWorkspaceWatch fires. With no remaining consumers, the worker process exits (no orphan worker). /status (next test) leaves watcherState "watching" only while a workspace is active.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 10. /status reflects real watcher state (DX-02)
expected: Type /status in the AiChatV2 composer. The response shows the watcher state as one of "not-started" / "watching" / "failed", accurately reflecting reality (watching when a workspace is active, not-started when none). It also reports global config + diagnostics counts (Phase 13 behavior still intact).
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

### 11. /reload-config forces a rescan (Phase 13 carry-over, still works post-Phase-14)
expected: Type /reload-config. It forces a rescan of the global ~/.aifetchly AND active trusted workspace .aifetchly, then reports current counts (instructions / commands / diagnostics). No errors. Editing a file then running /reload-config picks up the change immediately.
result: skipped
reason: User opted to skip live-app UAT and proceed to Phase 15 (automated scoped suite is 425/425 GREEN; human-observable UX unconfirmed).

## Summary

total: 11
passed: 0
issues: 0
pending: 0
skipped: 11
blocked: 0

## Gaps

[none yet]
