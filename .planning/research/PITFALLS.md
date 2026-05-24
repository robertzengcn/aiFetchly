# Pitfalls Research

**Domain:** Adding file operation recording and real-time display to an Electron AI chat application
**Researched:** 2026-05-25
**Confidence:** HIGH (based on direct codebase analysis of ToolExecutor, StreamEventProcessor, preload.ts, channellist.ts, and ai-chat-ipc.ts)

## Critical Pitfalls

### Pitfall 1: Tracker emit failure crashes skill execution

**What goes wrong:**
FileOperationTracker.emit() throws an exception (e.g., sender is null because the BrowserWindow was closed mid-stream, or the IPC serialization fails on an unexpected data shape). The exception propagates up through ToolExecutor.executeFileTool() and kills the ongoing AI tool call, aborting the entire chat stream.

**Why it happens:**
The ToolExecutor.executeFileTool() method (line 1319-1327) directly returns `await FileToolService.execute(toolName, toolParams)`. The tracker will be called in the same call stack or in a wrapper around this. If the tracker is not isolated in a try/catch, any failure in the tracker bubbles into the tool result. Even worse, if the tracker is called between the file operation and the return, an exception means the tool appears to have failed even though the file was already written to disk.

**How to avoid:**
Wrap every tracker call in its own try/catch that logs the error but never re-throws. The constraint in PROJECT.md says "FileOperationTracker.emit() failures must be caught silently" -- enforce this with a utility function:

```typescript
private static safeEmit(record: FileOperationRecord): void {
    try {
        FileOperationTracker.emit(record);
    } catch (error) {
        console.error('[FileOperationTracker] emit failed silently:', error);
    }
}
```

Call this AFTER the tool result is captured, not between the operation and the return. The emit must be fire-and-forget.

**Warning signs:**
- AI chat stream aborts when the user closes and reopens the window during a file write operation
- Tool result shows `success: false` even though the file was actually modified on disk
- Intermittent stream failures that correlate with window focus changes

**Phase to address:**
Phase 1 (ToolExecutor integration) -- this is the first code written and must be baked into the integration pattern from the start.

---

### Pitfall 2: Missing preload whitelist entry silently drops all events

**What goes wrong:**
The new `AI_FILE_OPERATION` channel is added to `channellist.ts` but not added to the `validChannels` array in the `receive` method of preload.ts (line 320-365). The contextBridge silently rejects the subscription. The frontend registers a listener but never receives events. No error is thrown anywhere.

**Why it happens:**
The preload.ts file has FOUR separate channel whitelists that must all be updated: `send` whitelist (line 266+), `receive` whitelist (line 321+), `removeListener` whitelist (line 379+), and `removeAllListeners` whitelist (line 435+). Each whitelist is independently maintained. A new channel needs to be added to the correct ones. For file operation events, only the `receive` and `removeListener` whitelists matter (main-to-renderer events), but it is easy to miss one.

**How to avoid:**
Create a checklist for adding any new IPC channel:
1. Add constant to `src/config/channellist.ts`
2. Import constant in `src/preload.ts` (the imports section already has the import block)
3. Add to `receive` validChannels array (line ~321)
4. Add to `removeListener` validChannels array (line ~379)
5. If the channel needs frontend-to-main send: add to `send` validChannels (line ~266)
6. If cleanup needed: add to `removeAllListeners` validChannels (line ~435)

Write a test that calls `window.api.receive(NEW_CHANNEL, () => {})` and verifies the listener is registered.

**Warning signs:**
- Frontend console shows no errors but no file operation events arrive
- Adding `console.log` inside the tracker emit shows events being sent from main process
- The channel works in development but "mysteriously" stops working in production builds

**Phase to address:**
Phase 2 (IPC channel creation) -- the preload whitelist update must be part of the same commit that creates the channel.

---

### Pitfall 3: ToolExecutor does not have access to BrowserWindow sender

**What goes wrong:**
FileOperationTracker is called from ToolExecutor.executeFileTool(), but ToolExecutor is a static class with no reference to the IpcMainEvent or BrowserWindow. It cannot send events to the renderer. The tracker tries to use `BrowserWindow.getAllWindows()[0]` or similar workaround, which breaks when the window is closed or when multiple windows exist.

**Why it happens:**
Looking at how the existing streaming works: StreamEventProcessor holds `private event: IpcMainEvent` (line 114) and uses `this.event.sender.send()` to push chunks to the renderer. But ToolExecutor is a static utility class (line 107) with no event reference. It only receives `toolName`, `toolParams`, and `conversationId`. The conversationId is not enough to locate the correct BrowserWindow.

The architecture decision in PROJECT.md says "FileOperationTracker as static service" -- but a static service cannot call `event.sender.send()` without a reference to the sender.

**How to avoid:**
Two viable approaches, pick one:

**Option A (Recommended): Event emitter pattern.**
FileOperationTracker extends Node.js EventEmitter. ToolExecutor emits records on the tracker instance. StreamEventProcessor (which HAS the sender reference) subscribes to tracker events and forwards them to the renderer via `this.event.sender.send()`. This keeps ToolExecutor decoupled from IPC.

```typescript
// In StreamEventProcessor constructor or init:
FileOperationTracker.on('operation', (record) => {
    this.event.sender.send(AI_FILE_OPERATION, JSON.stringify(record));
});
```

**Option B: Pass sender through.**
Add an optional `sender` parameter to ToolExecutor.execute(), threaded from StreamEventProcessor. This works but pollutes the ToolExecutor interface.

**Warning signs:**
- Tracker calls `BrowserWindow.getAllWindows()[0].webContents.send()` and events go to the wrong window
- Events stop arriving after the user opens a second BrowserWindow
- Null pointer exceptions when all windows are closed

**Phase to address:**
Phase 1 (architecture decision) -- the communication path between ToolExecutor and renderer must be decided before any code is written.

---

### Pitfall 4: Memory leak from unbounded in-memory operation records

**What goes wrong:**
FileOperationTracker stores records in a static array that grows indefinitely during a long session. A user who runs AI file operations for hours accumulates thousands of records. The array consumes increasing memory, and serializing it for any UI query gets progressively slower. Eventually the application becomes sluggish.

**Why it happens:**
The project explicitly chose "no database persistence in v1.1" and "in-memory only." Without a cap, the array grows without bound. The existing `RateLimiterManager` has a similar pattern with a `Map<string, RateLimiter>` but rate limiters are bounded by tool type count. File operation records are unbounded -- each AI tool call produces a new one.

**How to avoid:**
Set a hard cap on in-memory records (e.g., 500 most recent records per conversation, or 1000 total). When the cap is exceeded, drop the oldest records. This is acceptable because the records are ephemeral anyway (lost on restart). Document the cap as a constant:

```typescript
const MAX_IN_MEMORY_OPERATION_RECORDS = 500;
```

Use a circular buffer or array.slice() to enforce the cap on every insert.

**Warning signs:**
- Application memory usage climbs steadily during prolonged AI chat sessions
- The AI chat UI becomes sluggish after 30+ minutes of heavy file operations
- `process.memoryUsage().heapUsed` shows continuous growth

**Phase to address:**
Phase 1 (FileOperationTracker service design) -- bake the cap into the initial implementation.

---

### Pitfall 5: TypeScript types drift between main and renderer process

**What goes wrong:**
The `FileOperationRecord` interface is defined in `src/entityTypes/` but the renderer process receives the record as a serialized JSON string through `window.api.receive()`. The JSON.parse() call produces a plain object with no type guarantee. If the main process changes the record shape (adds/removes a field), the renderer code using the old shape silently reads `undefined` properties. No compile-time error, no runtime error -- just missing data in the UI.

**Why it happens:**
IPC serialization strips all TypeScript type information. The existing pattern in `aiChat.ts` (line 136) does `const chunk: ChatStreamChunk = JSON.parse(chunkData)` -- the type annotation is a cast, not a validation. There is no runtime schema check. This works when types are stable, but during development of a new feature, the shape changes frequently.

**How to avoid:**
1. Define the `FileOperationRecord` type in a SHARED location (`src/entityTypes/fileOperationTypes.ts`) imported by both main and renderer code.
2. Add a runtime type guard function that validates the parsed object:

```typescript
function isFileOperationRecord(obj: unknown): obj is FileOperationRecord {
    return typeof obj === 'object' && obj !== null
        && typeof (obj as Record<string, unknown>).operationType === 'string'
        && typeof (obj as Record<string, unknown>).filePath === 'string'
        && typeof (obj as Record<string, unknown>).timestamp === 'number';
}
```

3. Use the type guard in the frontend listener and log a warning if validation fails.
4. Do NOT use `any` -- the project CLAUDE.md forbids it.

**Warning signs:**
- UI shows "undefined" in file path display
- Type guard catches mismatched records in development console
- Adding a new field to the record does not break the build but breaks the UI

**Phase to address:**
Phase 1 (type definitions) -- the shared type file is the foundation for all subsequent work.

---

### Pitfall 6: Race condition between tool result and operation record events

**What goes wrong:**
The file operation is executed and the tool result is sent back to the AI server. The FileOperationTracker.emit() is called after the tool returns. But the StreamEventProcessor has already sent the `TOOL_RESULT` chunk to the renderer (line 541-542 in StreamEventProcessor calls `saveToolResult` then `sendToolResultToAI`). The renderer receives the tool result BEFORE it receives the file operation record. The UI shows the tool result but the operation badge is missing because it arrives later.

**Why it happens:**
Two independent IPC messages are sent: the tool result via `AI_CHAT_STREAM_CHUNK` and the operation record via `AI_FILE_OPERATION`. Electron's IPC does not guarantee ordering between different channels. Even if sent sequentially from main process, they arrive at the renderer in an undefined order.

**How to avoid:**
Design the UI to handle out-of-order arrival. The operation record should include the `toolId` (the same `toolId` used in `AI_CHAT_STREAM_CHUNK`). The frontend stores operation records in a map keyed by `toolId` and reconciles them when the tool result arrives. If the operation record arrives first, store it. If the tool result arrives first, render it and attach the operation badge when the record catches up.

Alternatively, embed the file operation record INSIDE the existing `ChatStreamChunk` as an optional field, so it travels with the tool result. This eliminates the ordering problem entirely.

**Warning signs:**
- Operation badge flickers (appears and disappears) during fast AI tool calls
- Operation badge is missing on the first render but appears if the user scrolls
- The problem is intermittent and hard to reproduce (depends on IPC scheduling)

**Phase to address:**
Phase 2 (IPC channel design) and Phase 3 (UI integration) -- the ordering contract must be defined before any UI code is written.

---

### Pitfall 7: Incomplete i18n across all 6 language files

**What goes wrong:**
Translation keys for file operation UI text are added to `en.ts` and `zh.ts` but forgotten in `es.ts`, `fr.ts`, `de.ts`, or `ja.ts`. The application does not crash -- it falls back to the English text (the `t('key') || 'English fallback'` pattern). But users see English text mixed with their selected language, which looks broken. This is not caught during development because the developer likely tests in English.

**Why it happens:**
There are 6 separate language files that must all contain the same keys. Adding a key requires editing 6 files. The project CLAUDE.md explicitly calls this out as a "MANDATORY RULE." But in practice, developers add keys to the language they are testing in and forget the rest.

**How to avoid:**
1. Add all translation keys to ALL 6 files in a single commit, before any UI code uses them.
2. Use placeholder translations (English text) for languages where native translation is not available -- this is better than missing keys.
3. Write a simple test script that extracts keys from `en.ts` and verifies they exist in all other language files.
4. Use the same key namespace prefix (e.g., `aiChat.fileOperation.*`) for all related keys.

**Warning signs:**
- Language files have different numbers of keys
- Some keys appear in `en.ts` but not in `de.ts`
- The `t()` function returns the English fallback string in non-English locales

**Phase to address:**
Phase 4 (i18n) -- add all translations BEFORE the UI code that uses them.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Emit operation record inline in ToolExecutor.executeFileTool() | Faster to implement, no new service class | Tightly coupled; cannot add persistence later without refactoring ToolExecutor | Never -- create the tracker as a separate service from the start |
| Skip the type guard for parsed IPC records | Less code, TypeScript casts work at compile time | Silent data corruption when types drift between main and renderer; hard to debug | Never -- the type guard is 10 lines and prevents hours of debugging |
| Hardcode English strings in the Vue component, add i18n "later" | Ship faster, test in English first | "Later" never comes; non-English users see mixed language UI | Never in this project -- CLAUDE.md mandates i18n for all user-facing text |
| Use `BrowserWindow.getAllWindows()[0]` to find the renderer | Quick workaround for the sender reference problem | Breaks with multiple windows; null pointer when window is closed; fragile | Never -- use EventEmitter pattern to decouple |
| Store operation records in a Pinia store directly from IPC listener | Simple state management | Pinia store becomes the single source of truth; cannot be extended to main-process queries later | MVP only if a refactor to a proper tracker service is planned for Phase 2 |

## Integration Gotchas

Common mistakes when connecting to the existing system.

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| ToolExecutor integration | Wrapping FileToolService.execute() with tracker calls inside the same try/catch as the file operation | Track the operation AFTER the result is captured; use a separate try/catch for the tracker emit so file operations are never affected |
| StreamEventProcessor hook | Subscribing to tracker events in the constructor but never unsubscribing | Subscribe in the stream processing method (where the event reference exists) and unsubscribe in the cleanup/finally block |
| channellist.ts | Adding the channel constant but forgetting the import in preload.ts | The import block in preload.ts (lines 10-255) must include the new constant; verify the import resolves |
| preload.ts receive whitelist | Adding the channel to `receive` but not to `removeListener` | Both whitelists are independent; missing `removeListener` means `windowRemoveAllListeners()` silently fails, causing duplicate listeners on re-subscription |
| Frontend API wrapper | Using `windowInvoke` (request/response) for file operation events | File operations are push events (main to renderer); use `windowReceive` to subscribe, not `windowInvoke` to poll |
| ChatStreamChunk extension | Adding `fileOperation` field to ChatStreamChunk type but not updating all places that construct chunks | ChatStreamChunk is constructed in at least 8 places in StreamEventProcessor; adding an optional field requires no changes but the type must be accurate |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded record accumulation | Memory grows linearly; UI sluggish after long sessions | Cap at 500 records with oldest-first eviction | 30+ minutes of continuous AI file operations |
| Re-rendering entire message list on each operation record | Chat UI stutters; each new badge causes full re-layout of all messages | Use Vue's `key` binding with toolId; only update the specific message component that matches the operation's toolId | 50+ messages with operation badges |
| JSON.stringify/parse on every operation record | CPU spikes during rapid AI tool calls (AI can call file_write 10+ times per second) | Only serialize once at the emit boundary; keep the record as a typed object in main process memory | High-frequency file operations (e.g., AI refactoring a directory) |
| Subscribing to tracker events without debouncing | Each file operation triggers a separate Vue reactivity update; 10 operations in 100ms = 10 renders | Batch operation records in the frontend (collect for 100ms, then render) or use `nextTick()` to coalesce updates | AI performs batch file edits (e.g., "rename all files in src/") |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Including full file contents in the operation record sent to renderer | File contents (potentially sensitive config, credentials) visible in IPC message and DevTools; stored in browser memory | Only include metadata in the record: operationType, filePath (relative), timestamp, success, toolId. Never include file content or diffs in the IPC payload |
| Logging file paths in the operation record that expose the user's home directory path | Privacy leak; the full `/Users/name/...` path reveals the system username | Use relative paths in records; strip the workspace root prefix before emitting |
| Sending operation records for files outside the workspace (e.g., system files the AI attempted to access) | Reveals system file structure to renderer process | Validate that the file path is within the allowed workspace roots before creating the record (reuse FilePathGuard) |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing operation records as separate chat messages | Clutters the chat; user cannot tell which tool call the operation belongs to | Show operations as badges/pills attached to the existing tool call message, using the toolId correlation |
| Displaying raw file paths in the UI | Users see `/home/user/project/src/components/Button.vue` which is overwhelming | Show only the filename with a truncated path; use a tooltip for the full path |
| No visual distinction between success and failure operations | User cannot tell at a glance if the AI's file write succeeded or failed | Use color coding: green for success, red for failure; include the error message on hover for failures |
| Showing every read-only operation (file_read, glob, grep) | Operation feed is noisy; user sees 10 read operations for every write | Only track mutating operations (file_write, file_edit, delete) as specified in PROJECT.md -- but enforce this in code, not documentation |
| No way to clear/dismiss operation badges | Old operations pile up visually; the chat becomes cluttered | Auto-dismiss badges after the conversation moves on, or collapse them into a summary after N messages |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **FileOperationTracker service:** Often missing the memory cap -- verify records array has a maximum size enforced on every insert
- [ ] **ToolExecutor integration:** Often missing the error isolation -- verify tracker emit is wrapped in try/catch that never re-throws
- [ ] **IPC channel in channellist.ts:** Often missing the preload.ts import -- verify the constant appears in the import block (lines 10-255 of preload.ts)
- [ ] **Preload whitelist:** Often missing the `removeListener` array -- verify the channel appears in ALL relevant whitelists (receive, removeListener, removeAllListeners)
- [ ] **Frontend API wrapper:** Often missing cleanup on unmount -- verify `windowRemoveAllListeners` is called in the Vue component's `onUnmounted` hook
- [ ] **TypeScript types:** Often missing the type guard -- verify `isFileOperationRecord()` is called before using parsed IPC data
- [ ] **i18n translations:** Often missing 3-4 of the 6 language files -- verify the new keys exist in en.ts, zh.ts, es.ts, fr.ts, de.ts, AND ja.ts
- [ ] **Operation record enrichment:** Often missing the `conversationId` and `toolId` fields -- verify each record includes both so the frontend can correlate with the chat message
- [ ] **UI badge rendering:** Often missing the failure state -- verify the badge renders differently for `success: false` records
- [ ] **Component unmount cleanup:** Often missing the event listener removal -- verify `FileOperationTracker.off()` or `windowRemoveAllListeners` is called when the AI chat component is destroyed

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Tracker emit crashes skill execution | LOW | Wrap the emit call in try/catch; single-line fix in ToolExecutor |
| Missing preload whitelist entry | LOW | Add the channel constant to the correct whitelist array in preload.ts; requires app restart |
| No sender reference in ToolExecutor | MEDIUM | Refactor to EventEmitter pattern; changes ToolExecutor, StreamEventProcessor, and possibly ai-chat-ipc |
| Unbounded memory growth | LOW | Add the MAX_IN_MEMORY_OPERATION_RECORDS cap to the tracker; clears on next emit |
| TypeScript type drift | MEDIUM | Add runtime type guard; update the shared type file; update all consumers |
| IPC race condition (out-of-order events) | MEDIUM | Add reconciliation logic in the Vue component; store records in a map and match by toolId |
| Incomplete i18n translations | LOW | Add missing keys to all language files; no code changes needed |
| Memory leak from unreleased event listeners | LOW | Add cleanup in onUnmounted hook; if listeners already leaked, restart app |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Tracker emit crashes skill execution | Phase 1 (ToolExecutor integration) | Write unit test that calls executeFileTool with a mock tracker that throws; verify the file operation still succeeds |
| Missing preload whitelist entry | Phase 2 (IPC channel) | After adding the channel, write a test that subscribes via window.api.receive and verify the listener is registered (not silently rejected) |
| No sender reference in ToolExecutor | Phase 1 (architecture decision) | Verify the architecture diagram shows the EventEmitter pattern from ToolExecutor through StreamEventProcessor to renderer |
| Unbounded memory growth | Phase 1 (FileOperationTracker service) | Write unit test that inserts 1000 records and verifies the array stays at MAX cap |
| TypeScript type drift | Phase 1 (shared types) | Write unit test for the type guard function; verify it rejects malformed objects |
| IPC race condition | Phase 2/3 (IPC and UI) | Write integration test that sends tool result and operation record in reverse order; verify UI reconciles correctly |
| Incomplete i18n | Phase 4 (translations) | Write script that diffs translation keys across all 6 language files; run in CI |
| Memory leak from event listeners | Phase 3 (UI integration) | Mount and unmount the AI chat component 20 times; verify listener count does not grow |

## Sources

- Direct codebase analysis of `src/service/ToolExecutor.ts` (executeFileTool at line 1319-1327)
- Direct codebase analysis of `src/service/StreamEventProcessor.ts` (sender pattern, event lifecycle, tool execution flow)
- Direct codebase analysis of `src/preload.ts` (whitelist pattern across receive/send/removeListener/removeAllListeners arrays)
- Direct codebase analysis of `src/config/channellist.ts` (channel constant pattern)
- Direct codebase analysis of `src/main-process/communication/ai-chat-ipc.ts` (IPC handler pattern, streaming flow)
- Direct codebase analysis of `src/views/api/aiChat.ts` (frontend subscription pattern, JSON.parse casting)
- Direct codebase analysis of `src/views/utils/apirequest.ts` (windowReceive, windowRemoveAllListeners)
- Direct codebase analysis of `src/views/components/aiChat/AiChatBox.vue` (Vue component structure, message types)
- Direct codebase analysis of `src/service/FileToolService.ts` (file tool execution and result shapes)
- PROJECT.md constraints and architecture decisions

---
*Pitfalls research for: AI Chat File Operation Recording in Electron + Vue 3 + TypeScript*
*Researched: 2026-05-25*
