# Phase 7: Frontend Badges and UI - Research

**Researched:** 2026-05-25
**Domain:** Vue 3 + Vuetify frontend, IPC subscription, diff rendering, Electron shell
**Confidence:** HIGH

## Summary

Phase 7 adds visible, color-coded inline badges to the AI chat interface for every file mutation performed by AI skills. The implementation builds on the Phase 5/6 backend infrastructure (FileOperationTracker, IPC channel, ToolExecutor emit logic). The key research findings are: (1) the exact template insertion point is line 349 in AiChatBox.vue, directly after the `<div class="message-text">` element inside the "Regular Message" template block for assistant messages; (2) the subscription pattern follows the existing `windowReceive`/`windowRemoveAllListeners` flow but differs from stream subscriptions because FileOperationTracker sends the record object directly (not JSON.stringify'd); (3) AiChatBox.vue currently has NO `onUnmounted` hook, so listener cleanup must be added from scratch; (4) the `diff` npm package (v5.2.0) is already installed and used by FileToolService via `diff.createPatch()`.

**Primary recommendation:** Extract a standalone `FileOperationBadge.vue` component. Add `onUnmounted` to AiChatBox.vue for the first time. Add the `AI_FILE_OPEN` IPC handler to `ai-chat-ipc.ts` alongside existing handlers. Thread `result.diff` through ToolExecutor's emit with a single spread line.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Badges render as a separate `<FileOperationBadge>` Vue component placed after the `message-text` div, only for assistant messages. NOT injected into v-html content.
- **D-02:** Multiple badges per message use a horizontal chip row layout (flex-wrap). Each badge is a compact chip/tag showing operation type icon, file basename, and success/failure indicator. Wraps to next line when full.
- **D-03:** Extend `FileOperationRecord` with a `diff?: string` field. Backward-compatible optional addition.
- **D-04:** Thread `result.diff` from `FileEditResult` through the ToolExecutor emit for file_edit operations. `FileEditResult.diff` already exists.
- **D-05:** Real-time subscription to `AI_FILE_OPERATION` IPC events in AiChatBox.vue. Subscribe in `onMounted`, unsubscribe in `onUnmounted`.
- **D-06:** Store received records in a reactive `Map<conversationId, FileOperationRecord[]>`. Records attach to the currently-streaming assistant message during active streaming, or the most recent assistant message when not streaming.
- **D-07:** No toolCallId matching required -- simpler approach using conversation-scoped record accumulation.
- **D-08:** New dedicated IPC channel `AI_FILE_OPEN` (`"ai-chat:file-open"`) in `channellist.ts`. Handler calls `shell.openPath(filePath)`.
- **D-09:** Add `AI_FILE_OPEN` to preload invoke whitelist only (no receive/send needed).
- **D-10:** Entire badge chip is clickable with cursor pointer and hover state.
- **D-11:** Add `subscribeToFileOperations(handler)` and `unsubscribeFromFileOperations()` wrappers in `src/views/api/aiChat.ts`.
- **D-12:** Handler receives typed `FileOperationRecord` (import from `@/entityTypes/fileOperationTypes`).

### Claude's Discretion
- Exact badge chip styling (colors, padding, border-radius) -- follow Vuetify chip conventions
- Badge entrance animation
- Diff section line count limit for very large diffs
- Error handling for missing files when clicking open
- Whether to show timestamps on badges

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SUB-01 | Add `subscribeToFileOperations(handler)` wrapper using `windowReceive(AI_FILE_OPERATION, handler)` in `src/views/api/aiChat.ts` | Subscription pattern documented in Section: IPC Subscription Pattern |
| SUB-02 | Add `unsubscribeFromFileOperations()` wrapper using `windowRemoveAllListeners(AI_FILE_OPERATION)` | Cleanup pattern documented in Section: IPC Subscription Pattern |
| SUB-03 | Handler receives typed `FileOperationRecord` (no `any` casts) | Type import documented in Section: FileOperationRecord Type Extension |
| BADGE-01 | Display color-coded inline badges in AiChatBox.vue for each file operation record | Template insertion point documented in Section: AiChatBox Template Analysis |
| BADGE-02 | Badge shows: operation type icon, file path (basename), success/failure indicator | Vuetify v-chip props documented in Section: Vuetify Badge Rendering |
| BADGE-03 | Failed operations show error message in badge | Error display pattern documented in Section: Vuetify Badge Rendering |
| BADGE-04 | Operation type colors: green=create, yellow=overwrite, blue=edit, red=failed | Color mapping documented in Section: Vuetify Badge Rendering |
| BADGE-05 | Records correlated to correct assistant message via `conversationId` | Correlation strategy documented in Section: Badge-to-Message Correlation |
| DIFF-01 | Edit operation badges include collapsible diff section showing unified diff lines | Diff rendering documented in Section: Diff Rendering |
| DIFF-02 | Diff lines color-coded: green additions, red deletions | CSS approach documented in Section: Diff Rendering |
| DIFF-03 | Diff data sourced from `FileEditResult.diff` already computed by `FileToolService` | Data flow documented in Section: Diff Data Flow |
| OPEN-01 | Clicking operation badge opens file in system default editor | shell.openPath pattern documented in Section: Click-to-Open IPC Pattern |
| OPEN-02 | Uses `shell.openPath(filePath)` via new IPC handler | Handler pattern documented in Section: Click-to-Open IPC Pattern |
| OPEN-03 | Badge has cursor pointer and hover state to indicate clickability | Vuetify v-chip events documented in Section: Vuetify Badge Rendering |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| IPC subscription (AI_FILE_OPERATION) | Browser / Client | -- | Renderer receives events and stores in reactive state |
| Badge component rendering | Browser / Client | -- | Vue component rendered in AiChatBox template |
| Diff display | Browser / Client | -- | Frontend-only CSS-based diff line coloring |
| Click-to-open file | API / Backend | Browser / Client | shell.openPath must run in main process; badge click triggers IPC invoke |
| Record type extension | Shared Types | -- | `FileOperationRecord` is shared between main and renderer |
| Diff data threading | API / Backend | -- | ToolExecutor (main process) adds diff to emit record |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vue | 3.x | Reactive UI framework | Project standard [VERIFIED: package.json] |
| vuetify | 3.x | UI component library (v-chip) | Project standard [VERIFIED: CLAUDE.md] |
| diff | 5.2.0 | Unified diff generation (already used by FileToolService) | Already installed [VERIFIED: node_modules/diff/package.json] |
| uuid | (installed) | ID generation in FileOperationTracker | Already used by tracker [VERIFIED: src/service/FileOperationTracker.ts] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vue-i18n | (installed) | Internationalization | Phase 8 handles full translations; Phase 7 uses English text with fallback pattern |
| @mdi/js | (installed) | Material Design Icons | Icon props on v-chip prepend-icon/append-icon |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| v-chip for badges | Custom div with CSS | v-chip provides built-in color, size, variant, click, density -- no reason to custom-build |
| Diff line CSS rendering | Prism.js / highlight.js | Overkill for diff lines; simple CSS classes on `<pre>` lines are sufficient and lighter |

**Installation:**
No new dependencies needed. All required packages are already installed. [VERIFIED: diff@5.2.0, vuetify, vue]

## Architecture Patterns

### System Architecture Diagram

```
[FileOperationTracker]                  [AiChatBox.vue]
  (main process)                          (renderer)
       |                                       |
       | webContents.send(                     |
       |   AI_FILE_OPERATION,                  |
       |   fullRecord)                         |
       |                                       |
       +--- IPC Channel --------->  [preload.ts receive]
       |    ai-chat:file-operation    strips event, passes record
       |                                       |
       |                              [aiChat.ts]
       |                          subscribeToFileOperations(handler)
       |                                       |
       +-------------------------------> [reactive Map]
                                            <conversationId,
                                             FileOperationRecord[]>
                                                 |
                                          [visibleMessages computed]
                                                 |
                              +--- for each assistant message ---+
                              |                                  |
                    [message-text div]              [FileOperationBadge.vue]
                    (v-html content)                  - v-chip per record
                                                      - color by type
                                                      - diff expandable
                                                      - click = IPC invoke
                                                            |
                                                      [AI_FILE_OPEN]
                                                            |
                                                   [ai-chat-ipc.ts]
                                                            |
                                                    shell.openPath()
```

### Recommended Project Structure
```
src/
  views/components/aiChat/
    AiChatBox.vue               # Modified: add subscription, onUnmounted, badge rendering
    FileOperationBadge.vue      # NEW: badge component (extracted)
  views/api/
    aiChat.ts                   # Modified: add subscribe/unsubscribe wrappers
  entityTypes/
    fileOperationTypes.ts       # Modified: add diff?: string field
  service/
    ToolExecutor.ts             # Modified: thread result.diff in emit
  main-process/communication/
    ai-chat-ipc.ts              # Modified: add AI_FILE_OPEN handler, import shell
  config/
    channellist.ts              # Modified: add AI_FILE_OPEN constant
  preload.ts                    # Modified: add AI_FILE_OPEN to invoke whitelist
```

### Pattern 1: IPC Subscription with Cleanup
**What:** Subscribe to main->renderer IPC events in `onMounted`, clean up in `onUnmounted`.
**When to use:** Any component that receives pushed events from the main process.
**Example:**
```typescript
// In src/views/api/aiChat.ts
import { AI_FILE_OPERATION } from "@/config/channellist";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";

export function subscribeToFileOperations(
  handler: (record: FileOperationRecord) => void
): void {
  // windowReceive strips the IPC event object, passes record directly
  windowReceive(AI_FILE_OPERATION, (record: FileOperationRecord) => {
    handler(record);
  });
}

export function unsubscribeFromFileOperations(): void {
  windowRemoveAllListeners(AI_FILE_OPERATION);
}
```
**Source:** [VERIFIED: src/views/api/aiChat.ts streamChatMessage pattern, src/views/utils/apirequest.ts windowReceive signature]

### Pattern 2: Vuetify v-chip as Badge
**What:** Use v-chip component for compact, color-coded operation badges.
**When to use:** All file operation badge rendering.
**Example:**
```vue
<v-chip
  size="small"
  :color="badgeColor"
  variant="tonal"
  density="compact"
  class="ma-1 cursor-pointer"
  @click="handleOpenFile"
>
  <v-icon start size="x-small">{{ operationIcon }}</v-icon>
  {{ fileBasename }}
  <v-icon end size="x-small" :color="success ? 'success' : 'error'">
    {{ success ? 'mdi-check-circle' : 'mdi-alert-circle' }}
  </v-icon>
</v-chip>
```
**Source:** [VERIFIED: AiChatBox.vue lines 398-406, 677-679 show existing v-chip usage patterns in the project]

### Pattern 3: shell.openPath IPC Handler
**What:** Simple ipcMain.handle that calls shell.openPath and returns status.
**When to use:** Opening files in the system default application.
**Example:**
```typescript
// In ai-chat-ipc.ts
import { ipcMain, shell } from "electron";
import { AI_FILE_OPEN } from "@/config/channellist";

// Inside registerAiChatIpcHandlers():
ipcMain.handle(AI_FILE_OPEN, async (_event, data) => {
  const parsed = JSON.parse(data);
  const filePath: string = parsed.filePath;
  if (!filePath || typeof filePath !== "string") {
    return { status: false, msg: "Invalid file path" };
  }
  try {
    await shell.openPath(filePath);
    return { status: true, msg: "OK" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to open file";
    return { status: false, msg };
  }
});
```
**Source:** [VERIFIED: src/main-process/communication/sync-msg.ts OPENDIRECTORY handler at line 261, src/main-process/menu/MenuManager.ts shell.openPath at line 140]

### Anti-Patterns to Avoid
- **Injecting badges into v-html output:** The `formatMessage()` function returns sanitized HTML. Injecting Vue components into it is impossible and unsafe. Badges must be a separate DOM tree after the message-text div. [VERIFIED: AiChatBox.vue line 349, `v-html="formatMessage(message.content)"`]
- **JSON.parse in the subscription handler:** Unlike `AI_CHAT_STREAM_CHUNK` which sends stringified data, `FileOperationTracker.emit()` sends the record object directly via `webContents.send(AI_FILE_OPERATION, fullRecord)`. The preload `receive` function strips the event and passes args directly. Do NOT JSON.parse the record. [VERIFIED: src/service/FileOperationTracker.ts line 65-68 vs ai-chat-ipc.ts line 942 which uses JSON.stringify]
- **Missing onUnmounted cleanup:** AiChatBox.vue currently has NO `onUnmounted` lifecycle hook. If you subscribe in `onMounted` but never clean up, listeners will stack on every mount/unmount cycle and cause memory leaks and duplicate handler invocations. [VERIFIED: grep of AiChatBox.vue confirms no onUnmounted/onBeforeUnmount]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Badge/chip component | Custom div with manual CSS | Vuetify `v-chip` | Built-in color, size, density, variant, prepend/append icons, click handlers, hover states, accessibility |
| Diff string parsing | Regex-based line splitting | `diff` npm package (already installed) | Only needed in FileToolService (backend); frontend receives pre-computed diff string |
| IPC channel security | Manual channel validation | preload.ts whitelist arrays | ContextBridge security model requires explicit whitelist entries |
| File opening | renderer-side fs operations | `shell.openPath()` via IPC | Renderer has no access to shell; main process has the electron shell API |

**Key insight:** The diff is already computed in the main process by FileToolService. Phase 7 only needs to thread the existing `result.diff` string through ToolExecutor and render it with CSS color classes on the frontend. No diff computation happens in the renderer.

## Common Pitfalls

### Pitfall 1: Missing onUnmounted Cleanup in AiChatBox
**What goes wrong:** AiChatBox.vue is a component that can be mounted/unmounted (toggled via visibility). Without `onUnmounted`, every time the component remounts, a new `windowReceive` listener is registered, causing duplicate badge renders and memory leaks.
**Why it happens:** The component was initially written without cleanup. Streaming cleanup relies on `windowRemoveAllListeners` inside `streamChatMessage` (called per-stream), not component lifecycle.
**How to avoid:** Add `onUnmounted` hook that calls `unsubscribeFromFileOperations()`. Import `onUnmounted` from vue (currently only `onMounted` is imported).
**Warning signs:** Badges appearing twice for the same operation, or stale badges from previous conversations.

### Pitfall 2: Record-Object vs JSON-String Confusion
**What goes wrong:** Copying the streaming subscription pattern which expects a JSON string and calls `JSON.parse()`. FileOperationTracker sends the record object directly (not stringified). Calling `JSON.parse()` on an object would throw.
**Why it happens:** The `streamChatMessage` function in `aiChat.ts` does `JSON.parse(chunkData)` because `ai-chat-ipc.ts` sends `JSON.stringify(chunk)`. This is inconsistent with FileOperationTracker which sends the raw object.
**How to avoid:** The subscription handler receives a `FileOperationRecord` directly. No parsing needed. Cast the received value to `FileOperationRecord` using the type import.
**Warning signs:** "Unexpected token o" JSON.parse errors, or undefined record fields.

### Pitfall 3: Badge Showing on Non-Assistant Messages
**What goes wrong:** Rendering badges on user messages or system messages where no file operations belong.
**Why it happens:** The template has multiple message types (tool_call, tool_result, plan_created, etc.) sharing the same `v-for` loop. The `message-text` div only exists in the "Regular Message" template block (the `v-else` branch at line 296).
**How to avoid:** The `<FileOperationBadge>` component should only be rendered inside the "Regular Message" `<template v-else>` block, and only when `message.role === 'assistant'`. Add a `v-if="message.role === 'assistant'"` guard.
**Warning signs:** Badges appearing on user messages or tool result messages.

### Pitfall 4: Reactive Map Not Triggering Vue Updates
**What goes wrong:** Using a `Map` directly with `.set()` does not trigger Vue reactivity because Vue 3's reactivity system tracks changes to Map via the Proxy-based reactive wrapper, but `.set()` on a plain `ref<Map>` does work. However, pushing to an array inside a Map value requires careful handling.
**Why it happens:** `reactive(new Map())` works for `.set()` and `.delete()`, but mutating array contents inside the map value does not re-trigger the Map's own reactivity.
**How to avoid:** Either use `reactive(new Map<string, FileOperationRecord[]>())` and always use `.set()` to replace arrays (immutable pattern), or use a `ref<Map>` and replace the entire Map on each update. Recommended: use a `ref` wrapping a plain object `Record<string, FileOperationRecord[]>` for simpler reactivity.
**Warning signs:** Badges not appearing or not updating when new records arrive during streaming.

### Pitfall 5: Large Diffs Overwhelming the Chat
**What goes wrong:** A file_edit that replaces hundreds of lines produces a very large diff string. Rendering it inline would push chat content far down.
**Why it happens:** No diff size limit is set in FileToolService -- the diff is computed and stored in full.
**How to avoid:** (Claude's discretion) Truncate diff display in the frontend. Show first N lines with a "Show full diff" expandable. Consider a 50-line display limit with collapse.
**Warning signs:** Chat becomes laggy or scrolls unexpectedly when a large edit occurs.

## Code Examples

### Exact Template Insertion Point (AiChatBox.vue)
```vue
<!-- Line 349: existing message-text div -->
<div class="message-text" v-html="formatMessage(message.content)"></div>

<!-- NEW: File operation badges (insert between lines 349 and 350) -->
<FileOperationBadge
  v-if="message.role === 'assistant'"
  :records="fileOperationRecordsByConversation.get(message.conversationId || conversationId) || []"
  :is-active-message="isLastAssistantMessage(message)"
  @open-file="handleOpenFile"
/>
<!-- Line 350: existing timestamp div -->
<div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
```
**Source:** [VERIFIED: src/views/components/aiChat/AiChatBox.vue lines 296-354]

### Subscription Setup in AiChatBox.vue Script
```typescript
// In <script setup> section
import { onUnmounted } from 'vue';  // ADD to existing import line 702
import { subscribeToFileOperations, unsubscribeFromFileOperations } from '@/views/api/aiChat';
import type { FileOperationRecord } from '@/entityTypes/fileOperationTypes';

const fileOperationRecords = ref<Map<string, FileOperationRecord[]>>(new Map());

onMounted(async () => {
  await loadChatHistory();
  scrollToBottom();

  // Subscribe to file operation events
  subscribeToFileOperations((record: FileOperationRecord) => {
    const current = fileOperationRecords.value.get(record.conversationId) ?? [];
    const updated = [...current, record];  // Immutable: create new array
    const newMap = new Map(fileOperationRecords.value);
    newMap.set(record.conversationId, updated);
    fileOperationRecords.value = newMap;
  });
});

onUnmounted(() => {
  unsubscribeFromFileOperations();
});
```
**Source:** [VERIFIED: src/views/components/aiChat/AiChatBox.vue lines 702, 1060-1063; src/views/api/aiChat.ts; src/views/pages/google-maps-scraper/index.vue lines 620-624 for onUnmounted pattern]

### ToolExecutor Diff Threading
```typescript
// In executeFileTool(), around line 1347:
// BEFORE (current code):
...(toolName === "file_edit" && {
  linesChanged: result.replacements as number,
}),

// AFTER (add diff field):
...(toolName === "file_edit" && {
  linesChanged: result.replacements as number,
  diff: (result as FileEditResult).diff,
}),
```
**Source:** [VERIFIED: src/service/ToolExecutor.ts lines 1347-1349; src/entityTypes/fileToolTypes.ts FileEditResult.diff at line 97]

### Diff Rendering CSS
```vue
<template>
  <div v-if="expanded && record.diff" class="diff-preview">
    <pre class="diff-content">
      <template v-for="(line, idx) in diffLines" :key="idx">
        <div :class="{
          'diff-add': line.startsWith('+'),
          'diff-remove': line.startsWith('-'),
          'diff-context': line.startsWith(' ')
        }">{{ line }}</div>
      </template>
    </pre>
  </div>
</template>

<style scoped>
.diff-add { color: #22863a; background-color: #f0fff4; }
.diff-remove { color: #cb2431; background-color: #ffeef0; }
.diff-context { color: #6a737d; }
.cursor-pointer { cursor: pointer; }
.cursor-pointer:hover { opacity: 0.85; }
</style>
```
**Source:** [VERIFIED: src/service/FileToolService.ts line 336 -- `diff.createPatch()` produces unified diff format with +/-/space prefixed lines]

## AiChatBox Template Analysis

### Critical Template Structure (lines 296-354)

The template has a `v-for="message in visibleMessages"` loop at line 86. Each message goes through conditional rendering:

1. `v-if="message.messageType === MESSAGE_TYPE.TOOL_CALL"` (line 113) -- Tool call messages
2. `v-else-if="message.messageType === MESSAGE_TYPE.TOOL_RESULT"` (line 141) -- Tool result messages
3. `v-else-if="message.messageType === MESSAGE_TYPE.PLAN_CREATED"` (line 190) -- Plan messages
4. `v-else-if="message.messageType === MESSAGE_TYPE.PLAN_STEP_COMPLETE"` (line 233) -- Step messages
5. `v-else-if="message.messageType === MESSAGE_TYPE.PLAN_EXECUTE_RESUME"` (line 281) -- Resume messages
6. `v-else` (line 296) -- **Regular messages (THIS IS THE TARGET)**

Inside the "Regular Message" block (lines 296-354):
- Lines 297-329: Message header (copy/resend buttons)
- Lines 330-347: Attachment preview (user messages only)
- **Line 349: `<div class="message-text" v-html="formatMessage(message.content)"></div>`**
- Lines 350-353: Timestamp display

The `<FileOperationBadge>` component must be inserted **between line 349 and line 350**, guarded by `v-if="message.role === 'assistant'"`.

[VERIFIED: src/views/components/aiChat/AiChatBox.vue full template read lines 1-357]

## IPC Subscription Pattern

### How windowReceive Works

The `windowReceive` function in `src/views/utils/apirequest.ts`:
```typescript
export const windowReceive = (channel, cb) => {
  window.api.receive(channel, (event) => {
    cb(event);  // passes the raw arg to callback
  });
};
```

The preload `receive` function wraps `ipcRenderer.on`:
```typescript
receive: (channel, func) => {
  // ... whitelist check ...
  const wrapped = (_event, ...args) => {
    func(...args);  // strips event, passes remaining args
  };
  ipcRenderer.on(channel, wrapped);
};
```

So when main process calls `webContents.send(AI_FILE_OPERATION, fullRecord)`, the callback receives `fullRecord` directly (the first arg after event stripping).

### Key Difference from Streaming Pattern

The `streamChatMessage` function in `aiChat.ts` uses `windowReceive` with `JSON.parse(chunkData)` because `ai-chat-ipc.ts` sends `JSON.stringify(chunk)`. For `AI_FILE_OPERATION`, the tracker sends the record object directly (not stringified). The subscription handler must NOT call `JSON.parse`.

[VERIFIED: src/views/utils/apirequest.ts lines 43-49, src/preload.ts lines 370-377, src/service/FileOperationTracker.ts lines 65-68, src/main-process/communication/ai-chat-ipc.ts line 942]

## Badge-to-Message Correlation

### Strategy: Conversation-Scoped Accumulation

Per D-06 and D-07, records accumulate per conversationId in a reactive Map. The badge component receives all records for the current conversation and renders them on assistant messages.

Two correlation scenarios:

1. **During active streaming** (`activeStreamConversationId` is set): New records arrive while the assistant message is being built. They should appear on the currently-streaming message.

2. **After streaming completes**: Records arrive after the final message is in the history. They should appear on the most recent assistant message.

The implementation should:
- Track which message is the "active" one (during streaming, it is the message being appended to; after streaming, it is the last assistant message in `messages` array)
- Pass a computed `isTargetMessage` flag to the badge component so it knows whether to show its records
- Only render badges on the target assistant message, not on all assistant messages

A simpler approach (D-07): Show all records for the conversation on the MOST RECENT assistant message only. Earlier messages get no badges. This avoids needing to correlate individual records to specific messages.

[VERIFIED: src/views/components/aiChat/AiChatBox.vue line 790 `activeStreamConversationId`, lines 966-971 `visibleMessages` computed]

## Diff Data Flow

### Current State
1. `FileToolService.execute("file_edit", params)` calls `diff.createPatch(path, oldContent, newContent)` at line 336
2. The patch is partially processed (first 20 changed lines extracted)
3. The result `FileEditResult` has a `diff?: string` field (line 97 of fileToolTypes.ts)
4. `ToolExecutor.executeFileTool()` emits a `FileOperationRecord` but does NOT include `result.diff`
5. The record is sent to renderer via `FileOperationTracker.emit()`

### Required Change (D-03, D-04)
1. Add `diff?: string` to `FileOperationRecord` interface
2. In ToolExecutor, add `diff: (result as FileEditResult).diff` to the emit record for `file_edit` operations
3. The frontend receives the diff string and renders it with CSS color classes

The diff string from `diff.createPatch()` has the standard unified diff format:
```
--- a/path
+++ b/path
@@ -line,count +line,count @@
 context line
-removed line
+added line
```

[VERIFIED: src/entityTypes/fileToolTypes.ts line 97, src/service/FileToolService.ts line 336, src/service/ToolExecutor.ts lines 1333-1354]

## Click-to-Open IPC Pattern

### Existing Patterns

The project has two relevant patterns:

1. **OPENDIRECTORY** (sync-msg.ts line 261): Uses `dialog.showOpenDialog()` -- this is a file picker, NOT suitable for opening files.
2. **shell.openPath** (MenuManager.ts line 140): Used in menu to open folders -- this IS the correct pattern.

### Implementation Plan

Add `AI_FILE_OPEN` channel constant:
```typescript
// In channellist.ts
export const AI_FILE_OPEN = "ai-chat:file-open";
```

Add to preload invoke whitelist (preload.ts):
```typescript
// In the invoke validChannels array
AI_FILE_OPEN,
```

Add handler in `ai-chat-ipc.ts`:
```typescript
// Import shell from electron (add to existing import line 1)
import { ipcMain, shell } from "electron";

// Inside registerAiChatIpcHandlers():
ipcMain.handle(AI_FILE_OPEN, async (_event, data) => {
  const parsed = JSON.parse(data);
  const filePath = parsed.filePath;
  // ... validation and shell.openPath call
});
```

Frontend invoke from badge component:
```typescript
import { windowInvoke } from "@/views/utils/apirequest";
import { AI_FILE_OPEN } from "@/config/channellist";

async function openFile(filePath: string): Promise<void> {
  await windowInvoke(AI_FILE_OPEN, { filePath });
}
```

[VERIFIED: src/main-process/communication/sync-msg.ts lines 261-270, src/main-process/menu/MenuManager.ts lines 132-140, src/preload.ts invoke whitelist at line 453+]

## Vuetify Badge Rendering

### v-chip Props for Badges

| Prop | Value | Purpose |
|------|-------|---------|
| `size` | `"small"` or `"x-small"` | Compact badge |
| `color` | `"success"` / `"warning"` / `"info"` / `"error"` | Type-based coloring |
| `variant` | `"tonal"` or `"flat"` | Visual style |
| `density` | `"compact"` | Reduced padding |
| `prepend-icon` | `"mdi-plus"` / `"mdi-file-refresh"` / `"mdi-pencil"` / `"mdi-alert"` | Operation type icon |
| `append-icon` | `"mdi-check-circle"` / `"mdi-alert-circle"` | Success/failure indicator |

### Color Mapping (per BADGE-04)
| Operation | Vuetify Color | Icon |
|-----------|--------------|------|
| create | `success` (green) | `mdi-plus` |
| overwrite | `warning` (yellow) | `mdi-file-refresh-outline` |
| edit | `info` (blue) | `mdi-pencil-outline` |
| failed | `error` (red) | `mdi-alert-circle-outline` |

[VERIFIED: AiChatBox.vue uses v-chip at lines 157-159, 398-406, 677-679 with similar patterns]

## FileOperationRecord Type Extension

### Current Interface (fileOperationTypes.ts)
```typescript
export interface FileOperationRecord {
  readonly id: string;
  readonly type: FileOperationType;
  readonly filePath: string;
  readonly timestamp: number;
  readonly success: boolean;
  readonly conversationId: string;
  readonly skillName: string;
  readonly toolCallId?: string;
  readonly linesChanged?: number;
  readonly sizeBytes?: number;
  readonly error?: string;
}
```

### Required Addition
```typescript
  /** Optional: unified diff for edit operations (D-03) */
  readonly diff?: string;
```

This is backward-compatible: existing records without `diff` are valid. The ToolExecutor only populates this field for `file_edit` operations.

[VERIFIED: src/entityTypes/fileOperationTypes.ts lines 17-40]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No onUnmounted in AiChatBox | Multiple components use onUnmounted | Pre-existing pattern | Must add lifecycle cleanup |
| JSON.stringify for all IPC data | Mixed (stringify for streams, objects for events) | Varies by handler | Must check each channel's send format |
| v-chip with variant="outlined" | v-chip with variant="tonal" preferred for badges | Vuetify 3 convention | Use tonal for filled-but-subtle badges |

**Deprecated/outdated:**
- `variant="plain"` on v-chip: Use `variant="text"` or `variant="tonal"` instead in Vuetify 3

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `FileEditResult.diff` is always populated for successful file_edit operations | Diff Data Flow | Diff section may show empty on some edits |
| A2 | `shell.openPath()` works for all file types users will encounter | Click-to-Open IPC Pattern | Some file types may not have a default handler |
| A3 | The "Regular Message" template block (v-else at line 296) is the only place badges should appear | Template Analysis | Badges might need to appear on tool result messages too |

**Note:** All three assumptions are LOW risk. A1 is mitigated by the `diff?` being optional. A2 is standard Electron behavior. A3 aligns with D-01 (assistant messages only).

## Open Questions

1. **Should badges appear on ALL assistant messages or only the most recent one?**
   - What we know: D-07 says "no toolCallId matching required -- simpler approach using conversation-scoped record accumulation."
   - What's unclear: Whether accumulated records should display on every assistant message in the conversation, or only the most recent/target message.
   - Recommendation: Show all records for the conversation on the MOST RECENT assistant message only. This avoids needing to track which records belong to which message. When a new assistant message appears, move all badges to it.

2. **How to handle records that arrive AFTER the user switches conversations?**
   - What we know: Records are keyed by conversationId in the Map. Switching conversations changes the active conversationId.
   - What's unclear: If a delayed record arrives for a non-active conversation, it will be stored in the Map but will not be visible until the user switches back.
   - Recommendation: This is acceptable behavior. Records accumulate silently and display when the user returns to that conversation.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | Yes | (installed) | -- |
| diff npm package | Diff display (already computed in backend) | Yes | 5.2.0 | -- |
| Vuetify 3 | v-chip component | Yes | (installed) | -- |
| vue-i18n | i18n (Phase 8) | Yes | (installed) | -- |
| electron shell | shell.openPath | Yes | (project dependency) | -- |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:** None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (frontend) + Mocha (backend modules) |
| Config file | vitest.service.config.mjs / vitest.config.mjs |
| Quick run command | `npx vitest run --config vitest.service.config.mjs` |
| Full suite command | `yarn test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUB-01 | subscribeToFileOperations registers windowReceive handler | unit | `npx vitest run test/vitest/` | Wave 0 |
| SUB-02 | unsubscribeFromFileOperations calls windowRemoveAllListeners | unit | `npx vitest run test/vitest/` | Wave 0 |
| BADGE-01 | FileOperationBadge renders for each record | unit | `npx vitest run test/vitest/` | Wave 0 |
| DIFF-01 | Diff section shows when record.diff is present | unit | `npx vitest run test/vitest/` | Wave 0 |
| OPEN-01 | Clicking badge invokes AI_FILE_OPEN IPC | unit | `npx vitest run test/vitest/` | Wave 0 |
| EXEC-03 | ToolExecutor threads result.diff for file_edit | unit | `yarn test test/modules/` | Existing tests |
| D-03 | FileOperationRecord includes diff field | unit (type check) | `yarn tsc` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --config vitest.service.config.mjs`
- **Per wave merge:** `yarn test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/vitest/main/FileOperationBadge.test.ts` -- covers BADGE-01..05, DIFF-01..03, OPEN-01..03
- [ ] `test/vitest/utilitycode/fileOperationSubscription.test.ts` -- covers SUB-01..03
- [ ] Framework config: `vitest.service.config.mjs` -- already exists for service tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | Yes | Preload whitelist for AI_FILE_OPEN channel |
| V5 Input Validation | Yes | Validate filePath in AI_FILE_OPEN handler |
| V6 Cryptography | No | -- |

### Known Threat Patterns for Electron + IPC

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in open-file | Tampering | Validate filePath is absolute, exists, is not a directory traversal |
| XSS via diff content | Tampering | Render diff in `<pre>` tag (not v-html), use text interpolation `{{ line }}` |
| Unauthorized IPC calls | Spoofing | Preload whitelist restricts channels; renderer cannot call unlisted channels |

**Key security requirement:** The AI_FILE_OPEN handler MUST validate the filePath parameter. Never trust renderer-sent paths blindly. Check that the path is absolute, does not contain traversal sequences, and refers to an existing file before calling `shell.openPath()`.

## Sources

### Primary (HIGH confidence)
- src/views/components/aiChat/AiChatBox.vue -- Template structure (lines 85-357), script setup (lines 701-1063)
- src/views/api/aiChat.ts -- Subscription patterns, windowReceive usage
- src/entityTypes/fileOperationTypes.ts -- FileOperationRecord interface
- src/entityTypes/fileToolTypes.ts -- FileEditResult with diff field
- src/service/FileOperationTracker.ts -- emit() implementation, webContents.send format
- src/service/ToolExecutor.ts -- executeFileTool() at lines 1321-1376
- src/views/utils/apirequest.ts -- windowReceive/windowRemoveAllListeners
- src/preload.ts -- Whitelist arrays (receive, removeListener, removeAllListeners, invoke)
- src/config/channellist.ts -- AI_FILE_OPERATION constant, channel naming convention
- src/main-process/communication/ai-chat-ipc.ts -- Handler registration pattern
- src/main-process/communication/sync-msg.ts -- OPENDIRECTORY handler pattern
- src/main-process/menu/MenuManager.ts -- shell.openPath usage pattern

### Secondary (MEDIUM confidence)
- src/service/FileToolService.ts -- diff.createPatch() usage confirming unified diff format
- src/views/pages/google-maps-scraper/index.vue -- onUnmounted cleanup pattern reference
- node_modules/diff/package.json -- v5.2.0 verified installed

### Tertiary (LOW confidence)
- None -- all findings verified from codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies verified in node_modules and codebase
- Architecture: HIGH - Template insertion point, IPC patterns, and handler locations all verified from source
- Pitfalls: HIGH - Each pitfall discovered by direct code inspection (onUnmounted absence, JSON vs object, template structure)

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable frontend patterns, no fast-moving dependencies)
