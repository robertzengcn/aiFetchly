# Local Xenova Embedding Model - Product Requirements Document

## 1. Summary

AiFetchly currently retrieves available embedding models from the remote AI server and sends knowledge-library text to that server to generate embeddings. This creates latency, depends on network/server availability, and sends user knowledge content off-device.

This feature adds a local free embedding option powered by `@xenova/transformers`, using `Xenova/all-MiniLM-L6-v2` as the first supported local model. The application must merge this local model into the same embedding model list used by the current RAG UI and model validation flow. If a selected remote embedding model fails after its retry policy is exhausted, the application should automatically fall back to the local Xenova model when possible.

The expected user-visible outcome is simple: users see a free local embedding model in the existing embedding model selector, can choose it for knowledge indexing/search, and have a resilient fallback when remote embedding generation fails.

## 2. Goals

- Add `Xenova/all-MiniLM-L6-v2` as a local embedding model option.
- Display the local model as free in the model list, using a visible `(free)` label in UI surfaces.
- Keep the stored model identifier stable and machine-readable, separate from display text.
- Merge local embedding models with the current remote embedding model list.
- Allow local embedding generation for both document chunks and search queries.
- Fall back to local embeddings after remote embedding generation fails after retry.
- Avoid direct database access from local embedding worker code.
- Preserve existing remote model behavior for users and documents that already use remote embeddings.

## 3. Non-Goals

- Do not replace all remote embedding models.
- Do not add multiple local embedding models in the first release.
- Do not add a new vector database backend.
- Do not silently mix embeddings from different models inside one document index.
- Do not run heavy local embedding inference on the Electron main process.
- Do not require users to install Ollama, Python, CUDA, or external services.
- Do not change chat-completion model selection. This PRD only covers embedding models for RAG/knowledge.

## 4. Current State

The current app has three relevant behaviors:

- `RagConfigApi.getAvailableEmbeddingModels()` retrieves embedding models from the remote AI server.
- `RagSearchModule.generateChunkEmbeddings()` calls the remote embedding API for each chunk.
- `VectorSearchService.generateQueryEmbeddingForModel()` calls the remote embedding API for user queries.

The app already has `@xenova/transformers` installed and an `EmbeddingImpl` interface that can support provider-based embedding implementations.

## 5. Product Requirements

### 5.1 Local Model Catalog Entry

The application must define a built-in local embedding model:

| Field | Value |
| --- | --- |
| Provider | `local-xenova` |
| Stable model ID | `local-xenova:Xenova/all-MiniLM-L6-v2` |
| Display name | `Xenova/all-MiniLM-L6-v2 (free)` |
| Underlying Xenova model | `Xenova/all-MiniLM-L6-v2` |
| Dimensions | `384` |
| Cost flag | `is_free: true` |
| Availability | available when `@xenova/transformers` can be loaded |

The `(free)` suffix is display text only. It must not be used as the persisted model ID, vector index key, or provider routing key.

### 5.2 Model List Merging

The app must expose a single embedding model list to the UI by combining:

1. Remote models from the existing remote API.
2. Local built-in models from the app runtime.

Requirements:

- The local model must be present even when the remote model-list API fails, as long as the local runtime is available.
- Remote models must keep their current response shape.
- Local models must include enough metadata for UI display and embedding execution.
- If remote and local model IDs collide, local IDs must remain namespaced with `local-xenova:` to avoid ambiguity.
- The list response must expose whether a model is free.

### 5.3 `AiChatApi` Integration

The normalized model-list behavior in `src/api/aiChatApi.ts` already supports `is_free` for AI chat models. The embedding model list should follow the same pattern where practical:

- Add a local model normalization/merge layer near the API boundary.
- Represent local model entries with `is_free: true`.
- Preserve remote model entries with their server-provided free/cost metadata when available.
- Keep the UI-facing free badge derived from metadata, not string parsing.

If embedding model listing remains owned by `RagConfigApi`, it must still follow the `AiChatApi` model-list conventions for free metadata and local model injection. The implementation may either:

- add embedding-model helpers to `AiChatApi`, or
- keep `RagConfigApi` as the transport API and add a shared local model catalog used by both APIs.

The implementation must avoid duplicating local model definitions in multiple files.

### 5.4 Model Selector Behavior

The embedding model selector must show local and remote models together.

User-visible requirements:

- Local model label: `Xenova/all-MiniLM-L6-v2 (free)`.
- Free local model should be visually distinguishable from paid or remote models.
- If the remote model list fails, the selector should still show the local free model.
- If the current saved default model is unavailable, the app may suggest or auto-select the local free model.
- The default model must be persisted using the stable model ID and dimension.

### 5.5 Embedding Execution

When the selected model ID starts with `local-xenova:`, embedding generation must use `@xenova/transformers`.

Execution requirements:

- Use `Xenova/all-MiniLM-L6-v2`.
- Use mean pooling.
- Normalize embeddings.
- Return 384-dimensional vectors.
- Support single query embedding and batch document chunk embedding.
- Batch chunk embedding to reduce CPU overhead.
- Cache the loaded model in the local embedding process for reuse.

### 5.6 Worker Placement

Local embedding inference should not run directly in the Electron main process.

Requirements:

- Place worker-specific entry points and local embedding worker code under `src/childprocess/`.
- The worker may load the Xenova model and produce vectors.
- The worker must not access SQLite, TypeORM models, or vector store modules directly.
- The main process must receive embedding results and store them through existing Module/Model layers.

### 5.7 Remote Failure Fallback

When a remote embedding model is selected and embedding generation fails after retry, the app must attempt local fallback.

Fallback requirements:

- Retry the remote embedding request according to the existing retry policy or a new embedding-specific retry policy.
- Only fall back after retry is exhausted.
- Use `local-xenova:Xenova/all-MiniLM-L6-v2` as the fallback model.
- Record the final model metadata on the document after fallback.
- Do not store remote vectors and local fallback vectors in the same document index.
- If fallback happens during document indexing, all chunks in that indexing run must be embedded with the local model.
- If some chunks were already stored with the remote model before failure, the app must either rebuild the document index with local vectors or fail safely and mark the document processing status as error. The preferred behavior is rebuild with local vectors.
- If local fallback also fails, surface a clear error and save the document error log.

### 5.8 Query-Time Model Consistency

Search queries must use the same model provider and dimensions as the document indexes being searched.

Requirements:

- Documents indexed with remote models continue to generate query embeddings through the matching remote model unless fallback is explicitly needed.
- Documents indexed with `local-xenova:Xenova/all-MiniLM-L6-v2` generate query embeddings locally.
- Hybrid search across documents with different model providers must group documents by model ID and dimensions before querying.
- If a remote query embedding fails after retry, the app must not use the local model to search remote-indexed documents. It may skip those remote-indexed documents and search local-indexed documents, or show a partial result warning.

### 5.9 Existing Documents and Migration

Existing documents must continue to work without forced migration.

Requirements:

- Existing remote-indexed documents keep their stored model metadata.
- Switching the default model to local affects future indexing only.
- The app should support a future "rebuild embeddings with local free model" action, but that action is not required in the first release.
- If a document is re-indexed after selecting the local model, old vectors for that document must be cleared before local vectors are written.

### 5.10 Path and Identifier Safety

The local model ID contains `/`, which is unsafe in filenames.

Requirements:

- Sanitize model IDs before using them in vector index filenames.
- Use a deterministic safe key for index paths.
- Keep the original model ID in persisted metadata for display and provider routing.
- Do not derive provider behavior from display labels such as `(free)`.

## 6. UX Requirements

### 6.1 Model List Display

The UI should distinguish three states:

| State | Example display |
| --- | --- |
| Local free model | `Xenova/all-MiniLM-L6-v2 (free)` |
| Remote free model | server-provided name plus free badge when `is_free` is true |
| Remote paid/unknown model | server-provided name with no free badge |

### 6.2 Failure Messaging

When fallback succeeds:

> Remote embedding failed. AiFetchly used the local free embedding model instead.

When both remote and local fail:

> Embedding generation failed after remote retry and local fallback. Check the document error log for details.

When only partial search is possible:

> Some remote-indexed documents could not be searched because remote query embedding failed.

## 7. Functional Acceptance Criteria

- Given the remote embedding model API succeeds, the model selector includes all remote models plus `Xenova/all-MiniLM-L6-v2 (free)`.
- Given the remote embedding model API fails, the model selector still includes `Xenova/all-MiniLM-L6-v2 (free)`.
- Given the user selects the local model, document chunk embeddings are generated locally and stored with 384 dimensions.
- Given a local-indexed document exists, RAG search generates the query embedding locally and returns vector search results.
- Given a remote embedding request fails after retry during indexing, the app attempts local fallback.
- Given remote fallback to local succeeds, the document metadata records the local model ID and 384 dimensions.
- Given local fallback fails, the document processing status becomes error and the error log explains both remote and local failures.
- Given an existing remote-indexed document exists, it remains searchable through the remote model path.
- Given model IDs contain `/`, vector index files are still created under the expected app-owned vector index directory.

## 8. Technical Constraints

- No `any` types in new TypeScript code.
- IPC handlers remain communication-only and call Module/Controller methods.
- Database writes stay in Model/Module layers.
- Worker process code stays under `src/childprocess/`.
- Worker processes must not access the database directly.
- User-facing UI text must be added to all supported language files when UI changes are implemented.
- AI enablement checks must remain first for remote AI work.
- In the first release, local free embeddings remain inside the existing RAG/knowledge feature entitlement. They reduce remote AI cost and latency but do not create a new unauthenticated local-only RAG product mode.

## 9. Entitlement Decision

Local embeddings are free from a compute-cost perspective but still follow the current RAG/knowledge feature entitlement in the first release. This avoids changing subscription behavior while reducing cost and improving performance for users who already have knowledge features enabled. A later release can separate "local-only knowledge search" from remote AI features if product wants that.

## 10. Rollout Plan

1. Add local model catalog and model-list merge behavior.
2. Add local embedding provider and worker.
3. Route selected local model through local embedding provider for indexing and query search.
4. Add remote failure fallback to local provider.
5. Update UI display and translations for free badge/fallback messages.
6. Add tests for model list merge, local embedding dimensions, fallback behavior, and model consistency.

## 11. Test Requirements

Unit tests:

- Local model catalog returns exactly one local model with 384 dimensions and `is_free: true`.
- Model-list merge preserves remote models and appends local model.
- Model-list merge works when remote API fails.
- Stable model ID and display label are separate.
- Path-safe model key generation handles `local-xenova:Xenova/all-MiniLM-L6-v2`.
- Remote embedding failure after retry triggers local fallback.
- Query embedding uses local provider for local-indexed documents.
- Query embedding does not use local provider for remote-indexed documents unless those documents were re-indexed locally.

Integration tests:

- Upload a document with local model selected and verify chunks/vectors are stored.
- Search a local-indexed document and verify results are returned.
- Simulate remote embedding failure and verify fallback metadata is stored.
- Simulate both remote and local failures and verify document error state.

Manual smoke tests:

- Start app with remote AI server online and confirm local free model appears.
- Start app with remote AI server offline and confirm local free model still appears.
- Index a small text document locally.
- Search the document with RAG enabled.
- Confirm no document content is sent to the remote embedding endpoint when local model is selected.

## 12. Success Metrics

- Users can index and search knowledge documents without remote embedding latency when local model is selected.
- Remote embedding failures no longer block document indexing when local fallback succeeds.
- The local model is visible and understandable as a free option.
- Existing remote-indexed documents remain functional.
- No UI freeze occurs during local embedding generation.
