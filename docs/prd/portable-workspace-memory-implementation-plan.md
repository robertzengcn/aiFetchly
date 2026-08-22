# Portable Workspace Memory - Implementation Plan

| Field | Value |
| --- | --- |
| Source PRD | `docs/prd/portable-workspace-memory-prd.md` |
| Technical design | `docs/prd/portable-workspace-memory-technical-design.md` |
| Created | 2026-08-23 |

Implements the PRD's Phase 1–2 core (file contract, identity, projection,
synchronization) plus Phase 3 UI essentials and Phase 4 policy defaults, mapped
onto the design's implementation sequence (§26 Phase A–E).

## Verified starting state

- Workspace memory (SQLite-only) is fully implemented and green: entity, model,
  module, retrieval, auto-dream, IPC, panel UI.
- `WorkspaceKeyService` derives `ws_<sha32(canon-root)>`; `WorkspaceResolver`
  resolves approved conversations; `WorkspaceMemoryContextResolver` is the
  renderer trust boundary.
- Watcher: one `WorkspaceWatchManager` → one forked worker
  (`WorkspaceConfigWatchWorker`) → `WorkspaceConfigScanner` snapshots
  (`.aifetchly/**` already chokidar-watched recursively) → zod-validated events
  → trust-filtered apply. Worker is DB-free (env `WORKER_TYPE` guard in models).
- `DB_MIGRATIONS` is empty; dev runs TypeORM `synchronize` (migration cutover
  remains a release prerequisite per design §9.1 — this plan ships the
  migration file and a runtime legacy-scope backfill so dev DBs converge).

## Phase A — Scope foundation (design D-01)

1. `src/entityTypes/portableWorkspaceMemoryTypes.ts` — all shared contracts
   (frontmatter/document/draft/snapshot/view/diagnostic types, ID patterns).
2. Entities: `AIWorkspaceMemoryScope`, `AIWorkspaceMemoryScopePath`,
   `AIWorkspaceMemoryPortableState`, `AIWorkspaceMemorySyncAudit` (+ register in
   `SqliteDb.ts`).
3. `AIWorkspaceMemoryEntity`: add nullable `scopeId`, composite unique
   `(scopeId, memoryId)`, scope indexes; drop global `memoryId` uniqueness.
4. Models for the four new tables with `WORKER_TYPE` guards + scope-scoped
   queries.
5. Scope-based methods on `AIWorkspaceMemoryModel` (`getByScopeAndMemoryId`,
   `listByScope`, `listActiveForScopeRetrieval`, update/delete/markUsed by
   scope) + `backfillScopeIdForWorkspaceKey`.
6. `WorkspaceMemoryScopeModule`: resolve/create legacy scope
   (`wscope-legacy-<key-without-ws_>`), bind portable identity, transactional
   scope merge (duplicate memoryId → regenerate incoming ID + audit; no data
   loss), policy updates.
7. `WorkspaceMemoryScopeResolver` (service): conversationId →
   `WorkspaceMemoryScopeContext { scopeId, workspaceKey, workspaceRoot, … }`;
   `WorkspaceMemoryContextResolver` delegates to it (compat).
8. Migration `src/migrations/…-portable-workspace-memory.ts` (table creates +
   backfill + unique swap; count-verified rebuild).
9. Tests: scope model/module (backfill, bind, merge), resolver, isolation.

## Phase B — Portable format & files (design D-02/03/06/07/08)

1. `PortableWorkspaceMemoryFormat.ts` (pure): draft → validated document,
   canonical serializer (field order, LF, `js-yaml` safe schema, `noRefs`),
   H1 title extraction outside code fences, sha-256 hashing, UUID/filename
   match, timestamps, limits (16 KiB / 8k / 200 / 20-array caps).
2. `PortableWorkspaceMemoryFileStore.ts`: internal path construction,
   containment + symlink rejection, `write-file-atomic` writes returning
   hash/bytes, README/INDEX/record deletes.
3. `PortableWorkspaceIdentityService.ts`: draft inspection (missing/valid/
   invalid), `randomUUID` identity creation, regeneration support.
4. `PortableWorkspaceMemoryIndexService.ts`: deterministic `INDEX.md`
   (max-`updatedAt` timestamp, type-priority sort, 240-cp summaries, 512 KiB
   cap) + managed-block `README.md`.
5. `PortableWorkspaceMemoryModule.ts`: portable-state upsert, reject (keep last
   valid projection), conflict marking, missing reconciliation by policy,
   private↔portable promotion, sanitized audit rows, diagnostics/conflict
   views.
6. Tests: format round-trip/limits/secrets, index determinism, store path
   safety, module state machine.

## Phase C — Watcher & reconciliation (design D-04/05)

1. `src/childprocess/aifetchly-config/PortableMemoryFileScanner.ts`: bounded
   worker scan (lstat-first, 16 KiB cap, 1,000 files, 8-way concurrency, strict
   UTF-8, frontmatter/body split, hashes, README/INDEX hash-only, symlink
   rejection, `complete` flag, diagnostics).
2. Wire into `workerScanner.ts` (`snapshot.portableMemory`); extend
   `AIFetchlyConfigSnapshot`/`AIFetchlyConfigDiff` (`portableMemoryChanged`).
3. `WorkspaceChokidarWatcher`: ignore atomic-write temp patterns
   (`*.tmp` etc.).
4. `WorkspaceWatchProtocol`: bounded zod schema for `portableMemory` payload.
5. `WorkspaceWatchManager`: optional `portableMemorySnapshotCallback`,
   fire-and-forget enqueue, never blocks worker message handling.
6. `WorkspaceWatchManagerSingleton`: construct shared coordinator + wire.
7. `PortableWorkspaceMemorySyncCoordinator.ts`: per-scope serialized queues,
   snapshot coalescing (user mutations never dropped), reconciliation
   algorithm (§14.2), idempotency by hash, review policies, missing-file
   reconciliation only on complete scans, conflict detection, one renderer
   summary event.
8. Tests: scanner (incl. no-DB import boundary), protocol bounds, manager
   forwarding, coordinator (idempotency, incomplete-scan-no-delete, policies,
   conflict, coalescing).

## Phase D — IPC, service facade, Git, bridge

1. `PortableWorkspaceMemoryService.ts`: status/enable/preview+export/rescan/
   diagnostics/conflicts/resolve/policy + promote/privatize paths
   (file-first, hash-guarded).
2. Channels in `channellist.ts`, handlers in
   `portable-workspace-memory-ipc.ts` (Zod strict schemas; no AI gate for
   non-AI ops; forged root/scope/path rejected), registration, preload
   allowlist + `changed` event.
3. `src/views/api/portableWorkspaceMemory.ts`.
4. `PortableWorkspaceMemoryGitStatusService.ts` (read-only `execFile` git).
5. `PortableWorkspaceMemoryBridgeService.ts` (AGENTS.md/CLAUDE.md managed
   blocks, preview/apply/remove with hash guard).
6. Tests: IPC (forged scope, strict schema), service, git-status, bridge.

## Phase E — UI + i18n

1. `WorkspaceMemoryPanel.vue`: portable status banner, storage/sync/visibility
   badges, rescan, enable/manage, diagnostics counts, filters.
2. `PortableMemoryEnableDialog.vue` (preview → confirm flow) +
   diagnostics/conflict dialogs.
3. Retrieval update: scope-based candidate fetch, exclude
   rejected/conflicted/missing/pending records, untrusted-context header.
4. i18n keys in en/zh/es/fr/de/ja; component tests (`yarn test:components`).

## Phase F — Auto-dream + verification

1. `AIWorkspaceAutoDreamService` resolves scope IDs; keeps created memories
   private (D-09); never hard-deletes portable records.
2. Full gates: `yarn testmain`, targeted vitest suites, one-shot `tsc` +
   `vue-check`, component tests; update traceability notes.

## Conventions honored

- IPC → Service → Module → Model → Entity layering; worker processes DB-free.
- Zod at boundaries; no `any`; explicit returns; i18n ×6 for all UI text.
- Atomic commits per logical unit; never `--no-verify`.
