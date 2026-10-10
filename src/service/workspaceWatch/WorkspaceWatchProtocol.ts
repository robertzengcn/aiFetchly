/**
 * WorkspaceWatchProtocol — WAT-06 zod schemas for the watcher IPC boundary.
 *
 * Two discriminated unions on the `type` field:
 *   - workerCommandSchema (main → worker): watch/unwatch/rescan/shutdown
 *   - workerEventSchema   (worker → main): snapshot/changed/diagnostic/error
 *
 * Trust model:
 *   - main → worker is trusted (main is the authority). The worker still
 *     safeParses defensively — defense in depth.
 *   - worker → main is UNTRUSTED even though we forked the worker. The
 *     manager safeParses every event before use; malformed → terminate +
 *     restart the worker (never apply the malformed snapshot).
 *
 * Size limits (design §14.4): error.message capped at 2000 chars;
 * workspaceId must be a non-empty string.
 *
 * The snapshot/diff/diagnostic shapes are reused from Phase 13
 * (aifetchlyConfigTypes) — referenced via z.custom<T>(), never redefined
 * inline. This keeps the canonical data contract in one place
 * (aifetchlyConfigTypes.ts) so future capability arrays (commands/agents/
 * hooks/skills) propagate without touching this protocol module.
 */

import { z } from "zod";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigDiff,
  AIFetchlyConfigSnapshot,
} from "@/entityTypes/aifetchlyConfigTypes";

/**
 * WorkspaceId non-empty string — used across multiple commands/events.
 * Hoisted as a reusable schema for consistency.
 */
const workspaceIdSchema = z.string().min(1);

/**
 * Snapshot/diff/diagnostic are reused by reference (Phase 13 shapes). We
 * wrap them with z.custom() so safeParse runs a structural check on the
 * received value without redeclaring the field-level schemas here. This
 * intentionally couples the protocol to the type — a breaking change to
 * the snapshot shape must flow through this module.
 */
const snapshotSchema: z.ZodType<AIFetchlyConfigSnapshot> = z.custom(
  (val): val is AIFetchlyConfigSnapshot =>
    typeof val === "object" &&
    val !== null &&
    typeof (val as { source?: unknown }).source === "string" &&
    typeof (val as { sourceId?: unknown }).sourceId === "string" &&
    Array.isArray((val as { files?: unknown }).files) &&
    Array.isArray((val as { instructions?: unknown }).instructions) &&
    Array.isArray((val as { diagnostics?: unknown }).diagnostics) &&
    // Portable-memory payload (optional): when present it must satisfy the
    // bounded schema below; absent is valid (pre-portable snapshots).
    ((val as { portableMemory?: unknown }).portableMemory === undefined ||
      portableMemorySchema.safeParse(
        (val as { portableMemory?: unknown }).portableMemory
      ).success)
);

/**
 * Bounded shape for the portable-memory scan payload (design §12.5). The
 * portable scan rides the snapshot, so its bounds are enforced inside the
 * snapshot predicate: at most 1,000 drafts, each path/body bounded, SHA-256
 * hashes, declared totals capped, diagnostics message-limited. A malformed
 * portable payload fails the whole snapshot check → worker restart, never a
 * partial apply.
 */
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const portableDraftSchema = z.object({
  relativePath: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(255),
  contentHash: sha256Schema.or(z.literal("")),
  sizeBytes: z.number().int().min(0),
  mtimeMs: z.number(),
  rawFrontmatter: z.unknown(),
  markdownBody: z.string().max(16 * 1024),
  syntaxError: z.string().max(500).optional(),
  isSymbolicLink: z.boolean(),
});

const portableDiagnosticSchema = z.object({
  severity: z.string().max(20),
  source: z.string().max(20),
  sourceId: z.string().max(200),
  filePath: z.string().max(1024),
  code: z.string().max(80),
  message: z.string().max(1000),
  recoverable: z.boolean(),
});

export const portableMemorySchema = z.object({
  schemaVersion: z.literal(1),
  directoryPresent: z.boolean(),
  complete: z.boolean(),
  identity: z
    .object({
      relativePath: z.literal(".aifetchly/workspace.json"),
      raw: z.unknown(),
      contentHash: sha256Schema,
      sizeBytes: z.number().int().min(0).max(8 * 1024),
      mtimeMs: z.number(),
    })
    .optional(),
  records: z.array(portableDraftSchema).max(1000),
  seenRelativePaths: z.array(z.string().max(1024)).max(1100),
  readmeHash: sha256Schema.optional(),
  indexHash: sha256Schema.optional(),
  totalBytes: z.number().int().min(0).max(16 * 1024 * 1024),
  diagnostics: z.array(portableDiagnosticSchema).max(200),
});

const diffSchema: z.ZodType<AIFetchlyConfigDiff> = z.custom(
  (val): val is AIFetchlyConfigDiff =>
    typeof val === "object" &&
    val !== null &&
    Array.isArray((val as { added?: unknown }).added) &&
    Array.isArray((val as { changed?: unknown }).changed) &&
    Array.isArray((val as { removed?: unknown }).removed)
);

const diagnosticSchema: z.ZodType<AIFetchlyConfigDiagnostic> = z.custom(
  (val): val is AIFetchlyConfigDiagnostic =>
    typeof val === "object" &&
    val !== null &&
    typeof (val as { severity?: unknown }).severity === "string" &&
    typeof (val as { code?: unknown }).code === "string" &&
    typeof (val as { message?: unknown }).message === "string"
);

/**
 * Main → worker commands. `strict()` rejects unknown extra fields so a
 * buggy main process can't slip a stray payload past the worker.
 */
export const workerCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("watch-workspace"),
      workspaceId: workspaceIdSchema,
      workspaceRoot: z.string().min(1),
      includeRootAgentsFile: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("unwatch-workspace"),
      workspaceId: workspaceIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("rescan-workspace"),
      workspaceId: workspaceIdSchema,
    })
    .strict(),
  z.object({ type: z.literal("shutdown") }).strict(),
]);

export type WorkspaceWatchCommand = z.infer<typeof workerCommandSchema>;

/**
 * Worker → main events. `strict()` rejects unknown extra fields so a
 * buggy or future-compromised worker cannot smuggle an unrecognised
 * payload past the manager's safeParse.
 *
 * §14.4 size limit on error.message is enforced via z.string().max(2000).
 */
export const workerEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("snapshot"),
      workspaceId: workspaceIdSchema,
      snapshot: snapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("changed"),
      workspaceId: workspaceIdSchema,
      snapshot: snapshotSchema,
      diff: diffSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("diagnostic"),
      workspaceId: workspaceIdSchema,
      diagnostic: diagnosticSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      workspaceId: workspaceIdSchema,
      message: z.string().max(2000),
      recoverable: z.boolean(),
    })
    .strict(),
]);

export type WorkspaceWatchEvent = z.infer<typeof workerEventSchema>;
