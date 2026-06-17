# Add Search to AI Chat V2 Conversation History

## Context

The AI Chat V2 conversation history dialog currently lists all conversations with no way to filter or search. As conversations accumulate, users cannot find specific past discussions. This plan adds a backend-powered full-text search across message content, surfaced through a search field in the existing conversation history dialog.

The search queries the `ai_chat_messages.content` column with LIKE, matching any conversation that contains the search term in any message (user or assistant). This is more useful than title-only filtering since conversation titles are auto-derived from the last message's first 60 characters.

## Approach

Extend the existing `getConversations()` flow with an optional `searchQuery` parameter rather than creating a separate IPC channel. When a query is provided, the model layer uses a LIKE filter on `content` to find matching conversation IDs first, then fetches metadata for those conversations.

## Files to Modify

### 1. Model Layer — `src/model/AIChatMessage.model.ts`

Add `searchConversationsWithMetadata(query: string)` method after the existing `getConversationsWithMetadata()` (line ~188).

Two-step query (consistent with existing N+1 pattern):
1. Find DISTINCT `conversationId` values where `content LIKE '%query%'` (escape `%` and `_` in user input)
2. For each matching conversation, fetch last message, message count, and first message timestamp (same sub-queries as existing method)

Return the same type shape so the module layer can format them identically.

### 2. Module Layer — `src/modules/AIChatModule.ts`

Add a pass-through method (after line ~126):
```typescript
async searchConversationsWithMetadata(query: string) {
    return await this.chatMessageModel.searchConversationsWithMetadata(query);
}
```

### 3. V2 Module — `src/modules/AIChatV2Module.ts`

Change `getConversations()` (line 110) signature to:
```typescript
async getConversations(searchQuery?: string): Promise<ChatV2ConversationSummary[]>
```

- When `searchQuery` is a non-empty string: call `this.chatModule.searchConversationsWithMetadata(searchQuery)` instead of `getConversationsWithMetadata()`
- Otherwise: call existing `getConversationsWithMetadata()`
- The `v2-` prefix filtering loop remains (harmless for search since the LIKE query only returns matching rows)

### 4. IPC Handler — `src/main-process/communication/ai-chat-v2-ipc.ts`

**Handler** (line 231): Accept search query from the IPC payload:
```typescript
async function handleConversations(searchQuery?: string): Promise<...> {
    // ...
    return ok(await module.getConversations(searchQuery));
}
```

**Registration** (line 1485): Pass the argument through:
```typescript
ipcMain.handle(AI_CHAT_V2_CONVERSATIONS, async (_event, searchQuery?: string) =>
    handleConversations(searchQuery)
);
```

### 5. Frontend API — `src/views/api/aiChatV2.ts`

Update `getChatV2Conversations` (line 63):
```typescript
export async function getChatV2Conversations(searchQuery?: string): Promise<ChatV2ConversationSummary[]> {
    const resp = await windowInvoke(AI_CHAT_V2_CONVERSATIONS, searchQuery);
    return (resp as ChatV2ConversationSummary[] | null) ?? [];
}
```

### 6. UI — `src/views/components/aiChatV2/AiChatV2.vue`

Add to the conversation history dialog (lines 99-134):

**New reactive state:**
- `conversationSearch = ref("")` — the search input value
- `searchingConversations = ref(false)` — loading spinner flag
- A debounce timer ref for 300ms delay

**Search logic:**
- `watch(conversationSearch)` with 300ms debounce:
  - Empty string → call `loadConversations()` (full list, no search)
  - Non-empty → set `searchingConversations = true`, call `getChatV2Conversations(query)`, update `conversations.value`, clear loading flag
- Clear search resets to full list

**Template additions** (inside the dialog, above the `v-list`):
- A `v-text-field` with `prepend-inner-icon="mdi-magnify"`, `clearable`, `density="compact"`, bound to `conversationSearch`
- A `v-progress-linear` (indeterminate) shown when `searchingConversations` is true
- An empty-state message ("No conversations found") when search yields zero results

**On dialog open:** reset `conversationSearch` to empty and reload full list.

## i18n

Add these keys to all 6 language files (`src/views/lang/{en,zh,es,fr,de,ja}.ts`):
- `aiChatV2.search_conversations` — "Search conversations..."
- `aiChatV2.no_search_results` — "No conversations found"

## Verification

1. `npx vue-tsc --noEmit` — type check passes
2. Manual test:
   - Open AI Chat V2, create several conversations with different content
   - Open conversation history dialog
   - Type a search term — list filters in real-time (300ms debounce)
   - Clear search — full list returns
   - Click a result — loads that conversation
   - Close and reopen dialog — search is cleared
3. Edge cases:
   - Empty search → shows all conversations
   - No matches → shows "No conversations found" empty state
   - Special characters in search (e.g., `%`, `_`) — SQLite LIKE wildcards are escaped
