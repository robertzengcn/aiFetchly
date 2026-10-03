import "reflect-metadata";
import type { DataSource } from "typeorm";
import * as path from "node:path";
import { AIToolOutputBootstrapEntity } from "@/entity/AIToolOutputBootstrap.entity";
import { AIToolResultProjectionEntity } from "@/entity/AIToolResultProjection.entity";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import { TOOL_RESULT_CONFIG, TOOL_RESULT_POLICY_VERSION } from "@/config/toolResultConfig";
import { truncateUtf8Safe, utf8ByteLength } from "@/service/ToolResultTextUtil";

/**
 * Idempotent, resumable data bootstrap for preserved tool outputs
 * (technical design §13.2).
 *
 * The project has `synchronize: true` and an EMPTY migration list, so writing
 * a migration file would be theatre - it would never execute. This service is
 * the honest replacement: named steps record completion, and a step that
 * interrupts leaves an opaque resume position so it continues where it stopped
 * instead of rescanning from the beginning.
 *
 * Every step is written so that running it twice is a no-op, which is what
 * makes it safe to call on every startup.
 */

/** Current additive schema version for this feature. */
export const TOOL_OUTPUT_SCHEMA_VERSION = 1;

/**
 * Bounded batch size for the legacy projection backfill. Small enough that a
 * single batch never stalls the event loop (NFR-05: no >50 ms stall) and
 * never holds more than one batch's rows in memory (NFR-03), large enough to
 * make forward progress on a 64 MiB-row table in a reasonable number of
 * batches. The walk yields between batches via `onYield`.
 */
export const LEGACY_PROJECTION_BACKFILL_BATCH_ROWS = 50;

/**
 * UTF-8 byte budget for the inline preview inside a legacy projection. Keeps
 * the projection content bounded regardless of the original row size; the rest
 * of the payload stays retrievable via `conversation_history_read`.
 */
export const LEGACY_PROJECTION_PREVIEW_BYTES = 1024;

/** Named steps, so a step's identity is stable across releases. */
export const TOOL_OUTPUT_BOOTSTRAP_KEYS = {
  additiveEntities: "additive-entities-v1",
  /** Resumable legacy projection backfill (T14 / design §10.2). */
  legacyProjections: "legacy-projections-v1",
} as const;

export interface BootstrapStepResult {
  readonly key: string;
  /** True when this call performed the work (vs. it already being done). */
  readonly ran: boolean;
  /** True when the step is complete after this call. */
  readonly completed: boolean;
  readonly error?: string;
}

/** Options forwarded to a step's execution (e.g. the legacy backfill walk). */
export interface BootstrapStepOptions {
  /** Batch size for the legacy projection backfill. */
  readonly batchRows?: number;
  /** Yield to the event loop between batches (NFR-05). */
  readonly onYield?: () => Promise<void> | void;
  /** Observability for per-batch progress and skips. */
  readonly onLog?: (message: string) => void;
}

export class ToolResultBootstrapService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly profileId: string
  ) {}

  /**
   * Run every bootstrap step in order.
   *
   * A failing step is recorded and does NOT stop the others: an additive
   * schema step that cannot run should not prevent a later, independent step
   * from being attempted, and startup must never throw because of this.
   */
  async runAll(options?: BootstrapStepOptions): Promise<BootstrapStepResult[]> {
    const results: BootstrapStepResult[] = [];
    for (const key of Object.values(TOOL_OUTPUT_BOOTSTRAP_KEYS)) {
      results.push(await this.runStep(key, options));
    }
    return results;
  }

  /** Run one named step exactly once. */
  async runStep(
    key: string,
    options?: BootstrapStepOptions
  ): Promise<BootstrapStepResult> {
    const existing = await this.findMarker(key);
    if (existing?.completed) {
      return { key, ran: false, completed: true };
    }
    try {
      await this.executeStep(key, options);
      await this.upsertMarker({ key, completed: true, lastPositionJson: null });
      return { key, ran: true, completed: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Record the attempt so the failure is observable, but leave the step
      // incomplete so the next startup retries it.
      await this.upsertMarker({ key, completed: false, lastPositionJson: null });
      return { key, ran: true, completed: false, error: message };
    }
  }

  /**
   * Dispatch a named step. The additive-entities step is a no-op (TypeORM
   * `synchronize` creates the tables); the legacy-projections step walks
   * oversized legacy rows in bounded, resumable batches and writes a bounded
   * projection per row so the read path can substitute it without
   * re-materializing the full payload (T14 / design §10.2).
   */
  private async executeStep(
    key: string,
    options?: BootstrapStepOptions
  ): Promise<void> {
    if (key === TOOL_OUTPUT_BOOTSTRAP_KEYS.additiveEntities) return;
    if (key === TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections) {
      await this.backfillLegacyProjections(options);
      return;
    }
    throw new Error(`unknown tool-output bootstrap step: ${key}`);
  }

  /**
   * Resumable, bounded backfill of legacy projections (T14 / design §10.2).
   *
   * Walks oversized legacy rows in `(timestamp, id)` keyset order, one batch at
   * a time, building a bounded projection per row and saving it keyed by
   * `(profileId, sourceRowKey, outputEpoch, policyVersion)`. The original row
   * is never mutated; only the projection is written. Progress is checkpointed
   * via the bootstrap marker after every batch, so an interrupted run resumes
   * from the last committed row instead of rescanning. The caller yields
   * between batches (NFR-05) and the walk is bounded by `batchRows`, so it
   * never stalls the event loop or holds more than one batch's rows in memory.
   *
   * Never throws: a per-row or per-batch failure is logged via `onLog` and the
   * walk continues past the offending batch (a corrupt single row never blocks
   * the rest), checkpointing past it so the next run does not retry it.
   */
  async backfillLegacyProjections(input?: BootstrapStepOptions): Promise<void> {
    const log = input?.onLog ?? (() => undefined);
    const onYield = input?.onYield ?? (() => undefined);
    const batchRows = input?.batchRows ?? LEGACY_PROJECTION_BACKFILL_BATCH_ROWS;
    // The DataSource's `database` is the FILE (`<dir>/scraper.db`), but
    // `AIChatMessageArchiveModel` extends `BaseDb`, whose constructor calls
    // `SqliteDb.getInstance(filepath)` expecting a DIRECTORY (it joins
    // `scraper.db` itself). Passing the file path would resolve to a
    // different singleton path and reset the live connection mid-walk. Derive
    // the directory the DataSource was built from so the archive model rebinds
    // to the SAME singleton the caller holds.
    const dbDir = path.dirname(String(this.dataSource.options.database));
    const archiveModel = new AIChatMessageArchiveModel(dbDir);
    const projectionRepo = this.dataSource.getRepository(AIToolResultProjectionEntity);

    const cursor = await this.readPosition(TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections);
    let afterTs = 0;
    let afterRow = 0;
    if (cursor) {
      const parsed = JSON.parse(cursor) as { ts: number; rid: number };
      afterTs = parsed.ts;
      afterRow = parsed.rid;
    }

    let processed = 0;
    for (;;) {
      const page = await archiveModel.scanOversizedRowsAboveCursor({
        afterTimestampMs: afterTs,
        afterRowId: afterRow,
        minContentBytes: TOOL_RESULT_CONFIG.inlineMaxBytes,
        batchRows,
      });
      if (page.rows.length === 0) {
        if (!page.hasMore) break;
        // Advance past the empty page and continue (no rows to project).
        if (page.nextCursor) {
          afterTs = page.nextCursor.timestampMs;
          afterRow = page.nextCursor.rowId;
          await this.writePosition(
            TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections,
            JSON.stringify({ ts: afterTs, rid: afterRow })
          );
          await onYield();
          continue;
        }
        break;
      }
      for (const row of page.rows) {
        try {
          const projection = this.buildLegacyProjection(row);
          // Idempotent: UNIQUE on (profileId, sourceRowKey, outputEpoch, policyVersion)
          // — a re-run after a policy change writes a new row; a re-run under
          // the same policy is a no-op via upsert. Use save() which upserts on
          // the unique constraint when the row already exists (TypeORM treats
          // save as insert-or-update on the PK, so find-then-save to honor the
          // unique key without relying on driver-specific upsert behavior).
          const existing = await projectionRepo.findOne({
            where: {
              profileId: this.profileId,
              sourceRowKey: row.messageId,
              outputEpoch: projection.outputEpoch,
              policyVersion: TOOL_RESULT_POLICY_VERSION,
            },
          });
          const entity = existing ?? new AIToolResultProjectionEntity();
          entity.profileId = this.profileId;
          entity.sourceRowKey = row.messageId;
          entity.conversationId = row.conversationId;
          entity.outputEpoch = projection.outputEpoch;
          entity.policyVersion = TOOL_RESULT_POLICY_VERSION;
          entity.content = projection.content;
          entity.metadataJson = projection.metadataJson;
          entity.outputRefsJson = projection.outputRefsJson;
          await projectionRepo.save(entity);
          processed += 1;
        } catch (rowError: unknown) {
          // A single corrupt row never blocks the walk; skip and continue.
          log(
            `[tool-result] legacy projection backfill: skipped row ${row.messageId}: ${
              rowError instanceof Error ? rowError.message : String(rowError)
            }`
          );
        }
      }
      // Checkpoint past the last row of the batch so an interrupted run resumes.
      const last = page.rows[page.rows.length - 1];
      afterTs = last.timestamp.getTime();
      afterRow = last.id;
      await this.writePosition(
        TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections,
        JSON.stringify({ ts: afterTs, rid: afterRow })
      );
      log(
        `[tool-result] legacy projection backfill: ${processed} projected, cursor=(${afterTs},${afterRow})`
      );
      await onYield();
      if (!page.hasMore) break;
    }
  }

  /**
   * Build a bounded projection for one legacy oversized row. The projection is
   * a truthful receipt: it states the original byte size, shows a bounded
   * preview, and points at the source row for retrieval via
   * `conversation_history_read`. The original row's `content` is never mutated;
   * only this derived string is stored.
   *
   * `outputEpoch` is `"legacy"` for rows that predate the scope table — the
   * backfill predates per-conversation epochs, and a constant epoch keeps the
   * UNIQUE key stable across re-runs under the same policy.
   */
  private buildLegacyProjection(row: {
    messageId: string;
    conversationId: string;
    content: string;
    role: string;
  }): {
    outputEpoch: string;
    content: string;
    metadataJson: string;
    outputRefsJson: string;
  } {
    const totalBytes = utf8ByteLength(row.content);
    const preview = truncateUtf8Safe(
      row.content,
      LEGACY_PROJECTION_PREVIEW_BYTES
    );
    const truncated = totalBytes > LEGACY_PROJECTION_PREVIEW_BYTES;
    const content =
      `[Legacy tool output — ${totalBytes} bytes, ${truncated ? "truncated" : "full"} preview shown.]\n` +
      `Retrieve the full passage with conversation_history_read (message id "${row.messageId}").\n\n` +
      `${preview}${truncated ? "\n…[truncated]" : ""}`;
    const metadataJson = JSON.stringify({
      legacyProjection: true,
      originalBytes: totalBytes,
      role: row.role,
    });
    // No externalized artifact references for legacy rows — the source row
    // itself is the retrievable evidence, addressed by its messageId.
    const outputRefsJson = JSON.stringify([
      {
        backend: "legacy_message",
        sourceRowKey: row.messageId,
        conversationId: row.conversationId,
      },
    ]);
    return {
      outputEpoch: "legacy",
      content,
      metadataJson,
      outputRefsJson,
    };
  }

  /** Read a marker's resume position, or null when absent/unreadable. */
  async readPosition(key: string): Promise<string | null> {
    const marker = await this.findMarker(key);
    if (!marker?.lastPositionJson) return null;
    try {
      return JSON.parse(marker.lastPositionJson) as string;
    } catch {
      return null;
    }
  }

  /** Persist a backfill's progress so an interrupted run resumes. */
  async writePosition(key: string, position: string): Promise<void> {
    await this.upsertMarker({
      key,
      completed: false,
      lastPositionJson: JSON.stringify(position),
    });
  }

  private async findMarker(
    key: string
  ): Promise<AIToolOutputBootstrapEntity | null> {
    const repo = this.dataSource.getRepository(AIToolOutputBootstrapEntity);
    return await repo.findOne({ where: { profileId: this.profileId, bootstrapKey: key } });
  }

  private async upsertMarker(input: {
    key: string;
    completed: boolean;
    lastPositionJson: string | null;
  }): Promise<void> {
    const repo = this.dataSource.getRepository(AIToolOutputBootstrapEntity);
    const entity =
      (await repo.findOne({
        where: { profileId: this.profileId, bootstrapKey: input.key },
      })) ?? new AIToolOutputBootstrapEntity();
    entity.id = entity.id ?? 1;
    entity.profileId = this.profileId;
    entity.bootstrapKey = input.key;
    entity.schemaVersion = TOOL_OUTPUT_SCHEMA_VERSION;
    entity.completed = input.completed;
    entity.lastPositionJson = input.lastPositionJson ?? undefined;
    await repo.save(entity);
  }
}
