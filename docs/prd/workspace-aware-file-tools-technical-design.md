# Workspace-Aware AI File Tools - Technical Design

## 1. Purpose

This document translates `docs/workspace-aware-file-tools-prd.md` into an implementation-facing technical design.

The goal is to make AI file tools operate inside an explicit user-approved workspace instead of using broad default roots such as the user's home directory. The design keeps the current file safety foundation, especially `FilePathGuard`, but changes how roots are resolved and how workspace state is surfaced to the user.

The primary bug this design prevents is:

```text
EPERM: operation not permitted, scandir '/Users/cengjianze/.Trash'
```

That error happens because `glob_files` can default to the home directory and then traverse protected macOS folders. The fix is not to special-case `.Trash`. The fix is to stop treating home as the AI workspace.

## 2. Current System Summary

### 2.1 Existing File Tool Flow

Current AI file tool execution follows this path:

```text
AI model tool call
  -> SkillRegistry built-in skill definition
  -> SkillExecutor permission gate
  -> ToolExecutor.execute(...)
  -> ToolExecutor.executeFileTool(...)
  -> cached FileToolService singleton
  -> FilePathGuard
  -> fs / fast-glob / write-file-atomic
```

Key files:

| File | Current responsibility |
| --- | --- |
| `src/config/skillsRegistry.ts` | Registers `file_read`, `glob_files`, `grep_files`, `file_edit`, `file_write` as built-in tools |
| `src/service/ToolExecutor.ts` | Dispatches tool calls and emits file operation records for write/edit |
| `src/service/FileToolService.ts` | Implements the file tools |
| `src/service/FilePathGuard.ts` | Validates paths against allowed roots and deny-list patterns |
| `src/config/fileToolConfig.ts` | Defines default roots, ignore patterns, deny-list, size limits, rate limits |
| `src/entityTypes/fileToolTypes.ts` | Defines file tool params/results and path validation result types |

### 2.2 Current Root Selection

`FileToolService` currently constructs its guard like this:

```typescript
constructor(roots?: readonly string[]) {
  this.guard = new FilePathGuard(roots ?? getDefaultWorkspaceRoots());
}
```

`getDefaultWorkspaceRoots()` returns Electron home and userData in production:

```typescript
const home = app.getPath("home");
const userData = app.getPath("userData");
return [home, userData];
```

`ToolExecutor` currently caches one global file service:

```typescript
private static fileToolService: FileToolService | null = null;

private static getFileToolService(): FileToolService {
  if (!ToolExecutor.fileToolService) {
    ToolExecutor.fileToolService = new FileToolService();
  }
  return ToolExecutor.fileToolService;
}
```

That means AI chat file tools inherit global roots, not conversation-specific roots.

### 2.3 Current Search Defaults

`glob_files` validates optional `cwd`, then defaults to the first guard root:

```typescript
const searchCwd =
  cwd?.resolvedPath ?? this.guard.getRoots()[0] ?? process.cwd();
```

With home as the first root, a tool call like this scans home:

```json
{
  "pattern": "**/*",
  "head_limit": 50
}
```

### 2.4 Current Permission Flow

The existing permission system already blocks or prompts for tools based on `requiresConfirmation` and `permissionCategory`.

File tools are registered with:

```typescript
requiresConfirmation: true,
permissionCategory: "filesystem"
```

This design keeps that permission flow. Workspace approval is added before filesystem execution. It does not replace per-tool permission cards.

## 3. Target Architecture

### 3.1 High-Level Flow

Target AI file tool flow:

```text
AI model tool call
  -> SkillRegistry built-in skill definition
  -> SkillExecutor permission gate
  -> ToolExecutor.execute(...)
  -> FileToolWorkspaceResolver.resolve(conversationId)
  -> if no active workspace: workspaceRequired result
  -> FileToolService({ roots: [workspace.rootPath], workspace })
  -> FilePathGuard
  -> fs / fast-glob / write-file-atomic
  -> workspace-aware result metadata
  -> FileOperationTracker emits relative-path audit record
```

### 3.2 Workspace Data Flow

```text
Renderer workspace selector
  -> src/views/api/aiWorkspace.ts
  -> preload-safe IPC
  -> ai-workspace-ipc.ts
  -> AIWorkspaceModule
  -> AIWorkspaceModel / AIConversationWorkspaceModel
  -> SQLite TypeORM entities
```

### 3.3 Runtime Tool Flow

```text
ToolExecutor.executeFileTool(toolName, args, conversationId)
  -> FileToolWorkspaceResolver.resolveForConversation(conversationId)
  -> WorkspaceResolved | WorkspaceMissing
  -> new FileToolService({ roots: [rootPath], workspace })
  -> execute tool
  -> append workspace metadata to result
```

### 3.4 Ownership Rules

IPC owns:

- AI enable checks.
- JSON parsing.
- Electron dialog calls.
- returning `CommonMessage<T>` payloads.

Modules own:

- workspace business rules.
- persistence orchestration.
- conversation binding state.
- workspace status updates.

Models own:

- TypeORM repository access.
- query shapes.
- insert/update/delete operations.

Services own:

- workspace resolution for file tool execution.
- filesystem path validation.
- file tool execution.
- tool result shaping.

Renderer owns:

- workspace badge.
- workspace selection card.
- workspace missing UI.
- permission-card display metadata.

## 4. New Types

### 4.1 Workspace Status Types

Add `src/entityTypes/aiWorkspaceTypes.ts`.

```typescript
export type AIWorkspacePermissionStatus = "active" | "revoked" | "missing";

export type AIWorkspaceBoundBy = "user" | "system";

export interface AIWorkspaceView {
  readonly workspaceId: string;
  readonly rootPath: string;
  readonly displayName: string;
  readonly permissionStatus: AIWorkspacePermissionStatus;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly lastUsedAt?: string;
}

export interface AIConversationWorkspaceView {
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly rootPath: string;
  readonly displayName: string;
  readonly permissionStatus: AIWorkspacePermissionStatus;
  readonly boundAt: string;
  readonly boundBy: AIWorkspaceBoundBy;
}

export interface WorkspaceRequiredToolResult {
  readonly success: false;
  readonly workspaceRequired: true;
  readonly error: string;
  readonly toolName: string;
  readonly conversationId?: string;
}
```

### 4.2 File Tool Workspace Metadata

Extend `src/entityTypes/fileToolTypes.ts`.

```typescript
export interface FileToolWorkspaceMetadata {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceRoot: string;
  readonly relativePath?: string;
}
```

Update mutation/read/search results to optionally include workspace metadata:

```typescript
export interface FileWriteResult extends FileToolResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly mode: "created" | "overwritten";
  readonly workspaceId?: string;
  readonly workspaceName?: string;
  readonly workspaceRoot?: string;
  readonly relativePath?: string;
}
```

For `glob_files`, returned `matches` should remain workspace-relative paths. Add workspace fields at the result level:

```typescript
export interface GlobFilesResult extends FileToolResult {
  readonly matches: readonly string[];
  readonly total: number;
  readonly truncated: boolean;
  readonly workspaceId?: string;
  readonly workspaceName?: string;
  readonly workspaceRoot?: string;
}
```

### 4.3 Path Validation Metadata

Extend `PathValidationResult` with root and relative path data.

```typescript
export interface PathValidationResult {
  readonly safe: boolean;
  readonly resolvedPath: string;
  readonly error?: string;
  readonly rootPath?: string;
  readonly relativePath?: string;
  readonly code?:
    | "invalid_path"
    | "outside_workspace"
    | "deny_list"
    | "realpath_failed";
}
```

This lets `FileToolService` produce precise UI/audit metadata without recomputing root matches.

## 5. Database Design

### 5.1 Entity: AIWorkspaceEntity

Create `src/entity/AIWorkspace.entity.ts`.

```typescript
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIWorkspacePermissionStatus } from "@/entityTypes/aiWorkspaceTypes";

@Entity("ai_workspaces")
@Index(["workspaceId"], { unique: true })
@Index(["rootPath"], { unique: true })
@Index(["permissionStatus"])
export class AIWorkspaceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  workspaceId: string;

  @Order(2)
  @Column("text", { nullable: false })
  rootPath: string;

  @Order(3)
  @Column("varchar", { length: 200, nullable: false })
  displayName: string;

  @Order(4)
  @Column("varchar", { length: 32, nullable: false, default: "active" })
  permissionStatus: AIWorkspacePermissionStatus;

  @Order(5)
  @Column("datetime", { nullable: true })
  lastUsedAt?: Date;

  @Order(6)
  @Column("text", { nullable: true })
  metadata?: string;
}
```

### 5.2 Entity: AIConversationWorkspaceEntity

Create `src/entity/AIConversationWorkspace.entity.ts`.

```typescript
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIWorkspaceBoundBy } from "@/entityTypes/aiWorkspaceTypes";

@Entity("ai_conversation_workspaces")
@Index(["conversationId", "active"])
@Index(["workspaceId"])
export class AIConversationWorkspaceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  workspaceId: string;

  @Order(3)
  @Column("datetime", { nullable: false })
  boundAt: Date;

  @Order(4)
  @Column("varchar", { length: 32, nullable: false })
  boundBy: AIWorkspaceBoundBy;

  @Order(5)
  @Column("boolean", { nullable: false, default: true })
  active: boolean;

  @Order(6)
  @Column("text", { nullable: true })
  metadata?: string;
}
```

TypeORM on SQLite may store boolean as integer depending on project config. Match the existing project convention if another entity already uses a boolean column.

### 5.3 Entity Registration

Add both entities to the SQLite data-source entity list. The exact file to update depends on current entity registration in `src/config/SqliteDb.ts` or adjacent configuration. Keep this change near other AI chat entities.

### 5.4 Migration Behavior

This project appears to initialize schema from TypeORM entity metadata rather than a separate migration folder for every feature. The implementation should follow the existing database initialization path.

Migration rules:

- New tables are additive.
- Existing conversations start with no workspace binding.
- Existing file operation records stay readable.
- No existing user files are moved or modified.

## 6. Model Layer

### 6.1 AIWorkspaceModel

Create `src/model/AIWorkspace.model.ts`.

Responsibilities:

- create workspace.
- find by workspaceId.
- find by rootPath.
- list recent workspaces.
- update permission status.
- update lastUsedAt.

Interface:

```typescript
export class AIWorkspaceModel extends BaseDb {
  async createWorkspace(input: {
    workspaceId: string;
    rootPath: string;
    displayName: string;
    permissionStatus: AIWorkspacePermissionStatus;
    metadata?: Record<string, unknown>;
  }): Promise<AIWorkspaceEntity>;

  async getByWorkspaceId(
    workspaceId: string
  ): Promise<AIWorkspaceEntity | null>;

  async getByRootPath(rootPath: string): Promise<AIWorkspaceEntity | null>;

  async listRecent(limit: number): Promise<AIWorkspaceEntity[]>;

  async updateStatus(input: {
    workspaceId: string;
    permissionStatus: AIWorkspacePermissionStatus;
  }): Promise<void>;

  async touchLastUsed(workspaceId: string): Promise<void>;
}
```

### 6.2 AIConversationWorkspaceModel

Create `src/model/AIConversationWorkspace.model.ts`.

Responsibilities:

- bind workspace to conversation.
- deactivate old binding for a conversation.
- get active binding.
- clear active binding.
- list bindings for audit/history if needed.

Interface:

```typescript
export class AIConversationWorkspaceModel extends BaseDb {
  async bindWorkspace(input: {
    conversationId: string;
    workspaceId: string;
    boundBy: AIWorkspaceBoundBy;
  }): Promise<AIConversationWorkspaceEntity>;

  async getActiveByConversation(
    conversationId: string
  ): Promise<AIConversationWorkspaceEntity | null>;

  async clearActive(conversationId: string): Promise<void>;
}
```

Implementation detail:

- `bindWorkspace()` should deactivate existing active rows for the conversation before inserting the new row.
- Use a transaction if the local TypeORM helper pattern supports it. If not, keep the two writes sequential and covered by tests.

## 7. Module Layer

### 7.1 AIWorkspaceModule

Create `src/modules/AIWorkspaceModule.ts`.

Responsibilities:

- normalize selected paths.
- validate root exists and is a directory.
- resolve symlink roots to real paths.
- create or reuse workspaces.
- bind workspace to conversation.
- clear workspace binding.
- build renderer-safe views.

Important: module extends `BaseModule`; IPC must not access repositories directly.

Public methods:

```typescript
export class AIWorkspaceModule extends BaseModule {
  async listRecentWorkspaces(limit?: number): Promise<AIWorkspaceView[]>;

  async createOrReuseWorkspace(input: {
    rootPath: string;
    displayName?: string;
  }): Promise<AIWorkspaceView>;

  async bindConversation(input: {
    conversationId: string;
    workspaceId: string;
    boundBy: AIWorkspaceBoundBy;
  }): Promise<AIConversationWorkspaceView>;

  async getConversationWorkspace(
    conversationId: string
  ): Promise<AIConversationWorkspaceView | null>;

  async clearConversationWorkspace(
    conversationId: string
  ): Promise<{ cleared: boolean }>;

  async markMissing(workspaceId: string): Promise<void>;

  async revokeWorkspace(workspaceId: string): Promise<AIWorkspaceView>;
}
```

### 7.2 Root Path Normalization

`createOrReuseWorkspace()` must:

1. reject empty paths.
2. resolve to absolute path.
3. call `fs.realpathSync()` if the path exists.
4. verify the path exists.
5. verify the path is a directory.
6. derive displayName from `path.basename(rootPath)` if absent.
7. reuse an existing workspace for the same real root path.

Pseudo-code:

```typescript
private normalizeRootPath(rootPath: string): string {
  const abs = path.resolve(rootPath);
  if (!fs.existsSync(abs)) throw new Error("Workspace folder does not exist");
  const real = fs.realpathSync(abs);
  if (!fs.statSync(real).isDirectory()) {
    throw new Error("Workspace path must be a directory");
  }
  return real;
}
```

### 7.3 Workspace View Builder

The module should centralize conversion from entity rows to view objects. Do not expose internal numeric database IDs to the renderer.

```typescript
private toWorkspaceView(entity: AIWorkspaceEntity): AIWorkspaceView {
  return {
    workspaceId: entity.workspaceId,
    rootPath: entity.rootPath,
    displayName: entity.displayName,
    permissionStatus: entity.permissionStatus,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt?.toISOString(),
    lastUsedAt: entity.lastUsedAt?.toISOString(),
  };
}
```

## 8. Workspace Resolver Service

### 8.1 New Service

Create `src/service/FileToolWorkspaceResolver.ts`.

This service is the bridge between tool execution and workspace persistence.

```typescript
export type FileToolWorkspaceResolution =
  | {
      readonly ok: true;
      readonly workspace: AIConversationWorkspaceView;
    }
  | {
      readonly ok: false;
      readonly result: WorkspaceRequiredToolResult;
    };

export class FileToolWorkspaceResolver {
  constructor(private readonly module = new AIWorkspaceModule()) {}

  async resolveForConversation(input: {
    conversationId: string;
    toolName: string;
  }): Promise<FileToolWorkspaceResolution> {
    // implementation
  }
}
```

### 8.2 Resolver Rules

Rules:

1. If `conversationId` is empty, return workspace required.
2. If no active binding exists, return workspace required.
3. If workspace status is `revoked`, return workspace required.
4. If root path is missing on disk, mark workspace missing and return workspace required.
5. If root path exists but is not a directory, mark missing and return workspace required.
6. If valid, return workspace view and touch `lastUsedAt`.

Workspace required result:

```typescript
{
  success: false,
  workspaceRequired: true,
  error: "Select a workspace before using file tools.",
  toolName,
  conversationId,
}
```

### 8.3 Why Resolver Is Separate From FileToolService

`FileToolService` should remain focused on filesystem operations. It should not know how to query chat conversation state or database modules.

`ToolExecutor` already has `conversationId`; that makes it the right place to call the resolver and then construct a workspace-scoped `FileToolService`.

## 9. FilePathGuard Changes

### 9.1 Preserve Existing Behavior

Keep these existing rules:

- null-byte rejection.
- control-character rejection.
- relative path resolution under first root.
- absolute path normalization.
- symlink realpath checks.
- root jail.
- deny-list matching.

### 9.2 Add Root Metadata

Currently `computeRelativePath()` is private and only used for deny-list matching. Change internal matching to return both root and relative path.

Suggested helper:

```typescript
private findMatchingRoot(resolved: string):
  | { rootPath: string; relativePath: string }
  | null {
  for (const root of this.roots) {
    if (resolved.startsWith(root + path.sep) || resolved === root) {
      const rel = path.relative(root, resolved).split(path.sep).join("/");
      return { rootPath: root, relativePath: rel };
    }
  }
  return null;
}
```

Return metadata on success:

```typescript
return {
  safe: true,
  resolvedPath: resolved,
  rootPath: match.rootPath,
  relativePath: match.relativePath,
};
```

Return stable codes on errors:

```typescript
return {
  safe: false,
  resolvedPath: "",
  error: "Path is outside the active workspace.",
  code: "outside_workspace",
};
```

### 9.3 Empty Roots

In strict workspace mode, `FilePathGuard` should reject construction with no roots. If changing constructor behavior risks tests, add a static factory or option:

```typescript
new FilePathGuard(roots, denyList, { requireRoots: true });
```

For this project, the cleaner path is to enforce non-empty roots in `FileToolService` strict mode instead of changing `FilePathGuard` globally.

## 10. FileToolService Changes

### 10.1 Constructor Options

Replace or overload the constructor.

Current:

```typescript
constructor(roots?: readonly string[])
```

Target:

```typescript
export interface FileToolServiceOptions {
  readonly roots?: readonly string[];
  readonly requireWorkspace?: boolean;
  readonly workspace?: {
    readonly workspaceId: string;
    readonly displayName: string;
    readonly rootPath: string;
  };
}

constructor(input?: readonly string[] | FileToolServiceOptions) {
  // preserve array constructor for existing tests
}
```

Compatibility behavior:

- `new FileToolService([tmpDir])` continues to work for existing tests.
- `new FileToolService()` remains available for non-chat legacy code, but AI chat should not use it.
- `new FileToolService({ requireWorkspace: true })` without roots returns workspace-required results or throws at construction, depending on chosen implementation.

Recommended behavior:

- Throw if `requireWorkspace` is true and roots are empty.
- Keep `execute()` returning structured errors for tool-level issues.

### 10.2 Result Metadata

Add a helper:

```typescript
private withWorkspace<T extends Record<string, unknown>>(
  result: T,
  validation?: PathValidationResult
): T & FileToolWorkspaceMetadata {
  return {
    ...result,
    workspaceId: this.workspace?.workspaceId,
    workspaceName: this.workspace?.displayName,
    workspaceRoot: this.workspace?.rootPath,
    relativePath: validation?.relativePath,
  };
}
```

For search tools, no single target path exists. Include workspace fields without `relativePath`.

### 10.3 Glob/Grep Error Resilience

Update `fast-glob` calls:

```typescript
const allMatches = fg.sync(params.pattern, {
  cwd: searchCwd,
  ignore,
  dot: false,
  onlyFiles: true,
  suppressErrors: true,
});
```

Add OS-protected defaults to `DEFAULT_IGNORE_PATTERNS`:

```typescript
".Trash/**",
"Library/**",
"**/.Trash/**",
```

Do not rely on these patterns as the main safety barrier. They only reduce noisy traversal failures inside unusual workspaces.

### 10.4 Remove Process CWD Fallback For Strict Mode

In strict mode, this code must not fall back to `process.cwd()`:

```typescript
cwd?.resolvedPath ?? this.guard.getRoots()[0] ?? process.cwd()
```

Use:

```typescript
const defaultRoot = this.guard.getRoots()[0];
if (!defaultRoot) {
  return workspaceRequiredResult(...);
}
const searchCwd = cwd?.resolvedPath ?? defaultRoot;
```

## 11. ToolExecutor Integration

### 11.1 Remove Global Singleton For AI Chat File Tools

Current singleton:

```typescript
private static fileToolService: FileToolService | null = null;
```

Target:

```typescript
private static fileToolServicesByWorkspace = new Map<string, FileToolService>();
private static workspaceResolver = new FileToolWorkspaceResolver();
```

Implementation:

```typescript
private static async getFileToolServiceForConversation(
  conversationId: string,
  toolName: string
): Promise<
  | { ok: true; service: FileToolService; workspace: AIConversationWorkspaceView }
  | { ok: false; result: WorkspaceRequiredToolResult }
> {
  const resolved = await ToolExecutor.workspaceResolver.resolveForConversation({
    conversationId,
    toolName,
  });
  if (!resolved.ok) return { ok: false, result: resolved.result };

  const workspace = resolved.workspace;
  const cacheKey = `${workspace.workspaceId}:${workspace.rootPath}`;
  let service = ToolExecutor.fileToolServicesByWorkspace.get(cacheKey);
  if (!service) {
    service = new FileToolService({
      roots: [workspace.rootPath],
      requireWorkspace: true,
      workspace: {
        workspaceId: workspace.workspaceId,
        displayName: workspace.displayName,
        rootPath: workspace.rootPath,
      },
    });
    ToolExecutor.fileToolServicesByWorkspace.set(cacheKey, service);
  }

  return { ok: true, service, workspace };
}
```

### 11.2 executeFileTool Target Flow

```typescript
private static async executeFileTool(
  toolName: string,
  toolParams: Record<string, unknown>,
  conversationId: string
): Promise<Record<string, unknown>> {
  const resolved = await ToolExecutor.getFileToolServiceForConversation(
    conversationId,
    toolName
  );
  if (!resolved.ok) {
    return resolved.result as unknown as Record<string, unknown>;
  }

  const result = await resolved.service.execute(toolName, toolParams);
  ToolExecutor.emitFileOperationIfNeeded({
    toolName,
    result,
    toolParams,
    conversationId,
    workspace: resolved.workspace,
  });
  return result;
}
```

### 11.3 FileOperationTracker Metadata

Extend `FileOperationRecord`:

```typescript
export interface FileOperationRecord {
  readonly workspaceId?: string;
  readonly workspaceRoot?: string;
  readonly relativePath?: string;
}
```

Emission should prefer:

- `relativePath` for UI display.
- `workspaceRoot` only in trusted detail views.
- original `filePath` kept for backward compatibility.

### 11.4 Permission Timing

Current permission prompt happens in `SkillExecutor` before `ToolExecutor.execute()`. Workspace resolution currently happens inside `ToolExecutor`, after permission grant.

That creates a product issue: the permission card cannot show workspace metadata unless it can resolve workspace before permission.

Recommended phase 1 approach:

1. Keep workspace-required enforcement in `ToolExecutor`.
2. Add lightweight permission-card preview metadata in `SkillExecutor` or renderer by using tool arguments and active workspace state from the conversation.
3. If no workspace is active, permission card should not be the primary UI; the tool result should be workspace-required.

Future improvement:

- Add a `previewToolExecution()` path that resolves workspace and builds permission preview before asking for write permission.

## 12. IPC Design

### 12.1 New Channels

Add to `src/config/channellist.ts`:

```typescript
export const AI_WORKSPACE_LIST = "ai-workspace:list";
export const AI_WORKSPACE_SELECT_FOLDER = "ai-workspace:select-folder";
export const AI_WORKSPACE_BIND_CONVERSATION =
  "ai-workspace:bind-conversation";
export const AI_WORKSPACE_GET_CONVERSATION =
  "ai-workspace:get-conversation";
export const AI_WORKSPACE_CLEAR_CONVERSATION =
  "ai-workspace:clear-conversation";
export const AI_WORKSPACE_REVOKE = "ai-workspace:revoke";
```

### 12.2 IPC Handler File

Create `src/main-process/communication/ai-workspace-ipc.ts`.

Rules:

- Check `USER_AI_ENABLED` before work.
- Use `AIWorkspaceModule`.
- Do not use TypeORM repositories directly.
- Use Electron `dialog.showOpenDialog` only in main process.
- Return `CommonMessage<T>` using existing `ok` / `denied` style.

### 12.3 Select Folder Handler

```typescript
async function handleSelectWorkspaceFolder(): Promise<
  CommonMessage<AIWorkspaceView | null>
> {
  if (!isAIEnabled()) return denied("AI functionality is only available to subscribers.");

  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return ok(null);
  }

  const module = new AIWorkspaceModule();
  const workspace = await module.createOrReuseWorkspace({
    rootPath: result.filePaths[0],
  });
  return ok(workspace);
}
```

### 12.4 Bind Conversation Handler

Input:

```typescript
{
  conversationId: string;
  workspaceId: string;
}
```

Output:

```typescript
AIConversationWorkspaceView
```

Rules:

- `conversationId` must be a non-empty string.
- `workspaceId` must be a non-empty string.
- Binding is always `boundBy: "user"` for renderer-initiated calls.

## 13. Renderer API

Create `src/views/api/aiWorkspace.ts`.

```typescript
export async function listAIWorkspaces(): Promise<AIWorkspaceView[]> {
  const resp = await windowInvoke(AI_WORKSPACE_LIST);
  return (resp as AIWorkspaceView[] | null) ?? [];
}

export async function selectAIWorkspaceFolder(): Promise<AIWorkspaceView | null> {
  const resp = await windowInvoke(AI_WORKSPACE_SELECT_FOLDER);
  return (resp as AIWorkspaceView | null) ?? null;
}

export async function bindAIWorkspaceToConversation(
  conversationId: string,
  workspaceId: string
): Promise<AIConversationWorkspaceView | null> {
  const resp = await windowInvoke(AI_WORKSPACE_BIND_CONVERSATION, {
    conversationId,
    workspaceId,
  });
  return (resp as AIConversationWorkspaceView | null) ?? null;
}

export async function getConversationWorkspace(
  conversationId: string
): Promise<AIConversationWorkspaceView | null> {
  const resp = await windowInvoke(AI_WORKSPACE_GET_CONVERSATION, {
    conversationId,
  });
  return (resp as AIConversationWorkspaceView | null) ?? null;
}

export async function clearConversationWorkspace(
  conversationId: string
): Promise<{ cleared: boolean } | null> {
  const resp = await windowInvoke(AI_WORKSPACE_CLEAR_CONVERSATION, {
    conversationId,
  });
  return (resp as { cleared: boolean } | null) ?? null;
}
```

## 14. Renderer Components

### 14.1 AiChatV2 Integration

`AiChatV2.vue` should own:

- `activeWorkspace`
- workspace loading state
- workspace selection handler
- workspace clear/switch handler

Load workspace when:

- selecting a conversation.
- stream start creates a new conversation ID.
- binding workspace after folder selection.

Clear workspace state when:

- starting a new conversation.
- clearing messages.

### 14.2 New Components

Suggested components:

| Component | Responsibility |
| --- | --- |
| `AiChatV2WorkspaceBadge.vue` | Compact workspace state in the chat header or composer prepend |
| `AiChatV2WorkspaceCard.vue` | Action card shown when a tool returns `workspaceRequired` |
| `AiChatV2WorkspaceDialog.vue` | Recent workspace list, selected root path, clear/switch actions |

### 14.3 Workspace Badge Placement

Place the badge in the header action area near the context badge and model selector, or in the composer prepend next to mode/model controls.

Recommended first placement:

```vue
<AiChatV2WorkspaceBadge
  :workspace="activeWorkspace"
  :disabled="chatIsRunning"
  @choose="handleChooseWorkspace"
  @clear="handleClearWorkspace"
/>
```

The badge should be compact because AI Chat V2 is already dense.

### 14.4 Workspace Required Tool Result UI

When a tool result contains:

```typescript
toolResult.workspaceRequired === true
```

Render `AiChatV2WorkspaceCard` instead of a generic JSON tool result.

Actions:

- Choose Workspace.
- Cancel Tool / dismiss.

After choosing a workspace:

- Bind it to the current conversation.
- Send a continuation message like "Workspace selected. Please retry the file operation."

Do not automatically retry the original tool call in phase 1 unless there is already a safe pending-turn mechanism for this exact state.

## 15. Permission Card Changes

### 15.1 Current Card

`SkillApprovalCard.vue` currently shows:

- tool name.
- permission category.
- generic description.
- shell preview for shell tools.

### 15.2 Add Filesystem Preview

Add a filesystem preview shape:

```typescript
interface FilesystemPreview {
  workspaceName?: string;
  workspaceRoot?: string;
  relativePath?: string;
  operation?: "read" | "search" | "create" | "overwrite" | "edit";
}
```

Extend props:

```typescript
interface Props {
  toolName: string;
  permissionCategory?: string;
  shellPreview?: ShellPreview;
  filesystemPreview?: FilesystemPreview;
}
```

Display when `permissionCategory === "filesystem"`:

```text
Workspace: aiFetchly
Root: /Users/cengjianze/project/aiFetchly
Operation: Create file
Path: docs/campaign.md
```

### 15.3 Preview Source

For phase 1, renderer can derive preview from:

- active conversation workspace state.
- tool call arguments in the permission prompt message metadata.

If the prompt message does not include tool arguments, extend persisted permission prompt metadata to include safe preview fields.

Do not include file content in permission card metadata.

## 16. Skill Registry Updates

Update file tool descriptions in `src/config/skillsRegistry.ts`.

Current wording says "allowed workspace" but does not explain missing workspace behavior.

Target wording:

- "Paths are relative to the active workspace selected by the user."
- "Absolute paths are accepted only if they are inside the active workspace."
- "If no workspace is selected, ask the user to choose a workspace before retrying."

Example for `file_write`:

```typescript
description:
  "Create or overwrite a file inside the active workspace selected by the user. " +
  "Use workspace-relative paths such as 'docs/example.md'. Absolute paths are allowed only inside the active workspace. " +
  "If no workspace is selected, ask the user to choose one before retrying. User confirmation is required before any write."
```

## 17. Prompt Guidance

Add a short workspace section to the AI Chat V2 system prompt or tool guidance:

```text
File tools operate inside the user's active workspace. Prefer relative paths.
Do not request files outside the workspace. If a file tool reports that a workspace
is required, ask the user to select a workspace before retrying.
```

Candidate locations:

- `AIChatV2Module.getDefaultSystemPrompt()`
- `AIChatContextAssembler`
- a dedicated prompt section near tool registration

Keep it close to tool guidance so it is present whenever file tools are available.

## 18. Workspace Required Event Handling

### 18.1 No New Stream Event Needed In Phase 1

The existing `tool_result` event can carry `workspaceRequired: true` in `toolResult`.

Renderer logic in `AiChatV2.vue` currently calls `upsertToolResultMessage(...)` for tool results. Extend message rendering to inspect the metadata:

```typescript
message.metadata?.toolResult?.workspaceRequired === true
```

Then render the workspace card.

### 18.2 Optional Dedicated Event Later

If workspace interaction becomes a paused turn similar to permission prompts, add:

```typescript
type AIChatQueryWorkspaceRequiredEvent = {
  type: "workspace_required";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
};
```

Phase 1 should avoid this unless automatic retry/resume is required.

## 19. Security Design

### 19.1 Workspace Selection Trust Boundary

Only the user can select or bind a workspace. The model cannot grant workspace access by writing text or returning tool output.

Rules:

- Workspace selection happens through a renderer UI action.
- Renderer action calls IPC.
- Main process opens the folder picker or binds a known workspace.
- Model output cannot call `AI_WORKSPACE_BIND_CONVERSATION`.

### 19.2 Path Trust Boundary

Every tool path remains untrusted:

- tool arguments are model-generated.
- file contents may contain prompt injection.
- tool results may include untrusted text.

All paths must pass `FilePathGuard.validate()` immediately before filesystem operations.

### 19.3 Deny-List Still Applies Inside Workspace

Workspace access does not mean full access to every file inside the workspace.

Continue blocking:

- `.git/**`
- secrets and credential files.
- `.env` files.
- database files.
- SSH/GPG folders.

Consider adding:

- `**/.Trash/**`
- `**/Library/**` only if users may choose home-like folders.

### 19.4 UserData Root

Do not include Electron userData as an AI file tool root by default. Internal app operations may use userData, but AI file tools should only use user-selected workspace roots.

## 20. Error Handling

### 20.1 Error Codes

Prefer stable error codes in addition to human-readable messages.

Workspace resolver errors:

```typescript
type WorkspaceErrorCode =
  | "workspace_required"
  | "workspace_revoked"
  | "workspace_missing"
  | "workspace_not_directory";
```

Path guard errors:

```typescript
type PathErrorCode =
  | "invalid_path"
  | "outside_workspace"
  | "deny_list"
  | "realpath_failed";
```

### 20.2 User-Facing Messages

Map codes to i18n keys in the renderer:

| Code | English message |
| --- | --- |
| `workspace_required` | Select a workspace before using file tools. |
| `workspace_revoked` | Workspace access was revoked. Select a workspace to continue. |
| `workspace_missing` | The selected workspace folder no longer exists. |
| `outside_workspace` | This path is outside the active workspace. |
| `deny_list` | Access denied by security policy. |

## 21. Internationalization

Update all supported language files:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Suggested key group:

```typescript
aiWorkspace: {
  no_workspace: "No workspace",
  choose_workspace: "Choose Workspace",
  clear_workspace: "Clear Workspace",
  switch_workspace: "Switch Workspace",
  workspace_required: "Select a workspace before using file tools.",
  workspace_missing: "The selected workspace folder no longer exists.",
  workspace_revoked: "Workspace access was revoked.",
  active_workspace: "Workspace: {name}",
  workspace_root: "Root",
  target_path: "Path",
  operation: "Operation"
}
```

## 22. Test Plan

### 22.1 Unit Tests

Add `test/vitest/main/AIWorkspaceModule.test.ts`.

Cases:

- creates workspace from existing directory.
- reuses workspace for same real path.
- rejects missing path.
- rejects file path.
- binds conversation.
- replaces active binding when switching.
- clears conversation binding.
- marks missing workspace.

Add `test/vitest/main/FileToolWorkspaceResolver.test.ts`.

Cases:

- no conversation ID returns workspace required.
- no active binding returns workspace required.
- revoked workspace returns workspace required.
- missing root marks workspace missing.
- active root returns workspace view.

Update `test/vitest/main/FilePathGuard.test.ts`.

Cases:

- success result includes rootPath and relativePath.
- outside path includes `outside_workspace` code.
- deny-list includes `deny_list` code.

Update `test/vitest/main/FileToolService.test.ts`.

Cases:

- strict workspace mode requires roots.
- glob without cwd uses workspace root.
- grep without path uses workspace root.
- file_write returns relativePath metadata.
- file_edit returns relativePath metadata.
- fast-glob suppresses inaccessible child errors where feasible.

### 22.2 ToolExecutor Tests

Update or add `test/vitest/main/service/ToolExecutor.test.ts`.

Cases:

- `glob_files` with no workspace returns `workspaceRequired`.
- `file_write` with active workspace constructs workspace-scoped service.
- file operation record includes workspaceId and relativePath.
- global home-root file service is not used for chat file tools.

### 22.3 IPC Tests

Add `test/vitest/main/ai-workspace-ipc.test.ts` if existing IPC test patterns support Electron dialog mocking.

Cases:

- AI disabled returns denied response.
- list recent workspaces returns module data.
- bind validates conversationId and workspaceId.
- clear validates conversationId.

Folder picker can be tested by mocking `dialog.showOpenDialog`.

### 22.4 Renderer Tests Or Manual QA

Manual QA checklist:

- new chat shows no workspace badge.
- choose workspace binds to active conversation.
- switching conversation loads its workspace.
- workspace-required tool result renders workspace card.
- write permission card shows workspace root and target path.
- clearing workspace causes next file tool to return workspace required.

### 22.5 Regression Test For `.Trash`

Regression shape:

1. Create temp directory as workspace.
2. Create separate fake home directory with `.Trash`.
3. Bind conversation to temp workspace.
4. Call `glob_files` with `pattern: "**/*"`.
5. Assert search root is temp workspace, not fake home.

If direct assertion against `fast-glob` cwd is easier than creating an inaccessible folder, mock `fast-glob` and assert the `cwd` option.

## 23. Implementation Phases

### Phase 1: Persistence And Resolver

Files:

- `src/entityTypes/aiWorkspaceTypes.ts`
- `src/entity/AIWorkspace.entity.ts`
- `src/entity/AIConversationWorkspace.entity.ts`
- `src/model/AIWorkspace.model.ts`
- `src/model/AIConversationWorkspace.model.ts`
- `src/modules/AIWorkspaceModule.ts`
- `src/service/FileToolWorkspaceResolver.ts`

Tests:

- module tests.
- resolver tests.

Exit criteria:

- workspace can be created, bound, resolved, cleared.
- missing/revoked states are represented.

### Phase 2: Tool Execution Scoping

Files:

- `src/service/ToolExecutor.ts`
- `src/service/FileToolService.ts`
- `src/service/FilePathGuard.ts`
- `src/entityTypes/fileToolTypes.ts`
- `src/entityTypes/fileOperationTypes.ts`
- `src/config/fileToolConfig.ts`

Tests:

- file tool service tests.
- tool executor tests.
- `.Trash` regression.

Exit criteria:

- no workspace means no traversal.
- active workspace scopes all file tools.
- write/edit operation records include workspace metadata.

### Phase 3: IPC And Renderer API

Files:

- `src/config/channellist.ts`
- `src/main-process/communication/ai-workspace-ipc.ts`
- main-process registration file where communication handlers are installed.
- `src/views/api/aiWorkspace.ts`

Tests:

- IPC tests if practical.
- TypeScript compile.

Exit criteria:

- renderer can list/select/bind/clear workspace.
- AI enable checks are present.

### Phase 4: AI Chat V2 UI

Files:

- `src/views/components/aiChatV2/AiChatV2.vue`
- `src/views/components/aiChatV2/AiChatV2WorkspaceBadge.vue`
- `src/views/components/aiChatV2/AiChatV2WorkspaceCard.vue`
- `src/views/components/aiChatV2/AiChatV2WorkspaceDialog.vue`
- message rendering component that displays tool result cards.
- `src/views/components/aiChat/SkillApprovalCard.vue` or V2-specific permission card path.

Tests:

- manual QA.
- component tests if existing setup supports them.

Exit criteria:

- user can choose and see workspace.
- workspace-required result has a useful action.
- permission card has workspace context.

### Phase 5: Prompt And Tool Descriptions

Files:

- `src/config/skillsRegistry.ts`
- prompt builder/module that owns AI Chat V2 system prompt.
- language files.

Tests:

- registry prompt tests if applicable.
- i18n key presence checks if available.

Exit criteria:

- model receives clear workspace-relative path guidance.
- UI strings exist in all supported languages.

## 24. Rollback Strategy

Rollback should be easy because the change is additive until `ToolExecutor` starts requiring workspace.

Safe rollback levels:

1. Disable workspace-required behavior with a feature flag.
2. Keep UI and persistence, but allow explicit legacy roots for internal testing.
3. Revert `ToolExecutor` resolver integration if file tools are blocked incorrectly.

Do not delete workspace tables during rollback. They are harmless additive state.

## 25. Feature Flag

Add setting:

```typescript
USER_AI_WORKSPACE_REQUIRED = "user_ai_workspace_required"
```

Default:

- enabled for development.
- enabled for new installs.
- optional compatibility fallback during staged rollout.

Behavior when disabled:

- Workspace UI may still exist.
- ToolExecutor can use legacy behavior.
- Log a warning when AI file tools use legacy roots.

The flag should be temporary. The target product state is workspace-required always on.

## 26. Observability

Log structured main-process events:

- workspace created.
- workspace bound to conversation.
- workspace cleared.
- file tool blocked because workspace required.
- file tool rejected outside workspace.
- workspace missing on disk.

Do not log file contents.

For file paths:

- logs may include workspace-relative paths.
- avoid logging full absolute paths unless already present in trusted local logs and needed for debugging.

## 27. Performance Considerations

Workspace resolution adds database reads to file tool execution.

Mitigations:

- cache active conversation workspace in `FileToolWorkspaceResolver` with a small in-memory map.
- invalidate cache on bind/clear/revoke.
- cache `FileToolService` by `workspaceId:rootPath`.

Keep correctness first. A database lookup per file tool is acceptable for phase 1 because file tools are user-visible AI operations, not a hot render loop.

## 28. Compatibility Notes

### 28.1 Existing Tests

Existing tests that construct `new FileToolService([tmpDir])` should continue to pass.

### 28.2 Existing File Tool PRD

This design extends `docs/file-tools-prd/README.md`. It does not replace the original file tool behavior and safety model.

### 28.3 Existing Conversations

Existing conversations have no workspace. They continue to load normally. They need workspace selection only when a file tool is used.

### 28.4 Existing Permission Grants

Existing skill permission grants may say a user allowed `file_write`, but workspace approval is separate. A persistent file-write grant does not grant access to a workspace.

## 29. Open Implementation Questions

1. Should folder selection be available before a conversation ID exists?
   - Recommended: allow preselection in UI, then bind immediately after stream start creates the v2 conversation ID.

2. Should read-only file tools require the same confirmation as write tools?
   - Current registry marks all file tools as filesystem and confirmation-required. Keep current behavior for phase 1 unless product explicitly changes the trust model.

3. Should workspace root path be encrypted?
   - Not necessary for phase 1 unless existing local path metadata is encrypted elsewhere. Treat as local app metadata.

4. Should userData be a selectable workspace?
   - Do not suggest it. If user manually selects it through the folder picker, deny-list rules still apply, but product should steer away from internal app folders.

5. Should workspace state be shared with shell tools?
   - Later. Shell already has cwd guarding. This PRD targets AI file tools first.

## 30. Definition Of Done

- Technical implementation follows the three-layer database architecture.
- AI Chat V2 shows workspace state.
- File tools cannot run from AI chat without active workspace.
- Active workspace root is the only root passed to `FilePathGuard` for AI chat file tools.
- Tool results include workspace metadata.
- File operation records include workspace metadata.
- Permission cards show workspace context for mutating tools.
- `.Trash` EPERM reproduction is covered by regression test.
- TypeScript, targeted Vitest suites, and relevant manual QA pass.

