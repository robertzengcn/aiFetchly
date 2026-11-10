# Portable Workspace Memory — Open Decisions Resolved

| Field | Value |
|---|---|
| Source | PRD §27 (product) + technical-design §30 (engineering) |
| Created | 2026-08-24 |
| Status | All resolved |

## PRD §27: Open product decisions

1. **One directory vs separate subdirectories for local/team** — **Resolved: one directory.** The implementation uses `.aifetchly/memory/` with `visibility: local|team` as metadata. Rationale: simpler Git ignore behavior, no ambiguous partial-ignore; Git determines actual tracking.

2. **External deletions require review under `review-new`** — **Resolved: yes.** `reconcileMissingPaths` marks records `missing` (not deleted) under `review-new`/`review-all`; only `automatic` policy deletes. The import-review UI shows deletions separately with approve/reject.

3. **Portable→private retains the same ID** — **Resolved: retain the ID locally, record detachment.** `privatizeMemory` deletes the portable state but keeps the projection row with the same memoryId; the audit records the detachment to prevent re-import confusion.

4. **INDEX includes full content or summaries** — **Resolved: full content below the 512 KiB cap, then deterministic truncation with record links.** `summarize()` collapses whitespace to 240 code points, prefers sentence boundaries, appends `…` only when truncated.

5. **Auto-dream may write portable-local automatically** — **Resolved: no, keep private by default.** `AIWorkspaceAutoDreamService` skips portable records entirely (files are authoritative); new auto-dream memories are private SQLite records. Promotion is an explicit user action.

6. **`workspace.json` created separately from enabling portable memory** — **Resolved: create as part of enablement with a preview.** `enable()` creates `workspace.json` when missing, with the preview showing the planned files before confirmation.

7. **Future schema versions allow custom memory types** — **Resolved: keep the closed taxonomy.** The parser rejects unknown types with `memory-field-invalid`; the six allowed types (project/decision/workflow/convention/reference/warning) cover the v1 surface.

## Technical-design §30: Open engineering decisions

1. **Baseline migration timing** — **Resolved: migration `1700000000000-portable-workspace-memory` is registered in `DB_MIGRATIONS`.** The runtime backfill in `WorkspaceMemoryScopeModule` covers dev DBs; the formal migration covers packaged builds. 4 migration tests verify creation, backfill, idempotency, and down-refusal.

2. **Rejected-record retrieval** — **Resolved: exclude the whole record while its file is rejected.** `listExcludedMemoryIds` includes `syncState: rejected`; retrieval filters them out. The last-valid projection is retained in SQLite for recovery but never injected.

3. **Scope merge conflict UI** — **Resolved: bind non-conflicting records first, quarantine conflicts.** `mergeScopes` moves non-conflicting records, marks differing portable records as `conflicted` (with a re-ID'd quarantine), and the conflict-resolution UI lets the user choose.

4. **`js-yaml` vs restricted parser** — **Resolved: `js-yaml` with JSON-safe schema + strict post-parse validation.** `parseDraft` uses `yaml.JSON_SCHEMA`, deep-walks the result, rejects custom tags/aliases, and validates through explicit type guards. Never casts parsed YAML directly.

5. **Index timestamp** — **Resolved: max record `updatedAt` (D-08).** `buildIndex` uses the maximum portable `updatedAt` in the indexed set; empty index uses `1970-01-01T00:00:00.000Z`.

6. **Import review persistence** — **Resolved: bounded portable state + projection exclusion.** Pending-review records have a portable-state row with `syncState: pending-review`; they're excluded from retrieval. No separate pending table needed for v1.

7. **Detached records** — **Resolved: keep eligible only after explicit conversion to private.** `privatizeMemory` converts to private; `disable` does NOT delete projections (they stay as detached until the user explicitly converts or re-enables).

8. **Watcher scanner location** — **Resolved: `src/childprocess/aifetchly-config/PortableMemoryFileScanner.ts`.** Complies with the repo rule that worker-specific code lives under `src/childprocess/`; the scanner has no DB/Electron imports (verified by test).
