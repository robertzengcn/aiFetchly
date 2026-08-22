# Portable Workspace Memory - Product Requirements Document

| Field                | Value                                                    |
| -------------------- | -------------------------------------------------------- |
| Document version     | v1.0                                                     |
| Created              | 2026-08-22                                               |
| Status               | Draft                                                    |
| Owner                | AiFetchly AI Chat                                        |
| Target release       | To be planned                                            |
| Parent feature       | Workspace Memory                                         |
| Related PRD          | `docs/prd/workspace-memory-prd.md`                       |
| Technical design     | `docs/prd/portable-workspace-memory-technical-design.md` |
| Base memory design   | `docs/prd/workspace-memory-technical-design.md`          |
| Related platform PRD | `docs/prd/aifetchly-local-extensibility-prd.md`          |

## 1. Executive Summary

AiFetchly currently stores durable workspace memory in the local user SQLite database. The implementation correctly isolates memories by a main-process-resolved workspace key and supports retrieval, manual management, context injection, source attribution, and automatic consolidation. However, the database is private to the AiFetchly application instance. Other agents working in the same repository, such as Claude Code and Codex, cannot discover or update that memory through normal workspace files.

This feature adds **portable workspace memory** under `<workspace>/.aifetchly/memory/`. Portable memory is represented as bounded, validated Markdown files with structured YAML frontmatter. The files become the portable source of truth for shareable workspace knowledge. SQLite remains the local projection used for fast listing, prompt retrieval, usage tracking, embeddings, consolidation state, and diagnostics.

The feature is intentionally additive:

- Existing SQLite-only workspace memory continues to work during migration.
- Existing workspace isolation and approval rules remain in force.
- The application does not move or expose internal database files.
- AiFetchly writes memory files only inside an approved workspace.
- External agents can read the files without an AiFetchly-specific API.
- External agents can propose or make file edits that AiFetchly imports after validation.
- Users decide whether portable memories remain local or are committed to Git for team sharing.

The intended user outcome is that durable project decisions, workflows, conventions, references, and warnings follow the workspace rather than one application database or one filesystem path.

### 1.1 Relationship to the original workspace-memory PRD

The original workspace-memory PRD made repository file storage a non-goal for its first release and selected SQLite as the correct launch architecture. This document does not invalidate that decision. It defines the later portable/team phase anticipated by sections 12.4 and 28 of that PRD. Where this PRD is implemented, its file-authority and portable-identity requirements amend the original first-release non-goals only for workspaces that explicitly enable portable memory.

## 2. Background

### 2.1 Existing workspace memory

The current implementation includes:

- `AIWorkspaceMemoryEntity` for durable records in `ai_workspace_memories`.
- `AIWorkspaceMemoryModel` for workspace-scoped database access.
- `AIWorkspaceMemoryModule` for validation, secret filtering, and business rules.
- `WorkspaceMemoryContextResolver` for the approved-workspace trust boundary.
- `AIWorkspaceMemoryRetrievalService` for bounded prompt injection.
- `AIWorkspaceAutoDreamService` for automatic consolidation.
- Workspace-memory IPC and renderer management UI.

The existing scope boundary is correct: renderer requests contain a conversation ID, and the main process resolves the approved workspace and its workspace key. Renderer-supplied workspace keys are ignored.

### 2.2 Existing `.aifetchly` workspace support

AiFetchly already recognizes a trusted workspace-local configuration tree:

```text
<workspace>/.aifetchly/
├── AGENTS.md
├── settings.json
├── commands/
├── agents/
├── skills/
└── hooks/
```

The workspace watcher scans bounded content in a worker process and sends typed snapshots to the main process. The main process remains responsible for trust decisions, registry mutation, database writes, and renderer notifications.

Portable workspace memory should extend this established path and trust model instead of creating a second watcher or allowing worker database access.

### 2.3 Problem statement

SQLite-only workspace memory creates five product limitations:

1. **Agent isolation:** Claude Code, Codex, and other workspace agents cannot read AiFetchly's private database through normal repository context.
2. **Machine isolation:** the same repository cloned on a second machine receives a different local database and no memory history.
3. **Path identity:** the current workspace key is derived from the canonical absolute path, so the same repository at a different path receives a different key.
4. **Reviewability:** users cannot inspect memory changes through familiar file diffs or code review.
5. **Team portability:** approved project knowledge cannot travel with the repository without a separate export/import operation.

Merely placing a SQLite database inside `.aifetchly` would not solve these problems. Agents would still need schema knowledge and database tooling, concurrent application access could corrupt or lock the file, binary database changes would be unreviewable, and internal operational metadata could leak into the repository.

## 3. Product Vision

Workspace memory should behave like a project-owned knowledge layer:

```text
AiFetchly UI / auto-dream / external agents / human editors
                         |
                         v
            .aifetchly/memory/*.md
               portable source of truth
                         |
              validate and reconcile
                         v
                  local SQLite
       search projection + operational metadata
                         |
                         v
                 AI Chat context
```

Users should be able to open a repository in any compatible agent and give it the same durable project context, while AiFetchly retains fast local retrieval and strong workspace isolation.

## 4. Goals

1. Store portable workspace memories as human-readable files under `.aifetchly/memory/`.
2. Make portable memories readable by Claude Code, Codex, and other filesystem-aware agents.
3. Preserve SQLite as a rebuildable local projection and retrieval index.
4. Establish one clear authority model so file and database copies cannot silently diverge.
5. Add a stable workspace identity that survives path changes and repository clones.
6. Reuse the existing approved-workspace and `.aifetchly` watcher trust boundaries.
7. Support user-created, AiFetchly-created, and externally edited portable memories.
8. Prevent secret-like or malformed memory content from entering prompt context.
9. Allow users to choose local-only or Git-shareable memory behavior.
10. Make synchronization status, conflicts, and rejected files visible to users.
11. Migrate existing SQLite memories without data loss or forced repository changes.
12. Keep worker processes free of database access.
13. Preserve all current workspace-memory CRUD, retrieval, isolation, and auto-dream behavior.
14. Provide deterministic reconciliation after crashes, partial writes, branch changes, and external file edits.

## 5. Non-Goals

1. Do not move the AiFetchly user database into the workspace.
2. Do not expose raw SQLite tables to external agents.
3. Do not replace global user memory or conversation/session memory.
4. Do not automatically commit or push memory files to Git.
5. Do not automatically modify `AGENTS.md` or `CLAUDE.md` without user approval.
6. Do not treat all repository documentation or source files as memory.
7. Do not provide a general-purpose synchronization service between arbitrary databases and files.
8. Do not require MCP support for basic interoperability.
9. Do not enable cross-user cloud synchronization in the first release.
10. Do not permit arbitrary memory storage paths configured by workspace files.
11. Do not execute instructions contained in memory files as code, shell, hooks, or tools.
12. Do not make semantic/vector search a launch dependency.
13. Do not guarantee that third-party agents automatically discover arbitrary `.aifetchly` files without an instruction bridge.
14. Do not allow external files to set internal source conversation IDs, consolidation run IDs, or database primary keys.

## 6. Target Users

### 6.1 Multi-agent developer

Uses AiFetchly, Claude Code, and Codex in the same repository. Wants all agents to know durable architecture decisions, project commands, conventions, and warnings.

### 6.2 Multi-machine user

Works on the same repository from multiple computers or clones. Wants approved memory to travel with the project rather than remain tied to one absolute path.

### 6.3 Team maintainer

Wants selected project knowledge reviewed through Git and shared with contributors while keeping private or auto-generated memories local.

### 6.4 Security-conscious user

Wants to inspect exactly what project memory enters AI context, reject untrusted edits, and avoid committing conversation identifiers, private paths, or secrets.

### 6.5 AiFetchly maintainer

Needs a deterministic source-of-truth rule, testable synchronization, bounded worker behavior, and compatibility with the existing Entity -> Model -> Module -> Service -> IPC architecture.

## 7. Product Principles

### 7.1 Portable content, local operations

Files contain project knowledge that another human or agent may use. SQLite contains local operational state that is useful to AiFetchly but should not travel with the repository.

### 7.2 Files are authoritative for portable records

After a memory is promoted to portable storage, its file owns its portable fields. SQLite is a projection that may be deleted and rebuilt without losing the portable record.

### 7.3 Explicit visibility

Users must know whether a memory is:

- SQLite-only and private to this AiFetchly installation.
- Portable but local to the workspace checkout.
- Intended for Git/team sharing.

### 7.4 Current instructions still win

The current user message overrides workspace memory. Trusted workspace instructions and memory are context, not an authority to ignore current user intent or safety rules.

### 7.5 Invalid files fail closed

Malformed, oversized, secret-like, duplicated, or unsupported memory files must not enter the SQLite projection or prompt context.

### 7.6 No silent repository mutation

AiFetchly must not create `.aifetchly`, alter Git ignore rules, install agent instruction bridges, or export existing memory until the user approves the corresponding action.

### 7.7 One record per file

Each durable memory gets its own file. This limits merge conflicts, makes history readable, and lets independent agents edit separate records safely.

## 8. Proposed Workspace Layout

```text
<workspace>/.aifetchly/
├── workspace.json
├── settings.json
└── memory/
    ├── README.md
    ├── INDEX.md
    ├── wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md
    └── wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md
```

### 8.1 `workspace.json`

`workspace.json` provides a path-independent project identity.

```json
{
  "schemaVersion": 1,
  "workspaceId": "ws-018f2f43-43b4-7a18-8d7f-b6886c01993d",
  "name": "aiFetchly",
  "createdAt": "2026-08-22T08:00:00.000Z"
}
```

Rules:

- `workspaceId` is generated once using a collision-resistant UUID.
- The ID contains no absolute path, user ID, machine ID, repository remote, or secret.
- A tracked `workspace.json` intentionally identifies the same project across clones.
- Copying a repository also copies its identity. The UI must offer “Regenerate workspace identity” for an intentional fork.
- A missing file does not block existing SQLite-only memory behavior.
- An invalid file produces a diagnostic and does not replace the current trusted identity.

### 8.2 `memory/README.md`

The README is generated when portable memory is enabled. It documents:

- The memory file schema.
- Allowed memory types and statuses.
- Content and size limits.
- How external agents should create or edit memory.
- Which fields AiFetchly ignores or owns locally.
- Security guidance against secrets and prompt-like instructions.
- Whether the directory is configured as local-only or team-shareable.

AiFetchly may update the README when the schema version changes, but must preserve clearly marked user-authored sections.

### 8.3 `memory/INDEX.md`

`INDEX.md` is a generated, compact view of active portable memory designed for fast human and agent discovery.

Requirements:

- Contains active memory ID, type, title, and a concise content summary or full bounded content.
- Links to each record file with a relative path.
- Excludes archived and contradicted memories by default.
- Includes schema version and generated timestamp.
- Contains a generated-file warning.
- Is deterministic for the same active memory set.
- Can be rebuilt entirely from record files.
- Must never be the sole copy of a memory.
- Must not be imported as an additional memory record.

### 8.4 Memory record files

File name format:

```text
<memoryId>.md
```

Initial pattern:

```text
wmem-<uuid>.md
```

The file name and frontmatter `id` must match exactly. A mismatch is rejected to prevent ambiguous renames and accidental duplication.

## 9. Portable Memory File Contract

### 9.1 Example

```markdown
---
schema: aifetchly.memory/v1
id: wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1
type: decision
status: active
confidence: 95
visibility: team
createdAt: 2026-08-22T08:30:00.000Z
updatedAt: 2026-08-22T08:30:00.000Z
createdBy: aifetchly
---

# Database access uses Models and Modules

IPC handlers must not access TypeORM repositories directly. They delegate to a
Module, which applies business rules and calls a Model for database operations.
```

### 9.2 Required frontmatter fields

| Field        | Type            | Constraints                                                             | Meaning                           |
| ------------ | --------------- | ----------------------------------------------------------------------- | --------------------------------- |
| `schema`     | string          | exactly `aifetchly.memory/v1`                                           | Parser and migration version      |
| `id`         | string          | `wmem-` plus valid UUID; max 100 characters                             | Stable record identity            |
| `type`       | enum            | `project`, `decision`, `workflow`, `convention`, `reference`, `warning` | Existing closed taxonomy          |
| `status`     | enum            | `active`, `archived`, `contradicted`                                    | Retrieval eligibility             |
| `confidence` | integer         | 0 through 100                                                           | Confidence in durable correctness |
| `visibility` | enum            | `local`, `team`                                                         | Intended sharing behavior         |
| `createdAt`  | ISO 8601 string | valid UTC timestamp                                                     | Portable creation time            |
| `updatedAt`  | ISO 8601 string | valid UTC timestamp, not before `createdAt`                             | Portable modification time        |
| `createdBy`  | enum            | `user`, `aifetchly`, `external-agent`, `import`                         | Coarse, non-sensitive provenance  |

### 9.3 Optional frontmatter fields

| Field        | Type            | Constraints                           | Meaning                                |
| ------------ | --------------- | ------------------------------------- | -------------------------------------- |
| `supersedes` | string array    | valid memory IDs, max 20              | Older memories replaced by this record |
| `tags`       | string array    | normalized strings, max 20            | Optional filtering vocabulary          |
| `reviewedAt` | ISO 8601 string | valid UTC timestamp                   | Last explicit human review             |
| `reviewedBy` | string          | max 100 characters, no email required | Optional human-readable reviewer label |

Unknown fields must produce a recoverable diagnostic and be ignored in v1. They must not be copied into SQLite metadata automatically.

### 9.4 Markdown body

Rules:

- The first H1 heading is the memory title.
- The remaining Markdown is the memory content.
- Title length is 1 to 200 characters after trimming.
- Content length is 1 to 8,000 characters after trimming.
- Total file size is capped at 16 KiB in v1.
- HTML is treated as text content and must not execute in the renderer.
- Images, embedded data URLs, scripts, and external includes are unsupported.
- Relative links may be preserved as text but do not grant file access.
- A file with multiple H1 headings is valid; only the first H1 supplies the title.
- Frontmatter-only files are invalid because memory content is required.

### 9.5 Portable versus local-only fields

The following existing database fields remain local and are never exported by default:

- Numeric database `id`.
- Absolute `workspaceRoot`.
- Path-derived legacy `workspaceKey`.
- `sourceConversationId`.
- `sourceAgentTaskId`.
- `sourceMessageIds`.
- `lastUsedAt`.
- Consolidation run IDs and watermarks.
- Embeddings and vector index state.
- File hash, import revision, and diagnostic state.

This separation prevents private conversation identifiers, local paths, and retrieval telemetry from leaking into Git.

## 10. Memory Authority And State Model

### 10.1 Storage modes

Each workspace memory is in one of these storage modes:

| Mode             | File                     | SQLite               | Authority                                           |
| ---------------- | ------------------------ | -------------------- | --------------------------------------------------- |
| `private`        | No                       | Yes                  | SQLite                                              |
| `portable-local` | Yes, `visibility: local` | Yes                  | File for portable fields                            |
| `portable-team`  | Yes, `visibility: team`  | Yes                  | File for portable fields                            |
| `rejected-file`  | Yes                      | No active projection | File remains on disk; diagnostic explains rejection |

### 10.2 Authority rules

1. SQLite-only records remain authoritative until exported.
2. Once a record has a valid memory file, the file owns title, content, type, status, confidence, visibility, portable timestamps, and portable provenance.
3. SQLite owns local operational fields.
4. On startup or rescan, a valid file updates the SQLite projection.
5. If a portable record file is deleted, reconciliation removes its portable projection after confirming a complete scan.
6. A failed or partial scan must never delete projected records.
7. A rejected file must not overwrite the last valid projected version. The UI shows that the file and projection disagree.
8. `INDEX.md` never wins over record files.

### 10.3 Delete behavior

- **Archive** changes `status` to `archived` and preserves the record file.
- **Contradict** changes `status` to `contradicted` and preserves the record file.
- **Hard delete** removes the record file after user confirmation and deletes the local projection.
- Automatic consolidation may archive or contradict but must not hard-delete portable memory.
- If an external agent deletes a file, AiFetchly treats it as a requested hard delete only after a complete, trusted scan confirms the absence.
- The UI must show external deletions before final removal when the workspace setting requires review.

## 11. Synchronization And Reconciliation

### 11.1 App-originated create

```text
User or auto-dream creates portable memory
  -> resolve approved workspace in main process
  -> validate and apply secret filter
  -> allocate memory ID and timestamps
  -> atomically write record file
  -> parse the written bytes through the same importer
  -> upsert SQLite projection through Module and Model
  -> rebuild INDEX.md atomically
  -> notify renderer
```

If the file write fails, the portable SQLite record must not be committed as successful. The operation returns an actionable error and leaves no half-authoritative record.

### 11.2 App-originated update

1. Load the current valid record and content hash.
2. Verify the on-disk hash has not changed since it was read.
3. Apply validated changes.
4. Set `updatedAt` to the current time.
5. Write atomically through a temporary file and rename.
6. Re-import through the shared parser.
7. Update the SQLite projection.
8. Rebuild `INDEX.md`.

If the hash changed between read and write, report a conflict instead of overwriting the external edit.

### 11.3 External edit

```text
External agent or human edits memory file
  -> existing workspace watcher emits bounded snapshot
  -> main process confirms workspace trust
  -> main-side parser validates schema and content
  -> MemorySecretFilter checks title and body
  -> reconciliation compares file hash and SQLite import hash
  -> valid change updates projection
  -> invalid change produces diagnostic
  -> renderer receives sync-status event
```

The worker may read and parse bounded files, but it must not instantiate Models or write SQLite. Main-process code applies all database changes through `AIWorkspaceMemoryModule` or a dedicated synchronization Module that delegates to the memory Model.

### 11.4 Startup reconciliation

When an approved workspace is opened or acquired:

1. Scan the complete bounded memory directory.
2. Validate workspace identity.
3. Parse each candidate record independently.
4. Reject duplicate IDs, mismatched file names, symlinks, and unsupported files.
5. Upsert changed valid records by content hash.
6. Retain unchanged projections without rewriting them.
7. Reconcile missing files only after the scan completes successfully.
8. Rebuild `INDEX.md` only when its expected content differs.
9. Publish one summary event rather than one renderer event per file.

### 11.5 Loop prevention

App writes will trigger the workspace watcher. The synchronization layer must be idempotent, meaning repeating the same operation produces the same final state without duplicate work.

Use content hashes and last imported hashes to avoid:

- Re-importing identical bytes.
- Rebuilding an unchanged index.
- Treating AiFetchly's own atomic rename as an external conflict.
- Creating duplicate memories after a watcher restart.

### 11.6 Conflict policy

Conflicts occur when both AiFetchly and an external editor change the same record from the same prior version.

V1 behavior:

- Never silently choose the later writer.
- Preserve the external file unchanged.
- Preserve the last valid SQLite projection.
- Mark the record `conflicted` in local synchronization state, not in the portable memory status enum.
- Show both versions and their timestamps in the UI.
- Let the user choose “Use file version”, “Use AiFetchly version”, or “Merge manually”.
- Do not inject the unresolved new version into prompts.

## 12. Stable Workspace Identity

### 12.1 Identity resolution order

When an approved workspace is resolved:

1. If a valid trusted `.aifetchly/workspace.json` exists, use its `workspaceId` as the portable workspace identity.
2. Otherwise use the existing path-derived `workspaceKey` for local compatibility.
3. Offer the user an action to enable portable identity and create `workspace.json`.

### 12.2 Relationship to the existing workspace key

The existing `ws_<path-hash>` key remains useful for legacy SQLite records and local isolation. Portable identity adds a second stable identifier rather than silently changing all existing keys.

The data layer must support mapping:

```text
portable workspaceId -> one or more legacy/path-derived workspaceKey values
```

This allows the same repository to retain memory across clones while preserving a migration path from current records.

### 12.3 Worktrees and branches

Default behavior:

- Git worktrees that contain the same tracked `workspace.json` share portable identity.
- Their file contents may differ by branch, so each checkout's current memory files define its local projection.
- Branch switching triggers full reconciliation.
- The UI explains that Git-tracked memory follows branch history like other project files.
- Users who require isolated worktree memory can choose local-only memory or regenerate identity in an untracked `workspace.json`, subject to an explicit warning.

### 12.4 Memory identity and database uniqueness

Portable record identity is scoped to the portable workspace identity:

```text
(portableWorkspaceId, memoryId)
```

The current `ai_workspace_memories` schema enforces a globally unique `memoryId`. That constraint is sufficient for app-generated UUIDs in SQLite-only mode but cannot safely represent an intentional repository fork that keeps copied record IDs while receiving a new workspace identity.

Before supporting identity regeneration with retained memories, engineering must choose and migrate to one of these behaviors:

1. Preferably enforce uniqueness on `(workspace identity, memoryId)` and keep every Model lookup scoped by workspace.
2. Alternatively regenerate all copied memory IDs when regenerating workspace identity and update every local reference atomically.

The recommended approach is scoped uniqueness because record history and links remain stable inside each project lineage. The migration must preserve existing IDs, indexes, source attribution, and workspace-isolation guarantees.

## 13. External Agent Discoverability

### 13.1 The discoverability problem

Claude Code and Codex do not receive a guarantee that every arbitrary hidden directory will be read automatically. Portable files solve access, but an instruction bridge solves discovery.

### 13.2 Supported bridges

AiFetchly should offer an explicit setup action with previews for:

- Root `AGENTS.md` for agents that follow repository agent instructions.
- Root `CLAUDE.md` for Claude-oriented workflows.
- A copyable generic instruction for other tools.

Recommended instruction block:

```markdown
## Project memory

Read `.aifetchly/memory/INDEX.md` before making project-level decisions.
Open linked memory records when their details are relevant.
When adding durable project knowledge, follow
`.aifetchly/memory/README.md` and never store secrets or raw transcripts.
```

Requirements:

- Show the exact diff before modifying an instruction file.
- Require explicit user confirmation.
- Add a clearly delimited managed block.
- Detect an existing equivalent instruction and avoid duplication.
- Never remove user-authored content outside the managed block.
- Allow the user to remove the bridge later.
- Bridge installation is optional; memory remains usable inside AiFetchly without it.

### 13.3 External write guidance

`memory/README.md` should tell agents to:

1. Read the current record before editing it.
2. Preserve the memory ID and `createdAt`.
3. Update `updatedAt`.
4. Use the allowed type, status, visibility, and provenance values.
5. Avoid source conversation IDs and machine paths.
6. Create one memory per file.
7. Avoid editing `INDEX.md` because AiFetchly regenerates it.
8. Never store credentials, personal data, or raw transcript content.

## 14. Sharing And Git Behavior

### 14.1 Visibility modes

Workspace setting:

| Mode             | Default                     | Behavior                                                                 |
| ---------------- | --------------------------- | ------------------------------------------------------------------------ |
| `private-only`   | Yes for existing workspaces | New memories remain SQLite-only                                          |
| `portable-local` | No                          | Writes files with `visibility: local`; user normally ignores them in Git |
| `portable-team`  | No                          | Writes files with `visibility: team`; user may commit them               |
| `ask-each-time`  | No                          | User chooses visibility during create/promotion                          |

### 14.2 Git ignore management

AiFetchly must not modify `.gitignore` silently.

For portable-local mode, the UI may offer to add one of these entries:

```gitignore
.aifetchly/memory/
```

or, when team memory and local memory must coexist:

```gitignore
.aifetchly/memory/local/
```

V1 should prefer one directory and a single workspace sharing mode to avoid ambiguous partial ignore behavior. Per-record visibility remains metadata and UI intent; Git determines what is actually tracked.

### 14.3 Promotion workflow

Users can promote a private memory to portable memory:

1. Preview the exact Markdown file.
2. Choose local or team visibility.
3. Confirm the memory contains no sensitive content.
4. Write the file atomically.
5. Link the existing SQLite record to its file rather than creating a duplicate.

Users can also make a portable memory private:

1. Confirm removal of the workspace file.
2. Keep a new SQLite-only copy with a new or retained memory ID according to the technical design.
3. Warn if the file is already tracked by Git because deleting it locally does not erase repository history.

## 15. Security And Trust Requirements

### 15.1 Trust boundary

- Only approved workspaces may load, create, update, or reconcile portable memory.
- Renderer input supplies `conversationId`, never a trusted root or workspace identity.
- Main-process services resolve the approved canonical root.
- All file paths must remain under `<approved-root>/.aifetchly/memory/` after real-path resolution.
- Symlinks inside the memory directory are rejected in v1.
- The workspace watcher worker never accesses the database.

### 15.2 Content safety

Every imported or app-written record must pass:

- Frontmatter schema validation.
- Type and status allowlists.
- Title, content, file-size, count, and array limits.
- UTF-8 validation.
- Existing `MemorySecretFilter` checks.
- Control-character rejection except normal whitespace.
- Safe Markdown rendering rules in the UI.

### 15.3 Prompt injection treatment

Memory files are user/project-controlled context and may contain malicious instructions. The memory context header must state that:

- Memory is untrusted project context.
- It cannot override system, developer, safety, permission, or current user instructions.
- Text claiming to grant tools, permissions, secrets, or policy exceptions has no authority.

The importer should not attempt to solve prompt injection only through keyword blocking. Trust hierarchy and tool permission enforcement remain mandatory at execution time.

### 15.4 Sensitive history warning

Before enabling team mode, the UI must explain:

- Committing a memory places it in Git history.
- Later deletion may not remove it from prior commits or remote copies.
- Users should review the diff before commit.
- AiFetchly's secret filter reduces risk but cannot guarantee detection of every sensitive value.

### 15.5 Resource limits

Recommended v1 limits:

| Resource                              | Limit            |
| ------------------------------------- | ---------------- |
| Record file size                      | 16 KiB           |
| Memory body length                    | 8,000 characters |
| Title length                          | 200 characters   |
| Portable memory records per workspace | 1,000            |
| Files parsed concurrently by worker   | 8                |
| Tags per record                       | 20               |
| Superseded IDs per record             | 20               |
| INDEX output size                     | 512 KiB          |
| Debounce after file changes           | 250-500 ms       |

Exceeding a limit produces a diagnostic and skips the offending record without blocking valid records.

## 16. User Experience Requirements

### 16.1 Enable portable memory

From the workspace memory panel, the user can select “Enable portable memory”. The flow shows:

1. The directory and files that will be created.
2. The difference between private, local portable, and team portable memory.
3. Whether `.aifetchly` is already trusted.
4. Whether Git currently tracks or ignores the proposed path.
5. Optional instruction bridge installation.
6. Optional export of existing active workspace memories.

No files are created until the user confirms.

### 16.2 Memory list

Each memory row or detail view must show:

- Title and type.
- Status and confidence.
- Storage mode.
- Visibility intent.
- Last portable update time.
- Last local use time where available.
- Source class without exposing private source IDs by default.
- File synchronization state: synced, pending, rejected, conflicted, missing, or private.
- A link or action to reveal the file in the operating system.

### 16.3 Create and edit

When portable memory is enabled:

- Create forms include a storage/visibility choice based on workspace defaults.
- The user can preview the generated Markdown.
- Editing a portable memory updates the file and projection as one operation.
- Editing a rejected file from the UI starts from the on-disk content and displays validation errors.
- The app never silently overwrites a newer external edit.

### 16.4 Import review

Workspace settings determine external change behavior:

| Mode         | Behavior                                                                           |
| ------------ | ---------------------------------------------------------------------------------- |
| `automatic`  | Valid external changes update the projection immediately                           |
| `review-new` | New external records require approval; edits to known records import automatically |
| `review-all` | Every external create, update, or delete requires approval                         |

Recommended default is `review-new`.

### 16.5 Diagnostics

The UI must provide actionable diagnostics for:

- Invalid YAML.
- Unsupported schema.
- Filename and ID mismatch.
- Duplicate memory ID.
- Oversized file or content.
- Secret-like content.
- Invalid timestamps or enum values.
- Symlink rejection.
- Workspace identity collision or invalid identity file.
- Write permission errors.
- Concurrent edit conflicts.
- Stale or failed index generation.

Diagnostics must identify the relative file path, never expose unrelated absolute paths to the renderer, and avoid echoing sensitive content.

### 16.6 Empty states

Portable memory disabled:

```text
Workspace memories are stored privately in AiFetchly.
Enable portable memory to share selected project context with other agents.
```

Portable memory enabled with no records:

```text
No portable memories yet.
Create one or promote an existing private memory.
```

Sync error:

```text
Some workspace memory files could not be loaded.
Your last valid memories remain available. Review diagnostics to fix the files.
```

### 16.7 Internationalization and accessibility

- Every new user-facing string must be translated in English, Chinese, Spanish, French, German, and Japanese.
- Status must not be communicated by color alone.
- Conflict and diagnostic controls must be keyboard accessible.
- Confirmation dialogs must identify the exact memory and action.
- Long paths and titles must wrap or truncate with an accessible full-value affordance.

## 17. Functional Requirements

### Workspace setup and identity

- **FR-001:** The system MUST allow a user to enable portable memory only for an approved workspace.
- **FR-002:** The system MUST store portable memory only under `<approved-workspace>/.aifetchly/memory/`.
- **FR-003:** The system MUST support a versioned `.aifetchly/workspace.json` containing a path-independent workspace UUID.
- **FR-004:** The system MUST validate workspace identity in the main process before using it for memory mapping.
- **FR-005:** The system MUST preserve path-derived workspace keys for backward compatibility.
- **FR-006:** The system MUST map a portable workspace identity to current and legacy path-derived workspace keys without merging unrelated workspaces automatically.
- **FR-007:** The system MUST provide an explicit workspace-identity regeneration action for intentional repository forks.

### File format and validation

- **FR-008:** The system MUST store each portable memory in an individual Markdown file with YAML frontmatter.
- **FR-009:** The system MUST validate every portable field, body constraint, and filename/ID relationship before import.
- **FR-010:** The system MUST reject unsupported schema versions without deleting or rewriting the file.
- **FR-011:** The system MUST ignore unknown fields with diagnostics rather than trusting them as metadata.
- **FR-012:** The system MUST reject symbolic links and paths escaping the memory directory.
- **FR-013:** The system MUST apply secret-like content detection to app writes and external imports.
- **FR-014:** The system MUST prevent invalid or rejected files from entering AI prompt context.

### Source of truth and projection

- **FR-015:** The system MUST keep SQLite as the local projection for listing, retrieval, usage metadata, embeddings, and synchronization state.
- **FR-016:** The system MUST treat valid record files as authoritative for portable fields.
- **FR-017:** The system MUST preserve SQLite as the authority for records that have never been exported.
- **FR-018:** The system MUST be able to rebuild portable SQLite projections from valid memory files.
- **FR-019:** The system MUST never export local database primary keys, absolute workspace paths, source message IDs, or retrieval usage metadata by default.
- **FR-020:** The system MUST maintain a file content hash or equivalent revision marker for deterministic reconciliation.

### Synchronization

- **FR-021:** The system MUST reuse the existing workspace watcher lifecycle rather than starting one worker per memory subsystem.
- **FR-022:** Worker processes MUST NOT access SQLite, TypeORM Models, or Electron-only database services.
- **FR-023:** Main-process synchronization MUST route database writes through Model and Module layers.
- **FR-024:** App-originated record writes MUST be atomic.
- **FR-025:** The system MUST avoid re-import loops caused by its own watcher events.
- **FR-026:** The system MUST reconcile a complete memory snapshot on workspace acquire, app startup recovery, manual rescan, and branch/worktree change detection.
- **FR-027:** The system MUST not infer file deletions from an incomplete or failed scan.
- **FR-028:** The system MUST preserve the last valid projection when a changed file becomes invalid.
- **FR-029:** The system MUST detect concurrent external edits and avoid silent overwrite.
- **FR-030:** The system MUST expose synchronization summary events and per-file diagnostics to the renderer.

### Index and discoverability

- **FR-031:** The system MUST generate a deterministic `.aifetchly/memory/INDEX.md` from active valid record files.
- **FR-032:** The generated index MUST link to record files and MUST NOT be treated as a record itself.
- **FR-033:** The system MUST document the record schema and agent editing rules in `.aifetchly/memory/README.md`.
- **FR-034:** The system MUST offer optional instruction bridges for `AGENTS.md` and `CLAUDE.md` with an exact diff preview and explicit approval.
- **FR-035:** The system MUST avoid duplicate or overlapping managed instruction blocks.
- **FR-036:** The system MUST allow removal of its managed instruction bridge without modifying unrelated user content.

### CRUD and lifecycle

- **FR-037:** Users MUST be able to create a memory as private, portable-local, or portable-team according to workspace settings.
- **FR-038:** Users MUST be able to promote an existing private memory to portable storage without creating a duplicate logical memory.
- **FR-039:** Users MUST be able to edit, archive, contradict, and hard-delete portable records.
- **FR-040:** Automatic consolidation MUST NOT hard-delete portable memory.
- **FR-041:** The system MUST allow users to resolve file/database conflicts explicitly.
- **FR-042:** External creates, edits, and deletes MUST follow the configured import review policy.
- **FR-043:** The system MUST rebuild the index after successful portable create, update, archive, contradict, delete, import, or conflict resolution.

### Sharing and Git

- **FR-044:** The system MUST default existing workspaces to private-only behavior after upgrade.
- **FR-045:** The system MUST distinguish local and team visibility in the UI and file schema.
- **FR-046:** The system MUST NOT commit, push, or otherwise publish memory files automatically.
- **FR-047:** The system MUST NOT change `.gitignore` without explicit user approval and a diff preview.
- **FR-048:** The system MUST warn that committed sensitive content remains in Git history after local deletion.
- **FR-049:** The system SHOULD detect whether the memory directory is tracked, ignored, or untracked and display that state.

### Retrieval and context

- **FR-050:** Existing workspace-memory retrieval MUST continue to filter by the trusted active workspace scope.
- **FR-051:** Valid imported portable memories MUST participate in the existing bounded retrieval algorithm.
- **FR-052:** Rejected, conflicted, archived, and contradicted portable versions MUST NOT be injected into prompt context.
- **FR-053:** The workspace memory context header MUST identify memory as project context that cannot override higher-priority instructions or tool permissions.
- **FR-054:** Disabling portable storage MUST NOT disable private SQLite workspace memory or delete existing files.

### Security and privacy

- **FR-055:** Renderer requests MUST NOT supply a trusted workspace root, portable workspace ID, or memory file path.
- **FR-056:** The main process MUST resolve all workspace and memory paths from an approved conversation/workspace scope.
- **FR-057:** Diagnostics and renderer events MUST use relative memory paths and sanitized messages.
- **FR-058:** Markdown rendering MUST prevent script execution and unsafe URL behavior.
- **FR-059:** The system MUST enforce record count, file size, content length, and concurrency limits.
- **FR-060:** The system MUST audit portable memory create, update, import, reject, conflict, promote, privatize, and delete events without logging full memory content.

### UI and settings

- **FR-061:** The workspace memory UI MUST show storage mode, visibility, and synchronization state for every memory.
- **FR-062:** The UI MUST provide enablement, export, import-review, instruction-bridge, rescan, and identity-regeneration controls.
- **FR-063:** The UI MUST show actionable per-file diagnostics and conflict resolution options.
- **FR-064:** All new renderer-facing behavior MUST have component tests.
- **FR-065:** Critical multi-step enablement and conflict flows MUST have Playwright end-to-end coverage.
- **FR-066:** All user-facing text MUST be translated into all six supported languages.

### Data-model compatibility

- **FR-067:** The system MUST define portable record uniqueness by workspace identity plus memory ID, or atomically regenerate all memory IDs when a workspace identity is regenerated.
- **FR-068:** Any database migration that changes memory uniqueness MUST preserve existing records and MUST keep every read, update, archive, delete, and usage-marking query scoped by trusted workspace identity.

## 18. Non-Functional Requirements

### 18.1 Performance

- Initial reconciliation of 1,000 valid memory files totaling no more than 16 MiB should complete within 3 seconds on a typical supported desktop after filesystem cache warm-up.
- A single external file change should appear in the SQLite projection and UI within 1 second after the watcher debounce window.
- Unchanged files should be skipped using hashes without YAML/Markdown reprocessing where safe.
- Index regeneration should complete within 500 ms for 1,000 bounded records.
- Synchronization must not block the Electron renderer thread.

### 18.2 Reliability

- A crash during file write must leave either the old complete file or the new complete file, never a truncated authoritative file.
- Startup reconciliation must repair a stale SQLite projection without user intervention when files are valid.
- One invalid record must not prevent other valid records from loading.
- A watcher crash must follow the existing bounded restart policy.
- Branch changes and large file batches must settle to one deterministic projection.

### 18.3 Compatibility

- Existing SQLite-only workspaces must behave exactly as before until portable memory is enabled.
- Existing memory IDs and types remain valid.
- The file schema must be documented independently of TypeORM so other tools can implement it.
- V1 record files use UTF-8 Markdown and YAML frontmatter only.
- The feature must work on macOS, Windows, and Linux using platform-safe path handling.

### 18.4 Maintainability

- File parsing and serialization use one shared implementation.
- App writes are validated by parsing the serialized output before projection update.
- Import and export behavior has pure unit-testable functions.
- Database operations remain in Models and Modules.
- Workspace watcher protocol changes remain typed and versioned.

## 19. Migration Requirements

### 19.1 Upgrade behavior

After the feature ships:

- No workspace files are created automatically.
- Existing workspace memories remain SQLite-only.
- Existing path-derived workspace keys remain unchanged.
- The memory panel displays an optional portable-memory enablement action.

### 19.2 Export existing memories

When enabling portable memory, users may export:

- Selected memories.
- All active memories.
- All active and archived memories.

Before writing, the application shows:

- Record count.
- Destination.
- Visibility mode.
- Secret-filter warnings.
- Any records that cannot be exported and why.

Export must be resumable. Re-running it must update/link existing matching IDs rather than create duplicates.

### 19.3 Import existing files

When `.aifetchly/memory` already exists:

- Scan and validate before asking to enable synchronization.
- Show counts for valid, invalid, conflicting, active, archived, local, and team records.
- Do not inject imported records until the user approves the workspace and the configured review policy permits them.
- Preserve invalid files unchanged.

### 19.4 Rollback

Disabling portable synchronization:

- Stops watching/importing memory files.
- Does not delete files.
- Does not delete the last valid SQLite projections by default.
- Marks them as detached portable projections or converts them to private records according to an explicit user choice.
- Removes no instruction bridge unless the user separately requests removal.

## 20. Analytics And Observability

Local diagnostic metrics should include:

- Portable memory enabled/disabled by workspace identity.
- Number of private and portable records.
- Scan duration and file counts.
- Valid, unchanged, rejected, conflicted, imported, and deleted counts.
- Index generation duration and failure count.
- Instruction bridge status.
- Import review decisions.
- File write and reconciliation errors by sanitized error code.

Telemetry, when enabled, must not include:

- Memory titles or content.
- Workspace names, paths, repository URLs, or IDs.
- File names containing memory IDs.
- Source conversation/task/message IDs.
- Git branch names or commit hashes.

Suggested log event codes:

- `portable-memory-enabled`
- `portable-memory-disabled`
- `portable-memory-scan-completed`
- `portable-memory-file-rejected`
- `portable-memory-conflict-detected`
- `portable-memory-conflict-resolved`
- `portable-memory-index-failed`
- `portable-memory-export-completed`
- `portable-memory-identity-regenerated`

## 21. Testing Requirements

### 21.1 Parser and serializer tests

Cover:

- Valid round-trip serialization.
- Every allowed type, status, visibility, and provenance value.
- Missing and unknown fields.
- Invalid YAML and unsupported schema.
- Filename/ID mismatch and duplicate IDs.
- Timestamp validation.
- Title and content extraction.
- UTF-8 and control-character handling.
- File and field limits.
- Secret-like content rejection.
- Malicious Markdown and HTML rendering cases.

### 21.2 Synchronization tests

Cover:

- App create, update, archive, contradict, and delete.
- External create, update, delete, rename, and atomic rename.
- Repeated identical events.
- Partial and failed scans.
- Watcher restart and startup reconciliation.
- Self-write loop prevention.
- Hash mismatch conflict detection.
- Last valid projection retention after invalid edit.
- Complete projection rebuild from files.
- Index determinism.
- Branch-change reconciliation.

### 21.3 Workspace isolation tests

Cover:

- No approved workspace.
- Pending and revoked workspace.
- Forged renderer root, workspace ID, and memory path.
- Two workspaces with identical memory IDs.
- Two clones sharing portable identity.
- Intentional fork after identity regeneration.
- Worktree behavior.
- Symlink and traversal attempts.

### 21.4 Migration tests

Cover:

- Existing SQLite-only workspace upgrade.
- Selected and bulk export.
- Export retry without duplicates.
- Existing `.aifetchly/memory` import.
- Disabling and re-enabling synchronization.
- Unsupported future schema retained without data loss.

### 21.5 UI component tests

Required component coverage includes:

- Enablement preview and confirmation.
- Storage and visibility badges.
- Tracked/ignored/untracked Git state.
- Import review states.
- Rejected file diagnostics.
- Conflict comparison and resolution.
- Export preview.
- Identity regeneration warning.
- Empty, loading, success, partial, and error states.
- Translation-key presence in all language files.

### 21.6 End-to-end tests

Critical flows:

1. Enable portable memory, export one existing record, and verify the file and projection.
2. Edit a record externally and verify AiFetchly imports it.
3. Create a conflicting edit and verify no silent overwrite or prompt injection.
4. Switch between workspaces and verify no memory leakage.
5. Revoke workspace approval and verify watch/import/retrieval stops.
6. Install and remove an `AGENTS.md` instruction bridge without damaging existing content.

## 22. Acceptance Criteria

### AC-001: Cross-agent readability

Given portable memory is enabled and contains active records, when a user or filesystem-aware agent reads `.aifetchly/memory/INDEX.md`, then it can identify the active memory titles, types, summaries, and linked source files without SQLite access.

### AC-002: External edit import

Given a trusted approved workspace and a valid known memory file, when an external agent changes its content and `updatedAt`, then AiFetchly validates and reflects the update in its memory UI and retrieval projection within one second after debounce.

### AC-003: Invalid edit safety

Given a previously valid portable memory, when its file becomes invalid or secret-like, then AiFetchly retains the last valid projection, excludes the invalid version from new prompt context, and displays an actionable diagnostic.

### AC-004: Cross-clone identity

Given two clones containing the same valid `.aifetchly/workspace.json` and memory files, when each is opened as an approved workspace, then each derives the same portable workspace identity while retaining independent local operational metadata.

### AC-005: Workspace isolation

Given two approved workspaces with different portable identities, when a conversation uses workspace A, then no memory owned only by workspace B is listed, modified, deleted, or injected.

### AC-006: Atomic app write

Given AiFetchly updates a portable memory and the process terminates during the write, when the workspace is reopened, then reconciliation finds either the prior complete version or the new complete version and never treats a truncated partial file as authoritative.

### AC-007: Concurrent edit protection

Given AiFetchly opened a memory for editing and an external agent changes the file before save, when the user saves in AiFetchly, then the app reports a conflict and does not overwrite the external version.

### AC-008: No silent publication

Given portable memory is enabled, when AiFetchly creates or imports records, then it performs no Git commit, push, or `.gitignore` modification without explicit user action.

### AC-009: Recoverable projection

Given the local SQLite portable-memory projection is removed or stale, when a complete reconciliation runs against valid memory files, then the system rebuilds equivalent portable fields without requiring remote services.

### AC-010: External agent bridge

Given the user approves an `AGENTS.md` or `CLAUDE.md` bridge, when AiFetchly applies it, then the exact managed block appears once and all unrelated file content remains byte-for-byte unchanged.

### AC-011: Existing behavior preservation

Given an existing workspace that does not enable portable memory, when the application upgrades, then existing SQLite CRUD, retrieval, context injection, isolation, and auto-dream behavior remains unchanged.

### AC-012: Worker database separation

Given the workspace watcher scans memory files, when it processes creates, edits, and deletes, then no worker code imports or instantiates TypeORM, a Model, or a Module that accesses the database.

### AC-013: Intentional fork identity

Given a repository is copied with portable memory and the user regenerates its workspace identity, when both the original and fork are opened in the same AiFetchly installation, then both memory sets coexist without unique-key failure, cross-workspace mutation, or forced loss of record history.

## 23. Success Metrics

- **SC-001:** At least 95% of valid external memory edits appear in AiFetchly within one second after debounce in automated reliability tests.
- **SC-002:** 100% of traversal, symlink, forged renderer scope, and cross-workspace access tests are blocked.
- **SC-003:** 100% of app-originated memory writes pass atomic-write recovery tests.
- **SC-004:** Reconciliation of an unchanged 1,000-record workspace performs zero database content updates and zero index rewrites.
- **SC-005:** A projection rebuild restores 100% of portable fields for all valid records.
- **SC-006:** Zero local-only fields listed in section 9.5 appear in exported files.
- **SC-007:** Existing SQLite-only workspace-memory tests pass without behavior changes.
- **SC-008:** All new UI strings exist in all six supported languages.
- **SC-009:** Critical enablement, conflict, isolation, and instruction-bridge component/E2E tests pass in CI.
- **SC-010:** No app workflow automatically commits, pushes, or publishes portable memory.
- **SC-011:** Original and intentionally forked workspaces with copied record IDs coexist with 100% isolation in migration and CRUD tests.

## 24. Delivery Phases

### Phase 1: File contract and manual export/import

Deliver:

- Versioned parser and serializer.
- `workspace.json` validation and identity mapping.
- Manual export preview and atomic record writes.
- Manual import/rescan with diagnostics.
- SQLite projection mapping.
- Generated README and INDEX.
- Unit and integration tests.

Exit condition: users can explicitly export existing memory and re-import it into a rebuilt local projection without data loss.

### Phase 2: Live synchronization

Deliver:

- Workspace watcher protocol support for memory snapshots.
- Main-process reconciliation service.
- Hash-based loop prevention.
- External change review modes.
- Conflict detection and resolution.
- Startup, branch-change, and crash recovery.

Exit condition: app and external edits synchronize safely without silent overwrite or cross-workspace leakage.

### Phase 3: Product UI and agent bridges

Deliver:

- Portable-memory enablement flow.
- Storage, visibility, sync, and Git-state UI.
- Diagnostics and conflict UI.
- `AGENTS.md` and `CLAUDE.md` managed bridge previews.
- Full i18n, component tests, and critical E2E flows.

Exit condition: a non-technical user can enable, understand, share, troubleshoot, and disable portable memory safely.

### Phase 4: Auto-dream portability and retrieval upgrades

Deliver:

- Workspace policy for whether auto-dream creates private or portable memories.
- Review queue before auto-generated memories become team-shareable.
- Optional semantic/vector indexing over imported records.
- Improved provenance and “why used” visibility.

Exit condition: automatic memory creation respects publication policy and produces reviewable portable records without exposing local source metadata.

### Future: Memory API and MCP adapter

Possible follow-up:

- Local MCP server exposing list/get/propose/update operations.
- Agent-specific authentication and permission scopes.
- Structured conflict-aware write API.
- Remote team sync independent of Git.

The filesystem format remains the interoperability baseline even if MCP is later added.

## 25. Dependencies

The feature depends on:

- Existing workspace approval and `WorkspaceResolver` behavior.
- Existing `WorkspaceKeyService` and a new portable identity mapping.
- Existing `AIWorkspaceMemoryModule`, Model, and retrieval service.
- Existing `MemorySecretFilter`.
- Existing workspace watcher and scanner lifecycle.
- Existing YAML/frontmatter parsing support (`js-yaml`).
- Existing atomic file-write dependency (`write-file-atomic`).
- Existing renderer IPC validation conventions.
- Existing component and Playwright test infrastructure.

No new database engine, cloud service, or required AI model is needed.

## 26. Risks And Mitigations

| Risk                                              | User impact                                 | Mitigation                                                             |
| ------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Secrets are committed in memory                   | Long-lived credential or privacy exposure   | Secret filter, preview, team-mode warning, no auto-commit              |
| File and SQLite copies diverge                    | Agent receives stale or conflicting context | Clear authority rules, hashes, complete reconciliation, conflict state |
| External agent writes malformed data              | Memory disappears or pollutes context       | Per-file validation, last-valid projection retention, diagnostics      |
| App overwrites external edit                      | User or agent work is lost                  | Compare expected hash before atomic write                              |
| Watcher loops on app writes                       | CPU churn and repeated DB changes           | Content-hash idempotency and deterministic index                       |
| Path-derived identity changes across clones       | Memories appear missing                     | Portable UUID and legacy-key mapping                                   |
| Copied repository unintentionally shares identity | Unrelated fork appears to be same project   | Identity display and explicit regenerate action                        |
| Git branch changes memory set                     | Context changes unexpectedly                | Full reconciliation and visible branch-following explanation           |
| Memory contains hostile instructions              | Unsafe model/tool behavior                  | Untrusted-context header and unchanged permission enforcement          |
| Large memory directory hurts startup              | Slow workspace opening                      | Count/size limits, bounded concurrency, hash skipping                  |
| Invalid scan interpreted as deletion              | Valid memories disappear                    | Delete only after complete successful snapshot                         |
| Managed instruction bridge damages user file      | User configuration loss                     | Exact diff, atomic targeted edit, delimited block, tests               |

## 27. Open Product Decisions

The following decisions should be confirmed during engineering planning:

1. Whether `visibility: local` and `visibility: team` share one directory in v1 or use separate subdirectories. Recommendation: one directory and one workspace default for v1.
2. Whether external deletions require review under `review-new`. Recommendation: require review because deletion is materially different from an edit.
3. Whether a portable memory made private retains the same ID. Recommendation: retain the ID locally but record detachment to prevent re-import confusion.
4. Whether generated `INDEX.md` includes full content or summaries. Recommendation: include full content while total output is below the cap, then deterministic truncation with record links.
5. Whether auto-dream may write portable-local memory automatically. Recommendation: keep auto-dream private by default and require promotion until the feature has usage evidence.
6. Whether `workspace.json` should be created separately from enabling portable memory. Recommendation: create it as part of enablement with a preview.
7. Whether future schema versions allow custom memory types. Recommendation: keep the closed taxonomy until interoperability and migration behavior are proven.

## 28. Launch Checklist

- [ ] Product decisions in section 27 resolved and recorded.
- [ ] File schema examples validated by parser tests.
- [ ] Existing workspace-memory regression suite passes.
- [ ] Workspace watcher worker remains database-free.
- [ ] Cross-workspace and forged-scope security tests pass.
- [ ] Atomic write and crash recovery tests pass.
- [ ] Invalid-file last-valid-projection behavior verified.
- [ ] Conflict UI and review-policy flows tested.
- [ ] Git warning and no-auto-publish behavior verified.
- [ ] `AGENTS.md` and `CLAUDE.md` managed edits preserve unrelated content.
- [ ] All new UI strings translated into six languages.
- [ ] Component test gate passes.
- [ ] Critical Playwright flows pass.
- [ ] Upgrade and rollback behavior verified with existing SQLite-only data.
- [ ] Scoped memory-identity uniqueness migration and intentional-fork behavior verified.
- [ ] Privacy review confirms no local-only fields are exported or telemetered.
- [ ] Documentation for external agents is included in generated `memory/README.md`.

## 29. Final Recommendation

Implement portable workspace memory as a new layer over the existing workspace-memory feature:

- **Markdown record files are the portable authority.**
- **SQLite is the local projection and operational index.**
- **The existing trusted workspace watcher observes external changes.**
- **The main process validates and persists through Modules and Models.**
- **Stable workspace identity lives in `.aifetchly/workspace.json`.**
- **Agent discovery is enabled through optional, user-approved instruction bridges.**
- **Private memory remains the default, and publication is always explicit.**

This approach provides cross-agent and cross-clone memory without weakening AiFetchly's current database layering, workspace isolation, permission model, or local-first behavior.
