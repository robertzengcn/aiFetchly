# Workspace Memory Secret Filter Debug

Date: 2026-07-16

## Symptom

Manual test WM-VALID-06 allowed saving workspace memory content:

`The API key is sk-proj-abcdefghijklmnop1234567890abcdef`

Expected behavior is rejection with no partial memory creation.

## Root Cause

The workspace memory save path was wired correctly:

`WorkspaceMemoryPanel.vue` -> `workspaceMemoryApi.create` -> `ai:workspace-memory:create` -> `AIWorkspaceMemoryService.createManualMemory` -> `AIWorkspaceMemoryModule.createMemory` -> `rejectSecretLike`.

The bug was in `MemorySecretFilter`: existing patterns matched `api_key` / `api-key` and `sk-` followed directly by alphanumerics, but did not match `API key` with a space or OpenAI project key prefixes such as `sk-proj-...`.

## Fix

Updated `src/service/MemorySecretFilter.ts` to detect:

- `sk-` tokens that include hyphen/underscore segments, including `sk-proj-...`
- whitespace-separated `api key`, `access token`, and `refresh token`
- bearer authorization headers and embedded JWT-like tokens

Added regression coverage in:

- `test/vitest/main/service/MemorySecretFilter.test.ts`
- `test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts`

The module regression verifies the exact WM-VALID-06 text is rejected before the model `create` method is called.

## Evidence

Passed:

- `yarn testmain --run test/vitest/main/service/MemorySecretFilter.test.ts test/vitest/main/service/AIWorkspaceAutoDreamPromptBuilder.test.ts`
- `yarn testmain --run test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts -t "rejects WM-VALID-06"`

Broader DB-backed workspace memory module tests could not run in this environment because `better-sqlite3` was compiled for Node ABI 133 while the current Node runtime requires ABI 127.

## Status

DONE_WITH_CONCERNS: root cause fixed and focused regression tests pass; full DB-backed suite is blocked by local native module ABI mismatch.
