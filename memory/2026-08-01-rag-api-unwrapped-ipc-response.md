# RAG API Misread Unwrapped IPC Response

## Symptom

After the regenerate rebuild fix, the app showed `Failed to re-embed document ..., Failed to chunk and embed document` even though the application log showed chunking and embedding completed successfully.

## Root Cause

`windowInvoke()` unwraps IPC `CommonMessage` responses and returns `result.data` directly. The `chunkAndEmbedDocument()` renderer API wrapper incorrectly treated that unwrapped data as a full `{ status, msg, data }` envelope. Since the successful `ChunkAndEmbedResponse` has no `status` field, the wrapper classified the successful backend result as failed.

## Fix

`src/views/api/rag.ts` now treats the `windowInvoke()` return value as `ChunkAndEmbedResponse` directly and only reports failure when `response.success` is false.

## Evidence

- `yarn vitest-puppeteer --run test/vitest/utilitycode/ragApi.test.ts`: 2 tests passing.
- `yarn test test/modules/RagSearchController.chunkAndEmbedDocument.test.ts`: 1 passing.
- `yarn tsc-result`: passed.

## Regression Test

`test/vitest/utilitycode/ragApi.test.ts` verifies the renderer API accepts unwrapped successful chunk/embed payloads and surfaces backend failure messages from unwrapped failure payloads.

## Status

DONE
