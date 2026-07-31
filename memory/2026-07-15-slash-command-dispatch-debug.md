# Slash Command Dispatch Debug Report

Date: 2026-07-15

## Symptom

In AiChatV2, typing `/` showed suggestions, but selecting a command left the
suggestion list open. Sending `/help` or `/clear` did not run the built-in
slash command behavior.

## Root Cause

`AiChatV2Composer` wrote the selected command back into the draft as `/name `,
which triggered the draft watcher and reopened slash suggestions immediately.

`AiChatV2.vue` did not call `dispatchSlashCommand` before sending. Slash
command input was sent through the normal AI stream as plain chat text.

## Fix

- Suppressed the immediate post-selection slash refresh and cleared pending
  slash debounce state in `AiChatV2Composer.vue`.
- Routed slash-only submissions in `AiChatV2.vue` through
  `dispatchSlashCommand`.
- Rendered local command results directly in the chat and handled `/clear`
  through the existing clear conversation API.

## Evidence

- `npx vitest --run --config test/vitest/main/components/vitest.config.mjs test/vitest/main/components/AiChatV2.slashCommands.test.ts test/vitest/main/components/AiChatV2Composer.slashCommands.test.ts --reporter=dot`
- `npx tsc --noEmit -p tsconfig.json`

## Regression Tests

- `test/vitest/main/components/AiChatV2.slashCommands.test.ts`
- `test/vitest/main/components/AiChatV2Composer.slashCommands.test.ts`

## Related

Existing workspace component tests currently fail in this worktree because
their stubs do not reach the workspace badge/watch paths. That failure is
separate from the slash command dispatch path.

## Status

DONE
