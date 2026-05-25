# Phase 5: Types and Tracker Foundation - Research

**Researched:** 2026-05-25
**Domain:** TypeScript type definitions, static service class, IPC channel constant
**Confidence:** HIGH

## Summary

This phase creates three files that form the dependency foundation for all downstream phases: the `FileOperationRecord` type definition, the `FileOperationTracker` static service class, and the `AI_FILE_OPERATION` IPC channel constant. Every layer from backend interception through frontend display depends on these building blocks.

The implementation is straightforward because the codebase has well-established patterns for each component. The `FileOperationRecord` follows the same `readonly` interface pattern as `FileWriteResult` and `FileEditResult` in `src/entityTypes/fileToolTypes.ts`. The `FileOperationTracker` follows the static class pattern used by `RateLimiterManager` (defined inline in `src/service/ToolExecutor.ts` lines 61-102) and `ToolExecutor` itself. The channel constant follows the naming convention of the existing `AI_CHAT_STREAM_CHUNK` family in `src/config/channellist.ts`.

The key architectural decision is that the tracker's `emit()` method must be fire-and-forget: wrapped in try/catch that never re-throws, checked for destroyed webContents before sending. This prevents recording failures from ever breaking tool execution -- the single most critical pitfall identified in prior research.

**Primary recommendation:** Implement in dependency order (types first, then channel constant, then tracker service), write unit tests for the tracker's emit isolation and memory cap behavior, and do not wire the tracker to ToolExecutor or background.ts in this phase (that is Phase 6).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use the `uuid` package (already in dependencies as `^9.0.1`) to generate record IDs. Generate v4 UUIDs via `v4()` from the `uuid` package.
- **D-02:** Create a new file `src/entityTypes/fileOperationTypes.ts` for `FileOperationRecord` and `FileOperationType`.
- **D-03:** FileOperationTracker is window-scoped. `setWebContents()` called after BrowserWindow creation in `background.ts`. WebContents reference cleared on window `closed` event. In-memory store (Map keyed by conversationId) persists across page navigations within the same window session.
- **D-04:** Memory cap at 500 records per conversation, evicting oldest-first when exceeded.
- **D-05:** Static class pattern for `FileOperationTracker` (matches `RateLimiterManager` pattern).
- **D-06:** `emit()` wraps IPC send in try/catch -- failures never propagate to caller or break tool execution.
- **D-07:** `emit()` checks `webContents` is not destroyed before calling `send()`.
- **D-08:** All `FileOperationRecord` fields are `readonly` (immutable pattern per project coding standards).
- **D-09:** `FileOperationType` union: `"create" | "overwrite" | "edit"`.
- **D-10:** IPC channel constant: `AI_FILE_OPERATION = "ai-chat:file-operation"` in `src/config/channellist.ts`.
- **D-11:** Auto-generate `timestamp` as `Date.now()` (number, not Date object) for clean IPC serialization.

### Claude's Discretion
- Exact method signatures and internal Map structure
- Error logging within emit() (console.warn vs debug)
- Whether to expose `getRecords(conversationId)` method on tracker (likely useful for Phase 7)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TYPE-01 | Define `FileOperationType` union type: `"create" \| "overwrite" \| "edit"` | Section: Standard Stack -- TypeScript discriminated union pattern; file location decided in D-02 |
| TYPE-02 | Define `FileOperationRecord` interface with fields: id, type, filePath, timestamp (number), success, conversationId, skillName, toolCallId (optional), linesChanged (optional), sizeBytes (optional), error (optional) | Section: Code Examples -- exact interface shape following fileToolTypes.ts readonly pattern |
| TYPE-03 | All fields on `FileOperationRecord` are `readonly` (immutable pattern) | Section: Architecture Patterns -- readonly modifier pattern from fileToolTypes.ts lines 14-98 |
| TRAK-01 | Create static `FileOperationTracker` class with `setWebContents(webContents)` and `emit(record)` methods | Section: Code Examples -- tracker class pattern matching RateLimiterManager (ToolExecutor.ts lines 61-102) |
| TRAK-02 | `emit()` wraps IPC send in try/catch -- failures never propagate to caller | Section: Common Pitfalls -- Pitfall 1: emit failure isolation is the highest-priority concern |
| TRAK-03 | `emit()` checks `webContents` is not destroyed before sending | Section: Code Examples -- `!webContents.isDestroyed()` guard pattern used in background.ts line 838 |
| TRAK-04 | Tracker holds an in-memory `Map<conversationId, FileOperationRecord[]>` capped at 500 records per conversation | Section: Architecture Patterns -- memory cap implementation with oldest-first eviction |
| TRAK-05 | Auto-generates unique `id` (UUID v4) and `timestamp` (Date.now()) for each record | Section: Standard Stack -- uuid v4 import pattern from ExtractionQueue.ts line 1 |
| IPC-01 | Add `AI_FILE_OPERATION` channel constant (`"ai-chat:file-operation"`) to `src/config/channellist.ts` | Section: Code Examples -- follows existing AI_CHAT_* naming convention at channellist.ts lines 240-251 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Type definitions (FileOperationRecord) | Shared (entityTypes) | -- | Types are imported by both main and renderer process code |
| Static tracker service (FileOperationTracker) | Main Process | -- | Holds webContents reference and emits IPC; only called from ToolExecutor (main process) |
| IPC channel constant | Shared (config) | -- | Imported by both main process (tracker emit) and renderer (preload whitelist) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| uuid | ^9.0.1 (installed), 14.0.0 (latest in registry) | Generate v4 UUIDs for record IDs | Already in package.json; used in 10+ files across codebase with `import { v4 as uuidv4 } from 'uuid'` pattern [VERIFIED: grep for `from 'uuid'`] |
| TypeScript | 5.x | Type definitions with readonly fields | Project language; all entityTypes use readonly interface pattern [VERIFIED: fileToolTypes.ts lines 14-98] |
| Electron WebContents | 35.x | IPC send from main to renderer | Already used in background.ts and StreamEventProcessor.ts for main-to-renderer push [VERIFIED: background.ts lines 838, 1092; StreamEventProcessor.ts line 220] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^1.2.2 | Unit testing the tracker | All service-layer tests use vitest [VERIFIED: test/vitest/main/service/ToolExecutor.test.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| uuid v4 | crypto.randomUUID() | crypto.randomUUID() is available in Node 19+/Electron 28+, but uuid is already a dependency and used consistently across the codebase. Switching would create inconsistency with zero benefit. |

**Installation:**
No new packages needed -- all dependencies already in package.json.

**Version verification:**
```
uuid: ^9.0.1 (in package.json), 14.0.0 (latest on npm registry)
Note: Project pins ^9.0.1 which is intentionally behind latest. Do not upgrade as part of this phase.
```

## Architecture Patterns

### System Architecture Diagram

```
Phase 5 scope (dashed box):
+------------------------------------------------------------------+
|                      Main Process (Electron)                      |
|  +-------------------------------------------------------------+ |
|  |                 Phase 5 deliverables                         | |
|  |                                                              | |
|  |  +------------------------+  +----------------------------+ | |
|  |  | fileOperationTypes.ts  |  | FileOperationTracker.ts    | | |
|  |  | (types only, no logic) |  | (static service)           | | |
|  |  +------------------------+  +----------------------------+ | |
|  |          |                |       |          |              | |
|  +----------|----------------|-------|----------|--------------+ |
|             |                |       |          |                |
|  +----------|----------------|-------|----------|--------------+ |
|  |          v                |       |          v              | |
|  |  channellist.ts           |       |  webContents.send()     | |
|  |  (AI_FILE_OPERATION)      |       |  (Electron IPC)         | |
|  |          |                |       |                         | |
|  +----------|----------------|-------|-------------------------+ |
+-------------|----------------|-------|---------------------------+
              |                |
    +---------|----------------|-----------+
    |         v                v           |
    |  Future Phase 6 imports  |           |
    |  (ToolExecutor,           |           |
    |   background.ts)          |           |
    |                           |           |
    +---------------------------+-----------+
```

Phase 5 creates the three building blocks. Phase 6 will import them into ToolExecutor and background.ts. Phases 7-8 will consume them in the renderer.

### Recommended Project Structure

```
src/
+-- entityTypes/
|   +-- fileOperationTypes.ts       # NEW: FileOperationRecord + FileOperationType
+-- service/
|   +-- FileOperationTracker.ts     # NEW: Static tracker service
+-- config/
    +-- channellist.ts              # MODIFIED: Add AI_FILE_OPERATION constant
```

### Pattern 1: Readonly Interface Type Definition

**What:** TypeScript interface with all fields marked `readonly`, following the immutable pattern mandated by CLAUDE.md coding standards.
**When to use:** Every data type that crosses process boundaries (IPC) or represents a recorded event.
**Example:**

```typescript
// Source: Verified pattern from src/entityTypes/fileToolTypes.ts lines 66-98
export interface FileToolResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface FileWriteResult extends FileToolResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly mode: "created" | "overwritten";
}
```

The `FileOperationRecord` follows this exact pattern with `readonly` on every field and optional metadata fields using `?`.

### Pattern 2: Static Service Class

**What:** A class with only static methods and private static state, instantiated zero times. Matches the `RateLimiterManager` pattern.
**When to use:** When a service needs to be called from other static classes (like ToolExecutor) without dependency injection.
**Example:**

```typescript
// Source: src/service/ToolExecutor.ts lines 61-102 (RateLimiterManager)
class RateLimiterManager {
  private static limiters = new Map<string, RateLimiter>();

  static getLimiter(toolName: string): RateLimiter {
    if (!this.limiters.has(toolName)) {
      const config = this.getRateLimitConfig(toolName);
      this.limiters.set(toolName, new RateLimiter(config));
    }
    return this.limiters.get(toolName)!;
  }
  // ...
}
```

The `FileOperationTracker` follows this pattern: private static `webContents` reference, private static `Map` for records, public static methods for `setWebContents`, `emit`, `clear`, and optionally `getRecords`.

### Pattern 3: IPC Channel Constant Naming

**What:** Exported const string with `namespace:action` format, grouped by feature in channellist.ts.
**When to use:** Every new IPC channel must have a constant in this file.
**Example:**

```typescript
// Source: src/config/channellist.ts lines 240-251
// AI Chat Channels
export const AI_CHAT_MESSAGE = "ai-chat:message";
export const AI_CHAT_STREAM = "ai-chat:stream";
export const AI_CHAT_STREAM_CHUNK = "ai-chat:stream-chunk";
export const AI_CHAT_STREAM_COMPLETE = "ai-chat:stream-complete";
```

The new constant `AI_FILE_OPERATION = "ai-chat:file-operation"` follows the `ai-chat:*` prefix, consistent with being part of the AI chat feature area.

### Anti-Patterns to Avoid

- **Exporting a mutable class instance:** Do not create a singleton instance (`export const tracker = new FileOperationTracker()`). Use static methods only, matching the RateLimiterManager pattern. [VERIFIED: ToolExecutor.ts lines 61-102]
- **Using `Date` objects for timestamps:** `Date` objects do not survive JSON serialization through IPC cleanly. Use `Date.now()` which returns a plain `number`. [VERIFIED: CONTEXT.md D-11]
- **Omitting readonly:** CLAUDE.md mandates immutable patterns. Every field on `FileOperationRecord` must be `readonly`.
- **Throwing from emit():** The tracker's `emit()` must never throw, even if `webContents.send()` fails. Wrap the entire send in try/catch with empty catch (or log-only catch). [VERIFIED: CONTEXT.md D-06]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom ID generator using Math.random() or Date.now() concatenation | `uuid` package (`v4()` function) | Already in dependencies; cryptographically random; consistent with 10+ existing usages across codebase |
| IPC channel name | Hardcoded string literal at each usage site | Exported const in `channellist.ts` | Single source of truth; prevents typo bugs; all 50+ existing channels follow this pattern |
| Type safety for operation types | String literals scattered in code | `FileOperationType` union type | TypeScript compiler enforces valid values; prevents typos in operation type dispatch |

**Key insight:** This phase is entirely about creating well-typed, reusable building blocks. Every piece of code created here will be imported by multiple files in later phases. Correctness and immutability matter more than performance or cleverness.

## Common Pitfalls

### Pitfall 1: Emit Failure Crashes Tool Execution

**What goes wrong:** If `webContents.send()` throws (e.g., webContents is destroyed between the null check and the send call), the exception propagates up through `FileOperationTracker.emit()` into `ToolExecutor.executeFileTool()`, crashing the AI tool execution mid-stream.
**Why it happens:** Electron's `webContents.send()` can throw synchronously if the underlying renderer process has crashed. The `isDestroyed()` check is a race condition guard but not a guarantee.
**How to avoid:** Wrap the entire `emit()` body (including the `isDestroyed()` check and `send()` call) in a try/catch block that logs the error but never re-throws.
**Warning signs:** If tool execution stops working after closing/reopening the app window, the tracker is throwing.

### Pitfall 2: Forgetting to Implement the Memory Cap

**What goes wrong:** Without a cap, the in-memory `Map<conversationId, FileOperationRecord[]>` grows without bound. A long-running session with thousands of file operations consumes increasing memory in the main process.
**Why it happens:** The cap is easy to overlook because it is not needed for correctness, only for resource management.
**How to avoid:** Implement the 500-record cap in the `emit()` method itself: after appending the record to the array, check length and shift the oldest record if over 500.
**Warning signs:** Memory usage steadily increasing during long AI chat sessions with many file operations.

### Pitfall 3: Using `any` Type in the Tracker

**What goes wrong:** Using `any` for the record parameter or Map values defeats TypeScript's type safety and violates the project rule "NEVER use `any` type."
**Why it happens:** Expediency -- typing the full `FileOperationRecord` interface requires importing it.
**How to avoid:** Import and use `FileOperationRecord` from `fileOperationTypes.ts` for every parameter, return type, and Map generic.
**Warning signs:** TypeScript compiler warnings about implicit `any` types.

### Pitfall 4: Not Testing the Destroyed-WebContents Guard

**What goes wrong:** If the `isDestroyed()` check or try/catch is wrong, the first test will pass (webContents is valid) but production will fail when the window closes mid-operation.
**Why it happens:** Developers test the happy path (webContents is valid) but not the edge case (webContents is destroyed or null).
**How to avoid:** Write a unit test that calls `emit()` after calling `clear()` (which sets webContents to null), and another test with a mock webContents that returns `true` from `isDestroyed()`.
**Warning signs:** No test coverage for the null/destroyed webContents branches.

## Code Examples

Verified patterns from codebase source:

### FileOperationType Union and FileOperationRecord Interface

```typescript
// File: src/entityTypes/fileOperationTypes.ts (NEW)
// Pattern source: src/entityTypes/fileToolTypes.ts readonly interface pattern

/**
 * Types of file mutations tracked by FileOperationTracker.
 * Only write-like operations are recorded (no reads).
 */
export type FileOperationType = "create" | "overwrite" | "edit";

/**
 * Immutable record of a single file mutation performed by an AI chat skill.
 * All fields are readonly per project immutability standards.
 */
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

### AI_FILE_OPERATION Channel Constant

```typescript
// File: src/config/channellist.ts (MODIFIED -- add after line 251)
// Pattern source: existing AI_CHAT_* constants at lines 240-251

// Add in the AI Chat Channels section:
/** Main->Renderer: file operation record emitted after AI chat file_write/file_edit */
export const AI_FILE_OPERATION = "ai-chat:file-operation";
```

### FileOperationTracker Static Service

```typescript
// File: src/service/FileOperationTracker.ts (NEW)
// Pattern source: RateLimiterManager (ToolExecutor.ts lines 61-102) for static class pattern
// Pattern source: background.ts line 838 for webContents.send() + isDestroyed() guard

import { v4 as uuidv4 } from "uuid";
import type { WebContents } from "electron";
import { AI_FILE_OPERATION } from "@/config/channellist";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";

const MAX_RECORDS_PER_CONVERSATION = 500;

/**
 * Static service that emits file operation records to the renderer via IPC.
 * Designed so that emit() failures NEVER propagate to callers.
 */
export class FileOperationTracker {
  private static webContents: WebContents | null = null;
  private static readonly records = new Map<string, FileOperationRecord[]>();

  /**
   * Set the webContents reference for IPC communication.
   * Called once after BrowserWindow creation in background.ts.
   */
  static setWebContents(wc: WebContents): void {
    FileOperationTracker.webContents = wc;
  }

  /**
   * Clear the webContents reference and all stored records.
   * Called on window close event.
   */
  static clear(): void {
    FileOperationTracker.webContents = null;
    FileOperationTracker.records.clear();
  }

  /**
   * Emit a file operation record to the renderer.
   * Auto-generates id and timestamp.
   * Failures are caught silently -- tracking must never break tool execution.
   */
  static emit(
    record: Omit<FileOperationRecord, "id" | "timestamp">
  ): void {
    try {
      const fullRecord: FileOperationRecord = {
        ...record,
        id: uuidv4(),
        timestamp: Date.now(),
      };

      // Store in memory with cap
      const conversationId = record.conversationId;
      const existing = FileOperationTracker.records.get(conversationId) ?? [];
      existing.push(fullRecord);
      if (existing.length > MAX_RECORDS_PER_CONVERSATION) {
        existing.shift(); // Evict oldest
      }
      FileOperationTracker.records.set(conversationId, existing);

      // Send to renderer if webContents is alive
      if (
        FileOperationTracker.webContents &&
        !FileOperationTracker.webContents.isDestroyed()
      ) {
        FileOperationTracker.webContents.send(
          AI_FILE_OPERATION,
          fullRecord
        );
      }
    } catch {
      // Intentionally silent -- tracking must never break tool execution
    }
  }

  /**
   * Get all stored records for a conversation.
   * Useful for Phase 7 frontend badge rendering.
   */
  static getRecords(conversationId: string): readonly FileOperationRecord[] {
    return FileOperationTracker.records.get(conversationId) ?? [];
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dynamic `any`-typed IPC payloads | Typed interfaces with readonly fields | Established in codebase | FileOperationRecord must follow this pattern |
| Singleton instances with module-level state | Static classes with private static state | Established in codebase (RateLimiterManager, ToolExecutor) | FileOperationTracker uses static class pattern |
| Date objects in IPC | `Date.now()` number for timestamps | Best practice for Electron IPC | D-11 locks this decision |

**Deprecated/outdated:**
- `crypto.randomUUID()` is available in newer Node.js versions but the project uses the `uuid` package consistently. Do not switch.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `emit()` method should accept `Omit<FileOperationRecord, "id" \| "timestamp">` and auto-generate id/timestamp internally | Architecture Patterns | If the caller needs to control id/timestamp, the signature would need to change. Low risk: auto-generation is the intended design per TRAK-05 and D-01/D-11. |
| A2 | The `getRecords()` method should be exposed for Phase 7 use | Code Examples | If Phase 7 does not need server-side record retrieval (it might use only IPC push), this method is unused. Low risk: it is harmless and matches the Claude's Discretion allowance. |
| A3 | The in-memory Map eviction should use `Array.shift()` (oldest-first) | Architecture Patterns | If records need to be sorted differently for eviction, `shift()` would be wrong. Low risk: chronological order is the natural eviction policy. |

## Open Questions

1. **Error logging in emit() catch block**
   - What we know: CONTEXT.md Claude's Discretion allows choosing between console.warn and debug.
   - What's unclear: Whether the project has a preferred logging module for non-critical warnings.
   - Recommendation: Use `console.warn` for emit failures. The Logger module (`src/modules/Logger`) is available but emit failures are non-critical and should not spam the log file. If the planner wants structured logging, they can substitute.

2. **Whether `getRecords()` is needed in Phase 5**
   - What we know: CONTEXT.md lists it as Claude's Discretion, noting it is "likely useful for Phase 7."
   - What's unclear: Whether Phase 7 will use main-process record queries or only the IPC push stream.
   - Recommendation: Include it. It adds zero complexity (one method that reads from the Map) and saves Phase 7 from needing to modify this file.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^1.2.2 |
| Config file | None detected at project root (uses package.json scripts) |
| Quick run command | `npx vitest run test/vitest/main/service/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRAK-01 | Static class with setWebContents/emit methods | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |
| TRAK-02 | emit() try/catch prevents exception propagation | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |
| TRAK-03 | emit() checks isDestroyed before send | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |
| TRAK-04 | Memory cap at 500 records per conversation | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |
| TRAK-05 | Auto-generates UUID id and Date.now() timestamp | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |
| TYPE-01 | FileOperationType union compiles and constrains values | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |
| TYPE-02 | FileOperationRecord interface has all required/optional fields | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |
| TYPE-03 | All FileOperationRecord fields are readonly | compile | `yarn tsc` (TypeScript compiler catches mutation) | Existing |
| IPC-01 | AI_FILE_OPERATION constant is defined and has correct value | unit | `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts` | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run test/vitest/main/service/FileOperationTracker.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/vitest/main/service/FileOperationTracker.test.ts` -- covers TRAK-01 through TRAK-05, TYPE-01, TYPE-02, IPC-01
- [ ] No shared fixtures needed -- tracker is a static class with no database or Electron dependency in tests

## Sources

### Primary (HIGH confidence)

- `src/entityTypes/fileToolTypes.ts` -- Readonly interface pattern (lines 14-98), result type shape for FileWriteResult and FileEditResult
- `src/service/ToolExecutor.ts` -- RateLimiterManager static class pattern (lines 61-102), executeFileTool method (lines 1319-1327), executeInternal switch statement showing file tool dispatch (lines 190-195)
- `src/config/channellist.ts` -- IPC channel constant naming convention, AI_CHAT_* family (lines 240-251)
- `src/background.ts` -- BrowserWindow creation (line 289), closed event handler (line 353), webContents.send pattern (lines 838, 1092, 1145)
- `src/entityTypes/commonType.ts` -- ChatStreamChunk and MessageType patterns (lines 194-347)
- `package.json` -- uuid ^9.0.1 dependency, vitest ^1.2.2 dependency

### Secondary (MEDIUM confidence)

- `src/childprocess/contact-extraction/ExtractionQueue.ts` -- uuid v4 import pattern (`import { v4 as uuidv4 } from 'uuid'`)
- `test/vitest/main/service/ToolExecutor.test.ts` -- Existing test structure for ToolExecutor (vitest, describe/test/expect pattern)
- npm registry -- uuid latest version is 14.0.0 (project pins ^9.0.1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All patterns verified in source code, no new dependencies needed
- Architecture: HIGH - Static class pattern, readonly types, and IPC channel naming all have direct codebase precedents
- Pitfalls: HIGH - Pitfalls identified through direct codebase analysis with specific line references

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable -- no external dependency changes expected)
