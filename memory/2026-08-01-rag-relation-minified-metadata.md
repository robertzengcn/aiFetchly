# 2026-08-01 RAG Relation Minified Metadata

## Symptom

Production startup failed to initialize the TypeORM SQLite DataSource with:

`Entity metadata for Rp#chunks was not found. Check if you specified a correct entity object and if it's connected in the connection options.`

The failure cascaded into startup work, persisted skills/plugins loading, AI chat, language preference handlers, and user info refresh because they all depend on the shared `SqliteDb` DataSource.

## Root Cause

`RAGDocumentEntity` and `RAGChunkEntity` used string relation targets:

- `@OneToMany("RAGChunkEntity", "document")`
- `@ManyToOne("RAGDocumentEntity", "chunks")`

That relies on runtime class names matching the strings. In the packaged production bundle, Vite/Rollup minification renamed classes, so TypeORM saw the document entity as `Rp` and could not resolve the string target for `chunks` to the registered chunk entity metadata.

## Fix

Changed both RAG relation decorators to constructor callbacks:

- `@OneToMany(() => RAGChunkEntity, (chunk) => chunk.document)`
- `@ManyToOne(() => RAGDocumentEntity, (document) => document.chunks, { onDelete: "CASCADE" })`

Also replaced the relation `any` types with entity types so future refactors get type checking.

## Evidence

- `npx vitest run --config vite.main.config.mjs test/vitest/main/ragEntityRelations.test.ts` passed.
- The Vitest global setup ran `tsc --noEmit -p tsconfig.json` and found zero TypeScript errors.
- `git diff --check` passed.

## Regression Test

Added `test/vitest/main/ragEntityRelations.test.ts`, which asserts the RAG relation metadata uses constructor callbacks and resolves to the actual entity constructors instead of string class names.

## Status

DONE
