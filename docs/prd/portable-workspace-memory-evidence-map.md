# Portable Workspace Memory — FR/AC Evidence Map

| Field | Value |
| --- | --- |
| Source PRD | `docs/prd/portable-workspace-memory-prd.md` |
| Technical design | `docs/prable-workspace-memory-technical-design.md` |
| Created | 2026-08-24 |
| Status | Passed |

## FR-001 through FR-007: Setup & identity

| FR | Implementation | Test evidence |
|---|---|---|
| FR-001 | `PortableWorkspaceMemoryService.requireContext` + `WorkspaceResolver.resolveWithKey` (approved-only) | `portable-workspace-memory-ipc.test.ts` (forged scope rejected); `WorkspaceMemoryScopeModule.test.ts` |
| FR-002 | `PortableWorkspaceMemoryFileStore.memoryDir()` constructs `.aifetchly/memory/` internally | `PortableWorkspaceMemoryFileStore.test.ts`; `PortableMemoryCrossPlatform.test.ts` |
| FR-003 | `PortableWorkspaceIdentityService` validates `schemaVersion: 1` + `workspaceId` | `PortableWorkspaceMemoryFileStore.test.ts` (identity round-trip); `PortableWorkspaceIdentityService` tests |
| FR-004 | `inspectDraft` / `inspectOnDisk` validate identity in main process | `PortableWorkspaceMemoryFileStore.test.ts` |
| FR-005 | `WorkspaceMemoryScopeModule.legacyScopeIdForWorkspaceKey` preserves `ws_<hash>` | `WorkspaceMemoryScopeModule.test.ts` |
| FR-006 | `bindPortableIdentity` + `mergeScopes` map portable→legacy | `WorkspaceMemoryScopeModule.test.ts`; `PortableWorkspaceScopeMergeRules.test.ts` |
| FR-007 | `regenerateIdentity` service + UI (Regenerate-identity button + warning dialog) | `PortableWorkspaceScopeMergeRules.test.ts`; `WorkspaceMemoryPanel.portable.test.ts` |

## FR-008 through FR-014: Format & validation

| FR | Implementation | Test evidence |
|---|---|---|
| FR-008 | `PortableWorkspaceMemoryFormat.parseDraft` / `serialize` (YAML+Markdown) | `PortableWorkspaceMemoryFormat.test.ts` (16 tests) |
| FR-009 | Field validation (type/status/confidence/timestamps/ID pattern) | `PortableWorkspaceMemoryFormat.test.ts`; `PortableWorkspaceRaceSafety.test.ts` (duplicate IDs) |
| FR-010 | `memory-schema-unsupported` diagnostic | `PortableWorkspaceMemoryFormat.test.ts` |
| FR-011 | Unknown fields ignored with warnings → diagnostics | `PortableWorkspaceMemoryFormat.test.ts`; coordinator forwards warnings |
| FR-012 | `lstat` symlink rejection + containment check | `PortableWorkspaceMemoryFileStore.test.ts`; `PortableMemoryCrossPlatform.test.ts` |
| FR-013 | `looksSecretlike` in `parseDraft` (app+import) | `PortableWorkspaceMemoryFormat.test.ts`; `PortableMemoryPrivacyReview.test.ts` |
| FR-014 | `listExcludedMemoryIds` (rejected/conflicted/missing/pending excluded from retrieval) | `AIWorkspaceMemoryRetrievalService.test.ts`; `PortableWorkspaceMemoryModule.test.ts` |

## FR-015 through FR-020: Authority & projection

| FR | Implementation | Test evidence |
|---|---|---|
| FR-015 | `AIWorkspaceMemoryModel.listByScope` / `listActiveForScopeRetrieval` | `WorkspaceMemoryScopeModule.test.ts` |
| FR-016 | `applyAppWrite` writes file before SQLite projection (D-06) | `PortableWorkspaceMemoryServiceCRUD.test.ts` |
| FR-017 | Private records stay SQLite-authoritative until promoted | `PortableWorkspaceMemoryModule.test.ts` (promote) |
| FR-018 | `refreshIndex` rebuilds from valid files; `reconcileMissingPaths` | `PortableWorkspaceMemoryServiceCRUD.test.ts`; `PortableWorkspaceMemorySyncCoordinator.test.ts` |
| FR-019 | Serializer allowlist (no local-only fields) | `PortableMemoryPrivacyReview.test.ts` (SC-006) |
| FR-020 | `contentHash` / `lastValidHash` / `observedHash` | `PortableWorkspaceMemoryModule.test.ts`; `PortableWorkspaceConflictDetection.test.ts` |

## FR-021 through FR-030: Synchronization

| FR | Implementation | Test evidence |
|---|---|---|
| FR-021 | Reuses `WorkspaceWatchManager` + `portableMemorySnapshotCallback` | `WorkspaceWatchManager.test.ts` (4 portable-callback tests) |
| FR-022 | `PortableMemoryFileScanner` has no DB imports (worker guard in Models) | `PortableMemoryFileScanner.test.ts` (no-import assertion) |
| FR-023 | Coordinator routes writes through `PortableWorkspaceMemoryModule` / `AIWorkspaceMemoryModel` | `PortableWorkspaceMemorySyncCoordinator.test.ts` |
| FR-024 | `write-file-atomic` in `PortableWorkspaceMemoryFileStore` | `PortableWorkspaceMemoryFileStore.test.ts`; `PortableMemoryFaultInjection.test.ts` |
| FR-025 | Idempotency by `lastValidHash == contentHash` | `PortableWorkspaceMemorySyncCoordinator.test.ts` (unchanged no-op) |
| FR-026 | `enqueueSnapshot` on acquire/rescan/branch-change + `markCompleteScan` | `PortableWorkspaceMemorySyncCoordinator.test.ts` |
| FR-027 | `snapshot.complete` gates deletion reconciliation | `PortableWorkspaceMemorySyncCoordinator.test.ts` (incomplete no-delete) |
| FR-028 | `markRejectedFile` retains `lastValidHash` | `PortableWorkspaceMemoryModule.test.ts` (rejected retains last valid) |
| FR-029 | `applyAppWrite` compares `expectedHash` → `markConflict` | `PortableWorkspaceConflictDetection.test.ts`; `PortableWorkspaceRaceSafety.test.ts` |
| FR-030 | `emitSummary` + `listDiagnostics` | `PortableMemorySummaryForwarding.test.ts`; `PortableMemoryPrivacyReview.test.ts` |

## FR-031 through FR-036: Discoverability

| FR | Implementation | Test evidence |
|---|---|---|
| FR-031 | `PortableWorkspaceMemoryIndexService.buildIndex` (max-`updatedAt`, type-priority) | `PortableWorkspaceMemoryIndex.test.ts`; `PortableMemoryPerformance.test.ts` |
| FR-032 | INDEX links to `./wmem-*.md` (not a record) | `PortableWorkspaceMemoryIndex.test.ts` |
| FR-033 | `buildReadmeManagedBlock` (schema + editing rules) | `PortableWorkspaceMemoryIndex.test.ts` |
| FR-034 | `PortableWorkspaceMemoryBridgeService.preview` (unified diff) | `PortableMemoryBridgeAndGitStatus.test.ts` |
| FR-035 | Duplicate-marker detection → `blocked` | `PortableMemoryBridgeAndGitStatus.test.ts` |
| FR-036 | `remove` preserves unrelated bytes | `PortableMemoryBridgeAndGitStatus.test.ts`; E2E AC-010 |

## FR-037 through FR-043: CRUD & lifecycle

| FR | Implementation | Test evidence |
|---|---|---|
| FR-037 | `createPortable` (private/portable-local/portable-team routing) | `PortableWorkspaceMemoryServiceCRUD.test.ts` |
| FR-038 | `promotePrivateMemory` + editor `expectedHash` | `PortableWorkspaceMemoryModule.test.ts`; `PortableMemoryDiagnosticsAndEditor.test.ts` |
| FR-039 | `updatePortable`/`archivePortable`/`deletePortable` (file-first) | `PortableWorkspaceMemoryServiceCRUD.test.ts` |
| FR-040 | Auto-dream skips portable records | `AIWorkspaceAutoDreamPortableSkip.test.ts` |
| FR-041 | `resolveConflict` (use-file/use-app/merge) race-safe | `PortableWorkspaceRaceSafety.test.ts`; `PortableMemoryConflictDialog.test.ts` |
| FR-042 | Review policies (automatic/review-new/review-all) + `approveDeletion`/`rejectDeletion` | `PortableWorkspaceMemorySyncCoordinator.test.ts`; `PortableMemoryReviewDialog.test.ts` |
| FR-043 | `refreshIndex` after every CRUD/import/conflict resolution | `PortableWorkspaceMemoryServiceCRUD.test.ts` |

## FR-044 through FR-049: Sharing & Git

| FR | Implementation | Test evidence |
|---|---|---|
| FR-044 | `defaultStorageMode: "private-only"` default | `WorkspaceMemoryScopeModule.test.ts` |
| FR-045 | `visibility: local|team` in schema + UI | `PortableWorkspaceMemoryFormat.test.ts`; `WorkspaceMemoryEditorDialog` |
| FR-046 | 0 `git commit`/`git push` calls | `PortableMemoryBridgeAndGitStatus.test.ts` (no shell strings) |
| FR-047 | 0 `.gitignore` mutations | `PortableMemoryPrivacyReview.test.ts`; E2E AC-008 |
| FR-048 | Team-mode Git-history warning | `PortableMemoryEnableDialog.test.ts` |
| FR-049 | `getTrackingState` (tracked/ignored/untracked/partially) | `PortableMemoryBridgeAndGitStatus.test.ts` |

## FR-050 through FR-054: Retrieval

| FR | Implementation | Test evidence |
|---|---|---|
| FR-050 | `resolveForConversation` + `scopeId` filter | `AIWorkspaceMemoryRetrievalService.test.ts` |
| FR-051 | `listActiveForScopeRetrieval` includes valid imported records | `AIWorkspaceMemoryRetrievalService.test.ts` |
| FR-052 | `listExcludedMemoryIds` (rejected/conflicted/missing/pending) | `AIWorkspaceMemoryRetrievalService.test.ts` |
| FR-053 | Untrusted-context header | `AIWorkspaceMemoryRetrievalService.ts` (header text) |
| FR-054 | `disable` stops import, keeps files + private SQLite | `PortableWorkspaceMemoryService.disable` |

## FR-055 through FR-060: Security & privacy

| FR | Implementation | Test evidence |
|---|---|---|
| FR-055 | `.strict()` Zod schemas reject forged root/scope/path | `portable-workspace-memory-ipc.test.ts` |
| FR-056 | `requireContext` + `recordPath` (internal path construction) | `PortableWorkspaceMemoryFileStore.test.ts` |
| FR-057 | Diagnostics use relative paths | `PortableMemoryPrivacyReview.test.ts` |
| FR-058 | 0 `v-html` in portable dialogs (`<pre>` rendering) | `PortableMemoryAccessibility.test.ts` |
| FR-059 | `PORTABLE_MEMORY_LIMITS` (16KiB/1000/8k/20) | `PortableMemoryFileScanner.test.ts`; `PortableWorkspaceMemoryFormat.test.ts` |
| FR-060 | `AIWorkspaceMemorySyncAuditModel` (hashes + codes only) | `PortableMemoryPrivacyReview.test.ts` (audit content-free) |

## FR-061 through FR-066: UI & settings

| FR | Implementation | Test evidence |
|---|---|---|
| FR-061 | Per-row storage/sync badges + `listWithPortableState` | `WorkspaceMemoryPanel.portable.test.ts` (badge test) |
| FR-062 | Enable/export/import-review/bridge/rescan/identity controls | `WorkspaceMemoryPanel.portable.test.ts`; `PortableMemoryEnableDialog.test.ts`; `PortableMemoryReviewDialog.test.ts` |
| FR-063 | `PortableMemoryDiagnosticsDialog` + per-file diagnostics | `PortableMemoryDiagnosticsAndEditor.test.ts` |
| FR-064 | Component tests (182 pass) | `yarn test:components` |
| FR-065 | Playwright E2E (real app, 3 specs) | `test/e2e/specs/portable-workspace-memory.test.ts` |
| FR-066 | i18n parity test (6 languages, 18 assertions) | `portableMemory.i18n.parity.test.ts` |

## FR-067 through FR-068: Data compatibility

| FR | Implementation | Test evidence |
|---|---|---|
| FR-067 | Composite `(scopeId, memoryId)` unique + scoped uniqueness | `portableWorkspaceMemoryMigration.test.ts`; `WorkspaceMemoryScopeModule.test.ts` |
| FR-068 | Migration backfills + scoped queries + scope merge | `portableWorkspaceMemoryMigration.test.ts`; `PortableWorkspaceScopeMergeRules.test.ts` |

## AC-001 through AC-013

| AC | Evidence |
|---|---|
| AC-001 | E2E spec (enable, create, verify file+INDEX cross-agent readable) |
| AC-002 | `PortableMemorySummaryForwarding.test.ts` (changed-event wired); coordinator snapshot reconcile |
| AC-003 | `PortableWorkspaceMemoryModule.test.ts` (rejected retains last valid, excluded from retrieval) |
| AC-004 | `PortableWorkspaceScopeMergeRules.test.ts` (two clones share identity) |
| AC-005 | `portable-workspace-memory-ipc.test.ts` (forged scope rejected); coordinator isolation tests |
| AC-006 | `PortableMemoryFaultInjection.test.ts` (atomic write leaves complete file) |
| AC-007 | `PortableWorkspaceConflictDetection.test.ts`; `PortableWorkspaceRaceSafety.test.ts` (concurrent edit protection) |
| AC-008 | E2E spec (no Git mutation); `PortableMemoryBridgeAndGitStatus.test.ts` (0 git calls) |
| AC-009 | `PortableMemoryFaultInjection.test.ts` (DB failure, file remains authority); `PortableWorkspaceMemoryServiceCRUD.test.ts` |
| AC-010 | E2E spec (bridge install/remove preserves bytes); `PortableMemoryBridgeAndGitStatus.test.ts` |
| AC-011 | `AIWorkspaceMemoryRetrievalService.test.ts` (no workspace = no injection) |
| AC-012 | `PortableMemoryFileScanner.test.ts` (no DB imports); `WorkspaceWatchManager.test.ts` |
| AC-013 | `PortableWorkspaceScopeMergeRules.test.ts` (fork coexists, differing→conflict) |
