import { BaseDb } from "@/model/Basedb";
import { AIChatPendingMessageEntity } from "@/entity/AIChatPendingMessage.entity";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type {
  AIChatPendingMessageStatus,
  ChatV2MessageMetadata,
} from "@/entityTypes/aiChatV2Types";
import type { Repository, EntityManager } from "typeorm";
import crypto from "crypto";

/** Stable failure codes surfaced to the Module/queue service (design §24). */
export type AIChatPendingModelErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "PENDING_NOT_FOUND"
  | "PENDING_NOT_CLAIMABLE"
  | "CONVERSATION_MISMATCH";

export class AIChatPendingModelError extends Error {
  readonly code: AIChatPendingModelErrorCode;
  constructor(code: AIChatPendingModelErrorCode, message: string) {
    super(message);
    this.name = "AIChatPendingModelError";
    this.code = code;
  }
}

export interface AIChatPendingCreateRowInput {
  readonly pendingMessageId: string;
  readonly clientRequestId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly content: string;
  readonly modelContent: string;
  readonly status: "queued" | "paused";
  readonly requestOptionsJson?: string;
  readonly attachmentMetadataJson?: string;
  readonly messageMetadataJson?: string;
  readonly recoveryReason?: string;
}

/** Result of a conditional (expected-status) claim. */
export type AIChatPendingClaimResult =
  | { readonly ok: true; readonly row: AIChatPendingMessageEntity }
  | {
      readonly ok: false;
      readonly code: "PENDING_NOT_FOUND" | "PENDING_NOT_CLAIMABLE";
      readonly row?: AIChatPendingMessageEntity;
    };

function newClaimToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Data access for durable pending messages. All state transitions out of
 * `queued` are conditional single-UPDATE claims so exactly one claimant wins
 * (FR-7..9); transcript promotion runs in one transaction so the user row
 * and the terminal status commit together (design §7.8).
 */
export class AIChatPendingMessageModel extends BaseDb {
  public repository: Repository<AIChatPendingMessageEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatPendingMessageEntity
    );
  }

  /**
   * Insert a pending row. Idempotent on `clientRequestId` (unique index):
   * a retry reuses the existing row when conversationId and a SHA-256 digest
   * of normalized content/options match, otherwise `IDEMPOTENCY_CONFLICT`
   * (design §7.5).
   */
  async create(
    input: AIChatPendingCreateRowInput
  ): Promise<AIChatPendingMessageEntity> {
    const existing = await this.repository.findOne({
      where: { clientRequestId: input.clientRequestId },
    });
    if (existing) {
      const digestSame =
        this.contentDigest(existing.content) ===
          this.contentDigest(input.content) &&
        existing.conversationId === input.conversationId;
      if (!digestSame) {
        throw new AIChatPendingModelError(
          "IDEMPOTENCY_CONFLICT",
          "This request id was already used with different content."
        );
      }
      return existing;
    }
    const entity = new AIChatPendingMessageEntity();
    entity.pendingMessageId = input.pendingMessageId;
    entity.clientRequestId = input.clientRequestId;
    entity.conversationId = input.conversationId;
    entity.userMessageId = input.userMessageId;
    entity.content = input.content;
    entity.modelContent = input.modelContent;
    entity.status = input.status;
    entity.requestOptionsJson = input.requestOptionsJson;
    entity.attachmentMetadataJson = input.attachmentMetadataJson;
    entity.messageMetadataJson = input.messageMetadataJson;
    entity.recoveryReason = input.recoveryReason;
    entity.attemptCount = 0;
    return await this.repository.save(entity);
  }

  async getByPendingMessageId(
    pendingMessageId: string
  ): Promise<AIChatPendingMessageEntity | null> {
    return await this.repository.findOne({ where: { pendingMessageId } });
  }

  /**
   * Non-terminal rows for a conversation in FIFO order (`id ASC`, design
   * §8.2 FR-6), followed by terminal rows so the renderer can reconcile
   * stale bubbles.
   */
  async listByConversation(
    conversationId: string
  ): Promise<AIChatPendingMessageEntity[]> {
    return await this.repository
      .createQueryBuilder("p")
      .where("p.conversationId = :conversationId", { conversationId })
      .orderBy("p.id", "ASC")
      .getMany();
  }

  async listNonTerminalAll(): Promise<AIChatPendingMessageEntity[]> {
    return await this.repository
      .createQueryBuilder("p")
      .where("p.status IN (:...statuses)", {
        statuses: ["queued", "steering", "dispatching", "paused"],
      })
      .orderBy("p.id", "ASC")
      .getMany();
  }

  async countNonTerminalByConversation(
    conversationId: string
  ): Promise<number> {
    return await this.repository
      .createQueryBuilder("p")
      .where("p.conversationId = :conversationId", { conversationId })
      .andWhere("p.status IN (:...statuses)", {
        statuses: ["queued", "steering", "dispatching", "paused"],
      })
      .getCount();
  }

  /**
   * Claim the oldest `queued` row of a conversation for normal dispatch.
   * One conditional UPDATE; zero affected rows reloads and returns the
   * conflict state (FR-6..9).
   */
  async claimOldestForDispatch(
    conversationId: string
  ): Promise<AIChatPendingClaimResult> {
    const oldest = await this.repository
      .createQueryBuilder("p")
      .where("p.conversationId = :conversationId", { conversationId })
      .andWhere("p.status = :status", { status: "queued" })
      .orderBy("p.id", "ASC")
      .getOne();
    if (!oldest) {
      return { ok: false, code: "PENDING_NOT_FOUND" };
    }
    return await this.conditionalClaim(oldest, "dispatching");
  }

  /** Claim one queued row for steering, tagging the target assistant id. */
  async claimForSteering(
    pendingMessageId: string,
    targetAssistantMessageId: string
  ): Promise<AIChatPendingClaimResult> {
    const row = await this.getByPendingMessageId(pendingMessageId);
    if (!row) {
      return { ok: false, code: "PENDING_NOT_FOUND" };
    }
    const claimed = await this.conditionalClaim(row, "steering");
    if (!claimed.ok) {
      return claimed;
    }
    await this.repository.update(claimed.row.id, { targetAssistantMessageId });
    const latest = await this.getByPendingMessageId(pendingMessageId);
    return { ok: true, row: latest ?? claimed.row };
  }

  /**
   * Restore `steering -> queued` when the reservation could not be committed
   * (turn closed first). Conditional on the claim token so only the owning
   * claimant restores it (design §8.1).
   */
  async restoreSteeringToQueued(
    pendingMessageId: string,
    claimToken: string
  ): Promise<boolean> {
    const result = await this.repository.update(
      {
        pendingMessageId,
        status: "steering" as AIChatPendingMessageStatus,
        claimToken,
      },
      {
        status: "queued" as AIChatPendingMessageStatus,
        claimToken: undefined,
        targetAssistantMessageId: undefined,
      }
    );
    return (result.affected ?? 0) === 1;
  }

  /**
   * Release a dispatch claim back to `queued` when dispatch could not start
   * (e.g. the conversation lease was busy). Conditional on the claim token.
   */
  async releaseDispatchClaim(
    pendingMessageId: string,
    claimToken: string,
    failure?: { code: string; message: string }
  ): Promise<boolean> {
    const result = await this.repository.update(
      {
        pendingMessageId,
        status: "dispatching" as AIChatPendingMessageStatus,
        claimToken,
      },
      failure
        ? {
            status: "failed" as AIChatPendingMessageStatus,
            failureCode: failure.code,
            failureMessage: failure.message,
            terminalAt: new Date(),
          }
        : {
            status: "queued" as AIChatPendingMessageStatus,
            claimToken: undefined,
          }
    );
    return (result.affected ?? 0) === 1;
  }

  /**
   * Pause every claimable `queued` row of a conversation (queue hold:
   * stop/error/recovery/entitlement, design §9.4). Returns the paused count.
   */
  async pauseConversationQueued(
    conversationId: string,
    recoveryReason: string
  ): Promise<number> {
    const result = await this.repository.update(
      {
        conversationId,
        status: "queued" as AIChatPendingMessageStatus,
      },
      {
        status: "paused" as AIChatPendingMessageStatus,
        recoveryReason,
        updatedAt: new Date(),
      }
    );
    return result.affected ?? 0;
  }

  /** `paused -> queued` (resume) preserving FIFO order. */
  async resumeConversation(conversationId: string): Promise<number> {
    const result = await this.repository.update(
      {
        conversationId,
        status: "paused" as AIChatPendingMessageStatus,
      },
      {
        status: "queued" as AIChatPendingMessageStatus,
        recoveryReason: undefined,
        updatedAt: new Date(),
      }
    );
    return result.affected ?? 0;
  }

  /** Move unapplied `steering` rows of a conversation to `paused`. */
  async pauseSteeringRows(
    conversationId: string,
    recoveryReason: string
  ): Promise<number> {
    const result = await this.repository.update(
      {
        conversationId,
        status: "steering" as AIChatPendingMessageStatus,
      },
      {
        status: "paused" as AIChatPendingMessageStatus,
        recoveryReason,
        updatedAt: new Date(),
      }
    );
    return result.affected ?? 0;
  }

  /** Cancel one queued/paused row (user Remove). */
  async cancelQueued(
    pendingMessageId: string
  ): Promise<AIChatPendingClaimResult> {
    const row = await this.getByPendingMessageId(pendingMessageId);
    if (!row) {
      return { ok: false, code: "PENDING_NOT_FOUND" };
    }
    if (row.status !== "queued" && row.status !== "paused") {
      return { ok: false, code: "PENDING_NOT_CLAIMABLE", row };
    }
    const result = await this.repository.update(
      { id: row.id, status: row.status },
      {
        status: "cancelled" as AIChatPendingMessageStatus,
        terminalAt: new Date(),
        updatedAt: new Date(),
      }
    );
    if ((result.affected ?? 0) !== 1) {
      const latest = await this.getByPendingMessageId(pendingMessageId);
      return {
        ok: false,
        code: "PENDING_NOT_CLAIMABLE",
        row: latest ?? undefined,
      };
    }
    const cancelled = await this.getByPendingMessageId(pendingMessageId);
    return { ok: true, row: cancelled ?? row };
  }

  /**
   * Atomically promote a `dispatching` row into a delivered user transcript
   * row: one transaction inserts `ai_chat_messages` under the deterministic
   * userMessageId (insert-if-absent) and flips the pending row to `sent`
   * with linkage (design §7.8, FR-42).
   */
  async promoteDispatchToUserMessage(input: {
    readonly pendingMessageId: string;
    readonly claimToken: string;
    readonly metadata?: ChatV2MessageMetadata;
  }): Promise<AIChatMessageEntity> {
    return await this.sqliteDb.connection.transaction(
      async (manager): Promise<AIChatMessageEntity> => {
        const pending = await this.loadClaimed(
          manager,
          input.pendingMessageId,
          "dispatching",
          input.claimToken
        );
        const userRow = await this.insertUserRowIfAbsent(
          manager,
          pending,
          input.metadata
        );
        await manager
          .getRepository(AIChatPendingMessageEntity)
          .update(pending.id, {
            status: "sent" as AIChatPendingMessageStatus,
            sentMessageId: userRow.messageId,
            terminalAt: new Date(),
            updatedAt: new Date(),
          });
        return userRow;
      }
    );
  }

  /**
   * Atomically promote a `steering` row into a durable steering user row and
   * mark it `applied` with boundary + target linkage (FR-41). Runs inside
   * `consume()` BEFORE the instruction is returned to the loop, so no
   * unpersisted steering text ever enters model context (design §10.4).
   */
  async promoteSteeringToUserMessage(input: {
    readonly pendingMessageId: string;
    readonly claimToken: string;
    readonly boundary: string;
    readonly targetAssistantMessageId: string;
    readonly metadata?: ChatV2MessageMetadata;
  }): Promise<AIChatMessageEntity> {
    return await this.sqliteDb.connection.transaction(
      async (manager): Promise<AIChatMessageEntity> => {
        const pending = await this.loadClaimed(
          manager,
          input.pendingMessageId,
          "steering",
          input.claimToken
        );
        const userRow = await this.insertUserRowIfAbsent(
          manager,
          pending,
          input.metadata
        );
        await manager
          .getRepository(AIChatPendingMessageEntity)
          .update(pending.id, {
            status: "applied" as AIChatPendingMessageStatus,
            steeringBoundary:
              input.boundary as AIChatPendingMessageEntity["steeringBoundary"],
            targetAssistantMessageId: input.targetAssistantMessageId,
            sentMessageId: userRow.messageId,
            terminalAt: new Date(),
            updatedAt: new Date(),
          });
        return userRow;
      }
    );
  }

  /** Delete all pending rows for a conversation (clear cascade, FR-44). */
  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected ?? 0;
  }

  async deleteAll(): Promise<number> {
    const result = await this.repository.delete({});
    return result.affected ?? 0;
  }

  /**
   * Startup reconciliation (design §16.1). Abandoned transient states become
   * understandable queued/paused/sent/applied states; no provider request
   * may start from here.
   */
  async recoverOnStartup(): Promise<{
    recoveredToSent: number;
    recoveredToApplied: number;
    pausedDispatching: number;
    pausedSteering: number;
    pausedQueued: number;
  }> {
    const counts = {
      recoveredToSent: 0,
      recoveredToApplied: 0,
      pausedDispatching: 0,
      pausedSteering: 0,
      pausedQueued: 0,
    };
    const nonTerminal = await this.listNonTerminalAll();
    const messageRepo =
      this.sqliteDb.connection.getRepository(AIChatMessageEntity);
    const now = new Date();
    for (const row of nonTerminal) {
      if (row.status === "dispatching") {
        const delivered = await messageRepo.findOne({
          where: {
            conversationId: row.conversationId,
            messageId: row.userMessageId,
          },
        });
        if (delivered) {
          await this.repository.update(row.id, {
            status: "sent" as AIChatPendingMessageStatus,
            sentMessageId: delivered.messageId,
            terminalAt: now,
            updatedAt: now,
          });
          counts.recoveredToSent += 1;
        } else {
          await this.repository.update(row.id, {
            status: "paused" as AIChatPendingMessageStatus,
            recoveryReason: "recovered_dispatch",
            claimToken: undefined,
            updatedAt: now,
          });
          counts.pausedDispatching += 1;
        }
        continue;
      }
      if (row.status === "steering") {
        // A user row carrying steering metadata for this pending id proves
        // the instruction was already applied before the restart.
        const applied = await messageRepo
          .createQueryBuilder("m")
          .where("m.conversationId = :conversationId", {
            conversationId: row.conversationId,
          })
          .andWhere("m.messageId = :messageId", {
            messageId: row.userMessageId,
          })
          .getOne();
        if (applied) {
          await this.repository.update(row.id, {
            status: "applied" as AIChatPendingMessageStatus,
            sentMessageId: applied.messageId,
            terminalAt: now,
            updatedAt: now,
          });
          counts.recoveredToApplied += 1;
        } else {
          await this.repository.update(row.id, {
            status: "paused" as AIChatPendingMessageStatus,
            recoveryReason: "recovered_steering",
            claimToken: undefined,
            targetAssistantMessageId: undefined,
            updatedAt: now,
          });
          counts.pausedSteering += 1;
        }
        continue;
      }
      if (row.status === "queued") {
        await this.repository.update(row.id, {
          status: "paused" as AIChatPendingMessageStatus,
          recoveryReason: "recovered_after_restart",
          updatedAt: now,
        });
        counts.pausedQueued += 1;
      }
    }
    return counts;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private contentDigest(content: string): string {
    return crypto
      .createHash("sha256")
      .update(content.trim().replace(/\r\n/g, "\n"))
      .digest("hex");
  }

  /** One conditional UPDATE out of `queued`; the single-claimant gate. */
  private async conditionalClaim(
    row: AIChatPendingMessageEntity,
    next: "dispatching" | "steering"
  ): Promise<AIChatPendingClaimResult> {
    const claimToken = newClaimToken();
    const result = await this.repository.update(
      { id: row.id, status: "queued" as AIChatPendingMessageStatus },
      {
        status: next,
        claimToken,
        claimedAt: new Date(),
        attemptCount: (row.attemptCount ?? 0) + 1,
        updatedAt: new Date(),
      }
    );
    if ((result.affected ?? 0) !== 1) {
      const latest = await this.getByPendingMessageId(row.pendingMessageId);
      return {
        ok: false,
        code: "PENDING_NOT_CLAIMABLE",
        row: latest ?? undefined,
      };
    }
    const claimed = await this.getByPendingMessageId(row.pendingMessageId);
    if (!claimed || claimed.claimToken !== claimToken) {
      // Lost the row between UPDATE and reload — treat as a failed claim.
      return {
        ok: false,
        code: "PENDING_NOT_CLAIMABLE",
        row: claimed ?? undefined,
      };
    }
    return { ok: true, row: claimed };
  }

  /** Reload the row inside a transaction, verifying status + claim token. */
  private async loadClaimed(
    manager: EntityManager,
    pendingMessageId: string,
    expectedStatus: AIChatPendingMessageStatus,
    claimToken: string
  ): Promise<AIChatPendingMessageEntity> {
    const pending = await manager
      .getRepository(AIChatPendingMessageEntity)
      .findOne({ where: { pendingMessageId } });
    if (
      !pending ||
      pending.status !== expectedStatus ||
      pending.claimToken !== claimToken
    ) {
      throw new AIChatPendingModelError(
        "PENDING_NOT_CLAIMABLE",
        `Pending message ${pendingMessageId} is no longer claimable.`
      );
    }
    return pending;
  }

  /**
   * Insert the delivered user row with the deterministic userMessageId, or
   * validate the existing matching row (crash-safe: promotion retries reuse
   * the same row instead of duplicating it).
   */
  private async insertUserRowIfAbsent(
    manager: EntityManager,
    pending: AIChatPendingMessageEntity,
    metadata?: ChatV2MessageMetadata
  ): Promise<AIChatMessageEntity> {
    const repo = manager.getRepository(AIChatMessageEntity);
    const existing = await repo.findOne({
      where: {
        conversationId: pending.conversationId,
        messageId: pending.userMessageId,
      },
    });
    if (existing) {
      return existing;
    }
    const row = new AIChatMessageEntity();
    row.messageId = pending.userMessageId;
    row.conversationId = pending.conversationId;
    row.role = "user";
    row.content = pending.content;
    row.timestamp = new Date();
    row.metadata = JSON.stringify(
      metadata ?? this.parseStoredMetadata(pending)
    );
    row.messageType = MessageType.MESSAGE;
    return await repo.save(row);
  }

  private parseStoredMetadata(
    pending: AIChatPendingMessageEntity
  ): ChatV2MessageMetadata {
    if (pending.messageMetadataJson) {
      try {
        const parsed = JSON.parse(
          pending.messageMetadataJson
        ) as ChatV2MessageMetadata;
        if (parsed && typeof parsed === "object") {
          return { ...parsed, source: "chat-v2" };
        }
      } catch {
        // fall through to default
      }
    }
    return { source: "chat-v2" };
  }
}
