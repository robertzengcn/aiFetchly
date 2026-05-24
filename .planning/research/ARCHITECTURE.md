# Architecture Research

**Domain:** AI Chat File Operation Recording (Electron + Vue 3 + TypeScript)
**Researched:** 2026-05-25
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
+------------------------------------------------------------------+
|                      Renderer (Vue 3)                             |
+------------------------------------------------------------------+
|  +--------------+  +--------------+  +------------------------+  |
|  | AiChatBox.vue|  | aiChat.ts    |  | apirequest.ts          |  |
|  | (tool_call / |  | (streamChat  |  | (windowReceive /       |  |
|  |  tool_result |  |  Message)    |  |  windowRemoveAll...)   |  |
|  |  handlers)   |  |              |  |                        |  |
|  +------+-------+  +------+-------+  +-----------+------------+  |
|         |                 |                       |                |
+---------+-----------------+-----------------------+----------------+
|                      Preload (contextBridge)                      |
|  send / receive / invoke / removeListener / removeAllListeners    |
+------------------------------------------------------------------+
|                      Main Process (Electron)                      |
|  +-------------------------------------------------------------+ |
|  |                  StreamEventProcessor                        | |
|  |  handleToolCallEvent -> executeTool -> saveToolResult        | |
|  +---------+-------------------------------+-------------------+ |
|            | file_write/edit                    | other tools     |
|  +---------v----------+            +----------v-----------------+ |
|  |   ToolExecutor     |            |   SkillExecutor            | |
|  |   executeFileTool()|            |   (for registry skills)    | |
|  +---------+----------+            +----------------------------+ |
|  +---------v----------+                                           |
|  |  FileToolService   |  <- actual file I/O (read/write/edit)   |
|  +--------------------+                                           |
|  +-------------------------------------------------------------+ |
|  |  channellist.ts (AI_CHAT_STREAM_CHUNK, etc.)                | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `StreamEventProcessor` | Routes AI stream events; executes tools; sends results to renderer via IPC | `src/service/StreamEventProcessor.ts` |
| `ToolExecutor` | Static dispatch: rate limits, then calls tool-specific methods; `executeFileTool()` delegates to `FileToolService` | `src/service/ToolExecutor.ts` |
| `FileToolService` | Executes file I/O operations (read/write/edit/glob/grep) with path safety validation | `src/service/FileToolService.ts` |
| `SkillExecutor` | Executes registry-known skills (includes permission prompts) | `src/service/SkillExecutor.ts` |
| `ToolExecutionService` | Saves tool calls/results to database; formats LLM output | `src/service/ToolExecutionService.ts` |
| `AiChatBox.vue` | Vue 3 chat UI; handles chunk events (token/tool_call/tool_result) via `streamChatMessage` callback | `src/views/components/aiChat/AiChatBox.vue` |
| `aiChat.ts` | Frontend API wrappers: `streamChatMessage`, `stopStreamingChat`, etc. | `src/views/api/aiChat.ts` |
| `preload.ts` | contextBridge whitelist: `send`, `receive`, `invoke`, `removeListener`, `removeAllListeners` | `src/preload.ts` |
| `channellist.ts` | Central IPC channel string constants | `src/config/channellist.ts` |
| `commonType.ts` | Shared types: `MessageType`, `ChatMessage`, `ChatStreamChunk` | `src/entityTypes/commonType.ts` |

## Recommended Project Structure (New Files)

```
src/
+-- entityTypes/
|   +-- fileOperationRecord.ts       # NEW: FileOperationRecord type + helpers
+-- service/
|   +-- FileOperationTracker.ts      # NEW: Static tracker service (emits via BrowserWindow)
+-- config/
|   +-- channellist.ts               # MODIFIED: Add AI_FILE_OPERATION channel
+-- service/
|   +-- ToolExecutor.ts              # MODIFIED: Emit records after file_write/file_edit
+-- preload.ts                       # MODIFIED: Add AI_FILE_OPERATION to receive whitelist
+-- views/
    +-- api/
    |   +-- aiChat.ts                # MODIFIED: Add subscribeToFileOperations()
    +-- components/aiChat/
    |   +-- AiChatBox.vue            # MODIFIED: Display file operation badges
    +-- lang/
        +-- en.ts                    # MODIFIED: Add fileOp translation keys
        +-- zh.ts                    # MODIFIED
        +-- es.ts                    # MODIFIED
        +-- fr.ts                    # MODIFIED
        +-- de.ts                    # MODIFIED
        +-- ja.ts                    # MODIFIED
```

### Structure Rationale

- **entityTypes/fileOperationRecord.ts**: Follows established pattern where `src/entityTypes/` holds shared TypeScript interfaces (e.g., `fileToolTypes.ts`, `commonType.ts`). New file keeps it co-located with related types.
- **service/FileOperationTracker.ts**: Follows pattern of static service classes like `RateLimiterManager` and `ToolExecutor`. Static because it is called from `ToolExecutor.executeFileTool()` which is itself static.
- **channellist.ts**: Single source of truth for all IPC channel strings. New channel follows naming convention `ai-chat:file-operation`.
- **preload.ts**: Whitelist gatekeeper. Every new main-to-renderer channel must be added to `receive` and `removeListener` arrays.

## Architectural Patterns

### Pattern 1: ToolExecutor-level Interception

**What:** After `FileToolService.execute()` returns a result for `file_write` or `file_edit`, `ToolExecutor.executeFileTool()` constructs a `FileOperationRecord` and passes it to `FileOperationTracker.emit()`. The tracker sends the record to the renderer via IPC.

**When to use:** This is the single interception point. `ToolExecutor.executeFileTool()` is the only place that dispatches file tools, so all write-like operations pass through here.

**Trade-offs:**
- Pro: Single emission point, no risk of missing operations
- Pro: Access to `conversationId` parameter from `ToolExecutor.execute()`
- Pro: Has the `toolName` and `toolParams` before execution, and the `result` after
- Con: Couples tracking to the executor; if a second file tool path is added later, it needs its own emit call

**Example:**
```typescript
// In ToolExecutor.executeFileTool() -- AFTER the call to FileToolService
private static async executeFileTool(
  toolName: string,
  toolParams: Record<string, unknown>,
  conversationId: string
): Promise<Record<string, unknown>> {
  const result = await ToolExecutor.getFileToolService().execute(
    toolName,
    toolParams
  );

  // Emit file operation record for write-like operations
  if (toolName === "file_write" || toolName === "file_edit") {
    FileOperationTracker.emit({
      toolName,
      filePath: String(toolParams.path ?? ""),
      conversationId,
      success: result.success === true,
      timestamp: Date.now(),
      operationType: toolName === "file_write" ? "write" : "edit",
      metadata: {
        bytesWritten: (result as FileWriteResult).bytesWritten,
        mode: (result as FileWriteResult).mode,
        replacements: (result as FileEditResult).replacements,
      },
    });
  }

  return result;
}
```

### Pattern 2: Static Tracker Service with BrowserWindow Reference

**What:** `FileOperationTracker` holds a static reference to the main BrowserWindow's `webContents`. On `emit()`, it calls `webContents.send(AI_FILE_OPERATION, record)`. Failures are caught silently.

**When to use:** Main-to-renderer push channels where the renderer subscribes and the main process pushes data.

**Trade-offs:**
- Pro: Matches existing patterns (e.g., `GOOGLE_MAPS_SEARCH_RESULT` uses `senderWebContents.send()`)
- Pro: No need for `event.sender` in ToolExecutor (which is static and lacks IPC event context)
- Pro: Decouples tracker from StreamEventProcessor lifecycle
- Con: Requires explicit `setWebContents()` call during app initialization

**Example:**
```typescript
// FileOperationTracker.ts
import { AI_FILE_OPERATION } from "@/config/channellist";

export class FileOperationTracker {
  private static webContents: Electron.WebContents | null = null;

  static setWebContents(wc: Electron.WebContents): void {
    FileOperationTracker.webContents = wc;
  }

  static emit(record: FileOperationRecord): void {
    try {
      if (
        FileOperationTracker.webContents &&
        !FileOperationTracker.webContents.isDestroyed()
      ) {
        FileOperationTracker.webContents.send(
          AI_FILE_OPERATION,
          JSON.stringify(record)
        );
      }
    } catch {
      // Tracking must never break tool execution
    }
  }
}
```

### Pattern 3: Frontend Subscribe/Unsubscribe API Wrapper

**What:** A thin wrapper in `aiChat.ts` using `windowReceive` / `windowRemoveAllListeners` for the `AI_FILE_OPERATION` channel, providing a clean subscribe/unsubscribe interface.

**When to use:** For renderer-side listeners that need to be set up once and torn down on component unmount.

**Trade-offs:**
- Pro: Follows the existing `streamChatMessage` subscription pattern
- Pro: Type-safe callback parameter via `FileOperationRecord`
- Con: Requires `removeAllListeners` channel to be whitelisted in preload

## Data Flow

### File Operation Recording Flow

```
AI Server (SSE)
    |
    v
StreamEventProcessor.handleToolCallEvent()
    |
    v
StreamEventProcessor.executeTool()
    |
    +-- SkillExecutor.execute()  (if registry skill)
    |
    +-- ToolExecutor.execute()  (if MCP/legacy/file tool)
         |
         v
    ToolExecutor.executeInternal()
         |
         v
    ToolExecutor.executeFileTool()   <-- INTERCEPTION POINT
         |
         +-- FileToolService.execute(toolName, args)
         |       |
         |       v
         |    [File I/O on disk]
         |       |
         |       v
         |    result: { success, path, bytesWritten, ... }
         |
         +-- FileOperationTracker.emit(record)   <-- NEW
         |       |
         |       v
         |    webContents.send(AI_FILE_OPERATION, record)
         |       |
         |       v
         |    preload.ts receive whitelist
         |       |
         |       v
         |    windowReceive callback in aiChat.ts
         |       |
         |       v
         |    AiChatBox.vue reactive handler
         |       |
         |       v
         |    [Display file operation badge in chat]
         |
         v
    return result -> StreamEventProcessor -> AI server
```

### State Management

```
FileOperationTracker (main process, static)
    |  (webContents.send)
    v
preload.ts contextBridge
    |  (windowReceive)
    v
aiChat.ts subscribeToFileOperations()
    |  (callback)
    v
AiChatBox.vue
    |  (reactive ref: fileOperations: Ref<FileOperationRecord[]>)
    v
[Template renders badges]
```

### Key Data Flows

1. **Emission flow (main to renderer):** `ToolExecutor.executeFileTool()` detects write-like tool call result, constructs a `FileOperationRecord`, calls `FileOperationTracker.emit()`. The tracker pushes via `webContents.send(AI_FILE_OPERATION, ...)`. The preload whitelist allows it through. The `aiChat.ts` wrapper fires the callback. `AiChatBox.vue` appends to a reactive array.

2. **Result passthrough (unchanged):** The file tool result still flows through `StreamEventProcessor.executeTool()` as before, gets saved to database, and sent to renderer via `AI_CHAT_STREAM_CHUNK` with `eventType: 'tool_result'`. The recording is a side channel that does not alter the existing result flow.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 operations per session | In-memory array in Vue component; no pagination needed |
| 100-1000 operations | Consider virtual scrolling in the badge list; group operations by conversation |
| 1000+ operations (future) | Persist to SQLite via Model/Module pattern; paginate history queries |

### Scaling Priorities

1. **First bottleneck:** Unbounded reactive array growth. Mitigate with a max-size cap (e.g., keep last 200 records per conversation, drop oldest).
2. **Second bottleneck:** High-frequency emits overwhelming renderer. Mitigate with debounce or batch emit (collect records for 100ms, emit batch).

## Anti-Patterns

### Anti-Pattern 1: Intercepting inside FileToolService

**What people do:** Adding tracking logic inside `FileToolService.executeFileWrite()` or `executeFileEdit()`.
**Why it's wrong:** `FileToolService` is a pure I/O service with no awareness of IPC, conversations, or the AI chat context. Injecting tracking there violates separation of concerns and makes it harder to reuse `FileToolService` outside the AI chat context.
**Do this instead:** Intercept in `ToolExecutor.executeFileTool()` which has full context (toolName, params, conversationId, result).

### Anti-Pattern 2: Using the existing AI_CHAT_STREAM_CHUNK channel

**What people do:** Piggybacking file operation records onto the `AI_CHAT_STREAM_CHUNK` channel by adding a new `eventType` like `'file_operation'`.
**Why it's wrong:** The stream chunk channel is already multiplexed with many event types (token, tool_call, tool_result, plan_*, conversation_start). Adding more increases collision risk, makes the chunk handler in `AiChatBox.vue` harder to maintain, and ties file operation display to the streaming lifecycle (operations should display even after a stream completes).
**Do this instead:** Use a dedicated `AI_FILE_OPERATION` channel with its own subscribe/unsubscribe lifecycle.

### Anti-Pattern 3: Requiring event.sender in ToolExecutor

**What people do:** Passing `IpcMainEvent` into `ToolExecutor` so it can call `event.sender.send()` directly.
**Why it's wrong:** `ToolExecutor` is a static class that does not receive the IPC event object. Adding it as a parameter would break the existing API and thread it through multiple call sites.
**Do this instead:** Use `FileOperationTracker` with a static `webContents` reference set during app initialization, matching how `GOOGLE_MAPS_SEARCH_RESULT` uses `senderWebContents`.

### Anti-Pattern 4: Emitting for read-only operations

**What people do:** Recording file_read, glob_files, and grep_files operations.
**Why it's wrong:** These are non-mutating operations. Showing them clutters the UI with noise and confuses users about what the AI actually changed. The PROJECT.md explicitly excludes them from scope.
**Do this instead:** Only emit for `file_write` and `file_edit`. Filter by `toolName` in `ToolExecutor.executeFileTool()`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Electron IPC (main-to-renderer) | `webContents.send(channel, data)` via `FileOperationTracker` | Must add channel to preload whitelist |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ToolExecutor <-> FileOperationTracker | Direct static method call | `FileOperationTracker.emit(record)` after file I/O completes |
| FileOperationTracker <-> Preload | IPC channel `AI_FILE_OPERATION` | Main-to-renderer push; renderer subscribes via `windowReceive` |
| aiChat.ts <-> AiChatBox.vue | Vue composable / callback pattern | `subscribeToFileOperations(cb)` returns unsubscribe function |
| AiChatBox.vue <-> File operation badges | Vue reactive ref | Array of `FileOperationRecord` rendered as chips/badges |

### Files Modified (Complete List)

| File | Change Type | Description |
|------|-------------|-------------|
| `src/entityTypes/fileOperationRecord.ts` | NEW | `FileOperationRecord` interface, `FileOperationType` enum |
| `src/service/FileOperationTracker.ts` | NEW | Static service: `setWebContents()`, `emit()`, `clear()` |
| `src/config/channellist.ts` | MODIFIED | Add `AI_FILE_OPERATION` export constant |
| `src/service/ToolExecutor.ts` | MODIFIED | Add emit call in `executeFileTool()` for file_write/file_edit |
| `src/preload.ts` | MODIFIED | Add `AI_FILE_OPERATION` to `receive` and `removeListener` whitelists |
| `src/views/api/aiChat.ts` | MODIFIED | Add `subscribeToFileOperations()` and `unsubscribeFromFileOperations()` |
| `src/views/components/aiChat/AiChatBox.vue` | MODIFIED | Add reactive `fileOperations` array, subscribe on mount, display badges |
| `src/views/lang/en.ts` | MODIFIED | Add `fileOp.*` translation keys |
| `src/views/lang/zh.ts` | MODIFIED | Add Chinese translations |
| `src/views/lang/es.ts` | MODIFIED | Add Spanish translations |
| `src/views/lang/fr.ts` | MODIFIED | Add French translations |
| `src/views/lang/de.ts` | MODIFIED | Add German translations |
| `src/views/lang/ja.ts` | MODIFIED | Add Japanese translations |
| `src/background.ts` | MODIFIED | Call `FileOperationTracker.setWebContents(mainWindow.webContents)` after window creation |

### Initialization Hook

The `FileOperationTracker.setWebContents()` call must happen after the main BrowserWindow is created in `background.ts`. The best location is right after the `mainWindow` is instantiated and before the IPC handlers are registered, matching how other services that need web access are initialized.

## Build Order (Dependency-Aware)

The following order ensures each step has all dependencies from previous steps:

1. **Types first** -- `src/entityTypes/fileOperationRecord.ts` (no dependencies)
2. **Channel constant** -- `src/config/channellist.ts` add `AI_FILE_OPERATION` (no code dependencies)
3. **Tracker service** -- `src/service/FileOperationTracker.ts` (depends on types + channel)
4. **Preload whitelist** -- `src/preload.ts` add channel to `receive` + `removeListener` arrays (depends on channel)
5. **Backend integration** -- `src/service/ToolExecutor.ts` add emit in `executeFileTool()` (depends on tracker)
6. **Backend initialization** -- `src/background.ts` add `FileOperationTracker.setWebContents()` (depends on tracker)
7. **Frontend API** -- `src/views/api/aiChat.ts` add subscribe helpers (depends on channel + types)
8. **Frontend UI** -- `src/views/components/aiChat/AiChatBox.vue` add badges + subscribe (depends on API + types)
9. **Translations** -- all 6 `src/views/lang/*.ts` files (depends on UI key names being finalized)

## Sources

- Source code analysis of `ToolExecutor.ts` (executeFileTool method, lines 1319-1327)
- Source code analysis of `StreamEventProcessor.ts` (handleToolCallEvent, executeTool methods)
- Source code analysis of `FileToolService.ts` (execute dispatch, write/edit implementations)
- Source code analysis of `preload.ts` (whitelist pattern for receive/send/invoke channels)
- Source code analysis of `AiChatBox.vue` (stream chunk handling, tool_call/tool_result event processing)
- Source code analysis of `channellist.ts` (IPC channel naming conventions)
- Source code analysis of `googleMaps-ipc.ts` (pattern for main-to-renderer push via webContents.send)

---
*Architecture research for: AI Chat File Operation Recording*
*Researched: 2026-05-25*
