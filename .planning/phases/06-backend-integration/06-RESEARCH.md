# Phase 6: Backend Integration - Research

**Researched:** 2026-05-25
**Domain:** ToolExecutor interception, preload whitelist, background initialization
**Confidence:** HIGH

## Summary

Phase 6 wires three integration points together so that every AI-initiated `file_write` and `file_edit` automatically emits a `FileOperationRecord` through IPC to the renderer, with zero impact on existing tool behavior. The core change is in `ToolExecutor.executeFileTool()` (currently a thin 6-line method that delegates to `FileToolService.execute()`), which must be extended to: (1) accept the `conversationId` that is already available in `executeInternal()` but not currently forwarded, (2) inspect the result to determine operation type and metadata, and (3) call `FileOperationTracker.emit()` on success or failure.

The implementation is narrow in scope but precise in placement. There are exactly three files to modify: `src/service/ToolExecutor.ts` (interception logic), `src/preload.ts` (whitelist the IPC channel), and `src/background.ts` (tracker lifecycle). The existing `FileWriteResult` already contains a `mode: "created" | "overwritten"` field that directly maps to the `FileOperationType` union (`"create" | "overwrite"`), and `FileEditResult` already contains a `replacements` count that maps to `linesChanged`. This means no changes to `FileToolService` are needed -- all data for the record comes from the result object.

**Primary recommendation:** Modify `executeFileTool` to accept `conversationId`, wrap the existing delegation in a try/catch that emits records on both success and failure paths, add `AI_FILE_OPERATION` to all 3 relevant preload whitelist arrays, and add tracker lifecycle calls in `background.ts` after window creation and on the `closed` event.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool interception (emit on mutation) | Main Process (ToolExecutor) | -- | ToolExecutor is the single dispatch point for all AI file tools; it already holds conversationId in executeInternal |
| Preload whitelist (allow IPC channel) | Preload Script | -- | preload.ts is the security boundary that gates which IPC channels pass between main and renderer |
| Tracker lifecycle (setWebContents) | Main Process (background.ts) | -- | BrowserWindow creation happens in background.ts; window-scoped services are initialized there |

<user_constraints>
## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for Phase 6. Locked decisions from prior v1.1 planning (via STATE.md):

### Locked Decisions (from milestone planning)
- Interception at ToolExecutor.executeFileTool() -- single dispatch point for all AI file tool calls
- FileOperationTracker as static service with webContents reference -- matches existing patterns
- Zero new npm dependencies -- all capabilities already in codebase
- Emit on both success and failure -- users need visibility into failed mutations
- In-memory only (no DB) for v1.1 -- reduce complexity, defer persistence

### Known Concerns (from STATE.md)
- conversationId not currently threaded to executeFileTool() -- must fix in Phase 6
- preload.ts has 4 whitelist arrays that ALL need updating -- missing one silently drops events

### Deferred Ideas (OUT OF SCOPE)
- Database persistence of operation records (v2+)
- Full rollback/undo system (v2+)
- Grouped operation display (v2+)
- file_delete tracking (v2+)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXEC-01 | Thread `conversationId` parameter through to `executeFileTool()` | Section: Architecture Patterns -- conversationId is in executeInternal() but not forwarded to executeFileTool(); pass as 3rd parameter |
| EXEC-02 | After FileToolService.execute() returns for file_write, detect if file existed before to determine create vs overwrite | Section: Don't Hand-Roll -- FileWriteResult.mode already returns "created" or "overwritten"; map directly to FileOperationType |
| EXEC-03 | After FileToolService.execute() returns for file_edit, emit FileOperationRecord with type "edit" and linesChanged from result | Section: Don't Hand-Roll -- FileEditResult.replacements provides the count; map to linesChanged |
| EXEC-04 | Emit record on both success and failure branches -- failed operations include error message | Section: Architecture Patterns -- wrap in try/catch; emit with success:false and error message in catch |
| EXEC-05 | Read-only tools (file_read, glob_files, grep_files) do NOT emit records | Section: Architecture Patterns -- guard with toolName === "file_write" or toolName === "file_edit" |
| EXEC-06 | Original tool result and error behavior preserved -- tracking is additive only | Section: Common Pitfalls -- emit must never change return value or throw; tracker.emit() already has try/catch isolation |
| PREL-01 | Add `AI_FILE_OPERATION` to all 4 whitelist arrays in src/preload.ts | Section: Architecture Patterns -- receive, removeListener, removeAllListeners arrays all need the constant; send array does NOT need it (main->renderer only) |
| INIT-01 | Call FileOperationTracker.setWebContents(mainWindow.webContents) after window creation in src/background.ts | Section: Architecture Patterns -- insert after line 343 (registerCommunicationIpcHandlers) inside createWindowBody() |
| INIT-02 | Clear/reset tracker webContents reference when window is closed or recreated | Section: Architecture Patterns -- insert FileOperationTracker.clear() inside existing "closed" event handler at line 353 |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FileOperationTracker | Phase 5 deliverable | Emit records via IPC | Already implemented in Phase 5 with 11 passing tests [VERIFIED: src/service/FileOperationTracker.ts] |
| FileOperationRecord | Phase 5 deliverable | Typed record interface | Already implemented with all readonly fields [VERIFIED: src/entityTypes/fileOperationTypes.ts] |
| AI_FILE_OPERATION | Phase 5 deliverable | IPC channel constant | Already defined as "ai-chat:file-operation" [VERIFIED: src/config/channellist.ts line 253] |
| FileToolService | Existing | File tool execution | Returns FileWriteResult (mode: "created"|"overwritten") and FileEditResult (replacements, diff) [VERIFIED: src/service/FileToolService.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^1.2.2 | Unit tests for ToolExecutor interception | Test the modified executeFileTool method [VERIFIED: vitest.service.config.mjs] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Interception in executeFileTool | Interception in FileToolService.execute | FileToolService is also called from non-AI contexts (if any exist). ToolExecutor is the AI-only entry point. executeFileTool is the right place. |

**Installation:**
No new packages needed -- all dependencies already in package.json.

## Architecture Patterns

### System Architecture Diagram

```
                                    AI Chat Request
                                         |
                                         v
+------------------------------------------------------------------+
|                      SkillExecutor                                 |
|  context: { conversationId, skillName, toolCallId, args }         |
+------------------------------------------------------------------+
         |                                            |
         | calls skill.execute(args, context)         |
         v                                            |
+------------------------------------------------------------------+
|  skillsRegistry.ts (file_write/file_edit entry)                   |
|  execute: (args, context) => {                                    |
|    ToolExecutor.execute("file_write", args, context.conversationId)|
|  }                                                                |
+------------------------------------------------------------------+
         |
         | calls ToolExecutor.execute(toolName, args, conversationId)
         v
+------------------------------------------------------------------+
|  ToolExecutor.execute(toolName, toolParams, conversationId)       |
|    -> RateLimiterManager.getLimiter(toolName)                     |
|    -> this.executeInternal(toolName, toolParams, conversationId)  |
+------------------------------------------------------------------+
         |
         | switch(toolName) case "file_write"|"file_edit"|...
         v
+------------------------------------------------------------------+
|  THIS PHASE: executeFileTool(toolName, toolParams, conversationId)|
|  +--------------------------------------------------------------+|
|  | 1. Call FileToolService.execute(toolName, toolParams)         ||
|  |    -> returns FileWriteResult or FileEditResult               ||
|  | 2. If file_write or file_edit:                                ||
|  |    a. Build FileOperationRecord from result                   ||
|  |    b. FileOperationTracker.emit(record)                       ||
|  | 3. Return result unchanged                                    ||
|  +--------------------------------------------------------------+|
+------------------------------------------------------------------+
         |                              |
         | result returned              | FileOperationTracker.emit(record)
         |                              v
         |                    +--------------------+
         |                    | FileOperationTracker|
         |                    | .emit() {           |
         |                    |   generate id/ts    |
         |                    |   store in Map      |
         |                    |   webContents.send(  |
         |                    |     AI_FILE_OPERATION,|
         |                    |     fullRecord)       |
         |                    | }                    |
         |                    +--------------------+
         |                              |
         |                              | IPC
         v                              v
+------------------------------------------------------------------+
|                      Renderer Process                              |
|  window.api.receive(AI_FILE_OPERATION, handler)                   |
|  Phase 7 will consume this                                        |
+------------------------------------------------------------------+
```

### Recommended Project Structure

```
src/
+-- service/
|   +-- ToolExecutor.ts          # MODIFIED: executeFileTool now intercepts
+-- preload.ts                   # MODIFIED: add AI_FILE_OPERATION to 3 whitelist arrays
+-- background.ts                # MODIFIED: tracker lifecycle init/clear
+-- service/
|   +-- FileOperationTracker.ts  # UNCHANGED (Phase 5 deliverable)
+-- entityTypes/
|   +-- fileOperationTypes.ts    # UNCHANGED (Phase 5 deliverable)
+-- config/
    +-- channellist.ts           # UNCHANGED (Phase 5 deliverable)
```

### Pattern 1: Thread conversationId Through to executeFileTool

**What:** The `executeInternal` method already receives `conversationId` (line 139) but does not forward it to `executeFileTool` (line 195). Add `conversationId` as a third parameter.

**When to use:** This is the single change needed for EXEC-01.

**Current code (line 190-195):**
```typescript
case "file_read":
case "file_write":
case "file_edit":
case "glob_files":
case "grep_files":
  return await this.executeFileTool(toolName, toolParams);
```

**After change:**
```typescript
case "file_read":
case "file_write":
case "file_edit":
case "glob_files":
case "grep_files":
  return await this.executeFileTool(toolName, toolParams, conversationId);
```

### Pattern 2: Interception with Record Emission

**What:** After `FileToolService.execute()` returns, inspect the result to determine whether and what record to emit. Only `file_write` and `file_edit` emit records (EXEC-05).

**Key insight:** `FileWriteResult.mode` already returns `"created" | "overwritten"` which maps directly to `FileOperationType` `"create" | "overwrite"`. `FileEditResult.replacements` provides the count that maps to `linesChanged`. No changes to FileToolService are needed. [VERIFIED: src/service/FileToolService.ts lines 254-266 and 345-350]

### Pattern 3: Preload Whitelist Addition

**What:** Add `AI_FILE_OPERATION` to the `receive`, `removeListener`, and `removeAllListeners` whitelist arrays in preload.ts. The channel is main-to-renderer only, so it does NOT need to be in the `send` or `invoke` arrays. [VERIFIED: src/preload.ts lines 320-448]

**Arrays to update:**

| Array | Location | Why Needed |
|-------|----------|------------|
| `receive` validChannels (line 321) | Yes | Renderer subscribes to file operation events |
| `removeListener` validChannels (line 379) | Yes | Renderer unsubscribes from file operation events |
| `removeAllListeners` validChannels (line 435) | Yes | Renderer clears all listeners on component unmount |
| `send` validChannels (line 266) | **NO** | Channel is main->renderer, renderer never sends |
| `invoke` validChannels (line 451) | **NO** | Not a request/response channel |

**Pattern:** Add `AI_FILE_OPERATION` in the "AI Chat Channels" section of each array, near the existing `AI_CHAT_STREAM_CHUNK` and `AI_CHAT_STREAM_COMPLETE` entries.

### Pattern 4: Background Initialization

**Where to insert init (INIT-01):** After `registerCommunicationIpcHandlers(win)` at line 343 in `createWindowBody()`. At this point `win` is created and its webContents are valid.

```typescript
// src/background.ts, inside createWindowBody(), after line 343
import { FileOperationTracker } from "@/service/FileOperationTracker";

// After: registerCommunicationIpcHandlers(win);
FileOperationTracker.setWebContents(win.webContents);
```

**Where to insert clear (INIT-02):** Inside the existing `win.on("closed", ...)` handler at line 353.

```typescript
(win as any).on("closed", () => {
  console.log("Window closed event triggered");
  FileOperationTracker.clear();  // <-- ADD HERE, before win = null
  win = null;
});
```

### Anti-Patterns to Avoid

- **Emitting records for read-only tools:** `file_read`, `glob_files`, `grep_files` must NOT emit records. Guard with an explicit `toolName === "file_write" || toolName === "file_edit"` check. [EXEC-05]
- **Swallowing the original error:** The catch block in the interception must re-throw the error after emitting the failure record. If you catch and don't re-throw, the tool execution silently succeeds from the caller's perspective. [EXEC-06]
- **Changing the return value:** The interception must return the exact same result object from `FileToolService.execute()`. Do not wrap, transform, or augment the result. [EXEC-06]
- **Forgetting a whitelist array:** preload.ts has 3 relevant whitelist arrays. Missing any one silently drops events in certain scenarios. [VERIFIED: STATE.md Blockers/Concerns]
- **Calling clear() too early:** Do not call `FileOperationTracker.clear()` before the `closed` event. The tracker should persist across page navigations within the same window session. [VERIFIED: CONTEXT.md D-03]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File existence detection for create vs overwrite | Pre-check with fs.existsSync before calling FileToolService | `FileWriteResult.mode` field ("created" or "overwritten") | FileToolService already computes this correctly (line 254: `const isOverwrite = mode === "overwrite" && fs.existsSync(filePath)`) [VERIFIED: src/service/FileToolService.ts] |
| Lines changed computation | Parse the diff string to count additions/deletions | `FileEditResult.replacements` field | FileToolService already counts replacements (line 348: `replacements: replaceAll ? matchCount : 1`) [VERIFIED: src/service/FileToolService.ts] |
| IPC send with error isolation | Manual error wrapping around webContents.send | `FileOperationTracker.emit()` method | Tracker already wraps everything in try/catch and checks isDestroyed() (Phase 5 deliverable) [VERIFIED: src/service/FileOperationTracker.ts lines 44-72] |

**Key insight:** FileToolService already returns all the data needed for FileOperationRecord. The interception in ToolExecutor only needs to read the result fields and map them. No changes to FileToolService are required.

## Common Pitfalls

### Pitfall 1: Missing conversationId Parameter

**What goes wrong:** If `conversationId` is not threaded through to `executeFileTool`, the tracker cannot correlate records to conversations, making Phase 7's badge rendering impossible.
**Why it happens:** The method currently does not accept this parameter (line 1319-1322). The `executeInternal` method has it (line 139) but does not forward it to `executeFileTool` (line 195).
**How to avoid:** Add `conversationId: string` as a third parameter to `executeFileTool` and pass it from `executeInternal` at the call site (line 195).
**Warning signs:** `FileOperationRecord.conversationId` is undefined or empty in Phase 7 frontend.

### Pitfall 2: Emit Changes Return Value or Error Behavior

**What goes wrong:** If the interception modifies the result object, throws instead of re-throwing, or catches without re-throwing, the AI's tool execution behavior changes, violating EXEC-06.
**Why it happens:** It is tempting to wrap the result in a richer object or to suppress the error after recording it.
**How to avoid:** The `emit()` call must be fire-and-forget (it already has internal try/catch). The result must be returned verbatim. Errors must be re-thrown after the emit.
**Warning signs:** AI chat starts behaving differently after Phase 6 changes (tools silently failing, double error messages, etc.).

### Pitfall 3: Missing Preload Whitelist Entry

**What goes wrong:** If `AI_FILE_OPERATION` is added to `receive` but not `removeListener`, the renderer can subscribe but cannot unsubscribe, causing memory leaks in Phase 7.
**Why it happens:** preload.ts has 4 separate whitelist arrays that are independently maintained. It is easy to add to one and forget the others.
**How to avoid:** Add the constant to all 3 relevant arrays (receive, removeListener, removeAllListeners) in a single commit. Verify by searching for `AI_CHAT_STREAM_CHUNK` (which is in all 3) and adding `AI_FILE_OPERATION` in the same position.
**Warning signs:** Phase 7 frontend receives events but component cleanup does not work, or events do not arrive at all.

### Pitfall 4: Tracker clear() Called on Wrong Event

**What goes wrong:** If `FileOperationTracker.clear()` is called on a navigation event instead of window close, records are lost when the user navigates between pages within the same window session.
**Why it happens:** BrowserWindow has both `close` and `closed` events, and page navigation triggers `did-navigate` events.
**How to avoid:** Only call `clear()` inside the `win.on("closed", ...)` handler (line 353). This event fires once when the window is actually destroyed, not on page navigations.
**Warning signs:** Records disappear when user navigates to a different page in the app.

### Pitfall 5: Type Casting Errors in Result Inspection

**What goes wrong:** `FileToolService.execute()` returns `Promise<Record<string, unknown>>`. Accessing fields like `result.mode` or `result.replacements` requires type casting, which can fail at runtime if the result shape changes.
**Why it happens:** The `execute()` method casts all return types through `Record<string, unknown>` (lines 56-72 of FileToolService.ts).
**How to avoid:** Cast to the specific result type (FileWriteResult/FileEditResult) for type safety. The `as unknown as Record<string, unknown>` pattern is already used throughout FileToolService.
**Warning signs:** TypeError: Cannot read property 'mode' of undefined when AI writes a file.

## Code Examples

Verified patterns from codebase source:

### Current executeFileTool (to be modified)

```typescript
// Source: src/service/ToolExecutor.ts lines 1319-1327
private static async executeFileTool(
  toolName: string,
  toolParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return await ToolExecutor.getFileToolService().execute(
    toolName,
    toolParams
  );
}
```

### FileWriteResult mode mapping (existing, no changes needed)

```typescript
// Source: src/service/FileToolService.ts lines 253-266
const isOverwrite = mode === "overwrite" && fs.existsSync(filePath);
writeFileAtomic.sync(filePath, content);
return {
  success: true,
  path: params.path,
  bytesWritten,
  mode: isOverwrite ? "overwritten" : "created",
};
```

### FileEditResult replacements mapping (existing, no changes needed)

```typescript
// Source: src/service/FileToolService.ts lines 345-350
return {
  success: true,
  path: params.path,
  replacements: replaceAll ? matchCount : 1,
  diff: diffLines.join("\n"),
};
```

### Preload whitelist pattern (where to add AI_FILE_OPERATION)

```typescript
// Source: src/preload.ts
// receive array (line 321-365): add after AI_CHAT_STREAM_COMPLETE
AI_CHAT_STREAM_CHUNK,
AI_CHAT_STREAM_COMPLETE,
AI_FILE_OPERATION,        // <-- ADD HERE
ANALYZE_WEBSITE_PROGRESS,

// removeListener array (line 379-423): add after AI_CHAT_STREAM_COMPLETE
AI_CHAT_STREAM_CHUNK,
AI_CHAT_STREAM_COMPLETE,
AI_FILE_OPERATION,        // <-- ADD HERE
ANALYZE_WEBSITE_PROGRESS,

// removeAllListeners array (line 435-444): add after AI_CHAT_STREAM_COMPLETE
AI_CHAT_STREAM_CHUNK,
AI_CHAT_STREAM_COMPLETE,
AI_FILE_OPERATION,        // <-- ADD HERE
ANALYZE_WEBSITE_PROGRESS,
```

### Background.ts tracker lifecycle (where to insert)

```typescript
// Source: src/background.ts

// INIT-01: After line 343 (registerCommunicationIpcHandlers)
// Inside createWindowBody(), after registerCommunicationIpcHandlers(win):
import { FileOperationTracker } from "@/service/FileOperationTracker";
registerCommunicationIpcHandlers(win);
FileOperationTracker.setWebContents(win.webContents);

// INIT-02: At line 353 (inside win.on("closed"))
(win as any).on("closed", () => {
  console.log("Window closed event triggered");
  FileOperationTracker.clear();  // <-- ADD HERE, before win = null
  win = null;
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No file operation tracking | Intercept at ToolExecutor.executeFileTool | Phase 6 (this phase) | Every AI file mutation will be observable in the UI |
| conversationId not in executeFileTool | Thread conversationId as parameter | Phase 6 (this phase) | Records can be correlated to conversations |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `skillName` should be set to the tool name (e.g., "file_write") in the record since the actual skill name context is not available at the ToolExecutor layer | Architecture Patterns | If Phase 7 needs the actual skill name, we would need to thread it through. Low risk: the toolName is already mapped to the record type, which is the more useful identifier. |
| A2 | `toolCallId` should be left undefined in the record because ToolExecutor.executeInternal does not receive it -- only SkillExecutor has access to it | Architecture Patterns | If Phase 7 needs toolCallId for correlation, we would need to add it to the ToolExecutor.execute signature. Medium risk: this could require threading toolCallId through two additional layers. |
| A3 | `AI_FILE_OPERATION` does NOT need to be in the `send` whitelist array because it is a main-to-renderer channel (renderer never sends to it) | Preload Whitelist Analysis | If the frontend ever needs to request file operation history via IPC, a separate invoke channel would be used. Low risk: the channel is documented as main->renderer. |

## Open Questions

1. **skillName and toolCallId availability**
   - What we know: `SkillExecutionContext` has `skillName` and `toolCallId` fields. SkillExecutor calls `ToolExecutor.execute(name, args, context.conversationId)` which only passes conversationId, not the full context.
   - What's unclear: Whether Phase 7 needs `skillName` and `toolCallId` on the record for UI rendering.
   - Recommendation: For v1.1, leave `skillName` as the tool name (e.g., "file_write") and `toolCallId` as undefined. These can be threaded through in a future iteration if the UI needs them.

2. **Error case filePath extraction**
   - What we know: On success, `result.path` contains the file path. On error (before FileToolService runs, or when FileToolService returns an error result), the path comes from `toolParams.path`.
   - What's unclear: Whether `toolParams.path` is always present in error cases.
   - Recommendation: Use `toolParams.path` for the error case filePath. If it is undefined, use an empty string (the record's filePath field is `string`, not `string | undefined`).

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified -- all changes are code-only, modifying existing TypeScript files with no new tools, services, or runtimes required)

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^1.2.2 |
| Config file | vitest.service.config.mjs |
| Quick run command | `npx vitest run --config vitest.service.config.mjs` |
| Full suite command | `npx vitest run --config vitest.service.config.mjs` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-01 | conversationId is threaded through to executeFileTool and appears in emitted record | unit | `npx vitest run --config vitest.service.config.mjs` | No -- Wave 0 |
| EXEC-02 | file_write result with mode "overwritten" emits record type "overwrite"; mode "created" emits "create" | unit | `npx vitest run --config vitest.service.config.mjs` | No -- Wave 0 |
| EXEC-03 | file_edit result emits record type "edit" with linesChanged from replacements count | unit | `npx vitest run --config vitest.service.config.mjs` | No -- Wave 0 |
| EXEC-04 | Failed file operations emit record with success=false and error message | unit | `npx vitest run --config vitest.service.config.mjs` | No -- Wave 0 |
| EXEC-05 | file_read, glob_files, grep_files do NOT emit records | unit | `npx vitest run --config vitest.service.config.mjs` | No -- Wave 0 |
| EXEC-06 | Tool result and error behavior unchanged after tracking addition | unit | `npx vitest run --config vitest.service.config.mjs` | No -- Wave 0 |
| PREL-01 | AI_FILE_OPERATION appears in receive, removeListener, removeAllListeners whitelist arrays | compile/manual | `yarn tsc` + manual grep | Existing |
| INIT-01 | FileOperationTracker.setWebContents called after window creation | integration/manual | Manual verification | Existing |
| INIT-02 | FileOperationTracker.clear called on window closed event | integration/manual | Manual verification | Existing |

### Sampling Rate

- **Per task commit:** `npx vitest run --config vitest.service.config.mjs`
- **Per wave merge:** `npx vitest run --config vitest.service.config.mjs`
- **Phase gate:** Full suite green + TypeScript compilation clean (`yarn tsc`)

### Wave 0 Gaps

- [ ] `test/vitest/main/service/ToolExecutor.test.ts` -- currently minimal (only checks execute method exists). Needs extension to cover EXEC-01 through EXEC-06 with mocked FileToolService and FileOperationTracker.
- [ ] No shared fixtures needed -- ToolExecutor and FileOperationTracker are both static classes testable without database or Electron runtime.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | FileToolService already validates all paths via FilePathGuard; ToolExecutor adds no new inputs |
| V4 Access Control | yes | Preload whitelist ensures only authorized IPC channels are exposed |
| V2 Authentication | no | No authentication changes |
| V3 Session Management | no | No session changes |
| V6 Cryptography | no | No cryptographic operations |

### Known Threat Patterns for Electron IPC

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized IPC channel access | Tampering | preload.ts whitelist arrays gate all IPC channels; adding AI_FILE_OPERATION only allows the renderer to listen for file operation records |
| Data exfiltration via IPC | Information Disclosure | FileOperationRecord only contains file paths and operation metadata, not file contents (diff is excluded from the record by design) |

## Sources

### Primary (HIGH confidence)

- `src/service/ToolExecutor.ts` -- executeFileTool method (lines 1319-1327), executeInternal switch statement (lines 136-203), execute entry point (lines 111-131) [VERIFIED: direct file read]
- `src/service/FileToolService.ts` -- execute method (lines 48-76), executeFileWrite (lines 195-267), executeFileEdit (lines 273-351) [VERIFIED: direct file read]
- `src/preload.ts` -- 4 whitelist arrays: send (line 266), receive (line 321), removeListener (line 379), removeAllListeners (line 435) [VERIFIED: direct file read]
- `src/background.ts` -- createWindowBody() (lines 287-491), closed handler (line 353) [VERIFIED: direct file read]
- `src/service/FileOperationTracker.ts` -- Phase 5 deliverable, emit() method with try/catch isolation [VERIFIED: direct file read]
- `src/entityTypes/fileOperationTypes.ts` -- FileOperationRecord interface [VERIFIED: direct file read]
- `src/entityTypes/fileToolTypes.ts` -- FileWriteResult.mode, FileEditResult.replacements [VERIFIED: direct file read]
- `src/entityTypes/skillTypes.ts` -- SkillExecutionContext interface (lines 117-136) [VERIFIED: direct file read]
- `src/config/channellist.ts` -- AI_FILE_OPERATION constant (line 253) [VERIFIED: direct file read]
- `src/config/skillsRegistry.ts` -- file_write/file_edit skill entries showing ToolExecutor.execute call chain [VERIFIED: direct file read]

### Secondary (MEDIUM confidence)

- `test/vitest/main/service/ToolExecutor.test.ts` -- Current test file (minimal) [VERIFIED: direct file read]
- `test/vitest/main/service/FileOperationTracker.test.ts` -- Phase 5 tests with 11 passing cases [VERIFIED: via 05-01-SUMMARY.md]
- `vitest.service.config.mjs` -- Vitest config for service tests [VERIFIED: direct file read]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies verified in codebase; Phase 5 deliverables confirmed with passing tests
- Architecture: HIGH - Single interception point confirmed; data flow traced from SkillExecutor through ToolExecutor to FileOperationTracker
- Pitfalls: HIGH - All pitfalls derived from direct code analysis of the 3 files being modified

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable -- no external dependency changes expected)
