# Local Xenova Embedding Model - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-07-05 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/local-xenova-embedding-model-prd.md` |
| Primary code paths | `src/api/ragConfigApi.ts`, `src/api/aiChatApi.ts`, `src/main-process/communication/rag-ipc.ts`, `src/modules/RagSearchModule.ts`, `src/service/VectorSearchService.ts`, `src/service/VectorStoreService.ts`, `src/views/pages/knowledge/KnowledgeLibrary.vue` |

---

## 1. Purpose

This document translates the local Xenova embedding PRD into an implementation-facing technical design.

The feature adds one local embedding model:

```text
local-xenova:Xenova/all-MiniLM-L6-v2
```

The model appears in the existing knowledge-library embedding model selector as:

```text
Xenova/all-MiniLM-L6-v2 (free)
```

The stored model ID stays stable and machine-readable. The display label is only presentation text. This matters because model IDs are used for provider routing, vector index naming, document metadata, and query-time model grouping.

The design keeps AiFetchly's existing architecture intact:

```text
Renderer
  -> preload-safe IPC
  -> main-process IPC handlers
  -> Modules and Services
  -> Models for persistence
  -> childprocess workers for isolated heavy work
```

The main process remains responsible for database writes and vector-store writes. The local embedding worker only loads `@xenova/transformers` and returns vectors.

## 2. Current Behavior To Preserve

### 2.1 AI Gate

Remote AI work must still check `USER_AI_ENABLED` through `Token` before request parsing or remote API calls in AI-serving IPC handlers.

For the first release, local free embeddings stay inside the existing RAG/knowledge feature entitlement. They reduce cost and latency for entitled users but do not create a separate local-only RAG mode.

### 2.2 RAG Model Listing

`RAG_GET_AVAILABLE_MODELS` currently calls:

```text
src/api/ragConfigApi.ts
  -> RagConfigApi.getAvailableEmbeddingModels()
  -> GET /api/ai/embedding/models
```

`src/views/api/rag.ts` converts `response.models` to a `ModelInfo[]`, and `KnowledgeLibrary.vue` uses `ModelInfo.name` as both the select title and select value.

This behavior must continue for remote models.

### 2.3 RAG Model Validation

`RAG_UPDATE_EMBEDDING_MODEL` currently validates the selected model only against the remote response:

```typescript
const modelInfo = modelsResponse.data.models[input.model];
```

The local model will be rejected unless validation is moved to a shared model catalog.

### 2.4 Document Metadata

Documents store model metadata on `RAGDocumentEntity`:

```text
modelName?: string
vectorDimensions?: number
vectorIndexPath?: string
```

No new database columns are required for the first release. Provider routing can be derived from the namespaced model ID stored in `modelName`.

### 2.5 Default Model Setting

`SystemSettingModule.updateDefaultEmbeddingModel()` stores the default model as:

```text
${modelName}:${dimension}
```

`SystemSettingModule.getDefaultEmbeddingModel()` currently splits by every colon and expects exactly two parts. The local ID contains a colon:

```text
local-xenova:Xenova/all-MiniLM-L6-v2:384
```

The parser must change to split on the last colon.

## 3. Target Architecture

### 3.1 Component Overview

```text
KnowledgeLibrary.vue
  -> views/api/rag.ts
  -> RAG_GET_AVAILABLE_MODELS
  -> rag-ipc.ts
  -> EmbeddingModelCatalogService
       -> RagConfigApi.getAvailableEmbeddingModels()
       -> LocalEmbeddingModelCatalog
  -> merged AvailableModelsResponse

RagSearchModule
  -> EmbeddingProviderFactory
       -> RemoteEmbeddingProvider
       -> LocalXenovaEmbeddingProvider
            -> LocalEmbeddingWorkerClient
            -> src/childprocess/embedding/LocalEmbeddingWorker.ts
  -> VectorStoreService.storeEmbedding()
  -> DocumentService.updateDocumentMetadata()

VectorSearchService
  -> group documents by modelName:dimensions
  -> EmbeddingProviderFactory
  -> provider.embedText(query)
  -> VectorStoreService.search()
```

### 3.2 Main Process Responsibilities

Main process code owns:

- model-list merging
- model selection validation
- default model persistence
- document processing orchestration
- remote retry and local fallback decisions
- vector-store writes
- document metadata writes
- worker process lifecycle
- renderer progress and error messages

### 3.3 Worker Responsibilities

The local embedding worker owns:

- loading `@xenova/transformers`
- loading `Xenova/all-MiniLM-L6-v2`
- caching the pipeline after first load
- generating embeddings with mean pooling and normalization
- validating output dimensions before returning

The worker must not:

- import TypeORM
- import Modules or Models
- read or write SQLite
- write vector indexes
- call remote AI APIs
- read arbitrary files
- decide whether fallback should happen

## 4. Data Contracts

### 4.1 Model Provider Types

Create `src/entityTypes/embeddingTypes.ts`.

```typescript
export type EmbeddingProviderKind = "remote-api" | "local-xenova";

export interface EmbeddingModelInfo {
  name: string;
  displayName: string;
  description: string;
  dimensions: number;
  provider: EmbeddingProviderKind;
  is_free: boolean;
  available: boolean;
  underlyingModel?: string;
}

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  dimensions: number;
  model: string;
  provider: EmbeddingProviderKind;
}

export interface EmbeddingBatchResult {
  embeddings: EmbeddingResult[];
  model: string;
  provider: EmbeddingProviderKind;
  dimensions: number;
}
```

`name` is the stable ID. `displayName` is the UI label. The existing `ModelInfo` in `ragConfigApi.ts` should either extend this shape or be replaced by a shared type that remains compatible with current remote responses.

### 4.2 Local Model Constant

Create `src/service/embedding/LocalEmbeddingModels.ts`.

```typescript
export const LOCAL_XENOVA_PROVIDER = "local-xenova" as const;
export const LOCAL_XENOVA_ALL_MINILM_MODEL_ID =
  "local-xenova:Xenova/all-MiniLM-L6-v2";
export const LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL =
  "Xenova/all-MiniLM-L6-v2";
export const LOCAL_XENOVA_ALL_MINILM_DIMENSIONS = 384;
```

Do not duplicate these string values elsewhere.

### 4.3 Available Models Response

Keep the existing response envelope:

```typescript
export interface AvailableModelsResponse {
  models: Record<string, ModelInfo>;
  default_model: string;
  default_dimensions?: number;
  total_models: number;
  configured_models: number;
}
```

Extend each model entry with optional fields:

```typescript
export interface ModelInfo {
  name: string;
  description: string;
  dimensions: number;
  displayName?: string;
  provider?: EmbeddingProviderKind;
  is_free?: boolean;
  available?: boolean;
  underlyingModel?: string;
}
```

Remote model entries should default to:

```text
provider = "remote-api"
displayName = name
is_free = false unless server reports true
available = true when present in remote response
```

Local model entry:

```typescript
{
  name: "local-xenova:Xenova/all-MiniLM-L6-v2",
  displayName: "Xenova/all-MiniLM-L6-v2 (free)",
  description: "Local CPU embedding model powered by Transformers.js",
  dimensions: 384,
  provider: "local-xenova",
  is_free: true,
  available: true,
  underlyingModel: "Xenova/all-MiniLM-L6-v2"
}
```

## 5. New Services and Files

### 5.1 Embedding Model Catalog

Create:

```text
src/service/embedding/EmbeddingModelCatalogService.ts
src/service/embedding/LocalEmbeddingModels.ts
src/service/embedding/EmbeddingModelId.ts
```

`EmbeddingModelCatalogService` exposes:

```typescript
export class EmbeddingModelCatalogService {
  async listModels(): Promise<AvailableModelsResponse>;
  async getModel(modelId: string): Promise<ModelInfo | null>;
  async getDefaultModel(): Promise<{ modelName: string; dimension: number } | null>;
  isLocalModel(modelId: string): boolean;
}
```

Behavior:

1. Call `RagConfigApi.getAvailableEmbeddingModels()`.
2. Normalize remote entries.
3. Add local entries.
4. If remote call fails, return a successful local-only catalog.
5. Preserve `default_model` from system settings when available.
6. If no system default exists and remote default is unavailable, use the local model as fallback default.

`EmbeddingModelId.ts` exposes:

```typescript
export function getEmbeddingProvider(modelId: string): EmbeddingProviderKind;
export function getUnderlyingLocalModel(modelId: string): string | null;
export function makeVectorModelKey(modelId: string, dimensions: number): string;
export function toPathSafeModelKey(modelId: string): string;
export function parseStoredEmbeddingModel(value: string): {
  modelName: string;
  dimension: number;
} | null;
```

`parseStoredEmbeddingModel()` must split by the last colon:

```typescript
const separatorIndex = value.lastIndexOf(":");
```

### 5.2 Embedding Providers

Create:

```text
src/service/embedding/EmbeddingProvider.ts
src/service/embedding/RemoteEmbeddingProvider.ts
src/service/embedding/LocalXenovaEmbeddingProvider.ts
src/service/embedding/EmbeddingProviderFactory.ts
src/service/embedding/EmbeddingRetryService.ts
```

Provider interface:

```typescript
export interface EmbeddingProvider {
  readonly provider: EmbeddingProviderKind;
  readonly modelName: string;
  readonly dimensions: number;
  embedText(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}
```

`RemoteEmbeddingProvider` wraps `RagConfigApi.generateEmbedding()`.

`LocalXenovaEmbeddingProvider` delegates to `LocalEmbeddingWorkerClient`.

`EmbeddingProviderFactory` routes by model ID:

```text
local-xenova:* -> LocalXenovaEmbeddingProvider
anything else   -> RemoteEmbeddingProvider
```

`EmbeddingRetryService` handles remote retry before fallback. The first release can use a small fixed profile:

```text
max attempts: 3 total tries
delays: 500 ms, 1500 ms
retryable: network failure, timeout, 429, 5xx, malformed remote response
not retryable: invalid model, auth/entitlement, local model ID passed to remote provider
```

### 5.3 Local Embedding Worker

Create:

```text
src/childprocess/embedding/LocalEmbeddingWorker.ts
src/childprocess/embedding/LocalEmbeddingWorkerTypes.ts
src/service/embedding/LocalEmbeddingWorkerClient.ts
vite.localEmbeddingWorker.config.mjs
```

Update `forge.config.js`:

```javascript
{
  entry: "src/childprocess/embedding/LocalEmbeddingWorker.ts",
  config: "vite.localEmbeddingWorker.config.mjs"
}
```

The Vite config should follow existing worker configs and alias `@` to `src`. It must not externalize `@xenova/transformers`.

### 5.4 Worker Protocol

Worker inbound messages:

```typescript
export interface LocalEmbeddingInitMessage {
  type: "initialize";
  requestId: string;
  modelId: "local-xenova:Xenova/all-MiniLM-L6-v2";
  underlyingModel: "Xenova/all-MiniLM-L6-v2";
}

export interface LocalEmbeddingBatchMessage {
  type: "embed-batch";
  requestId: string;
  modelId: "local-xenova:Xenova/all-MiniLM-L6-v2";
  texts: string[];
}

export interface LocalEmbeddingShutdownMessage {
  type: "shutdown";
  requestId: string;
}
```

Worker outbound messages:

```typescript
export interface LocalEmbeddingReadyMessage {
  type: "ready";
  requestId: string;
  modelId: string;
  dimensions: number;
}

export interface LocalEmbeddingBatchResultMessage {
  type: "embed-batch-result";
  requestId: string;
  modelId: string;
  dimensions: number;
  embeddings: number[][];
}

export interface LocalEmbeddingErrorMessage {
  type: "error";
  requestId: string;
  error: string;
}
```

Input validation must reject:

- unknown message types
- missing request IDs
- empty text arrays
- more than the configured max batch size
- non-string text values
- text values exceeding the configured max characters per item

Recommended initial limits:

```text
max batch size: 32
max characters per item: 16_000
worker request timeout: 120_000 ms
```

### 5.5 Local Xenova Runtime

Worker implementation:

```typescript
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);

const output = await extractor(texts, {
  pooling: "mean",
  normalize: true,
});
```

The worker converts the tensor to `number[][]` and validates:

```text
row count === texts.length
each row length === 384
all values are finite numbers
```

The loaded pipeline is cached in module scope after the first successful initialization.

## 6. RAG Integration

### 6.1 Model List IPC

Update `RAG_GET_AVAILABLE_MODELS` in `rag-ipc.ts`:

```text
Before:
  RagConfigApi.getAvailableEmbeddingModels()

After:
  EmbeddingModelCatalogService.listModels()
```

The handler should no longer throw when the remote model-list API fails if the local catalog is available.

### 6.2 Model Update IPC

Update `RAG_UPDATE_EMBEDDING_MODEL`:

```text
Before:
  Validate against remote response only.

After:
  Validate against EmbeddingModelCatalogService.getModel(input.model).
```

Persist:

```text
modelName = selected stable model ID
dimension = selected model dimensions
```

### 6.3 System Setting Parser

Update:

```text
src/modules/SystemSettingModule.ts
```

Current behavior:

```typescript
const parts = modelValue.split(":");
if (parts.length !== 2) return null;
```

Required behavior:

```typescript
const separatorIndex = modelValue.lastIndexOf(":");
if (separatorIndex <= 0 || separatorIndex === modelValue.length - 1) return null;
const modelName = modelValue.slice(0, separatorIndex);
const dimensionStr = modelValue.slice(separatorIndex + 1);
```

This preserves existing remote values and supports local namespaced values.

### 6.4 Document Embedding Flow

Replace direct remote calls in `RagSearchModule.generateChunkEmbeddings()`.

New flow:

```text
generateChunkEmbeddings(chunks, modelName, dimension)
  -> provider = EmbeddingProviderFactory.create(modelName, dimension)
  -> if provider is remote:
       try EmbeddingRetryService.embedBatch(provider, texts)
       catch retry exhausted:
         fallback to local provider
  -> if provider is local:
       localProvider.embedBatch(texts)
  -> write all vectors to VectorStoreService
  -> update document metadata with final model and dimensions
```

Important rule: a document indexing run must finish with one model. If remote embedding fails after some vectors were stored, delete the partial document vector index before writing local fallback vectors.

Implementation detail:

```text
RagSearchModule
  -> compute vectorIndexPath for selected/final model
  -> write vectors only after the batch succeeds, when possible
```

For memory safety, large documents may process chunks in batches. If a later batch fails after earlier batches were stored, fallback must clear the index and rebuild from the full chunk list using the local model.

### 6.5 Query Embedding Flow

Replace direct remote calls in `VectorSearchService.generateQueryEmbeddingForModel()`.

New flow:

```text
for each model group:
  provider = EmbeddingProviderFactory.create(modelName, dimensions)
  queryVector = provider.embedText(query)
  if provider fails:
     if model group is remote:
        skip this group and keep searching other groups
     if model group is local:
        skip this group
  search matching vector indexes only
```

Do not use the local model to query remote-indexed vectors. That produces invalid similarity results because embedding spaces differ.

### 6.6 Partial Search Warning

`VectorSearchService.search()` currently returns only `SearchResult[]`. To surface partial-search warnings, add an optional internal result type:

```typescript
export interface VectorSearchResponse {
  results: SearchResult[];
  skippedModelGroups: Array<{
    modelName: string;
    dimensions: number;
    reason: string;
  }>;
}
```

The first implementation may log skipped groups only. A later UI pass can display the PRD warning:

```text
Some remote-indexed documents could not be searched because remote query embedding failed.
```

## 7. Vector Store Path Safety

`VectorStoreService.getDocumentIndexPath()` currently embeds `modelConfig.name` directly in the filename:

```typescript
const fileName =
  `index_doc_${documentId}_${modelConfig.name}_${modelConfig.dimensions}.${ext}`;
```

This fails for model IDs containing `/`.

Update it to use `toPathSafeModelKey(modelConfig.name)`:

```typescript
const fileName =
  `index_doc_${documentId}_${safeModelKey}_${modelConfig.dimensions}.${ext}`;
```

Recommended safe key:

```text
lowercase
replace non [a-z0-9._-] with _
collapse repeated _
append short SHA-256 suffix of original model ID
```

Example:

```text
local-xenova:Xenova/all-MiniLM-L6-v2
-> local-xenova_xenova_all-minilm-l6-v2_a1b2c3d4
```

Keep the original model ID in `RAGDocumentEntity.modelName`.

## 8. Renderer Changes

### 8.1 API Types

Update `src/views/api/rag.ts` so `ModelInfo` can carry:

```text
displayName
is_free
provider
available
```

`getAvailableEmbeddingModelsWithDefault()` should keep returning:

```typescript
RAGResponse<{ models: ModelInfo[]; defaultModel: string }>
```

### 8.2 Knowledge Library Selector

Update `KnowledgeLibrary.vue`:

```text
item-value = "name"
item-title = displayName fallback name
```

Add an item append slot similar to `AiChatV2ModelSelector.vue`:

```text
if item.raw.is_free === true:
  show success chip: knowledge.model_free or aiChatV2.model_free
```

Because the label is user-facing, add translations under `knowledge` for all supported languages:

```text
embedding_model_free
embedding_model_local
embedding_remote_failed_local_fallback
embedding_failed_after_fallback
embedding_partial_remote_search
```

The existing `aiChatV2.model_free` translations may be reused only if the knowledge page already imports that namespace cleanly. Prefer knowledge-specific keys for future copy changes.

## 9. Packaging and Runtime Concerns

### 9.1 Worker Build

Add `vite.localEmbeddingWorker.config.mjs`. It should:

- use `nodeResolve()`
- use `alias()` for `@`
- output CommonJS to `dist/childprocess`
- preserve sourcemaps
- include `@xenova/transformers` in the packaged dependency graph

### 9.2 Model Download and Cache

Transformers.js may download model files on first use. The first release should allow the default Transformers.js cache behavior.

Follow-up packaging option:

- bundle the ONNX model as an extra resource for fully offline installs
- configure Transformers.js to load from the app resource path

Do not block the first implementation on bundling model weights unless product requires offline-first behavior.

### 9.3 Main Process Responsiveness

Local embedding generation must be asynchronous and worker-backed. The UI should remain responsive while the worker loads the model and embeds chunks.

### 9.4 CPU-Only Machines

Assume CPU-only execution. Use batching to reduce overhead but keep the batch size conservative. Initial batch size should be 32. Make it a constant so future tuning does not require touching RAG orchestration code.

## 10. Error Handling

### 10.1 Remote Indexing Failure

```text
remote provider fails
  -> retry remote provider
  -> retry exhausted
  -> clear partial remote vector writes for document
  -> embed all chunks with local provider
  -> write local vectors
  -> update document modelName/dimensions/vectorIndexPath to local
  -> save warning in document log or processing metadata
```

### 10.2 Local Fallback Failure

```text
remote provider fails
  -> retry exhausted
  -> local provider fails
  -> save document error log
  -> update processingStatus = "error"
  -> surface user-safe error
```

The error message should include:

- remote model ID
- local fallback model ID
- remote failure class
- local failure message

It must not include full document content.

### 10.3 Query-Time Failure

If query embedding fails for a model group:

- skip that model group
- continue searching other groups
- log the skipped group and reason
- return empty results only if every group failed

Do not fallback from remote query vectors to local vectors against remote indexes.

## 11. Security and Privacy

- Local model selection must not call `/api/ai/embedding/generate`.
- The worker receives only chunk text/query text needed for embeddings.
- The worker must not receive database paths or document file paths.
- Worker messages must be validated at process boundaries.
- Model IDs must be sanitized before path usage.
- Fallback logs must redact document content.
- Remote AI entitlement checks remain first for remote embedding work.

## 12. Implementation Order

Each step is a logical commit per repository workflow.

1. Add shared embedding types and local model constants.
2. Add `EmbeddingModelId` helpers and tests, including last-colon parsing.
3. Add `EmbeddingModelCatalogService` and update RAG model list/update IPC validation.
4. Update renderer model selector to use `displayName` and free chip, with all translations.
5. Add local embedding worker types, worker entry point, worker client, Vite config, and Forge entry.
6. Add `EmbeddingProvider`, `RemoteEmbeddingProvider`, `LocalXenovaEmbeddingProvider`, and factory.
7. Add `EmbeddingRetryService` and remote-to-local fallback orchestration for document indexing.
8. Update `RagSearchModule.generateChunkEmbeddings()` to use providers and final-model metadata.
9. Update `VectorSearchService.generateQueryEmbeddingForModel()` to use providers and skip failed model groups.
10. Update `VectorStoreService.getDocumentIndexPath()` to use path-safe model keys.
11. Add tests and run verification.

## 13. Test Plan

### 13.1 Unit Tests

Add tests under `test/vitest/main/service/`:

```text
EmbeddingModelId.test.ts
EmbeddingModelCatalogService.test.ts
EmbeddingProviderFactory.test.ts
EmbeddingRetryService.test.ts
LocalEmbeddingWorkerClient.test.ts
```

Required cases:

- local model ID resolves to `local-xenova`
- remote model ID resolves to `remote-api`
- stored default parses `Qwen/Qwen3-Embedding-4B:2560`
- stored default parses `local-xenova:Xenova/all-MiniLM-L6-v2:384`
- path-safe key has no `/` or `:`
- catalog appends local model to remote response
- catalog returns local model when remote response throws
- `RAG_UPDATE_EMBEDDING_MODEL` validation accepts the local model
- provider factory returns local provider for local model ID
- provider factory returns remote provider for remote model ID
- retry service falls back only after remote retries are exhausted

### 13.2 Worker Tests

Use a mocked Transformers.js import for unit tests. Do not download the real model in CI unit tests.

Required cases:

- initializes once and reuses the cached extractor
- embeds a batch and returns `number[][]`
- rejects malformed messages
- rejects overlarge batches
- rejects non-finite vectors
- returns structured error messages

### 13.3 RAG Integration Tests

Add or extend tests under `test/vitest/main/`:

- model list succeeds with remote plus local
- model list succeeds with local only when remote fails
- document indexing with local provider stores 384-dimensional vectors
- remote indexing failure triggers local fallback and updates document metadata
- partial remote vectors are removed before local fallback vectors are stored
- query search uses local provider for local-indexed documents
- query search does not use local provider against remote-indexed documents

### 13.4 Renderer Tests

Add focused tests for model selector data transformation if a test harness exists for the knowledge page:

- display name falls back to `name`
- free chip appears for `is_free === true`
- selected value remains stable model ID

### 13.5 Manual Smoke Tests

1. Start the app with remote AI server online.
2. Open Knowledge Library settings.
3. Confirm remote models and `Xenova/all-MiniLM-L6-v2 (free)` appear.
4. Select the local free model.
5. Upload a small `.txt` document.
6. Confirm no remote embedding request is sent.
7. Search the document with RAG.
8. Switch to a remote model and simulate remote embedding failure.
9. Confirm fallback to local succeeds and the document metadata stores the local model ID.
10. Start the app with remote AI server offline.
11. Confirm the local free model still appears in settings.

## 14. Verification Commands

Run:

```bash
yarn testmain
yarn vue-check
```

If worker build config changes are substantial, also run:

```bash
yarn build
```

Expected result:

- TypeScript passes.
- RAG IPC tests pass.
- Embedding service tests pass.
- Knowledge page type checks pass.
- Worker bundle builds without missing `@xenova/transformers` dependencies.

## 15. Trade-Offs

### 15.1 Shared Catalog Service vs API-Local Merge

Chosen: shared `EmbeddingModelCatalogService`.

Why:

- model list display and IPC validation must use the same source of truth
- local model constants are not duplicated
- remote failure behavior is centralized

Trade-off:

- adds one service layer before implementation touches embedding generation

### 15.2 Namespaced Model ID vs Display Suffix

Chosen: namespaced stable ID plus separate display name.

Why:

- `(free)` is presentation text and may be translated
- provider routing must not parse UI labels
- vector index names need deterministic stable IDs

Trade-off:

- `SystemSettingModule` parser must support colons inside model IDs

### 15.3 Worker Process vs Main Process Inference

Chosen: child process worker.

Why:

- model loading and CPU embedding work should not freeze Electron UI/main process work
- follows repository rule that worker-specific code lives under `src/childprocess/`

Trade-off:

- requires worker lifecycle, timeout, and packaging work

### 15.4 Local Fallback Rebuild vs Mixed Index

Chosen: rebuild one document index with the local model after remote failure.

Why:

- mixed embedding spaces in one index produce invalid search distances
- document metadata can truthfully record one final model

Trade-off:

- fallback after a late remote failure repeats embedding work

## 16. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| First local model load is slow | User waits during first indexing/search | worker progress messages and model cache |
| Transformers.js model download fails | local fallback unavailable | surface clear error and keep remote behavior unchanged |
| Model ID breaks filenames | vector index creation fails | `toPathSafeModelKey()` before every path use |
| Default model parser rejects local IDs | selected local default is lost | parse by last colon |
| Remote and local vectors mix | search quality becomes invalid | clear partial writes and store one model per document |
| CI downloads large model | tests become slow/flaky | mock Transformers.js in unit tests |
| Worker bundle misses dependency | packaged app cannot embed locally | dedicated Vite worker config and `yarn build` verification |

## 17. Future Extensions

- Add a "rebuild embeddings with local free model" action.
- Bundle model files for offline installs.
- Add more local models after catalog/provider abstractions are stable.
- Add user-visible indexing progress for local model download and warmup.
- Split local-only knowledge search from remote AI entitlement if product wants a free local RAG tier.

