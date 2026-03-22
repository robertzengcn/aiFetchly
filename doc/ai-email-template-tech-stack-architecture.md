# AI Email Template Creation — Tech Stack & Architecture Choices

This document captures tech stack and architecture choices for implementing AI-assisted email template creation in aiFetchly.

---

## 1. Tech Stack

### 1.1 Current Stack (Keep)

| Layer | Technology | Usage |
|-------|------------|-------|
| **Desktop** | Electron | Main/renderer processes, IPC |
| **Frontend** | Vue 3 (Composition API) | `templatedetail.vue` |
| **UI** | Vuetify 3 | Components, dialogs, forms |
| **Build** | Vite | Bundling, dev server |
| **Language** | TypeScript 5.x | Full type safety |
| **State** | Pinia | Shared state |
| **HTTP** | `HttpClient` (fetch) | Remote API calls to `VITE_LOGIN_URL/apis` |
| **DB (local)** | SQLite + TypeORM | Email templates, RAG metadata |
| **Vector store** | sqlite-vec | RAG vector search |
| **i18n** | vue-i18n | 6 languages |

### 1.2 AI / RAG Stack (Existing)

| Component | Technology | Notes |
|-----------|------------|-------|
| **Remote AI** | HTTP REST + SSE | `AiChatApi` → `/api/ai/ask/stream`, `/api/ai/chat/message` |
| **Local RAG** | RagSearchModule + VectorSearchService | Vector search in main process |
| **Embeddings** | Remote API (RagConfigApi) | Embedding model from remote server |
| **Chunking** | ChunkingService | Document chunking |
| **LLM SDK** | `openai` (optional local) | Used by ResponseGenerator |

### 1.3 Optional Additions for Email Template

| Option | Technology | Purpose |
|--------|------------|---------|
| **Structured output** | `zod` (already in deps) | Validate AI response schema |
| **Streaming UI** | Existing `ChatStreamChunk` pattern | Real-time template generation |

---

## 2. Architecture Choices

### 2.1 Client–Server Split

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         aiFetchly (Electron App)                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  Renderer Process          │  Main Process              │  Child Process      │
│  templatedetail.vue        │  IPC Handler               │  (not used)         │
│  - "Generate with AI"      │  - USER_AI_ENABLED check   │                     │
│  - Prompt form             │  - RagSearchModule.search()│                     │
│  - Variable buttons        │  - AiChatApi call          │                     │
│  - Preview                 │  - Stream event forwarding │                     │
└──────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP (VITE_LOGIN_URL + /apis)
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Remote API Server (Marketing Backend)                 │
│  - POST /api/ai/ask/stream (Option B)                                         │
│  - POST /api/ai/email-template/generate (Option A - new)                      │
│  - POST /api/ai/embeddings (RAG embedding)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Choice:** All AI/RAG logic runs in the main process (IPC handler). Renderer only sends params and displays results.

**Rationale:** Matches existing AI chat flow; main process has access to Token, RagSearchModule, and Electron APIs.

---

### 2.2 AI Endpoint Choice (Option A vs B)

| Aspect | Option A: Dedicated Endpoint | Option B: Reuse Chat Stream |
|--------|------------------------------|------------------------------|
| **Remote** | New `/api/ai/email-template/generate` | Existing `/api/ai/ask/stream` |
| **Protocol** | REST (request/response) | SSE (streaming) |
| **Output** | Structured JSON `{ title, content, description }` | Free-form text, parsed client-side |
| **Backend changes** | Yes | No |
| **Validation** | Server-side schema | Client-side (e.g. zod) |
| **Latency** | Single request | Same |
| **Iteration** | Can add retries, caching, versioning | Minimal changes |

**Recommendation:**
- **Phase 1 (MVP):** Option B — reuse chat stream, zero backend changes
- **Phase 2 (Production):** Option A — dedicated endpoint for structured output, versioning, and guardrails

---

### 2.3 RAG Integration Pattern

```
User Prompt
    │
    ▼
┌─────────────────────────┐
│ RagSearchModule.search  │  (Main process, local)
│ Query: prompt + tone    │
└───────────┬─────────────┘
            │ SearchResults
            ▼
┌─────────────────────────┐
│ Format RAG context      │
│ "Based on context:      │
│  [Doc 1] ... [Doc N]    │
│  --- User: {prompt}"    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ AiChatApi.streamMessage │  (or generateEmailTemplate)
│ + system prompt         │
└───────────┬─────────────┘
            │
            ▼
       Remote AI Server
```

**Choice:** Same pattern as `ai-chat-ipc.ts` (lines 178–210): local RAG → enhance message → send to remote AI.

**Rationale:** Consistent with existing AI chat; no need for remote RAG for templates.

---

### 2.4 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Data Flow                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  templatedetail.vue                                                              │
│       │                                                                          │
│       │ generateAIEmailTemplate({ prompt, tone, useRAG, ... })                   │
│       ▼                                                                          │
│  src/views/api/emailmarketing.ts                                                 │
│       │                                                                          │
│       │ windowInvoke(AI_EMAIL_TEMPLATE_GENERATE, data)                           │
│       ▼                                                                          │
│  preload.ts (contextBridge)                                                      │
│       │                                                                          │
│       │ IPC to main                                                              │
│       ▼                                                                          │
│  ai-email-template-ipc.ts (new) or ai-chat-ipc.ts (extend)                       │
│       │                                                                          │
│       ├─ Token.getValue(USER_AI_ENABLED) ──► if false: return error              │
│       │                                                                          │
│       ├─ if useRAG: RagSearchModule.search(prompt)                               │
│       │       │                                                                  │
│       │       └─► enhancedMessage = RAG context + user prompt                    │
│       │                                                                          │
│       ├─ AiChatApi.streamMessage({ message, systemPrompt, ... })                 │
│       │       │                                                                  │
│       │       └─► HttpClient.postStream('/api/ai/ask/stream', ...)               │
│       │                                                                          │
│       └─► Parse stream → extract title/content → return to renderer              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Choice:** Main process owns all AI logic. Renderer is a thin UI layer.

**Rationale:** Aligns with project constitution (AI enable check in IPC); keeps renderer process lightweight.

---

### 2.5 IPC Channel Design

| Choice | Approach | Rationale |
|--------|----------|-----------|
| **New vs existing** | New channels: `AI_EMAIL_TEMPLATE_GENERATE`, `AI_EMAIL_TEMPLATE_GENERATE_CHUNK`, `AI_EMAIL_TEMPLATE_GENERATE_COMPLETE` | Isolates from chat; clearer semantics |
| **Streaming** | Reuse `AI_CHAT_STREAM` + `AI_CHAT_STREAM_CHUNK` / `AI_CHAT_STREAM_COMPLETE` | Less duplication if Option B |
| **Handler location** | New `email-template-ai-ipc.ts` or extend `ai-chat-ipc.ts` | New file preferred for separation of concerns |

---

### 2.6 Variable System Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Variable format** | `{$var_name}` (unchanged) | Matches `convertVariableInTemplate` |
| **AI output** | AI must only emit allowed variables | Prevents invalid placeholders |
| **Variable registry** | Single source of truth (e.g. `EMAIL_TEMPLATE_VARIABLES`) | Shared by types, utils, UI, and AI prompt |
| **Validation** | Post-process AI output; replace or strip invalid `{$...}` | Fail-safe behavior |

---

### 2.7 Error Handling & Resilience

| Scenario | Strategy |
|----------|----------|
| AI disabled | Check `USER_AI_ENABLED` before any work |
| RAG failure | Fall back to prompt without RAG context |
| Remote timeout | Use stream with timeout; show partial result |
| Invalid AI output | Validate with zod; retry or show error |
| Network error | `HttpClient` retry / `TokenRefreshService` |

---

## 3. Architecture Decision Summary

| Decision | Recommendation |
|----------|----------------|
| **AI endpoint** | Phase 1: Option B (chat stream); Phase 2: Option A (dedicated) |
| **RAG location** | Local only (RagSearchModule in main process) |
| **IPC** | New `AI_EMAIL_TEMPLATE_*` channels + handler |
| **Streaming** | Use streaming for real-time UX |
| **Variable handling** | Central variable registry + post-process validation |
| **Dependencies** | No new packages; use `zod` if needed |

---

## 4. Remote Server Requirements (Option A)

If implementing a dedicated endpoint, the remote server should:

1. Accept `{ prompt, tone, industry, templateType, existingTitle?, existingContent? }`
2. Return `{ title, content, description?, variablesUsed }` or stream equivalent chunks
3. Use an email-specific system prompt with variable rules
4. Optionally accept prebuilt RAG context (or perform its own retrieval)
5. Reuse existing auth (Bearer token via `HttpClient`)

---

## References

- [ai-email-template-creation-advice.md](./ai-email-template-creation-advice.md) — Implementation advice
- [ai-chat-technical-docs.md](./ai-chat-technical-docs.md) — AI chat architecture
- [rag_api_documentation.md](./rag_api_documentation.md) — RAG API details
