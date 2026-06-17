# Documentation Index

## Marketing Automation Subagent System

- [PRD: Marketing Automation Subagent System](./marketing-subagent-system-prd.md)
- [Technology Design: Marketing Automation Subagent System](./marketing-subagent-system-technical-design.md)

## PRD: AI Chat File Operation Recording

### Overview

Add a file operation recording feature for AI chat skills. When an AI chat skill
creates, modifies, overwrites, updates, or deletes a file, the application should
record the operation and display it in the AI chat box near the relevant assistant
message.

This gives users clear visibility into what the AI changed during a chat session
and creates an audit trail for skill-driven file operations.

### Problem Statement

AI chat skills can execute tools that read, write, edit, and otherwise operate on
local files. Today, users may see the skill's natural language response, but they
do not get a structured list of file operations performed by that skill.

This creates three problems:

1. Users cannot easily tell which files were created, edited, or deleted.
2. There is no structured UI record tied to the chat conversation.
3. Debugging skill behavior requires manually checking file changes outside the
   chat experience.

### Goals

1. Record every successful and failed write-like file operation initiated by AI
   chat skills.
2. Display recorded operations in the AI chat box in near real time.
3. Associate each operation with the current chat conversation.
4. Keep the implementation close to the existing AI chat, skill, and file tool
   architecture.
5. Avoid direct database writes in IPC handlers unless persistence is explicitly
   added later through the Model/Module architecture.

### Non-Goals

1. Do not record manual user file edits in the editor.
2. Do not record unrelated internal application file operations unless they are
   triggered through AI chat skill tools.
3. Do not build a full rollback system in the first version.
4. Do not persist operation history across app restarts in the first version.
5. Do not add dynamic imports or untyped `any` values.

### Recommended Architecture

The best interception point is `src/service/ToolExecutor.ts`, specifically the
path that dispatches AI file tools to `FileToolService`.

Recommended flow:

```text
AI chat stream
  -> StreamEventProcessor
  -> SkillExecutor or ToolExecutor
  -> ToolExecutor.executeInternal(...)
  -> FileToolService.execute(...)
  -> FileOperationTracker.emit(...)
  -> AI_FILE_OPERATION IPC event
  -> src/views/api/aiChat.ts listener
  -> AI chat component renders operation summary
```

### Proposed Files

1. `src/entityTypes/fileOperationTypes.ts`
   - Defines `FileOperationType` and `FileOperationRecord`.
2. `src/service/FileOperationTracker.ts`
   - Emits file operation events to the renderer through Electron IPC.
3. `src/config/channellist.ts`
   - Adds `AI_FILE_OPERATION`.
4. `src/service/ToolExecutor.ts`
   - Emits operation records after file write/edit/delete tools run.
5. `src/views/api/aiChat.ts`
   - Adds renderer helper functions for subscribing to file operation events.
6. AI chat Vue component
   - Stores received operation records and displays them under related messages
     or in the current conversation operation panel.

### Data Model

```typescript
export type FileOperationType = "create" | "overwrite" | "edit" | "delete";

export interface FileOperationRecord {
  id: string;
  type: FileOperationType;
  filePath: string;
  timestamp: number;
  success: boolean;
  conversationId: string;
  skillName: string;
  toolCallId?: string;
  linesChanged?: number;
  sizeBytes?: number;
  error?: string;
}
```

### IPC Channel

Add a new channel in `src/config/channellist.ts`:

```typescript
export const AI_FILE_OPERATION = "ai:file-operation";
```

The main process emits this event with a `FileOperationRecord` payload. The
renderer listens through existing wrapper utilities in `src/views/api/aiChat.ts`.

### FileOperationTracker Service

Create a small main-process service responsible for sending records to the active
browser window:

```typescript
import type { BrowserWindow } from "electron";
import { AI_FILE_OPERATION } from "@/config/channellist";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";

export class FileOperationTracker {
  private static mainWindow: BrowserWindow | null = null;

  static setWindow(win: BrowserWindow): void {
    FileOperationTracker.mainWindow = win;
  }

  static emit(record: FileOperationRecord): void {
    if (
      FileOperationTracker.mainWindow &&
      !FileOperationTracker.mainWindow.isDestroyed()
    ) {
      FileOperationTracker.mainWindow.webContents.send(
        AI_FILE_OPERATION,
        record
      );
    }
  }
}
```

### ToolExecutor Changes

Update `ToolExecutor` so file write-like operations pass through a helper that
emits operation records.

Recommended behavior:

1. For `file_write`, detect whether the path existed before execution.
   - If it existed, record `overwrite`.
   - If it did not exist, record `create`.
2. For `file_edit`, record `edit`.
3. For delete-capable tools, record `delete`.
4. For read/search tools such as `file_read`, `glob_files`, and `grep_files`, do
   not emit a write operation record in the first version.
5. Emit both success and failure records.
6. Preserve the original tool result and error behavior.

### Frontend API Changes

Update `src/views/api/aiChat.ts`:

```typescript
import {
  windowReceive,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import { AI_FILE_OPERATION } from "@/config/channellist";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";

export function onAiFileOperation(
  handler: (record: FileOperationRecord) => void
): void {
  windowReceive(AI_FILE_OPERATION, handler);
}

export function removeAiFileOperationListeners(): void {
  windowRemoveAllListeners(AI_FILE_OPERATION);
}
```

### AI Chat UI Behavior

The chat UI should display file operations in a compact, scannable format:

1. Operation badge: `CREATE`, `OVERWRITE`, `EDIT`, `DELETE`.
2. File path.
3. Timestamp.
4. Success or failure indicator.
5. Error text when `success` is `false`.

### Security and Privacy Requirements

1. Do not expose hidden secrets or file contents in operation records.
2. Only display file paths and metadata.
3. Continue to rely on the existing file tool deny-list and permission checks.
4. Do not bypass `SkillPermissionService`.
5. Do not record read-only file operations as mutations.
6. Sanitize any user-visible error strings if they can include sensitive data.

### Error Handling

1. File operation tracking must never break the underlying skill execution.
2. If IPC emit fails because the window is destroyed, skip the UI event.
3. Failed tool operations should still emit a failed operation record when the
   operation type and file path are known.
4. Use `unknown` in catch blocks and narrow errors safely.

### Testing Strategy

1. Unit test operation type mapping.
2. Unit test that `file_write` records `create` when the path did not exist.
3. Unit test that `file_write` records `overwrite` when the path existed.
4. Unit test that `file_edit` records `edit`.
5. Unit test failed write/edit behavior emits `success: false`.
6. Renderer test or component test should verify operation records render in the
   chat UI.
7. Manual test by asking AI chat to create and edit a small temporary file, then
   verifying the chat box shows both operations.

### Rollout Plan

1. Add shared types and IPC channel.
2. Add `FileOperationTracker`.
3. Wire `FileOperationTracker` to the active browser window.
4. Update `ToolExecutor` file tool dispatch to emit records.
5. Add frontend listener wrappers in `src/views/api/aiChat.ts`.
6. Update the AI chat Vue component UI.
7. Add focused tests.
8. Run `yarn vue-check` or the available type check command.
9. Run relevant unit tests.

### Future Enhancements

1. Persist records to SQLite through a Model and Module layer.
2. Group operations under the exact assistant message or tool call.
3. Add a "view diff" action for edit operations.
4. Add a "revert operation" workflow for safe operations.
5. Add filters by operation type and success state.
6. Show operation counts in conversation history.
