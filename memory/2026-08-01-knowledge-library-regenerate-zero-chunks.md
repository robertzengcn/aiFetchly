# Knowledge Library Regenerate Returned Zero Chunks

## Symptom

Clicking the Knowledge Library table reload action showed a success message with `0 chunks created, 0 embedding generated`.

## Root Cause

The combined regenerate flow reused the normal chunking path without clearing the document's existing chunk rows or vector index. `ChunkingService` skips duplicate chunks by `contentHash` for the same document, so an already-processed document could produce zero new rows. Embedding then had no new work, or existing chunks were treated as already processed, making the manual regenerate action a no-op.

The renderer API wrapper also converted any resolved IPC response into `success: true`, so backend failures could be displayed as successful zero-count results.

## Fix

- Added `RagSearchModule.resetDocumentIndex()` to clear the prior document vector index and chunk rows before manual regeneration.
- Updated `RagSearchController.chunkAndEmbedDocument()` to fetch the document and call the reset before chunking.
- Updated `chunkAndEmbedDocument()` in the renderer API to unwrap the IPC `CommonMessage` envelope and preserve backend failure status/messages.
- Added `message` to `ChunkAndEmbedResponse` to match the backend response contract.

## Evidence

- `yarn test test/modules/RagSearchController.chunkAndEmbedDocument.test.ts`: 1 passing.
- `yarn tsc-result`: passed.
- `yarn test`: 275 passing.

## Regression Test

`test/modules/RagSearchController.chunkAndEmbedDocument.test.ts` verifies the combined operation calls `resetDocumentIndex` before chunking and embedding.

## Status

DONE
