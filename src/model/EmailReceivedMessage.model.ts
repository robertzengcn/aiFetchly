import { BaseDb } from "@/model/Basedb";
import { IsNull, Repository } from "typeorm";
import {
  normalizeStoredMessageId,
  PENDING_NEGATIVE_CONTEXT,
} from "@/service/emailReceive/EmailReplyIdentity";
import { LEGACY_SIBLING_SCAN_LIMIT } from "@/model/replyClusterEvidence";
import { replyWriteMutex } from "@/model/replyTxn";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { SortBy } from "@/entityTypes/commonType";
import {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReceivedMessageWriteSchema } from "@/schemas/entity/emailReceivedMessage";

/** Filter inputs for listing received messages. */
export interface ReceivedMessageListInput {
  emailServiceId: number;
  page: number;
  size: number;
  where?: string;
  sortby?: SortBy;
  unreadOnly?: boolean;
  replyStatus?: EmailReplyStatus;
  classification?: EmailMessageClassification;
}

export class EmailReceivedMessageModel extends BaseDb {
  private repository: Repository<EmailReceivedMessageEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReceivedMessageEntity
    );
  }

  /**
   * Upsert by the unique `(emailServiceId, providerUid)` key.
   *
   * On conflict, provider-supplied metadata (subject, body, addresses, headers,
   * receivedAt, unread flag, answered flag + provenance) is refreshed with a
   * TARGETED update while LOCAL processing state (`replyStatus`,
   * `classification`, `classificationConfidence`, `processedAt`) and the
   * detection-owned evidence columns (`replyDetectedAt`,
   * `replyDetectionSource`, `replyMatchedMessageId`, `replyNegativeCheckAt`,
   * `replyNegativeContextHash`) are preserved — repeated syncs must never
   * reset reply state, clobber a concurrently changed lifecycle, or erase a
   * sticky positive (FR-030, technical design §5.1).
   */
  async upsertByProviderUid(
    entity: EmailReceivedMessageEntity
  ): Promise<EmailReceivedMessageEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReceivedMessageWriteSchema()
    ) as unknown as EmailReceivedMessageEntity;

    const existing = await this.repository.findOne({
      where: {
        emailServiceId: stripped.emailServiceId,
        providerUid: stripped.providerUid,
      },
    });

    if (existing) {
      const providerPatch = this.buildProviderFieldPatch(stripped);
      // R11/FR-030: sync owns provider fields ONLY — it never writes
      // replyStatus or processedAt (those are app-delivery-owned). A
      // freshly-observed \Answered flag is recorded as sticky external
      // POSITIVE EVIDENCE (replyDetectedAt + replyDetectionSource) via
      // recordSyncAnsweredPositive, which COALESCE-fills and never overwrites
      // a more specific detector source/timestamp. Merge the written fields
      // over the already-loaded row instead of a second findOne round trip —
      // the update applied exactly these values (or threw); nothing else
      // writes these columns inside this call. The merge goes through
      // repository.merge so TypeORM BaseEntity methods (hasId/reload) stay
      // intact on the returned entity.
      await this.repository.update({ id: existing.id }, providerPatch);
      if (stripped.isAnswered === 1) {
        await this.recordSyncAnsweredPositive(existing.id);
      }
      return this.repository.merge(existing, providerPatch);
    }

    const created = this.repository.create(stripped);
    const saved = await this.repository.save(created);
    // R11/FR-030: insert-path sticky external positive — same evidence-only
    // write as the existing-row path. replyStatus keeps its lifecycle default
    // (not_started); the \Answered observation lands in the evidence columns.
    if (stripped.isAnswered === 1) {
      await this.recordSyncAnsweredPositive(saved.id);
    }
    return saved;
  }

  /**
   * Provider-owned field patch for the targeted sync update. Deliberately
   * excludes every write-owned-by-someone-else column: `replyStatus` /
   * `processedAt` (app delivery), classification fields (classifier), and the
   * detection evidence columns (detector). Only the raw flag observation
   * (`isAnswered` + check time) and UID provenance belong to sync.
   */
  private buildProviderFieldPatch(
    stripped: EmailReceivedMessageEntity
  ): Partial<EmailReceivedMessageEntity> {
    return {
      messageId: stripped.messageId,
      threadKey: stripped.threadKey,
      inReplyTo: stripped.inReplyTo,
      referencesHeader: stripped.referencesHeader,
      fromAddress: stripped.fromAddress,
      fromName: stripped.fromName,
      replyToAddress: stripped.replyToAddress,
      toAddressesJson: stripped.toAddressesJson,
      ccAddressesJson: stripped.ccAddressesJson,
      subject: stripped.subject,
      bodyText: stripped.bodyText,
      bodyHtmlSanitized: stripped.bodyHtmlSanitized,
      snippet: stripped.snippet,
      receivedAt: stripped.receivedAt,
      isUnread: stripped.isUnread,
      isAnswered: stripped.isAnswered,
      answeredFlagCheckedAt: stripped.answeredFlagCheckedAt ?? new Date(),
      providerFolder: stripped.providerFolder,
      providerUidValidity: stripped.providerUidValidity,
    };
  }

  /**
   * R11/FR-030 — sync-side sticky external positive. When sync observes a
   * freshly-set `\Answered` flag, it records the positive in the
   * detection-owned evidence columns WITHOUT touching `replyStatus` or
   * `processedAt` (those are app-delivery-owned). Uses the same
   * COALESCE-fill fence as `updateReplyEvidence`:
   *  - `replyDetectedAt`: fill-once (never move, never clear);
   *  - `replyDetectionSource`: fill-once only when null — a more specific
   *    detector source (`sent_search`) is NEVER downgraded to `mailbox_flag`.
   * Sync carries no matched message id, so `replyMatchedMessageId` is left
   * untouched. The raw flag observation (`isAnswered`/`answeredFlagCheckedAt`)
   * is already written by the provider patch / insert before this runs.
   */
  private async recordSyncAnsweredPositive(id: number): Promise<void> {
    // C01: serialized with admission snapshots (see replyTxn) — a sticky
    // positive must not land between a snapshot's statements.
    return await replyWriteMutex.run(async () => {
      const observedAt = new Date();
      await this.repository
        .createQueryBuilder()
        .update(EmailReceivedMessageEntity)
        .set({
          replyDetectedAt: () => "COALESCE(replyDetectedAt, :detectedAt)",
          replyDetectionSource: () => "COALESCE(replyDetectionSource, :source)",
        })
        .where("id = :id", { id })
        .setParameters({ detectedAt: observedAt, source: "mailbox_flag" })
        .execute();
    });
  }

  /**
   * N02: confirm a STAGED pending negative into a matchable one — conditionally
   * at this transaction boundary, not by blind overwrite.
   *
   * The UPDATE matches the exact staged observation (same instant + PENDING
   * marker) and requires the owning probe to be still live AT CONFIRMATION
   * time (`owner >= now`), not merely live when observed. A confirm that
   * arrives after probe expiry matches 0 rows: the row stays permanently
   * pending (readers reject it via N01), so a timed-out probe can never
   * leave reusable evidence inside the TTL — no post-confirmation rollback
   * or compensating fence needed.
   *
   * The exact-instant match also closes a replacement race the blind
   * overwrite had: a newer healthy probe's observation present on the row
   * rejects this stale confirm (0 rows) instead of being clobbered.
   * Concurrent positives still win via `replyDetectedAt IS NULL`.
   *
   * Null owner (probes without deadline tracking) preserves the previous
   * semantics: the caller's pre-write liveness fence is the only gate.
   *
   * @returns true when exactly one row was confirmed.
   */
  async confirmStagedNegativeEvidence(input: {
    id: number;
    replyNegativeCheckAt: Date;
    replyNegativeContextHash: string;
    replyNegativeOwnerExpiresAt?: Date | null;
    /**
     * C02: execution-time clock for the liveness predicate — pass a
     * function evaluated at execution (after database admission), never a
     * frozen pre-queue Date. A plain Date is still accepted and means
     * "evaluate as of this instant". Defaults to wall time.
     */
    now?: Date | (() => number);
  }): Promise<boolean> {
    // C01: serialized with admission snapshots (see replyTxn).
    return await replyWriteMutex.run(() =>
      this.confirmStagedNegativeEvidenceInner(input)
    );
  }

  private async confirmStagedNegativeEvidenceInner(input: {
    id: number;
    replyNegativeCheckAt: Date;
    replyNegativeContextHash: string;
    replyNegativeOwnerExpiresAt?: Date | null;
    /**
     * C02: execution-time clock for the liveness predicate — a function
     * evaluated HERE (after database admission), never a frozen pre-queue
     * Date. A plain Date is still accepted for callers without a clock
     * (tests, legacy paths) and means "evaluate as of this instant".
     */
    now?: Date | (() => number);
  }): Promise<boolean> {
    // C02: resolve the clock HERE (post-admission execution time). A
    // function reads the caller's live clock; a Date is a fixed instant.
    const now =
      typeof input.now === "function"
        ? new Date(input.now())
        : (input.now ?? new Date());
    const owner = input.replyNegativeOwnerExpiresAt ?? null;
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailReceivedMessageEntity)
      .set({
        replyNegativeContextHash: input.replyNegativeContextHash,
      })
      .where(
        "id = :id" +
          " AND replyDetectedAt IS NULL" +
          " AND replyNegativeCheckAt = :observedAt" +
          " AND replyNegativeContextHash = :pending" +
          (owner !== null
            ? " AND replyNegativeOwnerExpiresAt = :owner" +
              " AND replyNegativeOwnerExpiresAt >= :now"
            : " AND replyNegativeOwnerExpiresAt IS NULL"),
        {
          id: input.id,
          observedAt: input.replyNegativeCheckAt,
          pending: PENDING_NEGATIVE_CONTEXT,
          ...(owner !== null ? { owner, now } : {}),
        }
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Detection-owned evidence write (FR-030/FR-031, technical design §5.1).
   *
   * STICKY POSITIVE FENCE: once `replyDetectedAt` is set it is never cleared
   * and never overwritten — a later observation carrying no positive evidence
   * (zero flag, empty search) cannot reset a protected message. Negative
   * fields are written only while no positive evidence exists; once positive,
   * negatives are not written at all.
   */
  async updateReplyEvidence(input: {
    id: number;
    replyDetectedAt?: Date | null;
    replyDetectionSource?: string | null;
    replyMatchedMessageId?: string | null;
    replyNegativeCheckAt?: Date | null;
    replyNegativeContextHash?: string | null;
    replyNegativeOwnerExpiresAt?: Date | null;
    isAnswered?: number;
    answeredFlagCheckedAt?: Date | null;
  }): Promise<boolean> {
    // C01: serialized with admission snapshots (see replyTxn).
    return await replyWriteMutex.run(() => this.updateReplyEvidenceInner(input));
  }

  private async updateReplyEvidenceInner(input: {
    id: number;
    replyDetectedAt?: Date | null;
    replyDetectionSource?: string | null;
    replyMatchedMessageId?: string | null;
    replyNegativeCheckAt?: Date | null;
    replyNegativeContextHash?: string | null;
    replyNegativeOwnerExpiresAt?: Date | null;
    isAnswered?: number;
    answeredFlagCheckedAt?: Date | null;
  }): Promise<boolean> {
    const positive = input.replyDetectedAt != null;

    if (positive) {
      // Strengthen only: fill the first-positive timestamp when unset; never
      // move it, never clear it. Provenance fields ride along.
      const result = await this.repository
        .createQueryBuilder()
        .update(EmailReceivedMessageEntity)
        .set({
          replyDetectedAt: () => "COALESCE(replyDetectedAt, :detectedAt)",
          replyDetectionSource: input.replyDetectionSource ?? undefined,
          replyMatchedMessageId: input.replyMatchedMessageId ?? undefined,
          ...(input.isAnswered != null ? { isAnswered: input.isAnswered } : {}),
          ...(input.answeredFlagCheckedAt != null
            ? { answeredFlagCheckedAt: input.answeredFlagCheckedAt }
            : {}),
        })
        .where("id = :id", { id: input.id })
        .setParameters({ detectedAt: input.replyDetectedAt })
        .execute();
      return (result.affected ?? 0) === 1;
    }

    // Negative observation: only when NO positive evidence exists on the row.
    // F03: monotonic freshness — a negative write carries its own observation
    // time and must never overwrite a NEWER observation already stored. A
    // late (expired-owner or reordered) write with an older timestamp matches
    // 0 rows instead of silently replacing fresher evidence. Same-instant
    // re-probes (equal timestamps) still overwrite — redundant but harmless.
    // R02: the owning probe's deadline end rides along so readers can reject
    // expired-owner results even if compensating cleanup never runs. A null
    // owner expiry preserves legacy age-only semantics for rows written
    // before owner tracking existed.
    const negativeAt = input.replyNegativeCheckAt ?? null;
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailReceivedMessageEntity)
      .set({
        replyNegativeCheckAt: negativeAt,
        replyNegativeContextHash: input.replyNegativeContextHash ?? null,
        replyNegativeOwnerExpiresAt: input.replyNegativeOwnerExpiresAt ?? null,
        ...(input.isAnswered != null ? { isAnswered: input.isAnswered } : {}),
        ...(input.answeredFlagCheckedAt != null
          ? { answeredFlagCheckedAt: input.answeredFlagCheckedAt }
          : {}),
      })
      .where(
        "id = :id AND replyDetectedAt IS NULL" +
          (negativeAt !== null
            ? " AND (replyNegativeCheckAt IS NULL OR replyNegativeCheckAt <= :negativeAt)"
            : ""),
        { id: input.id, ...(negativeAt !== null ? { negativeAt } : {}) }
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }



  /**
   * Adopt a legacy bare-UID row into the namespaced providerUid scheme
   * (T03 step 3). Targeted update: preserves ALL local state (replyStatus,
   * classification, evidence, processedAt) — only the dedupe key + UID
   * provenance change. The caller must have validated the source identity
   * (fetched header matches the expected RFC Message-ID) first.
   *
   * COLLISION-SAFE: the rebase is refused (returns false, no write) when
   * another row in the same service already holds the target namespaced
   * key — e.g. a prior sync inserted the namespaced row while the legacy
   * row lingered. The unique `(emailServiceId, providerUid)` index would
   * otherwise abort the whole sync; the caller falls through to the normal
   * upsert, which refreshes the existing namespaced row and leaves the
   * legacy row guarded by its own canonical reply keys.
   */
  async updateProviderUidNamespacing(input: {
    id: number;
    emailServiceId: number;
    providerUid: string;
    providerFolder: string | null;
    providerUidValidity: string | null;
  }): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailReceivedMessageEntity)
      .set({
        providerUid: input.providerUid,
        providerFolder: input.providerFolder,
        providerUidValidity: input.providerUidValidity,
      })
      .where(
        "id = :id AND NOT EXISTS (" +
          "SELECT 1 FROM email_received_message" +
          " WHERE emailServiceId = :emailServiceId" +
          " AND providerUid = :targetUid AND id <> :id" +
          ")",
        {
          id: input.id,
          emailServiceId: input.emailServiceId,
          targetUid: input.providerUid,
        }
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Find a legacy bare-UID row for the same service whose providerUid equals
   * the raw UID string (pre-namespacing syncs stored `String(uid)`). Returns
   * null when no legacy row exists for adoption consideration.
   */
  async findLegacyBareUidRow(input: {
    emailServiceId: number;
    bareUid: string;
  }): Promise<EmailReceivedMessageEntity | null> {
    return await this.repository.findOne({
      where: {
        emailServiceId: input.emailServiceId,
        providerUid: input.bareUid,
      },
    });
  }

  async read(id: number): Promise<EmailReceivedMessageEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find every received-message row in the same configured email service that
   * shares the canonical inbound reply identity with the seed row (FR-029,
   * FR-038, technical design §4.1).
   *
   * Canonical equivalence is resolved by the normalized RFC Message-ID. The
   * `(emailServiceId, normalizedMessageId)` index makes this lookup cheap. The
   * seed row itself is always included in the result so callers can treat the
   * cluster uniformly.
   *
   * Legacy rows whose `normalizedMessageId` was never populated are handled by
   * the caller (the identity module normalizes their raw `messageId` on the fly
   * before binding the guard). A row with no usable RFC ID falls back to a
   * `row:<id>` singleton key and matches only itself — it is never merged with
   * another missing-id row by subject or conversation.
   */
  async findCanonicalEquivalents(input: {
    emailServiceId: number;
    normalizedMessageId: string | null;
  }): Promise<EmailReceivedMessageEntity[]> {
    if (!input.normalizedMessageId) {
      // No RFC id → singleton. Caller passes the seed row id separately if it
      // wants the row included; here we just return nothing for an empty key.
      return [];
    }
    const normalized = await this.repository.find({
      where: {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: input.normalizedMessageId,
      },
      order: { id: "ASC" },
    });
    // N01: discover legacy siblings whose `normalizedMessageId` column was
    // never populated but whose raw `messageId` normalizes to the same token.
    // Same-service only; bounded with fail-closed on incomplete discovery.
    const legacyCandidates = await this.repository.find({
      where: {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: IsNull(),
      },
      order: { id: "ASC" },
      take: LEGACY_SIBLING_SCAN_LIMIT + 1,
    });
    if (legacyCandidates.length > LEGACY_SIBLING_SCAN_LIMIT) {
      throw new Error(
        `Canonical discovery incomplete: more than ${LEGACY_SIBLING_SCAN_LIMIT} null-normalized rows in service ${input.emailServiceId} (§4.1)`
      );
    }
    const merged = [...normalized];
    for (const r of legacyCandidates) {
      if (merged.some((m) => m.id === r.id)) continue;
      const rawNormalized = normalizeStoredMessageId(r.messageId);
      if (rawNormalized !== null && rawNormalized === input.normalizedMessageId) {
        merged.push(r);
      }
    }
    merged.sort((a, b) => a.id - b.id);
    return merged;
  }

  /** Associate a received message with a conversation (P1, FR-001). */
  async setConversation(
    messageId: number,
    conversationId: number
  ): Promise<void> {
    await this.repository.update({ id: messageId }, { conversationId });
  }

  /** Messages not yet placed in a conversation (conversation backfill input). */
  async listWithoutConversation(
    emailServiceId?: number,
    limit = 100000
  ): Promise<EmailReceivedMessageEntity[]> {
    const qb = this.repository
      .createQueryBuilder("msg")
      .where("msg.conversationId IS NULL")
      .orderBy("msg.emailServiceId", "ASC")
      .addOrderBy("msg.receivedAt", "ASC")
      .take(limit);
    if (emailServiceId != null) {
      qb.andWhere("msg.emailServiceId = :emailServiceId", { emailServiceId });
    }
    return await qb.getMany();
  }

  /** Bulk-set normalization + conversation fields at sync time (P1/P2). */
  async updateNormalization(
    messageId: number,
    fields: {
      normalizedMessageId?: string | null;
      normalizedInReplyTo?: string | null;
      normalizedReferencesJson?: string | null;
      normalizedBodyText?: string | null;
      newContentText?: string | null;
      autoSubmittedHeader?: string | null;
      precedenceHeader?: string | null;
      listIdHeader?: string | null;
      listUnsubscribeHeader?: string | null;
      hasAttachments?: number;
      attachmentMetadataJson?: string | null;
      conversationId?: number | null;
    }
  ): Promise<void> {
    await this.repository.update({ id: messageId }, fields);
  }

  /**
   * Set the app-delivery lifecycle projection (replyStatus + processedAt).
   *
   * D01: TARGETED write — this method owns ONLY `replyStatus` and the
   * explicitly requested `processedAt`. The former load-and-full-entity-save
   * wrote every stale column back to the row, erasing concurrently landed
   * sticky reply evidence (replyDetectedAt/source/matched id/answered
   * metadata), negative cache/owner fields, and normalization. Un-owned
   * columns are never written; a missing row stays a no-op without loading
   * the complete entity.
   *
   * Status-only calls: when `processedAt` is null the caller means "change
   * only the status" — an existing processedAt (e.g. a concurrent send
   * projection) is preserved, never nulled and never moved.
   *
   * R-2026-10-17/D01 coordination: this is the one remaining writer of an
   * eligibility-relevant `email_received_message` column outside the commit/
   * claim transactions (`replyStatus === "sent"` feeds the canonical
   * eligibility ladder). The single-statement UPDATE runs under the shared
   * `replyWriteMutex` (C01) so it cannot land between a final-admission
   * snapshot's statements. Narrow by design: no load, no other entity, no
   * transaction, no nested mutex call.
   */
  async updateReplyStatus(
    id: number,
    status: EmailReplyStatus,
    processedAt: Date | null = null
  ): Promise<void> {
    await replyWriteMutex.run(() =>
      this.repository.update(
        { id },
        {
          replyStatus: status,
          ...(processedAt ? { processedAt } : {}),
        }
      )
    );
  }

  /** Record classification provenance so deterministic results are auditable (FR-007). */
  async updateClassificationProvenance(
    id: number,
    source: string,
    version: string
  ): Promise<void> {
    await this.repository.update(
      { id },
      {
        classificationSource: source,
        classificationVersion: version,
        classifiedAt: new Date(),
      }
    );
  }

  /**
   * Set the classifier-owned columns (D01). TARGETED update — owns ONLY
   * `classification` + `classificationConfidence`. The former
   * load-and-full-entity-save could write a stale `isUnread`/`replyStatus`/
   * evidence snapshot back over newer facts (D01). Missing rows stay a
   * no-op; nothing else on the row is read or written.
   */
  async updateClassification(
    id: number,
    classification: EmailMessageClassification | null,
    confidence: number | null
  ): Promise<void> {
    await this.repository.update(
      { id },
      {
        classification,
        classificationConfidence: confidence,
      }
    );
  }

  /**
   * Set the reader-owned unread flag (D01). TARGETED update — owns ONLY
   * `isUnread`. The former load-and-full-entity-save on message open could
   * erase a sticky positive that landed between the load and the save (the
   * D01 diagnostic for `markRead` proved the loss). Missing rows stay a
   * no-op; nothing else on the row is read or written.
   */
  async markRead(id: number, isUnread: boolean): Promise<void> {
    await this.repository.update({ id }, { isUnread: isUnread ? 1 : 0 });
  }

  async listByEmailService(
    input: ReceivedMessageListInput
  ): Promise<EmailReceivedMessageEntity[]> {
    let qb = this.repository
      .createQueryBuilder("msg")
      .where("msg.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });

    if (input.unreadOnly) {
      qb = qb.andWhere("msg.isUnread = 1");
    }
    if (input.replyStatus) {
      qb = qb.andWhere("msg.replyStatus = :replyStatus", {
        replyStatus: input.replyStatus,
      });
    }
    if (input.classification) {
      qb = qb.andWhere("msg.classification = :classification", {
        classification: input.classification,
      });
    }
    if (input.where) {
      qb = qb.andWhere(
        "(msg.subject LIKE :search OR msg.fromAddress LIKE :search OR msg.fromName LIKE :search)",
        { search: `%${input.where}%` }
      );
    }

    if (input.sortby?.key && input.sortby?.order) {
      const key = input.sortby.key.toLowerCase();
      const order = input.sortby.order.toLowerCase();
      const allowKeys = [
        "id",
        "receivedat",
        "subject",
        "replystatus",
        "isunread",
      ];
      const allowOrders = ["asc", "desc"];
      if (allowKeys.includes(key) && allowOrders.includes(order)) {
        qb = qb.orderBy(`msg.${key}`, order.toUpperCase() as "ASC" | "DESC");
      } else {
        qb = qb.orderBy("msg.receivedAt", "DESC");
      }
    } else {
      qb = qb.orderBy("msg.receivedAt", "DESC");
    }

    qb = qb.skip(input.page).take(input.size);
    return await qb.getMany();
  }

  async countByEmailService(
    input: Omit<ReceivedMessageListInput, "page" | "size" | "sortby">
  ): Promise<number> {
    let qb = this.repository
      .createQueryBuilder("msg")
      .where("msg.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    if (input.unreadOnly) {
      qb = qb.andWhere("msg.isUnread = 1");
    }
    if (input.replyStatus) {
      qb = qb.andWhere("msg.replyStatus = :replyStatus", {
        replyStatus: input.replyStatus,
      });
    }
    if (input.classification) {
      qb = qb.andWhere("msg.classification = :classification", {
        classification: input.classification,
      });
    }
    if (input.where) {
      qb = qb.andWhere(
        "(msg.subject LIKE :search OR msg.fromAddress LIKE :search OR msg.fromName LIKE :search)",
        { search: `%${input.where}%` }
      );
    }
    return await qb.getCount();
  }
}
