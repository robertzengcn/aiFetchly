import { BaseDb } from "@/model/Basedb";
import { AIChatArchiveSearchFragmentEntity } from "@/entity/AIChatArchiveSearchFragment.entity";
import type { Repository } from "typeorm";
import { Brackets } from "typeorm";
import { codePointLength, sliceByCodePoints } from "@/service/AIChatArchiveTextUtil";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";

/**
 * Search-fragment data access. Fragments are bounded slices of a source
 * message's content (by code-point offsets, with overlap) used for literal
 * substring search. Bounded to `searchFragmentMaxCodePoints` so search never
 * materializes full oversized messages. `(conversationId, sourceRowId, field,
 * startCodePoint)` is unique (§5.6).
 *
 * The first version uses bounded LIKE scans over this table; an optional FTS
 * virtual table can accelerate eligible word queries later (§7.1, §5.6). Per
 * §15, read-only history can fall back to original messages before indexing
 * completes — searchPage in the archive Module scans this table, and the
 * retrieval service never claims completeness unless scan_complete is true.
 */
export interface FragmentScanHit {
  readonly sourceRowId: number;
  readonly field: string;
  readonly startCodePoint: number;
  readonly endCodePoint: number;
  readonly fragmentText: string;
}

export class AIChatArchiveSearchFragmentModel extends BaseDb {
  public repository: Repository<AIChatArchiveSearchFragmentEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveSearchFragmentEntity
    );
  }

  protected onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveSearchFragmentEntity
    );
  }

  /**
   * Split a source message's content into bounded overlapping fragments and
   * persist them idempotently. `(conversationId, sourceRowId, field,
   * startCodePoint)` is unique, so re-indexing a row overwrites stale slices.
   * Uses `sliceByCodePoints` for correct Unicode segmentation.
   */
  async indexSourceContent(
    conversationId: string,
    sourceRowId: number,
    field: "content" | "tool_receipt",
    text: string
  ): Promise<number> {
    const maxCp = AI_CHAT_RECOVERABLE_DEFAULTS.searchFragmentMaxCodePoints;
    const overlap = AI_CHAT_RECOVERABLE_DEFAULTS.searchFragmentOverlapCodePoints;
    const total = codePointLength(text);
    if (total === 0) {
      // Persist a single empty fragment so the row is represented in searches.
      await this.upsertFragment({
        conversationId,
        sourceRowId,
        field,
        startCodePoint: 0,
        endCodePoint: 0,
        fragmentText: "",
      });
      return 1;
    }
    let start = 0;
    let count = 0;
    while (start < total) {
      const end = Math.min(start + maxCp, total);
      const fragmentText = sliceByCodePoints(text, start, end);
      await this.upsertFragment({
        conversationId,
        sourceRowId,
        field,
        startCodePoint: start,
        endCodePoint: end,
        fragmentText,
      });
      count++;
      if (end >= total) break;
      start = end - overlap; // overlap so cross-boundary phrases survive
      if (start < 0) start = 0;
    }
    return count;
  }

  /** Idempotent upsert keyed on (conversationId, sourceRowId, field, startCodePoint). */
  private async upsertFragment(input: {
    conversationId: string;
    sourceRowId: number;
    field: string;
    startCodePoint: number;
    endCodePoint: number;
    fragmentText: string;
  }): Promise<void> {
    const existing = await this.repository.findOne({
      where: {
        conversationId: input.conversationId,
        sourceRowId: input.sourceRowId,
        field: input.field,
        startCodePoint: input.startCodePoint,
      },
    });
    if (existing) {
      existing.endCodePoint = input.endCodePoint;
      existing.fragmentText = input.fragmentText;
      await this.repository.save(existing);
      return;
    }
    const entity = new AIChatArchiveSearchFragmentEntity();
    Object.assign(entity, input);
    await this.repository.save(entity);
  }

  /**
   * Bounded literal substring scan over fragments. Returns hits with their
   * code-point offsets so the retrieval service can verify against the
   * original source and merge overlap duplicates (§7.1).
   *
   * A page scan walks at most `searchMaxFragmentsPerPage` rows or
   * `searchMaxMsPerPage` ms, then stops with `hasMore=true` so the caller
   * can resume via a continuation cursor keyed on (sourceRowId,
   * startCodePoint).
   */
  async scanLiteral(
    conversationId: string,
    query: string,
    afterSourceRowId: number,
    afterStartCodePoint: number,
    maxFragments: number = AI_CHAT_RECOVERABLE_DEFAULTS.searchMaxFragmentsPerPage,
    maxMs: number = AI_CHAT_RECOVERABLE_DEFAULTS.searchMaxMsPerPage
  ): Promise<{ hits: FragmentScanHit[]; hasMore: boolean; lastRowId: number; lastStart: number }> {
    const started = Date.now();
    const limit = Math.min(
      maxFragments,
      AI_CHAT_RECOVERABLE_DEFAULTS.searchMaxFragmentsPerPage
    );
    const qb = this.repository
      .createQueryBuilder("f")
      .where("f.conversationId = :conversationId", { conversationId })
      .andWhere(
        new Brackets((b) => {
          b.where("f.sourceRowId > :rid", { rid: afterSourceRowId }).orWhere(
            "f.sourceRowId = :rid2 AND f.startCodePoint > :scp",
            { rid2: afterSourceRowId, scp: afterStartCodePoint }
          );
        })
      )
      .orderBy("f.sourceRowId", "ASC")
      .addOrderBy("f.startCodePoint", "ASC")
      .take(limit + 1); // +1 to detect hasMore without a second round-trip

    const rows = await qb.getMany();
    const hits: FragmentScanHit[] = [];
    let lastRowId = afterSourceRowId;
    let lastStart = afterStartCodePoint;
    let hasMore = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Honor the time budget: stop scanning once it is exhausted.
      if (Date.now() - started > maxMs) {
        hasMore = true;
        break;
      }
      if (i === limit) {
        hasMore = true;
        break;
      }
      if (row.fragmentText.includes(query)) {
        hits.push({
          sourceRowId: row.sourceRowId,
          field: row.field,
          startCodePoint: row.startCodePoint,
          endCodePoint: row.endCodePoint,
          fragmentText: row.fragmentText,
        });
      }
      lastRowId = row.sourceRowId;
      lastStart = row.startCodePoint;
    }
    return { hits, hasMore, lastRowId, lastStart };
  }

  /**
   * Delete all fragments for a conversation (used on tombstone cleanup).
   */
  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected ?? 0;
  }

  /**
   * Count fragments for a conversation — used to report index_complete.
   */
  async countByConversation(conversationId: string): Promise<number> {
    return this.repository.count({ where: { conversationId } });
  }
}
