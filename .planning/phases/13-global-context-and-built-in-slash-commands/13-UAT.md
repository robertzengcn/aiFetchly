---
status: testing
phase: 13-global-context-and-built-in-slash-commands
source: [13-VERIFICATION.md]
started: 2026-07-05T08:35:00Z
updated: 2026-07-05T08:35:00Z
---

## Current Test

number: 1
name: Slash dropdown opens on "/"
expected: |
  Typing "/" as the first character of the AiChatV2 composer draft opens a
  dropdown populated with the four built-in commands (/help, /clear, /status,
  /reload-config), each showing name, description, a "Built-in" source badge,
  and argument hint.
awaiting: user response

## Tests

### 1. Slash dropdown opens on "/"
expected: Type "/" as the first character of the AiChatV2 composer draft. A dropdown appears with /help, /clear, /status, /reload-config, each showing a "Built-in" source badge.
result: [pending]

### 2. Arrow-key navigation + Enter/Tab select without submitting
expected: With the dropdown open, ArrowDown moves the highlight down; ArrowUp moves it up. Enter or Tab on a highlighted command selects it and dispatches it WITHOUT submitting a message to the AI stream. The dropdown closes on selection.
result: [pending]

### 3. Shift+Enter inserts a newline (dropdown open and closed)
expected: In an empty composer, Shift+Enter inserts a newline (no submission). With the dropdown open, Shift+Enter still inserts a newline (the Enter/Tab intercept only fires when slashOpen && highlighted >= 0, so Shift+Enter is preserved). Release Shift, type a normal message, press Enter -> submits normally.
result: [pending]

### 4. Live AGENTS.md reload without restart
expected: Send a chat message and note the response. Create ~/.aifetchly/AGENTS.md with a distinctive instruction (e.g., "Always start your reply with the word BANANA"). Send another message WITHOUT restarting the app. The AI response reflects the new AGENTS.md instruction.
result: [pending]

### 5. /reload-config forces a rescan and reports current counts
expected: Run /reload-config in the AiChatV2 composer. A result message appears showing reloaded counts (Commands: 4, Diagnostics: 0, Watcher: not started (phase 14)). No message is submitted to the AI stream.
result: [pending]

### 6. /status shows global config + diagnostics state
expected: Run /status in the AiChatV2 composer. A result message appears showing the AiFetchly configuration status (commands count, agents, hooks, skills, diagnostics, last reload, watcher state). No message is submitted to the AI stream.
result: [pending]

### 7. Invalid/oversized file produces a diagnostic, not a crash
expected: Place an oversized (256KB+) AGENTS.md or a file with invalid frontmatter in ~/.aifetchly. Run /reload-config. The app does NOT crash; a diagnostic appears (file-too-large / frontmatter-invalid). Remove the bad file; /reload-config restores clean state.
result: [pending]

### 8. Built-in dispatch correctness for all 4 commands
expected: /help shows available commands; /clear shows the existing clear-confirm dialog (reusing clear_confirm_title/clear_confirm_body) and on confirm clears the conversation via AI_CHAT_V2_CLEAR_CONVERSATION; /status shows config status; /reload-config shows reloaded counts. None of the four submit to the AI stream.
result: [pending]

### 9. AIFETCHLY_CONFIG_CHANGED refreshes renderer cache
expected: With the app running, add a new prompt-command file or edit ~/.aifetchly/AGENTS.md externally (or run /reload-config). The renderer's local command cache refreshes (the slash dropdown reflects the new state without a full app restart). On unmount, the config-changed listener is cleaned up (no leak across re-mounts).
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0
blocked: 0

## Gaps
