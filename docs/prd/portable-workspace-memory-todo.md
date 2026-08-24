# Portable Workspace Memory Completion TODO

| Field | Value |
| --- | --- |
| Status | Gaps found |
| Created | 2026-08-24 |
| Source PRD | `docs/prd/portable-workspace-memory-prd.md` |
| Technical design | `docs/prd/portable-workspace-memory-technical-design.md` |
| Purpose | Track the work required to satisfy all launch requirements and acceptance criteria |

## Completion rule

Do not mark this feature complete until every task below is checked, all 68 functional requirements and 13 acceptance criteria have traceable automated evidence, and the technical-design definition of done is satisfied.

Each implementation task must include its required unit, component, integration, or Playwright tests in the same commit. Portable file mutations must remain inside an approved workspace, use file-first atomic writes, run through the per-scope synchronization queue, and update SQLite only through Models and Modules.

## P0: Complete the authoritative portable CRUD path

- [x] **Route memory creation by storage mode** (`FR-013`, `FR-016`, `FR-024`, `FR-037`, `FR-043`, `FR-060`)
  - Keep `private` creation on the existing SQLite path.
  - Route `portable-local` and `portable-team` creation through `PortableWorkspaceMemoryService` from the start.
  - Validate and secret-filter the canonical serialized bytes before writing.
  - Atomically write the record before creating its SQLite projection and portable state.
  - Rebuild the full active index and write a sanitized audit event.
  - Add component, IPC, service, filesystem, and end-to-end tests for all three storage modes.

- [x] **Route portable edits through the file-first service** (`FR-013`, `FR-016`, `FR-024`, `FR-029`, `FR-039`, `FR-043`, `AC-006`, `AC-007`)
  - Forward `storageMode`, `visibility`, and `expectedHash` from `WorkspaceMemoryEditorDialog.vue` through `WorkspaceMemoryPanel.vue`.
  - Detect whether the target record is private or portable in the main process.
  - For portable records, compare the current disk hash, validate the new document, write atomically, re-parse the written bytes, then update the projection.
  - Never allow the legacy SQLite update path to mutate portable fields directly.
  - Test a real renderer save after an external edit and prove that external bytes are not overwritten.

- [x] **Implement portable archive and contradict operations** (`FR-039`, `FR-040`, `FR-043`, `FR-060`)
  - Update `status` in the authoritative file first.
  - Re-import the written file, update the projection, remove the record from `INDEX.md`, and audit the action.
  - Route auto-dream archive/contradict proposals through the portable policy flow instead of changing SQLite.

- [x] **Implement portable hard delete** (`FR-039`, `FR-042`, `FR-043`, `FR-060`)
  - Require an exact-memory confirmation in the UI.
  - Delete the file first and delete portable state/projection only after successful filesystem removal.
  - Rebuild the index and audit the deletion.
  - Respect review policy for externally deleted files.
  - Add failure-injection tests proving a failed file deletion cannot leave a silent detached projection.

- [x] **Wire promotion and privatization into the memory UI** (`FR-038`, `FR-054`, `FR-060`)
  - Let users promote a private record without creating a duplicate logical memory.
  - Show a Markdown preview, visibility choice, secret warning, and confirmation.
  - For privatization, show Git-history warnings when tracked and delete the file before removing portable state.
  - Add component and Playwright coverage for both transitions.

## P0: Serialize all synchronization work per scope

- [x] **Use one per-scope queue for every mutation** (`FR-024` through `FR-029`, technical design D-05/D-06)
  - Route create, update, archive, contradict, delete, export, promotion, privatization, rescan, index generation, conflict resolution, and identity regeneration through `PortableWorkspaceMemorySyncCoordinator.enqueueOperation()`.
  - Remove production write paths that instantiate a file store and mutate files outside the queue.
  - Add ordering and concurrency tests covering watcher snapshots interleaved with each user mutation.

- [x] **Make app writes use the shared validator** (`FR-009`, `FR-013`, technical design sections 7 and 19)
  - Do not treat `buildDocument()` plus `serialize()` as validation.
  - Re-parse canonical bytes and apply `MemorySecretFilter` before every projection update.
  - Cover conflict merge content, promotion, bulk export, archive, contradict, and identity-related rewrites.

- [x] **Finish startup and branch/worktree reconciliation evidence** (`FR-026`, `AC-002`, `AC-009`)
  - Verify complete reconciliation on workspace acquire, application restart, manual rescan, Git branch change, worktree change, and watcher restart.
  - Treat deletion of the entire memory directory as a complete absence when the scan itself succeeds.
  - Publish one sanitized summary event and refresh the renderer within the required latency.

## P0: Correct conflict and invalid-file handling

- [x] **Make conflict resolution race-safe** (`FR-029`, `FR-041`, `AC-007`)
  - Include the observed file hash in the resolution request.
  - Re-read and compare the file immediately before `use-app` or `merge` writes.
  - Re-validate and re-import the selected/merged bytes before clearing conflict state.
  - Update the projection and index in the same queued operation.
  - Require the second confirmation specified for overwriting with the AiFetchly version.

- [x] **Reject duplicate IDs without importing either ambiguous record** (`FR-009`, `FR-014`, `FR-028`)
  - Fix reconciliation so drafts identified as duplicates are not processed by the subsequent import loop.
  - Keep the last valid projection excluded until ambiguity is resolved.
  - Persist a diagnostic for every conflicting path without storing file bodies.
  - Add tests where duplicate files have different hashes and scan order changes.

- [x] **Persist unknown-field warnings as diagnostics** (`FR-011`, `FR-030`)
  - Forward parser warnings from `PortableWorkspaceMemoryFormat.parseDraft()` into portable state/diagnostic views.
  - Continue ignoring unknown fields rather than copying them into metadata.
  - Test warning visibility in the renderer.

- [x] **Verify last-valid projection behavior end to end** (`FR-014`, `FR-028`, `AC-003`)
  - Test malformed YAML, secret-like content, unsupported schema, oversized input, filename mismatch, and symlinks.
  - Prove the file stays unchanged, the previous projection is retained for recovery but excluded from retrieval, and an actionable relative-path diagnostic appears.

## P0: Finish migration and portable identity behavior

- [x] **Add and verify the database baseline migration** (technical design sections 2.4, 9.1, 26, and 31)
  - Register a production-tested baseline migration before the incremental portable-memory migration.
  - Verify migration order and packaged-build cutover from TypeORM synchronization.
  - Test empty, real pre-feature, multi-workspace, archived-memory, and post-feature databases.

- [x] **Implement the specified transactional scope merge rules** (`FR-006`, `FR-067`, `FR-068`, `AC-004`, `AC-013`)
  - Deduplicate records only when canonical portable fields and hashes match.
  - Preserve a portable record over a colliding private record and re-ID only the private copy with an audit event.
  - Mark differing portable records as scope-merge conflicts instead of blindly changing an ID.
  - Verify counts before deleting the losing scope and roll back the whole merge on failure.
  - Test two clones, worktrees, intentional forks, and identical memory IDs in unrelated scopes.

- [x] **Make workspace-identity regeneration a safe fork operation** (`FR-007`, `AC-013`)
  - Add the explicit UI action and warning.
  - Inspect Git tracking state, acquire the scope queue, and compare the identity-file hash before writing.
  - Atomically write the new identity, bind/create the correct isolated scope, reconcile retained records, and audit the operation.
  - Prove the original and fork coexist without shared mutation or loss of history.

## P1: Complete product controls and review workflows

- [x] **Add the complete portable-memory settings surface** (`FR-054`, `FR-062`)
  - Provide post-enablement controls for export, import policy, rescan, disable/rollback, bridge management, default storage mode, and identity regeneration.
  - Disabling must stop import/watch behavior without deleting files or private SQLite memories.
  - Let users explicitly choose how detached portable projections are handled.

- [x] **Implement import review UI** (`FR-042`, `FR-062`, `FR-063`)
  - List pending new records, pending edits, and pending deletions separately.
  - Show bounded, safely rendered previews and relative paths.
  - Wire approve/reject actions and refresh status, retrieval eligibility, projection, index, and audit state.

- [x] **Show exact instruction-bridge diffs and management actions** (`FR-034` through `FR-036`, `AC-010`)
  - Render the exact unified diff returned by preview before confirmation.
  - Add bridge install/update/remove controls after initial enablement.
  - Preserve unrelated `AGENTS.md` and `CLAUDE.md` bytes and block duplicate/overlapping managed markers.

- [x] **Add reveal-file and full per-memory metadata actions** (PRD section 16.2)
  - Reveal only the main-process-resolved portable file.
  - Show storage mode, visibility intent, sync state, last portable update, last local use, and sanitized source class.
  - Provide an accessible full-value affordance for truncated paths and titles.

- [x] **Improve enable/import preview fidelity** (PRD sections 16.1 and 19.3)
  - Scan existing files before enablement and show valid, invalid, conflicting, active, archived, local, and team counts.
  - Show export count, destination, skipped records with reasons, and secret-filter warnings.
  - Do not create or mutate files until the final confirmation.

## P1: Correct index, rollback, and auto-dream behavior

- [x] **Always rebuild `INDEX.md` from the complete eligible record set** (`FR-031`, `FR-043`, `AC-001`)
  - Do not build the index from only the current export batch.
  - Include every active, valid, synced portable record and exclude archived, contradicted, rejected, conflicted, pending, and missing records.
  - Avoid rewriting identical bytes.

- [x] **Complete rollback and re-enable behavior** (`FR-054`, PRD section 19.4)
  - Verify files and last-valid projections survive disablement.
  - Ensure re-enabling performs a complete trusted reconciliation without duplicates.
  - Leave instruction bridges untouched unless separately removed.

- [x] **Add auto-dream portable review proposals** (`FR-040`, technical design section 19.5 and Phase E)
  - Keep new auto-dream memories private by default.
  - When auto-dream proposes changing portable memory, queue a reviewable suggestion when policy disallows automatic portable edits.
  - Never hard-delete or directly mutate the SQLite projection of portable memory.

## P1: Internationalization, accessibility, privacy, and observability

- [x] **Remove untranslated renderer fallbacks and enforce locale parity** (`FR-066`)
  - Add translation keys for portable preview/enable failures and any remaining user-visible literals.
  - Verify English, Chinese, Spanish, French, German, and Japanese contain identical portable-memory key sets.
  - Add an automated locale-key parity test.

- [ ] **Complete accessibility coverage** (PRD section 16.7)
  - Ensure diagnostics and conflict controls work by keyboard.
  - Do not communicate state by color alone.
  - Make confirmations identify the exact record and action.
  - Test long titles/paths and accessible full-value labels.

- [ ] **Complete privacy and logging review** (`FR-057`, `FR-060`, technical design section 28)
  - Prove exports omit local IDs, absolute roots, source conversation/task/message IDs, retrieval telemetry, embeddings, hashes, and consolidation metadata.
  - Prove logs, diagnostics, renderer events, and optional telemetry omit titles, bodies, workspace identifiers/paths, memory filenames/IDs, branches, and commit hashes where prohibited.
  - Record the completed privacy review in the launch checklist.

## P0: Replace placeholder acceptance coverage with real tests

- [x] **Rewrite the portable-memory Playwright suite to operate the application** (`FR-065`)
  - Remove tests that satisfy an acceptance criterion by writing or comparing fixture files without invoking AiFetchly.
  - Exercise the real renderer, preload, IPC, service, database, watcher, and filesystem path.

- [x] **E2E: enable and export** (`AC-001`, `AC-006`, `AC-009`)
  - Create a private memory in the UI, enable portable memory, export it, and verify the generated record, README, index, projection, and UI badges.

- [x] **E2E: external edit and invalid edit** (`AC-002`, `AC-003`)
  - Edit a real record externally and verify UI/retrieval refresh within one second after debounce.
  - Make the file invalid and verify last-valid recovery state, prompt exclusion, and diagnostic display.

- [x] **E2E: concurrent edit and conflict resolution** (`AC-007`)
  - Open the editor, modify the file externally, save in AiFetchly, and prove no overwrite occurs.
  - Exercise use-file, use-app, and manual-merge resolutions, including a second intervening external edit.

- [x] **E2E: isolation, clone, fork, and revocation** (`AC-004`, `AC-005`, `AC-011`, `AC-013`)
  - Switch between approved workspaces and prove list, write, delete, retrieval, and prompt isolation.
  - Verify two clones share portable identity but retain independent local operational metadata.
  - Regenerate fork identity and prove both sets coexist.
  - Revoke workspace approval and prove watching, import, file mutation, and retrieval stop.

- [x] **E2E: bridge lifecycle and no publication** (`AC-008`, `AC-010`)
  - Preview, install, update, and remove both bridge types while preserving unrelated bytes.
  - Spy on Git execution and filesystem changes to prove no commit, push, or `.gitignore` mutation occurs automatically.

- [x] **Add missing fault-injection and recovery suites** (`AC-006`, `AC-009`)
  - Terminate or fault writes before temporary-file completion, before rename, after rename, and before projection update.
  - Reopen the workspace and prove convergence to the old or new complete file without truncated authority.

## P1: Verify non-functional requirements

- [ ] **Add performance benchmarks** (PRD section 18.1 and success criteria `SC-001`, `SC-004`)
  - Reconcile 1,000 valid records totaling at most 16 MiB within 3 seconds after warm-up.
  - Reflect one external edit in projection and UI within one second after debounce.
  - Generate the bounded index within 500 ms.
  - Prove unchanged reconciliation avoids parser, database, and index writes where safe.

- [ ] **Add cross-platform path and watcher verification** (PRD sections 18.2 and 18.3)
  - Exercise Windows, macOS, and Linux path behavior, atomic rename patterns, symlink rejection, case sensitivity, branch checkout batches, and watcher restart recovery.

- [ ] **Close all testing-matrix gaps** (`FR-064`, PRD section 21)
  - Cover every allowed enum value, malicious Markdown/HTML, UTF-8/control characters, duplicate IDs, external rename/atomic rename, export retry, selected export, disable/re-enable, future schemas, Git states, loading/partial/error UI states, and translation parity.
  - Fix un-awaited rejection assertions in `PortableWorkspaceMemoryFileStore.test.ts`.

## Final launch gate

- [ ] Resolve and record every open product decision in PRD section 27.
- [ ] Resolve and record every open engineering decision in technical-design section 30.
- [ ] Map each `FR-001` through `FR-068` to implementation and passing test evidence.
- [ ] Map each `AC-001` through `AC-013` to a passing integration or end-to-end test.
- [ ] Run and pass `yarn test`, `yarn testmain`, `yarn test:components`, `yarn test:e2e`, `yarn typecheck`, and `yarn vue-typecheck`.
- [ ] Complete every item in the PRD launch checklist.
- [ ] Re-run the PRD/technical-design completion audit and obtain a `passed` result.
