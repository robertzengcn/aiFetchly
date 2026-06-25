# PRD: Knowledge Library Tool Calling and Reranked RAG

## 1. Overview

This PRD defines the next improvement to aiFetchly's knowledge library RAG system: a dedicated AI-callable `knowledge_library_search` tool backed by a more accurate retrieval pipeline using vector search, keyword search, reranking, and source-aware context formatting.

The goal is to make AI answers grounded in the user's uploaded knowledge library more accurate, explainable, and controllable. The current implementation retrieves context before the model responds and prepends that context into the user message. This works for simple cases, but it often retrieves broad or mismatched content and gives the model no way to perform a targeted follow-up search after it understands the user's intent.

## 2. Problem Statement

Users expect the AI assistant to answer questions from the knowledge library with precise, relevant information. The current RAG implementation has several accuracy limitations:

- RAG context is injected before the model can decide what knowledge it needs.
- Retrieval is primarily dense vector search, which is weak for exact facts such as names, IDs, dates, URLs, email addresses, and short phrases.
- Search results are not reranked by a relevance model before being sent to the LLM.
- Filters are applied after broad search, and some filter paths are currently placeholders.
- Result score assignment can be incorrect when chunk lookup order differs from vector result order.
- The same `threshold` value is used as both vector distance and similarity score, which creates inconsistent filtering behavior.
- Context formatting does not consistently include compact citations or neighboring chunks.

The AI server now provides an OpenAI-compatible chat API and a rerank API. aiFetchly should use these capabilities to improve RAG quality while preserving the existing local tool execution architecture.

## 3. Objectives

- Add a dedicated AI-callable `knowledge_library_search` tool.
- Improve retrieval accuracy with hybrid vector + keyword candidate collection.
- Use the AI server's `/v1/rerank` endpoint to rerank candidate chunks before returning results.
- Return structured, citation-friendly knowledge results to the AI.
- Preserve the existing `SkillRegistry`, `SkillExecutor`, `ToolExecutor`, and `StreamEventProcessor` tool-call architecture.
- Reduce automatic broad RAG context injection when tool calling is available.
- Add tests that verify ordering, filtering, reranking, and tool execution behavior.

## 4. Non-Goals

- Replacing the full existing RAG document ingestion system.
- Replacing sqlite-vec or the current vector store architecture in this phase.
- Moving all chat traffic to `/v1/chat/completions` immediately.
- Building a new permission framework for read-only knowledge search.
- Adding a new knowledge library UI redesign.
- Supporting arbitrary database access from worker processes.

## 5. Current Architecture Findings

### 5.1 Existing RAG search path

Current search flows through:

- `RagSearchModule.search()`
- `VectorSearchService.search()`
- `VectorStoreService.search()`
- `RAGChunkModule.getChunksByIds()`

The system searches document-specific vector indexes, combines chunk IDs and distances, then loads chunk details from SQLite.

### 5.2 Current chat integration

When `useRAG` is enabled, `ai-chat-ipc.ts` performs local RAG search before sending the message to the AI server. It then prepends retrieved chunks into the user message.

This should remain as a temporary fallback, but the preferred behavior should become tool-based retrieval:

- AI receives the `knowledge_library_search` tool.
- AI calls the tool when the user asks a knowledge-library question.
- Local app executes the search.
- Tool result is sent back through the existing continuation flow.
- AI answers from returned sources.

### 5.3 Tool execution path

The active stream path already provides tools from `SkillRegistry.getAllToolFunctions()`. `StreamEventProcessor` executes registered skills through `SkillExecutor`, which can call `ToolExecutor` or module services.

Implication: `knowledge_library_search` should be registered as a built-in skill in `src/config/skillsRegistry.ts`.

### 5.4 New AI server capabilities

The client already exposes:

- `AiChatApi.openAIChatCompletion()`
- `AiChatApi.openAIChatCompletionStream()`
- `AiChatApi.rerank()`

The OpenAI-compatible chat wrapper currently does not type or forward `tools`, `tool_choice`, or streamed `tool_calls`, so this phase should not depend on migrating chat to `/v1/chat/completions`. The rerank API can be used immediately inside the local retrieval pipeline.

## 6. Proposed Solution

### 6.1 Add `knowledge_library_search` as a built-in skill

Register a new read-only tool in `SkillRegistry`:

```ts
{
  name: "knowledge_library_search",
  description: "Search the local knowledge library for factual information from uploaded documents. Use this before answering questions that require knowledge-base context.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number", default: 5 },
      documentIds: { type: "array", items: { type: "number" } },
      documentTypes: { type: "array", items: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
      author: { type: "string" },
      dateRange: {
        type: "object",
        properties: {
          start: { type: "string" },
          end: { type: "string" }
        }
      },
      includeNeighborChunks: { type: "boolean", default: true }
    },
    required: ["query"]
  },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "read",
  source: "built-in"
}
```

The tool should execute through module-layer logic, not direct database access in IPC handlers.

### 6.2 Add a dedicated tool-facing module method

Add a method such as:

```ts
RagSearchModule.searchKnowledgeForTool(request): Promise<KnowledgeSearchToolResult>
```

This method should wrap the new retrieval pipeline and return LLM-friendly structured data.

Example result:

```ts
{
  query: string;
  totalCandidates: number;
  results: Array<{
    chunkId: number;
    documentId: number;
    documentName: string;
    title?: string;
    fileType: string;
    chunkIndex: number;
    score: number;
    rerankScore?: number;
    content: string;
    citation: string;
  }>;
}
```

### 6.3 Retrieval pipeline

The tool-backed retrieval flow should be:

```text
query
-> validate request and clamp limits
-> apply document metadata filters before retrieval
-> collect vector candidates, e.g. top 40
-> collect keyword candidates, e.g. top 40
-> merge and dedupe candidates by chunkId
-> rerank merged candidates with /v1/rerank
-> select top N reranked chunks
-> include neighbor chunks when requested
-> trim to context budget
-> return structured results with citations
```

### 6.4 Rerank integration

Use `AiChatApi.rerank()` after initial retrieval:

- `query`: original or rewritten user query.
- `documents`: candidate chunks, preferably objects with `text` and metadata fields.
- `top_n`: larger than the final result count if neighbor expansion is enabled.
- `return_documents`: false unless debugging requires returned document text.

Candidate mapping must preserve index-to-chunk identity:

```ts
const candidates = [...];
const rerankResponse = await aiChatApi.rerank({
  query,
  documents: candidates.map((candidate) => ({
    text: candidate.content,
    chunkId: candidate.chunkId,
    documentId: candidate.documentId
  })),
  top_n: limit
});

const ranked = rerankResponse.results.map((item) => ({
  ...candidates[item.index],
  rerankScore: item.relevance_score
}));
```

If rerank fails, the system should fall back to merged vector + keyword ranking and include a warning in logs, not fail the entire user chat.

### 6.5 Hybrid search

Add a keyword retrieval path in addition to vector retrieval.

Preferred implementation:

- Use SQLite FTS5 if available for `rag_chunks`.
- If FTS5 migration is too large, start with safe `LIKE`-based search as a fallback.
- Normalize query terms for exact identifiers, quoted phrases, emails, URLs, and dates.

Hybrid merging should use a simple, explainable score at first:

```text
combinedScore = vectorWeight * normalizedVectorScore
              + keywordWeight * normalizedKeywordScore
              + metadataBoost
```

Rerank becomes the final relevance authority when available.

### 6.6 Neighbor chunk expansion

After reranking, include surrounding chunks from the same document:

- default: include one previous and one next chunk
- never duplicate chunks
- preserve document order in expanded context
- label neighbor chunks separately from direct matches

This improves answer quality when the top chunk contains a partial sentence, table row, heading, or reference that needs nearby context.

### 6.7 Replace broad pre-injection behavior

For chat sessions where tool calling is available:

- `useRAG = true` should mean "expose and encourage knowledge-library tool use."
- The AI should call `knowledge_library_search` before answering knowledge-specific questions.
- Pre-injected RAG context should remain only as fallback for non-tool chat paths or compatibility modes.

The system prompt or developer message sent to the AI should include:

```text
When the user asks about uploaded documents, saved knowledge, internal notes, or the knowledge library, call `knowledge_library_search` before answering. Base factual claims on returned sources and cite document names.
```

### 6.8 OpenAI-compatible chat API path

The new `/v1/chat/completions` support should be treated as a future integration path for tool calling.

Before migrating tool chat to this endpoint, the API client must support:

- `tools`
- `tool_choice`
- non-streaming `message.tool_calls`
- streaming `delta.tool_calls`
- `role: "tool"` messages
- a local continuation loop equivalent to the existing custom stream continuation path

Until then, keep the existing custom tool stream path for production tool execution.

## 7. Functional Requirements

### Tool registration and execution

- FR-001: System MUST register `knowledge_library_search` as a built-in skill in `SkillRegistry`.
- FR-002: System MUST expose the tool through `SkillRegistry.getAllToolFunctions()`.
- FR-003: System MUST execute the tool through module/service-layer logic, not direct database access in IPC handlers.
- FR-004: System MUST not require user confirmation for the read-only knowledge search tool.
- FR-005: System MUST validate and clamp user/tool-provided `limit` values.

### Retrieval

- FR-006: System MUST support vector candidate retrieval from existing document vector indexes.
- FR-007: System MUST support keyword candidate retrieval from chunk content.
- FR-008: System MUST merge and dedupe vector and keyword candidates by `chunkId`.
- FR-009: System MUST preserve correct chunk-to-score mapping after database lookup.
- FR-010: System MUST apply document metadata filters before retrieval when possible.
- FR-011: System MUST distinguish vector distance thresholds from similarity score thresholds.

### Reranking

- FR-012: System MUST use `AiChatApi.rerank()` to rerank candidate chunks when the rerank API is available.
- FR-013: System MUST preserve candidate identity through rerank index mapping.
- FR-014: System MUST fall back to non-reranked hybrid ranking if rerank fails.
- FR-015: System MUST include rerank scores in tool results when available.

### Context and citations

- FR-016: System MUST return document name, document ID, chunk ID, chunk index, and content for each result.
- FR-017: System MUST include citation labels suitable for LLM responses.
- FR-018: System SHOULD include neighboring chunks when `includeNeighborChunks` is true.
- FR-019: System MUST bound total returned content to avoid oversized tool results.
- FR-020: System MUST mark truncated output when context limits are applied.

### Chat behavior

- FR-021: In tool-capable chat sessions, `useRAG` SHOULD expose and encourage the knowledge search tool instead of blindly prepending broad RAG context.
- FR-022: Existing pre-injection behavior MAY remain as fallback for non-tool or compatibility paths.
- FR-023: The AI system/developer prompt MUST instruct the model to use `knowledge_library_search` for uploaded-document or knowledge-library questions.

### OpenAI-compatible API

- FR-024: This phase MUST NOT depend on OpenAI-compatible tool calling until the client supports `tools` and `tool_calls`.
- FR-025: A future phase SHOULD add OpenAI-compatible tool-call support using the same local tool execution services.

## 8. Non-Functional Requirements

- NFR-001: Knowledge search tool execution SHOULD complete within 5 seconds for libraries up to 10,000 chunks when rerank is online.
- NFR-002: If rerank is unavailable, fallback retrieval SHOULD complete within 3 seconds for libraries up to 10,000 chunks.
- NFR-003: Tool results MUST be deterministic for the same indexed data and same rerank response.
- NFR-004: The implementation MUST follow the existing Model -> Module -> IPC architecture.
- NFR-005: The implementation MUST avoid `any` and use explicit TypeScript interfaces.
- NFR-006: The implementation MUST not access the database from worker processes.
- NFR-007: Logging MUST include retrieval counts and rerank fallback reasons without logging sensitive full document content unnecessarily.

## 9. User Stories

### User Story 1: Ask a factual question from documents

As a user, I want to ask the AI about uploaded documents so that I get an answer based on the most relevant knowledge-library passages.

Acceptance criteria:

- Given knowledge mode is enabled, when I ask a question about uploaded content, the AI calls `knowledge_library_search`.
- The answer cites the returned document names.
- The answer does not invent facts when no relevant result is found.

### User Story 2: Find exact information

As a user, I want the AI to find exact names, emails, dates, IDs, and URLs from my knowledge library.

Acceptance criteria:

- Keyword retrieval contributes exact-match candidates.
- Rerank promotes the most relevant exact-match chunks.
- Returned results include source document and chunk metadata.

### User Story 3: Query a narrowed document set

As a user, I want the AI to search only selected documents or document types when my question is scoped.

Acceptance criteria:

- The tool accepts document IDs and metadata filters.
- Filters are applied before candidate retrieval when possible.
- Results do not include filtered-out documents.

### User Story 4: Continue gracefully when rerank fails

As a user, I want knowledge search to continue working even when the rerank service is unavailable.

Acceptance criteria:

- Rerank errors are logged.
- The tool returns fallback hybrid-ranked results.
- The AI receives a usable tool result instead of a failed chat.

## 10. Edge Cases

- Empty knowledge library: return success with zero results and a clear message.
- Documents without embeddings: exclude from vector retrieval but allow keyword retrieval if chunks exist.
- Mixed embedding models: avoid comparing raw distances across incompatible models without normalization.
- Duplicate chunks: dedupe by `chunkId` and optionally by content hash.
- Very short queries: rely more heavily on keyword search and query expansion.
- Long multi-part questions: allow future query decomposition, but return best available results in this phase.
- Rerank response indexes out of range: ignore invalid rerank items and log a warning.
- Oversized chunks: truncate individual result content with a `truncated` flag.
- Missing vector index file: skip vector search for that document and keep keyword candidates.
- Stale document metadata: return safe partial results and log the inconsistency.

## 11. Success Metrics

- SM-001: For a fixed evaluation set, top-5 retrieval accuracy improves by at least 25% compared with current vector-only search.
- SM-002: Exact-match queries for names, dates, IDs, URLs, and emails return the correct source chunk in top 5 at least 90% of the time.
- SM-003: Rerank fallback path succeeds without chat failure in 100% of simulated rerank outage tests.
- SM-004: Tool-call RAG answers include source document citations in at least 95% of knowledge-library answer scenarios.
- SM-005: No direct database access is added to IPC handlers or worker processes.
- SM-006: Automated tests cover ordering, filter application, rerank mapping, fallback behavior, and tool registration.

## 12. Implementation Plan

### Phase 1: Correctness fixes

- Preserve chunk order when loading chunks by IDs.
- Split `threshold` into explicit `maxDistance` and `minScore`.
- Tighten `getDocumentsWithEmbeddings()` to detect actual embedding/index availability.
- Add unit tests for score/chunk alignment.

### Phase 2: Reranked retrieval service

- Add candidate result interfaces.
- Add vector candidate retrieval with normalized scores.
- Add keyword candidate retrieval.
- Add candidate merge/dedupe.
- Add rerank integration using `AiChatApi.rerank()`.
- Add fallback behavior when rerank fails.

### Phase 3: Knowledge search tool

- Register `knowledge_library_search` in `SkillRegistry`.
- Add execution handler that calls `RagSearchModule.searchKnowledgeForTool()`.
- Add tool result formatting for LLM consumption.
- Add tests for tool registration and execution.

### Phase 4: Chat integration

- Update RAG-enabled chat prompt instructions to prefer tool use.
- Keep pre-injection fallback only for compatibility paths.
- Ensure stream continuation still sends the knowledge tool after tool results.

### Phase 5: Evaluation and tuning

- Create a small deterministic RAG evaluation fixture set.
- Measure vector-only vs hybrid vs reranked results.
- Tune candidate counts, score weights, and default limits.

## 13. Test Strategy

### Unit tests

- `VectorSearchService` preserves chunk/result order.
- Threshold fields use correct semantics.
- Hybrid candidate merge dedupes correctly.
- Rerank mapping returns the correct chunks for response indexes.
- Rerank failure falls back to hybrid results.

### Module tests

- `RagSearchModule.searchKnowledgeForTool()` returns structured results.
- Metadata filters are applied before retrieval where possible.
- Neighbor chunk expansion preserves document order.

### Tool tests

- `knowledge_library_search` appears in `SkillRegistry.getAllToolFunctions()`.
- Tool execution validates inputs and clamps limits.
- Tool output includes citations and bounded content.

### Integration tests

- Chat stream receives a tool call, executes local knowledge search, sends tool result, and continues the answer.
- Existing non-tool RAG fallback still works.

## 14. Risks and Mitigations

- Risk: Rerank API latency slows chat responses.
  - Mitigation: cap candidates, add timeout, and fall back to hybrid ranking.

- Risk: Mixed embedding models produce inconsistent vector scores.
  - Mitigation: normalize scores per model group and rely on rerank as final ordering.

- Risk: Keyword search with `LIKE` is slow on large libraries.
  - Mitigation: start with bounded fallback, then add FTS5 indexing in a follow-up.

- Risk: Tool calling is less reliable if the model ignores the tool.
  - Mitigation: add strong system/developer instructions and keep fallback pre-injection for compatibility.

- Risk: Context output becomes too large.
  - Mitigation: enforce per-result and total token/character budgets.

## 15. Open Questions

- Which rerank model should be the default, and should users configure it separately from chat and embedding models?
- Should keyword search use FTS5 immediately, or should this phase start with `LIKE` and add FTS5 after validation?
- Should `knowledge_library_search` support query decomposition in this phase or a later phase?
- Should tool results expose raw scores to users in the UI, or keep scores internal to the AI flow?
- Should selected documents from the Knowledge Library UI be passed automatically as `documentIds` during chat?

