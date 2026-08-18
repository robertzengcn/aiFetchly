# Debug Report: Batch permission wait and exported file list

- **Date:** 2026-08-10
- **Status:** DONE_WITH_CONCERNS

## Symptom

1. After approving `process_artifact_batch`, the Allow control remained in a loading state for the full batch duration.
2. Files copied successfully by `export_generated_artifacts` did not appear in the file-operations panel below AiChatV2.

## Root cause

1. `AiChatV2` kept the permission prompt's tool ID in `permissionResumeInFlightToolIds` until the final tool-result event. The pinned approval card bound that state to its loading prop, so permission acknowledgement and long-running execution were presented as one operation.
2. The file-operations panel received live records from `FileOperationTracker` and rebuilt history only for `file_write` and `file_edit`. The export tool copied files directly but did not emit tracker records, and `fileOperationMetadata` did not understand its multi-item result.

## Fix

1. Immediately replace an approved permission prompt with a non-interactive `Running...` tool row. The final streamed result still replaces that row, and permission-resume failures still convert it to an error.
2. Emit one live file-operation record for each successful artifact export, including the workspace path, size, conversation, and a per-item tool-call ID.
3. Rebuild those records from persisted `export_generated_artifacts.items` so the panel survives conversation reloads.

## Evidence

- Main focused suite: 22 tests passed.
- Utility suite: 16 tests passed.
- Component suite: 4 tests passed.
- Full `yarn testmain` completed with TypeScript reporting 0 errors.

## Regression tests

- `test/vitest/utilitycode/toolExecutionStateUtil.test.ts`
- `test/vitest/main/components/AiChatV2Message.toolProgress.test.ts`
- `test/vitest/main/service/exportGeneratedArtifactsTool.test.ts`
- `test/vitest/utilitycode/fileOperationMetadata.test.ts`

## Concern

The real hosted image provider was not invoked during automated verification. The UI state transition, export filesystem behavior, live tracking contract, and history reconstruction are covered deterministically.
