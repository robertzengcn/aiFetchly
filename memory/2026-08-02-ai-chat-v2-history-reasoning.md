# AI Chat V2 History Reasoning Hydration

Date: 2026-08-02

## Symptom

Opening a conversation from the AI chat history list could leave the historical
assistant answer and reasoning panel absent from the AI Chat V2 UI.

## Root Cause

The V2 history IPC handler assumed history payloads were always JSON strings
and assumed database timestamps were always `Date` instances. Some renderer
paths can pass object payloads, and persisted SQLite datetime values can hydrate
as strings. Either case can make history loading fail before the renderer gets
assistant rows. The metadata parser also discarded older V2 reasoning metadata
when the persisted JSON did not include `source: "chat-v2"`.

## Fix

- Accept both JSON-string and object payloads in the V2 history handler.
- Serialize history timestamps from `Date`, ISO string, or epoch number values.
- Preserve source-less persisted reasoning metadata by normalizing it to
  `source: "chat-v2"` for renderer compatibility.
- Added a regression test that loads a historical assistant answer plus
  reasoning from an object payload and string timestamp.

## Verification

- `./node_modules/.bin/vitest run --config vite.main.config.mjs test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`
- `./node_modules/.bin/vitest run --config vite.main.config.mjs test/vitest/main/ipc/ai-chat-v2-ipc.test.ts -t "loads assistant history content"`
- `./node_modules/.bin/vue-tsc --noEmit`
- `git diff --check`

Status: DONE
