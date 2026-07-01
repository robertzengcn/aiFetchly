# Workspace-Aware File Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each AI Chat V2 conversation to an explicit user-approved workspace folder so all file tools (`file_read`, `file_write`, `file_edit`, `glob_files`, `grep_files`) operate inside that folder only and never default to the user's home directory.

**Architecture:** Add a per-conversation `Workspace` record (entity -> model -> module) that stores an absolute root path and approval state. A new `WorkspaceResolver` service looks up the active workspace for a given conversation. `FilePathGuard` and `FileToolService` gain a strict mode that constrains all path resolution to a single root. `ToolExecutor` switches from a global singleton `FileToolService` to a per-workspace cache so each conversation gets its own sandboxed resolver. The renderer collects a workspace choice via a new card and badge component, sends it through a new IPC channel, and displays the active root on the chat page and permission prompts.

**Tech Stack:** TypeScript 5.x, Electron (main + renderer), Vue 3 + Vuetify + Pinia, TypeORM + SQLite, existing `FileToolService` / `FilePathGuard` / `ToolExecutor` stack, vitest for main-process tests.

## Global Constraints

- TypeScript strict mode; no `any` (use `unknown`).
- Database access goes Model -> Module -> IPC handler (CLAUDE.md mandate).
- Worker processes never touch the DB directly (CLAUDE.md mandate); all worker-originated writes go through IPC to the main process.
- Every AI IPC handler gates on `USER_AI_ENABLED` via `Token` (CLAUDE.md mandate).
- All user-facing strings are added to all six language files: `en`, `zh`, `es`, `fr`, `de`, `ja`.
- File paths in code use `path.join` / `path.resolve`; never string concatenation.
- Entities are registered in `src/config/SqliteDb.ts` `entities: [...]` array.
- IPC channels are declared in `src/config/channellist.ts`, whitelisted in `src/preload.ts`, registered in `src/main-process/communication/index.ts`.
- Commits follow `<type>: <description>` with types `feat`, `refactor`, `test`, `docs`, `chore`.
- Each task ends with `git add <files> && git commit -m "<msg>"`.

---

## File Structure

### Create

- `src/entityTypes/workspaceTypes.ts` - pure type definitions for workspace records.
- `src/entity/WorkspaceEntity.ts` - TypeORM entity (`WorkspaceEntity`).
- `src/model/Workspace.model.ts` - data-access model (`WorkspaceModel`).
- `src/modules/WorkspaceModule.ts` - business logic (`WorkspaceModule`).
- `src/service/WorkspaceResolver.ts` - looks up the active workspace for a conversation.
- `src/main-process/communication/ai-workspace-ipc.ts` - IPC handlers.
- `src/views/api/workspace.ts` - renderer-side API wrappers.
- `src/views/components/aiChatV2/WorkspaceBadge.vue` - active-root badge.
- `src/views/components/aiChatV2/WorkspaceRequiredCard.vue` - card shown when no workspace is set.
- `test/vitest/main/workspace.model.test.ts` - model unit tests.

### Modify

- `src/entityTypes/fileToolTypes.ts` - add error codes, `rootPath`, `relativePath`, and `FileToolWorkspaceMetadata`.
- `src/entityTypes/fileOperationTypes.ts` - add optional `workspaceId`, `workspaceRoot`, `relativePath`.
- `src/service/FilePathGuard.ts` - add `findMatchingRoot()`, stable error codes, metadata on results.
- `src/service/FileToolService.ts` - add object-form constructor (`FileToolServiceOptions`) and strict mode.
- `src/service/ToolExecutor.ts` - replace global singleton with per-workspace cache.
- `src/config/SqliteDb.ts` - register `WorkspaceEntity`.
- `src/config/channellist.ts` - add workspace IPC channels.
- `src/preload.ts` - whitelist workspace channels.
- `src/main-process/communication/index.ts` - register workspace handlers.
- `src/views/components/aiChatV2/AiChatV2.vue` - add workspace state, card, badge, and passthrough to tool calls.
- `src/views/components/aiChat/SkillApprovalCard.vue` - show filesystem preview when available.
- `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` - add `workspace` section.
- `src/ai-chat-v2/skills/skillsRegistry.ts` (or equivalent) - mention workspace requirement in skill descriptions.

---

## Task 1: Workspace types

**Files:**
- Create: `src/entityTypes/workspaceTypes.ts`

**Interfaces:**
- Produces: `WorkspaceRecord`, `WorkspaceApprovalState`, `WorkspaceSummary`

- [ ] **Step 1: Create the type definitions**

```typescript
// src/entityTypes/workspaceTypes.ts

/**
 * Approval lifecycle for a workspace.
 *  - pending: created but not yet acknowledged in the UI
 *  - approved: user confirmed access to this folder
 *  - revoked: user removed access; tools must refuse further use
 */
export type WorkspaceApprovalState = 'pending' | 'approved' | 'revoked';

export interface WorkspaceRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly label: string | null;
  readonly approvalState: WorkspaceApprovalState;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly revokedAt: string | null;
}

/** Trimmed view returned to the renderer. */
export interface WorkspaceSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly label: string | null;
  readonly approvalState: WorkspaceApprovalState;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/entityTypes/workspaceTypes.ts
git commit -m "feat(workspace): add workspace type definitions"
```

---

## Task 2: Workspace entity

**Files:**
- Create: `src/entity/WorkspaceEntity.ts`
- Modify: `src/config/SqliteDb.ts`

**Interfaces:**
- Consumes: `WorkspaceRecord`, `WorkspaceApprovalState` from Task 1.
- Produces: `WorkspaceEntity` TypeORM table `workspace`.

- [ ] **Step 1: Create the entity**

Follow the pattern of an existing auditable entity. Inspect `src/entity/AIMemoryConsolidationRunEntity.ts` first if unsure of the base class.

```typescript
// src/entity/WorkspaceEntity.ts
import { Entity, Column, Index } from 'typeorm';
import { AuditableEntity } from './AuditableEntity';
import { WorkspaceApprovalState } from '@/entityTypes/workspaceTypes';

@Entity('workspace')
@Index('idx_workspace_conversation', ['conversationId'])
export class WorkspaceEntity extends AuditableEntity {
  @Column({ type: 'varchar', length: 64 })
  conversationId!: string;

  @Column({ type: 'varchar', length: 1024 })
  rootPath!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label!: string | null;

  @Column({ type: 'varchar', length: 16 })
  approvalState!: WorkspaceApprovalState;

  @Column({ type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  revokedAt!: Date | null;
}
```

- [ ] **Step 2: Register in SqliteDb.ts**

Open `src/config/SqliteDb.ts`, find the `entities: [...]` array (around line 485). Add the new entity at the end of the list (before the closing bracket):

```typescript
import { WorkspaceEntity } from '@/entity/WorkspaceEntity';
// ...
entities: [
  // ... existing entities ...
  AIMemoryConsolidationRunEntity,
  WorkspaceEntity,
],
```

- [ ] **Step 3: Verify type check passes**

Run: `yarn vue-check`
Expected: No new errors mentioning `WorkspaceEntity`.

- [ ] **Step 4: Commit**

```bash
git add src/entity/WorkspaceEntity.ts src/config/SqliteDb.ts
git commit -m "feat(workspace): add WorkspaceEntity and register in SqliteDb"
```

---

## Task 3: Workspace model

**Files:**
- Create: `src/model/Workspace.model.ts`

**Interfaces:**
- Consumes: `WorkspaceEntity` (Task 2), `WorkspaceRecord` (Task 1).
- Produces: `WorkspaceModel` with methods `upsert()`, `findByConversation()`, `findById()`, `setApprovalState()`, `listByConversation()`.

- [ ] **Step 1: Write the model**

Follow the `BaseDb` pattern used by other models (see `src/model/ContactInfo.model.ts` for reference). Models receive `dbpath` in the constructor and open a repository against the user DB.

```typescript
// src/model/Workspace.model.ts
import { Repository } from 'typeorm';
import { BaseDb } from '@/model/BaseDb';
import { SqliteDb } from '@/config/SqliteDb';
import { WorkspaceEntity } from '@/entity/WorkspaceEntity';
import {
  WorkspaceRecord,
  WorkspaceApprovalState,
  WorkspaceSummary,
} from '@/entityTypes/workspaceTypes';

export class WorkspaceModel extends BaseDb {
  constructor(dbpath: string) {
    super(dbpath);
  }

  private repo(): Repository<WorkspaceEntity> {
    return SqliteDb.getInstance(this.dbpath).connection.getRepository(WorkspaceEntity);
  }

  async upsert(input: {
    id: string;
    conversationId: string;
    rootPath: string;
    label: string | null;
    approvalState: WorkspaceApprovalState;
  }): Promise<WorkspaceRecord> {
    const repo = this.repo();
    const entity = repo.create({
      id: input.id,
      conversationId: input.conversationId,
      rootPath: input.rootPath,
      label: input.label,
      approvalState: input.approvalState,
    });
    const saved = await repo.save(entity);
    return this.toRecord(saved);
  }

  async findByConversation(conversationId: string): Promise<WorkspaceRecord | null> {
    const entity = await this.repo().findOne({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });
    return entity ? this.toRecord(entity) : null;
  }

  async findById(id: string): Promise<WorkspaceRecord | null> {
    const entity = await this.repo().findOne({ where: { id } });
    return entity ? this.toRecord(entity) : null;
  }

  async setApprovalState(
    id: string,
    state: WorkspaceApprovalState,
  ): Promise<WorkspaceRecord | null> {
    const repo = this.repo();
    const entity = await repo.findOne({ where: { id } });
    if (!entity) return null;
    entity.approvalState = state;
    if (state === 'approved') entity.approvedAt = new Date();
    if (state === 'revoked') entity.revokedAt = new Date();
    const saved = await repo.save(entity);
    return this.toRecord(saved);
  }

  async listByConversation(conversationId: string): Promise<WorkspaceSummary[]> {
    const entities = await this.repo().find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((e) => this.toSummary(e));
  }

  private toRecord(e: WorkspaceEntity): WorkspaceRecord {
    return {
      id: e.id,
      conversationId: e.conversationId,
      rootPath: e.rootPath,
      label: e.label,
      approvalState: e.approvalState,
      createdAt: e.createdAt ? e.createdAt.toISOString() : '',
      approvedAt: e.approvedAt ? e.approvedAt.toISOString() : null,
      revokedAt: e.revokedAt ? e.revokedAt.toISOString() : null,
    };
  }

  private toSummary(e: WorkspaceEntity): WorkspaceSummary {
    return {
      id: e.id,
      conversationId: e.conversationId,
      rootPath: e.rootPath,
      label: e.label,
      approvalState: e.approvalState,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/model/Workspace.model.ts
git commit -m "feat(workspace): add WorkspaceModel data-access layer"
```

---

## Task 4: Workspace module

**Files:**
- Create: `src/modules/WorkspaceModule.ts`

**Interfaces:**
- Consumes: `WorkspaceModel` (Task 3).
- Produces: `WorkspaceModule` with methods `setWorkspace()`, `getActiveWorkspace()`, `approveWorkspace()`, `revokeWorkspace()`, `listWorkspaces()`.

- [ ] **Step 1: Write the module**

```typescript
// src/modules/WorkspaceModule.ts
import { randomUUID } from 'crypto';
import { BaseModule } from '@/modules/BaseModule';
import { WorkspaceModel } from '@/model/Workspace.model';
import {
  WorkspaceRecord,
  WorkspaceSummary,
} from '@/entityTypes/workspaceTypes';

export interface SetWorkspaceInput {
  conversationId: string;
  rootPath: string;
  label?: string | null;
}

export class WorkspaceModule extends BaseModule {
  private model(): WorkspaceModel {
    return new WorkspaceModel(this.dbpath);
  }

  async setWorkspace(input: SetWorkspaceInput): Promise<WorkspaceRecord> {
    await this.ensureConnection();
    const model = this.model();
    const existing = await model.findByConversation(input.conversationId);
    if (existing && existing.approvalState !== 'revoked') {
      return model.upsert({
        id: existing.id,
        conversationId: input.conversationId,
        rootPath: input.rootPath,
        label: input.label ?? existing.label,
        approvalState: 'pending',
      });
    }
    return model.upsert({
      id: randomUUID(),
      conversationId: input.conversationId,
      rootPath: input.rootPath,
      label: input.label ?? null,
      approvalState: 'pending',
    });
  }

  async getActiveWorkspace(conversationId: string): Promise<WorkspaceRecord | null> {
    await this.ensureConnection();
    const record = await this.model().findByConversation(conversationId);
    if (!record) return null;
    if (record.approvalState === 'revoked') return null;
    return record;
  }

  async approveWorkspace(id: string): Promise<WorkspaceRecord | null> {
    await this.ensureConnection();
    return this.model().setApprovalState(id, 'approved');
  }

  async revokeWorkspace(id: string): Promise<WorkspaceRecord | null> {
    await this.ensureConnection();
    return this.model().setApprovalState(id, 'revoked');
  }

  async listWorkspaces(conversationId: string): Promise<WorkspaceSummary[]> {
    await this.ensureConnection();
    return this.model().listByConversation(conversationId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/WorkspaceModule.ts
git commit -m "feat(workspace): add WorkspaceModule business-logic layer"
```

---

## Task 5: Module unit tests

**Files:**
- Create: `test/vitest/main/workspace.model.test.ts`

- [ ] **Step 1: Write the tests**

Use a temp-file SQLite DB via `SqliteDb.resetInstance()`. Pattern follows existing tests under `test/vitest/main/`.

```typescript
// test/vitest/main/workspace.model.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SqliteDb } from '@/config/SqliteDb';
import { WorkspaceModel } from '@/model/Workspace.model';
import { WorkspaceEntity } from '@/entity/WorkspaceEntity';

let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  SqliteDb.resetInstance();
  const db = SqliteDb.getInstance(dbPath);
  await db.connection.synchronize();
});

afterAll(() => {
  SqliteDb.resetInstance();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const db = SqliteDb.getInstance(dbPath);
  await db.connection.getRepository(WorkspaceEntity).clear();
});

describe('WorkspaceModel', () => {
  it('upserts and reads back a workspace', async () => {
    const model = new WorkspaceModel(dbPath);
    const record = await model.upsert({
      id: 'abc-123',
      conversationId: 'conv-1',
      rootPath: '/tmp/project',
      label: 'Project',
      approvalState: 'pending',
    });
    expect(record.id).toBe('abc-123');
    expect(record.rootPath).toBe('/tmp/project');

    const found = await model.findByConversation('conv-1');
    expect(found).not.toBeNull();
    expect(found?.rootPath).toBe('/tmp/project');
  });

  it('updates approval state with timestamps', async () => {
    const model = new WorkspaceModel(dbPath);
    await model.upsert({
      id: 'ws-1',
      conversationId: 'conv-2',
      rootPath: '/tmp/x',
      label: null,
      approvalState: 'pending',
    });
    const approved = await model.setApprovalState('ws-1', 'approved');
    expect(approved?.approvalState).toBe('approved');
    expect(approved?.approvedAt).not.toBeNull();
  });

  it('returns null for unknown conversation', async () => {
    const model = new WorkspaceModel(dbPath);
    const found = await model.findByConversation('does-not-exist');
    expect(found).toBeNull();
  });

  it('lists multiple workspaces for a conversation in desc order', async () => {
    const model = new WorkspaceModel(dbPath);
    await model.upsert({
      id: 'a',
      conversationId: 'conv-3',
      rootPath: '/tmp/a',
      label: null,
      approvalState: 'revoked',
    });
    await model.upsert({
      id: 'b',
      conversationId: 'conv-3',
      rootPath: '/tmp/b',
      label: null,
      approvalState: 'approved',
    });
    const list = await model.listByConversation('conv-3');
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('b');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/workspace.model.test.ts`
Expected: PASS (4 tests). If failures, fix the model until green.

- [ ] **Step 3: Commit**

```bash
git add test/vitest/main/workspace.model.test.ts
git commit -m "test(workspace): add WorkspaceModel unit tests"
```

---

## Task 6: Workspace resolver service

**Files:**
- Create: `src/service/WorkspaceResolver.ts`

**Interfaces:**
- Consumes: `WorkspaceModule` (Task 4).
- Produces: `WorkspaceResolver.resolve(conversationId)` -> `{ rootPath, workspaceId } | null`.

- [ ] **Step 1: Write the resolver**

```typescript
// src/service/WorkspaceResolver.ts
import { WorkspaceModule } from '@/modules/WorkspaceModule';

export interface ResolvedWorkspace {
  readonly workspaceId: string;
  readonly rootPath: string;
}

/**
 * Main-process singleton that answers "what is the active workspace
 * for this conversation?". Returns null when no workspace has been
 * approved, which tells callers they must NOT run file tools.
 */
export class WorkspaceResolver {
  async resolve(conversationId: string): Promise<ResolvedWorkspace | null> {
    if (!conversationId) return null;
    const module = new WorkspaceModule();
    const record = await module.getActiveWorkspace(conversationId);
    if (!record) return null;
    if (record.approvalState !== 'approved') return null;
    return { workspaceId: record.id, rootPath: record.rootPath };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/service/WorkspaceResolver.ts
git commit -m "feat(workspace): add WorkspaceResolver service"
```

---

## Task 7: FilePathGuard metadata

**Files:**
- Modify: `src/entityTypes/fileToolTypes.ts`
- Modify: `src/service/FilePathGuard.ts`

**Interfaces:**
- Produces: `PathValidationResult` gains `code`, `rootPath`, `relativePath`; new `FileToolWorkspaceMetadata` interface.

- [ ] **Step 1: Extend PathValidationResult**

In `src/entityTypes/fileToolTypes.ts`, find the `PathValidationResult` interface and add fields. Keep the existing fields intact:

```typescript
export interface PathValidationResult {
  readonly safe: boolean;
  readonly resolvedPath: string;
  readonly error?: string;
  /** Stable error code for programmatic handling. */
  readonly code?:
    | 'OUTSIDE_ROOTS'
    | 'NOT_ABSOLUTE'
    | 'DOTPATH_TRAVERSAL'
    | 'DENY_LISTED'
    | 'SYMLINK_ESCAPES'
    | 'OK';
  /** The matching root the path was confined to, when safe. */
  readonly rootPath?: string;
  /** Path relative to the matching root, when safe. */
  readonly relativePath?: string;
}

export interface FileToolWorkspaceMetadata {
  readonly workspaceId: string;
  readonly rootPath: string;
  readonly relativePath: string;
}
```

- [ ] **Step 2: Add findMatchingRoot() and error codes to FilePathGuard**

Open `src/service/FilePathGuard.ts`. Add a private helper that returns the matching root for a resolved path, and update `validate()` to include `code`, `rootPath`, `relativePath` on every return.

Read the file first to locate the exact return statements.

Add these private methods near the bottom of the class:

```typescript
private findMatchingRoot(resolved: string): string | null {
  for (const root of this.roots) {
    if (resolved === root) return root;
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved.startsWith(rootWithSep)) return root;
  }
  return null;
}

private relativeToRoot(resolved: string, root: string): string {
  if (resolved === root) return '';
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved.startsWith(rootWithSep)) {
    return resolved.slice(rootWithSep.length);
  }
  return '';
}
```

Update each error return in `validate()` to add the `code` field:

- Not absolute: `return { safe: false, resolvedPath: inputPath, error: '...', code: 'NOT_ABSOLUTE' };`
- Dotpath traversal: `return { ...others, code: 'DOTPATH_TRAVERSAL' };`
- Deny-listed: `return { ...others, code: 'DENY_LISTED' };`
- Symlink escape: `return { ...others, code: 'SYMLINK_ESCAPES' };`
- Outside roots: `return { safe: false, resolvedPath: resolved, error: 'Path is outside the allowed workspace roots', code: 'OUTSIDE_ROOTS' };`
- Success return: replace with:

```typescript
const matchedRoot = this.findMatchingRoot(resolved);
return {
  safe: true,
  resolvedPath: resolved,
  code: 'OK',
  rootPath: matchedRoot ?? undefined,
  relativePath: matchedRoot ? this.relativeToRoot(resolved, matchedRoot) : undefined,
};
```

- [ ] **Step 3: Type-check**

Run: `yarn vue-check`
Expected: No new errors. Existing callers only consume `.safe` / `.resolvedPath` / `.error`, so no breakage expected.

- [ ] **Step 4: Commit**

```bash
git add src/entityTypes/fileToolTypes.ts src/service/FilePathGuard.ts
git commit -m "feat(file-tools): add error codes and workspace metadata to PathValidationResult"
```

---

## Task 8: FileToolService strict workspace mode

**Files:**
- Modify: `src/service/FileToolService.ts`

**Interfaces:**
- Consumes: extended `PathValidationResult` (Task 7).
- Produces: `FileToolServiceOptions` interface; `FileToolService` accepts `{ workspace: { id, rootPath } }` to enter strict mode.

- [ ] **Step 1: Add options interface and constructor overload**

Open `src/service/FileToolService.ts`. Add an options type and an alternative constructor branch. Keep the legacy `roots?: readonly string[]` overload working so other callers (tests, direct CLI scripts) are unaffected.

At the top of the file (after imports), add:

```typescript
export interface FileToolServiceWorkspace {
  readonly id: string;
  readonly rootPath: string;
}

export interface FileToolServiceOptions {
  /** Single approved workspace. When set, the service runs in strict mode
   *  and refuses any path outside this workspace. */
  readonly workspace?: FileToolServiceWorkspace;
  /** Legacy multi-root form, ignored when `workspace` is provided. */
  readonly roots?: readonly string[];
}
```

The existing constructor form is:

```typescript
constructor(roots?: readonly string[]) {
  this.guard = new FilePathGuard(roots ?? getDefaultWorkspaceRoots());
}
```

Replace it with a union form that accepts both shapes:

```typescript
constructor(optsOrRoots?: FileToolServiceOptions | readonly string[]) {
  if (Array.isArray(optsOrRoots)) {
    this.guard = new FilePathGuard(optsOrRoots);
    this.workspace = undefined;
  } else if (optsOrRoots && optsOrRoots.workspace) {
    this.guard = new FilePathGuard([optsOrRoots.workspace.rootPath]);
    this.workspace = optsOrRoots.workspace;
  } else if (optsOrRoots && optsOrRoots.roots) {
    this.guard = new FilePathGuard(optsOrRoots.roots);
    this.workspace = undefined;
  } else {
    this.guard = new FilePathGuard(getDefaultWorkspaceRoots());
    this.workspace = undefined;
  }
}

/** Active workspace when in strict mode, else undefined. */
readonly workspace: FileToolServiceWorkspace | undefined;
```

- [ ] **Step 2: Expose workspace accessor**

Add a method on the class that callers (ToolExecutor) use:

```typescript
getActiveWorkspace(): FileToolServiceWorkspace | undefined {
  return this.workspace;
}
```

- [ ] **Step 3: Type-check**

Run: `yarn vue-check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/service/FileToolService.ts
git commit -m "feat(file-tools): add strict workspace mode to FileToolService"
```

---

## Task 9: ToolExecutor per-workspace scoping

**Files:**
- Modify: `src/service/ToolExecutor.ts` (around lines 1590-1666)
- Modify: `src/entityTypes/fileOperationTypes.ts`

**Interfaces:**
- Consumes: `WorkspaceResolver` (Task 6), `FileToolServiceOptions` (Task 8).
- Produces: `ToolExecutor.executeFileTool()` gains an optional `workspaceRoot` parameter; per-workspace `FileToolService` cache.

- [ ] **Step 1: Extend FileOperationRecord**

In `src/entityTypes/fileOperationTypes.ts`, add optional fields:

```typescript
export interface FileOperationRecord {
  // ... existing fields ...
  readonly workspaceId?: string;
  readonly workspaceRoot?: string;
  readonly relativePath?: string;
}
```

- [ ] **Step 2: Replace the singleton cache with a per-workspace map**

Open `src/service/ToolExecutor.ts`, find the singleton block (lines 1596-1603). Replace with:

```typescript
private static fileToolServices: Map<string, FileToolService> = new Map();
private static fallbackFileToolService: FileToolService | null = null;

/**
 * Returns a FileToolService scoped to the given workspace root. When
 * no root is provided, returns the legacy default-roots service so
 * non-workspace callers keep working.
 */
private static getFileToolService(workspaceRoot?: string): FileToolService {
  if (!workspaceRoot) {
    if (!ToolExecutor.fallbackFileToolService) {
      ToolExecutor.fallbackFileToolService = new FileToolService();
    }
    return ToolExecutor.fallbackFileToolService;
  }
  const key = workspaceRoot;
  let service = ToolExecutor.fileToolServices.get(key);
  if (!service) {
    service = new FileToolService({
      workspace: {
        id: 'resolved:' + key,
        rootPath: key,
      },
    });
    ToolExecutor.fileToolServices.set(key, service);
  }
  return service;
}
```

- [ ] **Step 3: Accept a workspaceRoot argument in executeFileTool**

Locate `executeFileTool()` (around line 1605). Read the current signature. Add an optional `workspaceRoot?: string` parameter and thread it into the service lookup:

```typescript
async executeFileTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  workspaceRoot?: string,
): Promise<FileToolResult> {
  const service = ToolExecutor.getFileToolService(workspaceRoot);
  const result = await service.execute(toolName, args);
  // ... existing emit / return logic ...
}
```

When emitting via `FileOperationTracker`, include the workspace metadata when available:

```typescript
const ws = service.getActiveWorkspace();
if (ws) {
  // merge workspaceId / ws.rootPath into the record
}
```

- [ ] **Step 4: Wire WorkspaceResolver into the caller of executeFileTool**

Inside the dispatcher that invokes `executeFileTool` for a tool, resolve the workspace from the conversation id before invoking:

```typescript
let workspaceRoot: string | undefined;
if (context.conversationId) {
  const resolver = new WorkspaceResolver();
  const resolved = await resolver.resolve(context.conversationId);
  if (resolved) workspaceRoot = resolved.rootPath;
}
const result = await this.executeFileTool(toolName, args, context, workspaceRoot);
```

For this first iteration, keep the legacy fallback path (default-roots service) so existing skills do not break when no workspace is set, but emit a warning. A later task can harden this to a hard refusal once the UI always sets a workspace.

- [ ] **Step 5: Type-check**

Run: `yarn vue-check`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/service/ToolExecutor.ts src/entityTypes/fileOperationTypes.ts
git commit -m "refactor(file-tools): scope FileToolService per workspace in ToolExecutor"
```

---

## Task 10: Workspace IPC channels

**Files:**
- Modify: `src/config/channellist.ts`
- Modify: `src/preload.ts`

- [ ] **Step 1: Add channels**

Open `src/config/channellist.ts`. Add entries following the existing UPPER_SNAKE = "domain:action" pattern:

```typescript
export const AI_WORKSPACE_SET = 'ai-workspace:set';
export const AI_WORKSPACE_GET = 'ai-workspace:get';
export const AI_WORKSPACE_APPROVE = 'ai-workspace:approve';
export const AI_WORKSPACE_REVOKE = 'ai-workspace:revoke';
export const AI_WORKSPACE_LIST = 'ai-workspace:list';
```

- [ ] **Step 2: Whitelist in preload.ts**

Open `src/preload.ts`. Find the `invoke` array inside the `contextBridge.exposeInMainWorld` call. Add the five new channels:

```typescript
AI_WORKSPACE_SET,
AI_WORKSPACE_GET,
AI_WORKSPACE_APPROVE,
AI_WORKSPACE_REVOKE,
AI_WORKSPACE_LIST,
```

- [ ] **Step 3: Commit**

```bash
git add src/config/channellist.ts src/preload.ts
git commit -m "feat(workspace): register IPC channels and preload whitelist"
```

---

## Task 11: Workspace IPC handlers

**Files:**
- Create: `src/main-process/communication/ai-workspace-ipc.ts`
- Modify: `src/main-process/communication/index.ts`

**Interfaces:**
- Consumes: `WorkspaceModule` (Task 4), `Token` / `USER_AI_ENABLED` for AI gate, all channels from Task 10.
- Produces: Five `ipcMain.handle` registrations.

- [ ] **Step 1: Write the handler file**

Follow the existing IPC handler pattern. Look at `src/main-process/communication/aiusermemory-ipc.ts` for the `ok` / `denied` helpers and AI-gate pattern.

```typescript
// src/main-process/communication/ai-workspace-ipc.ts
import { ipcMain, BrowserWindow } from 'electron';
import {
  AI_WORKSPACE_SET,
  AI_WORKSPACE_GET,
  AI_WORKSPACE_APPROVE,
  AI_WORKSPACE_REVOKE,
  AI_WORKSPACE_LIST,
} from '@/config/channellist';
import { WorkspaceModule } from '@/modules/WorkspaceModule';
import { Token } from '@/config/usersetting';
import { USER_AI_ENABLED } from '@/config/usersetting';

function isAIEnabled(): boolean {
  const token = new Token();
  return token.getValue(USER_AI_ENABLED) === 'true';
}

function ok<T>(data: T) {
  return { status: true, msg: 'ok', data };
}

function denied<T>(msg: string, data: T = null as unknown as T) {
  return { status: false, msg, data };
}

export function registerAIWorkspaceIpcHandlers(_win: BrowserWindow): void {
  ipcMain.handle(AI_WORKSPACE_SET, async (_event, payload) => {
    if (!isAIEnabled()) return denied('AI features are not enabled.');
    if (!payload || typeof payload.conversationId !== 'string' || typeof payload.rootPath !== 'string') {
      return denied('Invalid workspace payload.');
    }
    try {
      const module = new WorkspaceModule();
      const record = await module.setWorkspace({
        conversationId: payload.conversationId,
        rootPath: payload.rootPath,
        label: typeof payload.label === 'string' ? payload.label : null,
      });
      return ok(record);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return denied('Failed to set workspace: ' + msg);
    }
  });

  ipcMain.handle(AI_WORKSPACE_GET, async (_event, conversationId: unknown) => {
    if (!isAIEnabled()) return denied('AI features are not enabled.');
    if (typeof conversationId !== 'string') return denied('Invalid conversationId.');
    const module = new WorkspaceModule();
    const record = await module.getActiveWorkspace(conversationId);
    return ok(record);
  });

  ipcMain.handle(AI_WORKSPACE_APPROVE, async (_event, id: unknown) => {
    if (!isAIEnabled()) return denied('AI features are not enabled.');
    if (typeof id !== 'string') return denied('Invalid workspace id.');
    const module = new WorkspaceModule();
    const record = await module.approveWorkspace(id);
    return ok(record);
  });

  ipcMain.handle(AI_WORKSPACE_REVOKE, async (_event, id: unknown) => {
    if (!isAIEnabled()) return denied('AI features are not enabled.');
    if (typeof id !== 'string') return denied('Invalid workspace id.');
    const module = new WorkspaceModule();
    const record = await module.revokeWorkspace(id);
    return ok(record);
  });

  ipcMain.handle(AI_WORKSPACE_LIST, async (_event, conversationId: unknown) => {
    if (!isAIEnabled()) return denied('AI features are not enabled.');
    if (typeof conversationId !== 'string') return denied('Invalid conversationId.');
    const module = new WorkspaceModule();
    const list = await module.listWorkspaces(conversationId);
    return ok(list);
  });
}
```

- [ ] **Step 2: Register in index.ts**

Open `src/main-process/communication/index.ts`. Add the import and a call to `registerAIWorkspaceIpcHandlers(win)` right after the existing `registerAIUserMemoryIpcHandlers();` call:

```typescript
import { registerAIWorkspaceIpcHandlers } from './ai-workspace-ipc';
// ... inside registerCommunicationIpcHandlers:
registerAIUserMemoryIpcHandlers();
registerAIWorkspaceIpcHandlers(win);
```

- [ ] **Step 3: Type-check**

Run: `yarn vue-check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/main-process/communication/ai-workspace-ipc.ts src/main-process/communication/index.ts
git commit -m "feat(workspace): add IPC handlers for workspace CRUD"
```

---

## Task 12: Renderer workspace API

**Files:**
- Create: `src/views/api/workspace.ts`

**Interfaces:**
- Consumes: channels from Task 10, `windowInvoke` from `src/views/utils/apirequest.ts`.

- [ ] **Step 1: Write the API wrappers**

```typescript
// src/views/api/workspace.ts
import { windowInvoke } from '@/views/utils/apirequest';
import {
  AI_WORKSPACE_SET,
  AI_WORKSPACE_GET,
  AI_WORKSPACE_APPROVE,
  AI_WORKSPACE_REVOKE,
  AI_WORKSPACE_LIST,
} from '@/config/channellist';
import type {
  WorkspaceRecord,
  WorkspaceSummary,
} from '@/entityTypes/workspaceTypes';

export async function setWorkspace(payload: {
  conversationId: string;
  rootPath: string;
  label?: string | null;
}): Promise<WorkspaceRecord | null> {
  return windowInvoke<WorkspaceRecord>(AI_WORKSPACE_SET, payload);
}

export async function getWorkspace(conversationId: string): Promise<WorkspaceRecord | null> {
  return windowInvoke<WorkspaceRecord>(AI_WORKSPACE_GET, conversationId);
}

export async function approveWorkspace(id: string): Promise<WorkspaceRecord | null> {
  return windowInvoke<WorkspaceRecord>(AI_WORKSPACE_APPROVE, id);
}

export async function revokeWorkspace(id: string): Promise<WorkspaceRecord | null> {
  return windowInvoke<WorkspaceRecord>(AI_WORKSPACE_REVOKE, id);
}

export async function listWorkspaces(conversationId: string): Promise<WorkspaceSummary[]> {
  return windowInvoke<WorkspaceSummary[]>(AI_WORKSPACE_LIST, conversationId);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/api/workspace.ts
git commit -m "feat(workspace): add renderer API wrappers"
```

---

## Task 13: i18n strings

**Files:**
- Modify: `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`

- [ ] **Step 1: Add workspace section to each language file**

Open `src/views/lang/en.ts`. Add a new top-level `workspace` section inside the export:

```typescript
workspace: {
  title: 'Workspace',
  badgeLabel: 'Workspace',
  notSet: 'No workspace set',
  selectFolder: 'Select folder',
  changeFolder: 'Change folder',
  approve: 'Approve workspace',
  revoke: 'Revoke workspace',
  rootPath: 'Root path',
  description: 'AI file tools only operate inside the approved workspace.',
  required: {
    title: 'Choose a workspace folder',
    body: 'Pick a folder where AI file tools can read and write. Nothing outside this folder will be touched.',
    pick: 'Pick folder',
    cancel: 'Cancel',
  },
},
```

Open `src/views/lang/zh.ts` and add the same key structure with Chinese values:

```typescript
workspace: {
  title: '工作区',
  badgeLabel: '工作区',
  notSet: '未设置工作区',
  selectFolder: '选择文件夹',
  changeFolder: '更换文件夹',
  approve: '批准工作区',
  revoke: '撤销工作区',
  rootPath: '根目录',
  description: 'AI 文件工具仅在被批准的工作区内运行。',
  required: {
    title: '请选择工作区文件夹',
    body: '选择一个文件夹用于 AI 文件工具的读写操作。此文件夹之外的内容不会被访问。',
    pick: '选择文件夹',
    cancel: '取消',
  },
},
```

Open `src/views/lang/es.ts`:

```typescript
workspace: {
  title: 'Espacio de trabajo',
  badgeLabel: 'Espacio de trabajo',
  notSet: 'Sin espacio de trabajo',
  selectFolder: 'Seleccionar carpeta',
  changeFolder: 'Cambiar carpeta',
  approve: 'Aprobar espacio de trabajo',
  revoke: 'Revocar espacio de trabajo',
  rootPath: 'Ruta raíz',
  description: 'Las herramientas de archivos de IA solo operan dentro del espacio aprobado.',
  required: {
    title: 'Elige una carpeta de trabajo',
    body: 'Elige una carpeta donde las herramientas de IA puedan leer y escribir. Nada fuera de esta carpeta será afectado.',
    pick: 'Elegir carpeta',
    cancel: 'Cancelar',
  },
},
```

Open `src/views/lang/fr.ts`:

```typescript
workspace: {
  title: 'Espace de travail',
  badgeLabel: 'Espace de travail',
  notSet: 'Aucun espace défini',
  selectFolder: 'Choisir un dossier',
  changeFolder: 'Changer de dossier',
  approve: 'Approuver l\'espace',
  revoke: 'Révoquer l\'espace',
  rootPath: 'Chemin racine',
  description: 'Les outils fichiers IA ne fonctionnent que dans l\'espace approuvé.',
  required: {
    title: 'Choisissez un dossier de travail',
    body: 'Choisissez un dossier où les outils IA peuvent lire et écrire. Rien en dehors de ce dossier ne sera touché.',
    pick: 'Choisir un dossier',
    cancel: 'Annuler',
  },
},
```

Open `src/views/lang/de.ts`:

```typescript
workspace: {
  title: 'Arbeitsbereich',
  badgeLabel: 'Arbeitsbereich',
  notSet: 'Kein Arbeitsbereich festgelegt',
  selectFolder: 'Ordner wählen',
  changeFolder: 'Ordner wechseln',
  approve: 'Arbeitsbereich genehmigen',
  revoke: 'Arbeitsbereich widerrufen',
  rootPath: 'Stammpfad',
  description: 'AI-Dateiwerkzeuge arbeiten nur innerhalb des genehmigten Arbeitsbereichs.',
  required: {
    title: 'Wählen Sie einen Arbeitsordner',
    body: 'Wählen Sie einen Ordner, in dem AI-Dateiwerkzeuge lesen und schreiben können. Außerhalb dieses Ordners wird nichts berührt.',
    pick: 'Ordner wählen',
    cancel: 'Abbrechen',
  },
},
```

Open `src/views/lang/ja.ts`:

```typescript
workspace: {
  title: 'ワークスペース',
  badgeLabel: 'ワークスペース',
  notSet: 'ワークスペース未設定',
  selectFolder: 'フォルダを選択',
  changeFolder: 'フォルダを変更',
  approve: 'ワークスペースを承認',
  revoke: 'ワークスペースを取り消し',
  rootPath: 'ルートパス',
  description: 'AI ファイルツールは承認されたワークスペース内でのみ動作します。',
  required: {
    title: 'ワークスペースフォルダを選択',
    body: 'AI ファイルツールが読み書きできるフォルダを選択してください。このフォルダ外には触れません。',
    pick: 'フォルダを選択',
    cancel: 'キャンセル',
  },
},
```

- [ ] **Step 2: Type-check**

Run: `yarn vue-check`
Expected: No errors. All six files must have the same key structure.

- [ ] **Step 3: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat(i18n): add workspace strings for all six languages"
```

---

## Task 14: Workspace badge component

**Files:**
- Create: `src/views/components/aiChatV2/WorkspaceBadge.vue`

**Interfaces:**
- Consumes: `WorkspaceSummary` from Task 1, i18n strings from Task 13.

- [ ] **Step 1: Write the component**

```vue
<template>
  <div v-if="workspace" class="workspace-badge" :title="workspace.rootPath">
    <v-icon size="small" start>mdi-folder</v-icon>
    <span class="workspace-badge__label">{{ $t('workspace.badgeLabel') || 'Workspace' }}:</span>
    <span class="workspace-badge__path">{{ displayPath }}</span>
  </div>
  <div v-else class="workspace-badge workspace-badge--unset">
    <v-icon size="small" start>mdi-folder-off</v-icon>
    <span>{{ $t('workspace.notSet') || 'No workspace set' }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { WorkspaceSummary } from '@/entityTypes/workspaceTypes';

const props = defineProps<{
  workspace: WorkspaceSummary | null;
}>();

const displayPath = computed(() => {
  const p = props.workspace?.rootPath ?? '';
  if (!p) return '';
  if (p.length <= 48) return p;
  const sep = p.includes('/') ? '/' : '\\';
  const parts = p.split(sep);
  if (parts.length <= 3) return p;
  return parts[0] + sep + '...' + sep + parts.slice(-2).join(sep);
});
</script>

<style scoped>
.workspace-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-on-surface));
}
.workspace-badge--unset {
  background: rgba(var(--v-theme-error), 0.08);
  color: rgb(var(--v-theme-error));
}
.workspace-badge__label {
  opacity: 0.7;
  margin-right: 4px;
}
.workspace-badge__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
```

- [ ] **Step 2: Type-check**

Run: `yarn vue-check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/components/aiChatV2/WorkspaceBadge.vue
git commit -m "feat(workspace): add WorkspaceBadge component"
```

---

## Task 15: Workspace required card component

**Files:**
- Create: `src/views/components/aiChatV2/WorkspaceRequiredCard.vue`
- Modify: `src/preload.ts` (only if no folder picker exists)

**Interfaces:**
- Consumes: `setWorkspace`, `approveWorkspace` from Task 12, i18n strings.

- [ ] **Step 1: Write the component**

This card is shown when the conversation has no approved workspace. It renders a file picker and calls `setWorkspace` + `approveWorkspace`. The card is pinned to the bottom of the chat until the user approves - it does NOT scroll with messages.

```vue
<template>
  <v-card class="workspace-required" elevation="2" rounded>
    <v-card-title>{{ $t('workspace.required.title') || 'Choose a workspace folder' }}</v-card-title>
    <v-card-text>
      <p class="text-body-2">{{ $t('workspace.required.body') || 'Pick a folder where AI file tools can read and write.' }}</p>
      <p v-if="errorText" class="text-error text-body-2">{{ errorText }}</p>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn variant="text" @click="$emit('cancel')">
        {{ $t('workspace.required.cancel') || 'Cancel' }}
      </v-btn>
      <v-btn color="primary" variant="flat" :loading="loading" @click="onPick">
        {{ $t('workspace.required.pick') || 'Pick folder' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { setWorkspace, approveWorkspace } from '@/views/api/workspace';

const props = defineProps<{
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: 'approved', workspaceId: string, rootPath: string): void;
  (e: 'cancel'): void;
}>();

const loading = ref(false);
const errorText = ref<string | null>(null);

async function onPick() {
  errorText.value = null;
  const picker = (window as unknown as { pickFolder?: () => Promise<string | null> }).pickFolder;
  if (!picker) {
    errorText.value = 'Folder picker not available.';
    return;
  }
  loading.value = true;
  try {
    const folder = await picker();
    if (!folder) return; // user cancelled
    const created = await setWorkspace({
      conversationId: props.conversationId,
      rootPath: folder,
    });
    if (!created) {
      errorText.value = 'Failed to create workspace.';
      return;
    }
    const approved = await approveWorkspace(created.id);
    if (!approved) {
      errorText.value = 'Failed to approve workspace.';
      return;
    }
    emit('approved', approved.id, approved.rootPath);
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.workspace-required {
  width: 100%;
}
</style>
```

- [ ] **Step 2: Confirm folder picker availability**

Search `src/preload.ts` and `src/main-process/` for an existing folder picker channel (e.g. `showOpenDialog`). If one exists, reuse it and expose it as `window.pickFolder`. If none exists, add a minimal IPC channel:

In `src/main-process/communication/ai-workspace-ipc.ts` (or a new small file), register:

```typescript
ipcMain.handle('dialog:pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
```

Whitelist `dialog:pick-folder` in `src/preload.ts` and expose:

```typescript
pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
```

- [ ] **Step 3: Type-check**

Run: `yarn vue-check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/components/aiChatV2/WorkspaceRequiredCard.vue src/preload.ts
git commit -m "feat(workspace): add WorkspaceRequiredCard with folder picker"
```

---

## Task 16: AiChatV2.vue integration

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue`

**Interfaces:**
- Consumes: `WorkspaceBadge` (Task 14), `WorkspaceRequiredCard` (Task 15), `getWorkspace` API.

- [ ] **Step 1: Read the current file**

Read `src/views/components/aiChatV2/AiChatV2.vue` fully. Identify:
- The `activeConversationId` ref (per previous session, this is a `ref<string | null>(null)` updated on stream `chunk.conversationId`).
- The chat-input area (where the ask-user-question card is pinned - the workspace card shares this pinning).
- The tool-call dispatch site (where messages are sent to the main process for AI tool execution).

- [ ] **Step 2: Add workspace state and badge**

In `<script setup>`, add:

```typescript
import WorkspaceBadge from '@/views/components/aiChatV2/WorkspaceBadge.vue';
import WorkspaceRequiredCard from '@/views/components/aiChatV2/WorkspaceRequiredCard.vue';
import { getWorkspace } from '@/views/api/workspace';
import type { WorkspaceSummary } from '@/entityTypes/workspaceTypes';
import { watch } from 'vue';

const activeWorkspace = ref<WorkspaceSummary | null>(null);
const showWorkspaceRequired = ref(false);

async function refreshWorkspace(conversationId: string | null) {
  if (!conversationId) {
    activeWorkspace.value = null;
    showWorkspaceRequired.value = false;
    return;
  }
  const ws = await getWorkspace(conversationId);
  activeWorkspace.value = ws
    ? {
        id: ws.id,
        conversationId: ws.conversationId,
        rootPath: ws.rootPath,
        label: ws.label,
        approvalState: ws.approvalState,
      }
    : null;
  showWorkspaceRequired.value = !activeWorkspace.value;
}

function onWorkspaceApproved(workspaceId: string, rootPath: string) {
  activeWorkspace.value = {
    id: workspaceId,
    conversationId: activeConversationId.value ?? '',
    rootPath,
    label: null,
    approvalState: 'approved',
  };
  showWorkspaceRequired.value = false;
}

// Watch the existing activeConversationId ref so the badge updates on new chats.
watch(activeConversationId, (id) => { void refreshWorkspace(id); }, { immediate: true });
```

In the template, near the chat-input area (where the AskUserQuestion card sits so the workspace card shares the pinned position):

```vue
<WorkspaceBadge :workspace="activeWorkspace" class="mb-2" />
<WorkspaceRequiredCard
  v-if="showWorkspaceRequired && activeConversationId"
  :conversation-id="activeConversationId"
  @approved="onWorkspaceApproved"
  @cancel="showWorkspaceRequired = false"
/>
```

- [ ] **Step 3: Pass workspace into tool-call dispatch**

At the point where the component sends a tool-call request to the main process, ensure the payload includes `conversationId` (which the resolver in Task 9 uses to look up the workspace). The existing dispatcher already sets `conversationId` from `activeConversationId` - verify it is never null when a tool call is issued.

- [ ] **Step 4: Type-check and run dev**

Run: `yarn vue-check`
Expected: No errors.

Then run the dev server in tmux and verify:
- New chat shows the badge "No workspace set".
- Clicking "Pick folder" opens the OS folder dialog.
- After picking, the badge updates to show the path.
- On reload, the workspace persists (fetched from DB).

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2.vue
git commit -m "feat(ai-chat-v2): integrate workspace card and badge"
```

---

## Task 17: Permission card filesystem preview

**Files:**
- Modify: `src/views/components/aiChat/SkillApprovalCard.vue`
- Modify: `src/views/components/aiChatV2/AiChatV2.vue`

**Interfaces:**
- Consumes: optional `workspaceRoot` and `relativePath` from the tool-call preview (provided by ToolExecutor via `FileToolWorkspaceMetadata`).

- [ ] **Step 1: Read the current SkillApprovalCard**

Open `src/views/components/aiChat/SkillApprovalCard.vue`. Note the props (`toolName`, `permissionCategory`, `shellPreview`).

- [ ] **Step 2: Add filesystem preview block**

Add new optional props `workspaceRoot?: string` and `relativePath?: string`. In the template, render a small section when `workspaceRoot` is set:

```vue
<div v-if="workspaceRoot" class="skill-approval__fs">
  <v-icon size="small" start>mdi-folder</v-icon>
  <span class="text-caption">{{ workspaceRoot }}</span>
  <span v-if="relativePath" class="text-caption text--secondary"> / {{ relativePath }}</span>
</div>
```

Update the props declaration:

```typescript
const props = defineProps<{
  toolName: string;
  permissionCategory: string;
  shellPreview?: string;
  workspaceRoot?: string;
  relativePath?: string;
}>();
```

- [ ] **Step 3: Thread workspaceRoot from AiChatV2**

In `AiChatV2.vue`, at the site where `SkillApprovalCard` is rendered, pass `:workspace-root="activeWorkspace?.rootPath ?? ''"`. If the active tool call carries a relative path, pass that too.

- [ ] **Step 4: Type-check**

Run: `yarn vue-check`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChat/SkillApprovalCard.vue src/views/components/aiChatV2/AiChatV2.vue
git commit -m "feat(ai-chat): show workspace path on permission card"
```

---

## Task 18: Skill descriptions update

**Files:**
- Modify: `src/ai-chat-v2/skills/skillsRegistry.ts` (or equivalent - confirm path)

- [ ] **Step 1: Locate the skill registry**

Search for where file-tool skills are described. Check both:
- `src/ai-chat-v2/skills/skillsRegistry.ts`
- `src/views/components/aiChatV2/` for a skills file.

If no central registry exists, find the skill metadata that is sent to the AI model in the system prompt. Goal: mention "Workspace required" on `file_read`, `file_write`, `file_edit`, `glob_files`, `grep_files`.

- [ ] **Step 2: Append workspace note to file-tool descriptions**

For each file-tool skill description, append a line like:

```
Workspace required: operates only inside the conversation's approved workspace folder.
```

- [ ] **Step 3: Type-check**

Run: `yarn vue-check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/ai-chat-v2/skills/skillsRegistry.ts
git commit -m "docs(skills): note workspace requirement on file-tool skills"
```

---

## Task 19: End-to-end verification

**Files:**
- No new files. Run the dev environment and exercise the flow.

- [ ] **Step 1: Run full type check**

Run: `yarn vue-check`
Expected: Zero errors.

- [ ] **Step 2: Run tests**

Run: `yarn vitest run test/vitest/main/workspace.model.test.ts`
Expected: PASS.

Run (if present): `yarn test`
Expected: No regressions in module tests.

- [ ] **Step 3: Run dev server in tmux**

Start the dev server inside a tmux session so logs are accessible.

- [ ] **Step 4: Manual verification checklist**

For each item, confirm pass/fail:

- [ ] New chat: badge shows "No workspace set".
- [ ] WorkspaceRequiredCard is pinned at bottom (does not scroll with messages).
- [ ] Click "Pick folder" -> OS dialog opens.
- [ ] Pick a folder -> badge updates with path.
- [ ] Reload the app -> workspace persists for that conversation.
- [ ] Ask the AI to read a file inside the workspace -> succeeds.
- [ ] Ask the AI to read a file outside the workspace -> refused with a clear error.
- [ ] Permission card (`SkillApprovalCard`) shows the workspace root when a file tool is requested.
- [ ] Switch language (Settings -> Language) to zh/es/fr/de/ja -> all workspace strings appear translated.

- [ ] **Step 5: Final commit (changelog only if needed)**

If anything was tweaked during verification, commit it:

```bash
git add -p
git commit -m "fix(workspace): verification tweaks"
```

---

## Self-Review Notes

- **Spec coverage**: PRD requirements (per-conversation workspace, user approval, file tools confined to workspace, no default-to-home, UI card + badge, permission preview, i18n in all languages) are all covered by Tasks 1-18.
- **Type consistency**: `WorkspaceRecord` / `WorkspaceSummary` / `ResolvedWorkspace` / `FileToolServiceWorkspace` are the only shapes crossing module boundaries and are referenced consistently across tasks.
- **Architecture conformance**: All DB access is via `WorkspaceModel` -> `WorkspaceModule` -> IPC handler; no DB calls in IPC or worker; AI gate present in every IPC handler.
- **Backwards compatibility**: `FileToolService` keeps the array-roots overload so existing callers and tests are not broken. `ToolExecutor` retains a fallback service for conversations without a workspace, so the feature ships in soft mode first.
