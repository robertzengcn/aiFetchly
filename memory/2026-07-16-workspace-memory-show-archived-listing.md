# DEBUG REPORT: Workspace Memory Show Archived Listing

Date: 2026-07-16

## Symptom

After archiving a workspace memory from `WorkspaceMemoryPanel.vue`, the item
disappeared from the default active list. Enabling "Show archived" did not bring
the archived item back.

## Root Cause

The panel attempted to request all memory statuses by omitting `status`:

`status: showArchived.value ? undefined : "active"`

However, `AIWorkspaceMemoryModule.listMemories()` treated an omitted status as
`"active"` before calling the model. As a result, the backend still queried only
active rows even when the panel intended to show archived rows too.

## Fix

Added an explicit workspace-memory list status sentinel: `"all"`.

- `WorkspaceMemoryPanel.vue` now sends `status: "all"` when Show archived is on.
- `AIWorkspaceMemoryModule.listMemories()` resolves `"all"` to no model status
  filter while preserving the existing default of active-only when status is
  omitted.
- `AIWorkspaceMemorySearchInput` now types the list status as
  `AIWorkspaceMemoryStatus | "all"`.

## Evidence

Passed:

- `yarn testmain --run test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts -t "module boundary|show-archived"`
- `yarn testmain --run test/vitest/main/service/AIWorkspaceMemoryService.test.ts test/vitest/main/ipc/ai-workspace-memory-ipc.test.ts`

The full DB-backed workspace-memory module test file is still blocked in this
local environment because `better-sqlite3.node` was compiled for Node module ABI
133 while the active runtime expects ABI 127.

## Regression Test

`test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts` now includes
constructor-free module-boundary tests that verify:

- omitted list status still maps to `"active"`;
- `"all"` maps to an undefined model status filter, allowing archived rows to be
  returned.

## Status

DONE_WITH_CONCERNS: root cause fixed and targeted coverage passes; full DB-backed
suite remains blocked by the local native-module mismatch.
