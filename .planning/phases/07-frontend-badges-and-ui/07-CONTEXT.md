# Phase 7: Frontend Badges and UI - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Display color-coded inline badges in the AI chat for every file mutation performed by AI skills. Users can expand diffs for edit operations and click badges to open files in the system default editor. This covers the subscription API, badge component, diff preview, and click-to-open — all within AiChatBox.vue and related frontend files. No backend tracking changes (those are in Phase 6), no translations (those are in Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Badge rendering approach
- **D-01:** Badges render as a separate `<FileOperationBadge>` Vue component placed after the `message-text` div, only for assistant messages. NOT injected into v-html content — clean separation from `formatMessage()` output.
- **D-02:** Multiple badges per message use a horizontal chip row layout (flex-wrap). Each badge is a compact chip/tag showing operation type icon, file basename, and success/failure indicator. Wraps to next line when full.

### Diff data availability
- **D-03:** Extend `FileOperationRecord` with a `diff?: string` field. This is a backward-compatible optional addition to the type defined in Phase 5.
- **D-04:** Thread `result.diff` from `FileEditResult` through the ToolExecutor emit for file_edit operations. `FileEditResult.diff` already exists — the diff is computed by FileToolService but currently not passed through.

### Badge-to-message correlation
- **D-05:** Real-time subscription to `AI_FILE_OPERATION` IPC events in AiChatBox.vue. Subscribe in `onMounted`, unsubscribe in `onUnmounted`.
- **D-06:** Store received records in a reactive `Map<conversationId, FileOperationRecord[]>`. Records attach to the currently-streaming assistant message during active streaming, or the most recent assistant message when not streaming.
- **D-07:** No toolCallId matching required — simpler approach using conversation-scoped record accumulation.

### Click-to-open mechanism
- **D-08:** New dedicated IPC channel `AI_FILE_OPEN` (`"ai-chat:file-open"`) in `channellist.ts`. Handler calls `shell.openPath(filePath)`. Not extending existing `OPENDIRECTORY` which is a directory picker dialog.
- **D-09:** Add `AI_FILE_OPEN` to preload invoke whitelist only (no receive/send needed).
- **D-10:** Entire badge chip is clickable with cursor pointer and hover state.

### Subscription API
- **D-11:** Add `subscribeToFileOperations(handler)` and `unsubscribeFromFileOperations()` wrappers in `src/views/api/aiChat.ts`. Use existing `windowReceive`/`windowRemoveAllListeners` pattern with `AI_FILE_OPERATION` channel.
- **D-12:** Handler receives typed `FileOperationRecord` (import from `@/entityTypes/fileOperationTypes`).

### Claude's Discretion
- Exact badge chip styling (colors, padding, border-radius) — follow Vuetify chip conventions
- Badge entrance animation
- Diff section line count limit for very large diffs
- Error handling for missing files when clicking open
- Whether to show timestamps on badges

</decisions>

<specifics>
## Specific Ideas

- Horizontal chip row should feel like GitHub commit status badges — compact, informative, not dominating the chat
- Colors from requirements: green=create, yellow=overwrite, blue=edit, red=failed
- Diff preview shows unified diff lines with green additions, red deletions (standard diff visualization)

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Feature Specification
- `docs/README.md` — Full PRD for AI Chat File Operation Recording: data model, IPC channel design, security requirements, error handling, testing strategy

### Requirements
- `.planning/REQUIREMENTS.md` — v1.1 requirements with REQ-IDs (SUB-01..03, BADGE-01..05, DIFF-01..03, OPEN-01..03 for this phase)
- `.planning/ROADMAP.md` — Phase 7 goal, success criteria, dependency chain

### Prior Phase Context
- `.planning/phases/05-types-and-tracker-foundation/05-CONTEXT.md` — FileOperationRecord type decisions, tracker lifecycle, IPC channel constant
- `.planning/STATE.md` — Accumulated decisions from Phase 6 (conversationId threading, mode mapping, preload whitelisting)

### Key Source Files (MUST read)
- `src/views/components/aiChat/AiChatBox.vue` — 1800+ line chat component, badges insert after message-text div (line ~349), subscription in onMounted/onUnmounted
- `src/views/api/aiChat.ts` — Frontend API wrappers, add subscription functions here
- `src/entityTypes/fileOperationTypes.ts` — FileOperationRecord type to extend with diff field
- `src/entityTypes/fileToolTypes.ts` — FileEditResult has `diff?: string` (already computed)
- `src/service/ToolExecutor.ts` — Emit logic to thread result.diff for file_edit
- `src/views/utils/apirequest.ts` — windowReceive/windowRemoveAllListeners patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `windowReceive`/`windowRemoveAllListeners` in `src/views/utils/apirequest.ts`: Subscription pattern already used for AI_CHAT_STREAM_CHUNK, AI_CHAT_STREAM_COMPLETE, ANALYZE_WEBSITE_PROGRESS — follow same pattern for AI_FILE_OPERATION
- `Vuetify v-chip` component: Available for badge rendering with color props, icons, and click handlers
- `mdi-*` icons: Already used throughout the app (mdi-pencil, mdi-check-circle, etc.)
- `FileEditResult.diff`: Already computed by FileToolService — just needs to be threaded to the emit record

### Established Patterns
- Message rendering in AiChatBox: `v-for="message in messages"` with role-based layout (user/assistant/system)
- Subscription lifecycle: `windowReceive` in handler setup, `windowRemoveAllListeners` in cleanup — but AiChatBox currently lacks `onUnmounted` cleanup for listeners
- Streaming state tracking: `activeStreamConversationId` ref tracks which conversation is currently streaming

### Integration Points
- AiChatBox.vue template: Insert `<FileOperationBadge>` component after `<div class="message-text">` inside assistant message blocks
- `src/views/api/aiChat.ts`: Add subscribe/unsubscribe functions alongside existing streamChatMessage
- `src/config/channellist.ts`: Add `AI_FILE_OPEN` constant
- `src/preload.ts`: Add `AI_FILE_OPEN` to invoke whitelist
- `src/main-process/communication/`: Add handler for AI_FILE_OPEN (in ai-chat-ipc.ts or sync-msg.ts)
- `src/entityTypes/fileOperationTypes.ts`: Add `diff?: string` to FileOperationRecord
- `src/service/ToolExecutor.ts`: Add `...(toolName === "file_edit" && { diff: result.diff })` to emit record

### Concerns
- AiChatBox.vue is 1800+ lines — new component should be extracted to a separate file (`FileOperationBadge.vue`) to keep changes minimal
- No `onUnmounted` hook in AiChatBox currently — must add one for cleanup of AI_FILE_OPERATION listener
- `diff` field could be large for big edits — consider truncating or limiting diff display in the frontend

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-frontend-badges-and-ui*
*Context gathered: 2026-05-25*
