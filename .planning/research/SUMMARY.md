# Project Research Summary

**Project:** AiFetchly v1.1 -- File Operation Recording
**Domain:** AI Chat File Operation Recording (Electron + Vue 3 + TypeScript)
**Researched:** 2026-05-25
**Confidence:** HIGH

## Executive Summary

This feature adds real-time recording and inline display of AI-initiated file mutations (file_write, file_edit) within an existing Electron AI chat application. It is a pure integration task: no new npm dependencies are required. Every capability needed -- TypeScript types, Electron IPC push, Vue 3 reactivity, Vuetify UI components, vue-i18n translations -- already exists in the project and is actively used by analogous features like contact extraction progress and Google Maps search results.

The recommended approach is a static `FileOperationTracker` service class that intercepts file tool results inside `ToolExecutor.executeFileTool()`, constructs a typed `FileOperationRecord`, and pushes it to the renderer via a dedicated `AI_FILE_OPERATION` IPC channel. The frontend subscribes through an `aiChat.ts` API wrapper and renders color-coded badges inline with tool call messages in `AiChatBox.vue`. This follows every established pattern in the codebase and avoids inventing new architecture.

The key risks are: (1) tracker emit failures propagating into tool execution and crashing the AI stream, (2) missing the preload whitelist entry which silently drops all events, and (3) a race condition between the tool result chunk and the operation record arriving on separate IPC channels. All three are addressed by specific architectural decisions documented in the pitfall research.

## Key Findings

### Recommended Stack

Zero new dependencies. The feature uses TypeScript discriminated union types for the record shape, the existing Electron contextBridge IPC pattern for main-to-renderer push, Vue 3 `ref<T[]>()` for reactive state in a single component, and Vuetify `v-chip`/`v-icon` for badge rendering.

**Core technologies:**
- TypeScript ^5.1.3: `FileOperationRecord` interface and `FileOperationType` enum -- discriminated unions suffice, no schema library needed
- Electron IPC (contextBridge) ^35.0.3: main-to-renderer event push -- `webContents.send()` pattern already used throughout
- Vue 3 (Composition API) ^3.3.4: reactive operation list in AiChatBox.vue -- `ref<T[]>()` is enough for single-component consumer
- Vuetify 3.5.15: operation badges with color-coded success/failure states -- `v-chip`, `v-icon`, `v-tooltip`
- vue-i18n: 8 new translation keys across 6 language files -- already integrated, no library addition

### Expected Features

**Must have (table stakes):**
- `FileOperationRecord` type in `src/entityTypes/` -- foundation for all layers
- `FileOperationTracker` static service -- emits records via IPC after file mutations
- `AI_FILE_OPERATION` IPC channel in channellist.ts -- dedicated main-to-renderer push channel
- ToolExecutor integration -- intercept in `executeFileTool()` for file_write/file_edit only
- Frontend subscription wrapper in `aiChat.ts` -- `subscribeToFileOperations()` / `unsubscribeFromFileOperations()`
- In-chat operation badge in `AiChatBox.vue` -- color-coded chips showing path, type, and success/failure
- 6-language translations -- 8 keys in en, zh, es, fr, de, ja files

**Should have (competitive):**
- Expandable diff preview on edit -- the `FileEditResult.diff` field is already computed by FileToolService
- Click-to-open-file from badge -- single `shell.openPath()` IPC handler
- Operation summary counter -- reactive `computed` counting records by type

**Defer (v2+):**
- Grouped operation display -- requires non-trivial rendering logic; defer until usage data shows whether clutter is a real problem
- Database persistence -- explicitly out of scope for v1.1 per PROJECT.md
- Rollback/undo system -- massive scope creep; show what changed, let users undo manually
- Separate operation history panel -- inline badges in chat are the right UX; separate panel splits attention

### Architecture Approach

The architecture follows a strict dependency chain: types first, then the tracker service, then IPC channel, then backend integration, then frontend API, then UI, then translations. The interception point is `ToolExecutor.executeFileTool()` which is the single dispatch path for all file tools. A static `FileOperationTracker` holds a `BrowserWindow.webContents` reference (set during app initialization in `background.ts`) and pushes records via `webContents.send()`. The tracker's emit method is wrapped in try/catch that never re-throws, ensuring recording failures never break tool execution.

**Major components:**
1. `FileOperationRecord` type (`src/entityTypes/fileOperationRecord.ts`) -- immutable record with id, type, filePath, timestamp, success, conversationId, toolCallId, and optional metadata (bytesWritten, replacements, error)
2. `FileOperationTracker` (`src/service/FileOperationTracker.ts`) -- static service with `setWebContents()`, `emit()`, `clear()`, and a 500-record memory cap with oldest-first eviction
3. `AI_FILE_OPERATION` IPC channel (`src/config/channellist.ts`) -- dedicated channel string `ai-chat:file-operation`, registered in preload.ts receive and removeListener whitelists
4. Frontend subscription in `aiChat.ts` -- `windowReceive` wrapper with typed callback, cleanup via `windowRemoveAllListeners` on unmount
5. Badge rendering in `AiChatBox.vue` -- reactive `fileOperations` ref, color-coded `v-chip` per operation type, failure state with error tooltip

### Critical Pitfalls

1. **Tracker emit failure crashes skill execution** -- Wrap every `FileOperationTracker.emit()` call in its own try/catch that logs but never re-throws. The emit must be fire-and-forget, called AFTER the tool result is captured.
2. **Missing preload whitelist entry silently drops events** -- The preload.ts file has four independent whitelists. Adding a channel requires updating `receive` AND `removeListener` arrays. Omitting one produces no error but no events reach the renderer.
3. **No sender reference in ToolExecutor** -- ToolExecutor is a static class with no `IpcMainEvent` access. Use `FileOperationTracker` with a static `webContents` reference set during `background.ts` initialization, matching the `GOOGLE_MAPS_SEARCH_RESULT` pattern.
4. **Memory leak from unbounded records** -- Cap at 500 records with oldest-first eviction. Records are ephemeral (lost on restart anyway), so dropping old ones is acceptable.
5. **Race condition between tool result and operation record** -- Two independent IPC channels do not guarantee ordering. Include `toolCallId` in the record and reconcile in the frontend by matching with tool result messages.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Types and Tracker Foundation
**Rationale:** Every downstream layer depends on the `FileOperationRecord` type and the `FileOperationTracker` service. Building these first with proper error isolation and memory caps prevents the most critical pitfalls from propagating into later phases.
**Delivers:** Shared type definition, static tracker service with 500-record cap, type guard for IPC deserialization
**Addresses:** FileOperationRecord type (table stakes), FileOperationTracker service (table stakes)
**Avoids:** Pitfall 1 (emit crashes), Pitfall 4 (unbounded memory), Pitfall 5 (type drift)

### Phase 2: IPC Channel and Backend Integration
**Rationale:** The IPC channel and ToolExecutor integration must ship together -- a channel without an emitter is dead code, and an emitter without a channel drops events silently. The preload whitelist must be updated in the same commit as the channel constant.
**Delivers:** `AI_FILE_OPERATION` channel constant, preload whitelist entries, ToolExecutor emit call for file_write/file_edit, `background.ts` initialization hook
**Addresses:** IPC channel (table stakes), ToolExecutor integration (table stakes)
**Avoids:** Pitfall 2 (missing whitelist), Pitfall 3 (no sender reference), Pitfall 6 (race condition via toolCallId correlation)

### Phase 3: Frontend Subscription and Badge UI
**Rationale:** With the IPC channel live and emitting records, the frontend layer can subscribe and render. The subscription wrapper, reactive state, and badge rendering are tightly coupled and should be built together to verify the full data flow end-to-end.
**Delivers:** `subscribeToFileOperations()` / `unsubscribeFromFileOperations()` in aiChat.ts, reactive `fileOperations` ref in AiChatBox.vue, color-coded operation badges with success/failure states, toolCallId-based reconciliation for out-of-order events
**Addresses:** Frontend subscription wrapper (table stakes), In-chat operation badge (table stakes)
**Avoids:** Pitfall 6 (reconciliation), UX pitfall of showing operations as separate messages

### Phase 4: Translations and Polish
**Rationale:** Translations depend on finalized UI key names. Doing them last ensures no key renaming churn. This phase also adds the diff preview differentiator if time permits.
**Delivers:** 8 translation keys in all 6 language files (en, zh, es, fr, de, ja), optional expandable diff preview for edit operations, click-to-open-file from badge
**Addresses:** 6-language translations (table stakes), expandable diff preview (differentiator), click-to-open-file (differentiator)
**Avoids:** Pitfall 7 (incomplete i18n)

### Phase Ordering Rationale

- Phase 1 comes first because the type definition is referenced by every other file. The tracker service is the architectural core and must have its error isolation and memory cap baked in from the start.
- Phase 2 wires the backend to the tracker and opens the IPC channel. The channel and preload whitelist must land together; separating them risks a broken intermediate state.
- Phase 3 is the first user-visible output. It depends on both the tracker (Phase 1) and the channel (Phase 2) being complete.
- Phase 4 is last because translation keys must match the finalized UI, and the differentiator features (diff preview, click-to-open) are low-risk additions on top of the working MVP.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** Complex UI integration -- AiChatBox.vue is a large component (multiple message types, streaming handler, tool_call/tool_result rendering). The exact template insertion point and reactive state management need careful planning to avoid re-render performance issues.
- **Phase 3:** toolCallId reconciliation logic -- requires understanding the exact timing of `AI_CHAT_STREAM_CHUNK` tool_result events vs `AI_FILE_OPERATION` events to design the correct reconciliation strategy.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Types and static service follow well-established patterns in the codebase (RateLimiterManager, MessageType enum). No surprises expected.
- **Phase 2:** IPC channel creation and preload whitelist updates follow a mechanical checklist documented in the pitfall research.
- **Phase 4:** i18n is a rote task across 6 language files with an established key namespace pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct source code inspection. Zero new dependencies needed -- verified against package.json. |
| Features | HIGH | Table stakes directly map to existing codebase patterns (contact extraction progress, Google Maps results). Differentiators are well-understood UX patterns from Cursor/Windsurf/Copilot. |
| Architecture | HIGH | Complete data flow traced through ToolExecutor, StreamEventProcessor, preload.ts, and AiChatBox.vue source code. Every integration point verified at specific line numbers. |
| Pitfalls | HIGH | All pitfalls identified through direct codebase analysis with specific line references. Prevention strategies are concrete code patterns, not abstract advice. |

**Overall confidence:** HIGH

### Gaps to Address

- **StreamEventProcessor lifecycle:** The exact subscription/unsubscription lifecycle for the tracker's webContents reference needs verification during Phase 2. If the webContents reference is set once in background.ts, it must handle window recreation (e.g., after a settings change that recreates the BrowserWindow).
- **AiChatBox.vue component complexity:** The component handles multiple message types and streaming states. The exact insertion point for operation badges within the template must be determined during Phase 3 planning to avoid conflicting with existing tool_result rendering.
- **toolCallId availability:** The `toolCallId` field is needed for race condition reconciliation. Verify that `ToolExecutor.execute()` receives and can pass through the `toolCallId` from the stream event. If not, an alternative correlation mechanism (e.g., conversationId + timestamp) must be designed.

## Sources

### Primary (HIGH confidence)
- `src/service/ToolExecutor.ts` -- executeFileTool dispatch (line 1319-1327), execute method (line 111-131), static class pattern (line 61-102)
- `src/service/StreamEventProcessor.ts` -- handleToolCallEvent/executeTool flow, sender.send pattern (line 220), tool result lifecycle (line 541-542)
- `src/service/FileToolService.ts` -- execute dispatch (line 48), write/edit result types including diff field
- `src/preload.ts` -- whitelist pattern across receive (line 321+), send (line 266+), removeListener (line 379+), removeAllListeners (line 435+)
- `src/config/channellist.ts` -- IPC channel naming conventions (AI_CHAT_STREAM_CHUNK, AI_CHAT_STREAM_COMPLETE patterns)
- `src/views/api/aiChat.ts` -- windowReceive subscription pattern (line 117-191)
- `src/views/components/aiChat/AiChatBox.vue` -- tool_result rendering, MESSAGE_TYPE constants, chunk handler
- `src/entityTypes/fileToolTypes.ts` -- existing file tool result types
- `src/entityTypes/commonType.ts` -- ChatStreamChunk, MessageType, ChatMessage shared types

### Secondary (MEDIUM confidence)
- Cursor IDE inline diff-in-chat pattern -- UX reference for operation badges
- Windsurf Cascade step view -- UX reference for grouped operations
- GitHub Copilot Chat file reference chips -- UX reference for click-to-open

---
*Research completed: 2026-05-25*
*Ready for roadmap: yes*
