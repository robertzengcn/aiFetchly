# DEBUG REPORT: Workspace Auto-Dream Single Conversation Trigger

Date: 2026-07-16

## Symptom

The user uses AI Chat V2 frequently but never sees workspace auto-dream run.

## Root Cause

Workspace auto-dream was wired to run after successful assistant turns, but its
automatic gate only counted workspace-bound source packets. The source collector
creates one chat source packet per conversation, not per chat turn. Therefore, a
user who works heavily in one approved workspace conversation still contributes
only one packet forever, while the service required three packets before an
automatic run.

Manual runs were not affected because `runNow({ force: true })` bypasses the
source-count gate.

## Fix

`AIWorkspaceAutoDreamService` now allows automatic runs when either:

- at least three changed source packets exist for the workspace; or
- the collected workspace packets contain at least six chat messages.

This preserves the existing multi-conversation behavior while allowing one
active workspace conversation to trigger consolidation after several turns.

## Evidence

Passed:

- `yarn testmain --run test/vitest/main/service/AIWorkspaceAutoDreamService.test.ts`
- `yarn testmain --run test/vitest/main/ipc/ai-workspace-memory-ipc.test.ts test/vitest/main/service/AIWorkspaceAutoDreamPromptBuilder.test.ts`

The service still intentionally skips automatic runs when:

- `USER_AI_ENABLED` is not `"true"`;
- the workspace auto-dream setting is disabled;
- the conversation has no approved workspace;
- the workspace has a successful run within the last 24 hours;
- another run for the same workspace is already running.

## Regression Test

`test/vitest/main/service/AIWorkspaceAutoDreamService.test.ts` now verifies:

- one short workspace conversation is skipped;
- one workspace conversation with enough messages runs automatically.

## Status

DONE: root cause found, fix applied, targeted tests pass.
