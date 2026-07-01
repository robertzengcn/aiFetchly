# Technology Advice: Knowledge Library Tool Calling and Reranked RAG

This document translates `docs/rag-tool-call-rerank-prd.md` into implementation guidance for aiFetchly's current Electron, TypeScript, SQLite, sqlite-vec, and skill-tool architecture.

## 1. Recommended architecture

Keep the implementation in the existing local tool execution path:

```text
AI stream
-> StreamEventProcessor
-> SkillExecutor
-> SkillRegistry built-in skill
-> RagSearchModule.searchKnowledgeForTool()
-> VectorSearchService / keyword search / rerank
-> RAGChunkModule / RAGDocumentModule
-> structured tool result
-> streamContinueWithToolResults()
```

Do not migrate this feature to `/v1/chat/completions` tool calling in the first pass. The current OpenAI-compatible client path supports basic messages and streaming text, but it does not yet model `tools`, `tool_choice`, `tool_calls`, or `role: "tool"` messages. The existing custom stream path already executes local tools and should remain the production path for this feature.

## 2. File placement

Recommended files:

- `src/config/skillsRegistry.ts`: register `knowledge_library_search`.
- `src/modules/RagSearchModule.ts`: expose `searchKnowledgeForTool()`.
- `src/service/VectorSearchService.ts`: add candidate retrieval, merge, scoring, rerank orchestration, and context shaping.
- `src/service/RagKeywordSearchService.ts`: optional new service for keyword/FTS retrieval if keeping `VectorSearchService` focused.
- `src/service/RagRerankService.ts`: optional new service wrapping `AiChatApi.rerank()` with timeout and fallback handling.
- `src/model/RAGChunk.model.ts`: add order-preserving chunk lookup and keyword search helpers.
- `src/modules/RAGChunkModule.ts`: expose model helpers without bypassing module boundaries.
- `test/vitest/main/service/`: service-level tests.
- `test/vitest/main/`: registry/tool execution tests if existing patterns support it.

Avoid direct database access in IPC handlers. Keep all persistence inside Model and Module layers.

## 3. Implement in this order

### Step 1: Retrieval correctness fixes

Fix these before adding the new tool, because they directly affect answer accuracy:

1. Preserve vector result order after loading chunks.
2. Split `threshold` into separate concepts:
   - `maxDistance`: vector distance cutoff.
   - `minScore`: normalized similarity/relevance cutoff.
3. Tighten document eligibility so vector retrieval uses only documents with usable vector metadata/indexes.
4. Add tests for chunk ID to score alignment.

Recommended order-preserving pattern:

```ts
const chunks = await this.chunkModule.getChunksByIds(chunkIds);
const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

for (const candidate of candidates) {
  const chunk = chunkById.get(candidate.chunkId);
  if (!chunk) continue;
  // Candidate score now stays attached to the correct chunk.
}
```

Do not rely on SQL `IN (:...chunkIds)` result order.

### Step 2: Candidate model

Introduce explicit candidate types so vector, keyword, and rerank data do not get mixed accidentally.

```ts
export interface RagSearchCandidate {
  chunkId: number;
  documentId: number;
  content: string;
  source: "vector" | "keyword" | "hybrid";
  vectorDistance?: number;
  vectorScore?: number;
  keywordScore?: number;
  combinedScore: number;
  rerankScore?: number;
  metadata: {
    chunkIndex: number;
    startPosition?: number;
    endPosition?: number;
    pageNumber?: number;
  };
  document: {
    id: number;
    name: string;
    title?: string;
    fileType: string;
  };
}
```

Keep raw vector distance separate from normalized scores. This prevents the current `threshold` ambiguity from returning inconsistent results.

### Step 3: Hybrid retrieval

Use two candidate sources:

- Vector search for semantic similarity.
- Keyword search for exact facts and short identifiers.

Start with a bounded keyword implementation if FTS5 migration is not ready:

- tokenize query safely
- search exact quoted phrases first
- search important terms with `LIKE`
- cap candidate count
- return simple keyword score based on phrase/term hits

Prefer FTS5 as the durable implementation once schema migration is acceptable:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts
USING fts5(content, chunkId UNINDEXED, documentId UNINDEXED);
```

If FTS5 is added, keep it synchronized when chunks are created or deleted. Do not build an FTS query by concatenating raw user text. Escape or tokenize input first.

### Step 4: Candidate merge

Merge by `chunkId`.

Suggested default weights before rerank:

```text
vectorWeight = 0.65
keywordWeight = 0.35
```

For short or identifier-like queries, shift weight toward keyword:

```text
vectorWeight = 0.45
keywordWeight = 0.55
```

Identifier-like signals:

- email address
- URL
- date
- phone number
- long numeric ID
- quoted phrase
- camelCase or snake_case symbol

Rerank should become final authority when available. Hybrid score is primarily a candidate-selection score.

## 4. Rerank integration

Use `AiChatApi.rerank()` in a small wrapper service or private method so timeout and fallback logic are centralized.

Recommended behavior:

- Input candidates: max 40-80 chunks.
- `top_n`: final limit plus extra room for neighbor expansion, usually `limit * 2`.
- Timeout: 4-8 seconds.
- `return_documents`: false by default.
- On error, log a warning and return hybrid-ranked candidates.

Use stable index mapping:

```ts
const documents = candidates.map((candidate) => ({
  text: candidate.content,
  chunkId: candidate.chunkId,
  documentId: candidate.documentId,
}));

const response = await aiChatApi.rerank({
  query,
  documents,
  top_n: Math.min(candidates.length, rerankTopN),
  return_documents: false,
});

const ranked: RagSearchCandidate[] = [];
for (const item of response.results) {
  const candidate = candidates[item.index];
  if (!candidate) {
    console.warn(`Rerank returned invalid candidate index: ${item.index}`);
    continue;
  }
  ranked.push({
    ...candidate,
    rerankScore: item.relevance_score,
    combinedScore: item.relevance_score,
  });
}
```

Do not trust returned document text for identity. Treat rerank indexes as the source of truth.

## 5. Knowledge search tool design

Register one built-in skill:

- Name: `knowledge_library_search`
- Permission: read-only, no confirmation
- Runtime: call `RagSearchModule.searchKnowledgeForTool()`

Use a small schema. The model should not need to know implementation details:

```ts
{
  query: string;
  limit?: number;
  documentIds?: number[];
  documentTypes?: string[];
  tags?: string[];
  author?: string;
  dateRange?: { start: string; end: string };
  includeNeighborChunks?: boolean;
}
```

Validate with explicit TypeScript guards or a schema library already accepted in the repo. Clamp:

- `limit`: 1-10, default 5
- vector candidate count: 20-80
- keyword candidate count: 20-80
- returned content size: configurable, with a hard cap

Tool output should be optimized for LLM consumption:

```ts
{
  success: true;
  query: string;
  totalCandidates: number;
  rerankUsed: boolean;
  truncated: boolean;
  results: Array<{
    citation: string;
    documentId: number;
    documentName: string;
    title?: string;
    fileType: string;
    chunkId: number;
    chunkIndex: number;
    score: number;
    rerankScore?: number;
    content: string;
  }>;
}
```

Use citation labels like:

```text
[doc:12 chunk:8 MarketingPlan.pdf]
```

This makes model citations simpler and gives the UI a stable hook for future clickable sources.

## 6. Neighbor chunk expansion

Neighbor chunks should be added after rerank, not before rerank. Rerank should compare direct candidate chunks only.

Default:

- include one previous chunk
- include one next chunk
- only from the same document
- dedupe by `chunkId`
- preserve source document order when grouping final context

Recommended final ordering:

1. Reranked direct hit order for result groups.
2. Within each group, neighbor chunks ordered by `chunkIndex`.

Mark neighbor chunks in metadata if they are returned as separate entries:

```ts
matchType: "direct" | "neighbor"
```

If the tool returns neighbors inline inside each result, label the sections clearly:

```text
Previous context:
...

Matched chunk:
...

Next context:
...
```

## 7. Filters and metadata

Apply filters before retrieval whenever possible.

Recommended filter flow:

1. Resolve allowed document IDs from metadata filters using `RAGDocumentModule`.
2. Pass allowed document IDs into vector and keyword retrieval.
3. Search only those documents.
4. Apply a final defensive filter after retrieval.

Supported filters:

- `documentIds`
- `documentTypes`
- `tags`
- `author`
- `dateRange`

If a filter cannot be applied at the vector index layer, at least use it to choose which document indexes are loaded. Avoid searching every document and filtering afterward.

## 8. Chat integration guidance

For the existing custom stream path:

- Keep `SkillRegistry.getAllToolFunctions()` as the tool source.
- Add `knowledge_library_search` to that registry.
- Update RAG-enabled chat instructions so the model knows to call the tool.
- Avoid pre-injecting RAG context when the tool path is active.

Recommended instruction:

```text
When the user asks about uploaded documents, saved knowledge, internal notes, or the knowledge library, call `knowledge_library_search` before answering. Base factual claims on returned sources. If the tool returns no relevant result, say that the knowledge library did not contain enough information.
```

Keep pre-injection fallback for:

- non-streaming paths that cannot execute tools
- compatibility paths
- temporary migration safety

For `/v1/chat/completions`, do not enable knowledge tool calling until these are implemented:

- request `tools`
- request `tool_choice`
- non-streaming `message.tool_calls`
- streaming `delta.tool_calls`
- local tool execution loop
- follow-up messages with `role: "tool"`

## 9. Error handling

Return successful empty results for normal no-data states:

- no documents
- no matching documents after filters
- no candidates

Return fallback results for rerank failures:

```ts
{
  success: true,
  rerankUsed: false,
  warning: "Rerank unavailable; returned hybrid-ranked results.",
  results: [...]
}
```

Return `success: false` only for invalid tool input or unexpected local execution failures.

Do not throw from the tool handler for expected retrieval misses. Tool failures degrade the chat loop more than an empty result does.

## 10. Observability

Log compact retrieval metadata:

- query hash or truncated query
- document count searched
- vector candidate count
- keyword candidate count
- merged candidate count
- rerank used or fallback reason
- execution time per phase
- returned result count
- truncation flag

Avoid logging full chunk content unless debug logging is explicitly enabled.

Recommended timing fields:

```ts
{
  vectorMs: number;
  keywordMs: number;
  rerankMs: number;
  totalMs: number;
}
```

## 11. Testing strategy

### Unit tests

- Chunk lookup preserves score mapping.
- `maxDistance` and `minScore` are applied independently.
- Candidate merge dedupes by `chunkId`.
- Identifier-like query shifts weight toward keyword results.
- Rerank index mapping preserves candidate identity.
- Invalid rerank indexes are ignored safely.
- Rerank failure returns fallback hybrid results.

### Module tests

- `RagSearchModule.searchKnowledgeForTool()` returns citation-ready results.
- Filters restrict the searched documents.
- Empty library returns success with zero results.
- Neighbor expansion returns previous and next chunks in correct order.
- Output caps set `truncated: true`.

### Tool tests

- `knowledge_library_search` is discoverable from `SkillRegistry.getAllToolFunctions()`.
- Tool execution clamps `limit`.
- Tool execution does not require permission.
- Tool result can pass through `ToolExecutionService.formatToolResultForLLM()`.

### Integration tests

- Stream emits tool call, local app executes knowledge search, continuation receives tool result, AI response resumes.
- Existing pre-injected RAG fallback still works for non-tool paths.

## 12. Performance defaults

Recommended initial constants:

```ts
const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;
const VECTOR_CANDIDATE_LIMIT = 50;
const KEYWORD_CANDIDATE_LIMIT = 50;
const RERANK_TOP_N_MULTIPLIER = 2;
const MAX_TOOL_CONTENT_CHARS = 12000;
const MAX_CHUNK_CONTENT_CHARS = 3000;
const RERANK_TIMEOUT_MS = 6000;
```

These should be centralized near the retrieval service and adjusted after evaluation.

## 13. Rollout recommendation

1. Ship correctness fixes and tests first.
2. Add hybrid retrieval with `LIKE` fallback.
3. Add rerank wrapper and fallback behavior.
4. Register `knowledge_library_search`.
5. Update chat instructions to prefer tool use when RAG is enabled.
6. Build a small retrieval evaluation fixture.
7. Add FTS5 if keyword fallback is too slow or inaccurate.
8. Add OpenAI-compatible tool calling only after the current custom tool path is stable.

## 14. Decisions to make before implementation

- Whether FTS5 is in the first implementation or a follow-up after `LIKE` validation.
- Default rerank model name, if the AI server requires one.
- Whether selected UI documents should automatically populate `documentIds`.
- Whether rerank should be configurable per user or fixed by server defaults.
- Whether citations should remain plain text initially or include UI-link metadata now.

