import { EntityManager, In, Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { runReplyTxn } from "@/model/replyTxn";
import { EmailOrganizationOperationEntity } from "@/entity/EmailOrganizationOperation.entity";
import { EmailOrganizationOperationItemEntity } from "@/entity/EmailOrganizationOperationItem.entity";
import { EmailOrganizationAttemptEntity } from "@/entity/EmailOrganizationAttempt.entity";
import {
  emailOrganizationOperationWriteSchema,
  emailOrganizationOperationItemWriteSchema,
  emailOrganizationAttemptWriteSchema,
} from "@/schemas/entity/emailOrganization";
import { parseAndStrip } from "@/utils/parseAndStrip";
import {
  deriveOperationStatus,
  countItemsForDisplay,
} from "@/model/emailOrganizationAggregate";
import type {
  EmailOrganizationItemStatus,
  EmailOrganizationOperationKind,
  EmailOrganizationOperationStatus,
  EmailOrganizationOrigin,
} from "@/entityTypes/emailOrganizationTypes";

/**
 * Data access + transaction orchestration for organization operations
 * (technical design §6.2/§6.3). Claims and finalizations run inside the
 * shared reply write transaction (mutex) so operation state, attempt rows
 * and reply-approval coordination stay coherent. No transaction is held
 * across network I/O: claim() returns before dispatch; finalize() runs
 * after the external result is known.
 */

export interface CreateOperationInput {
  readonly operationId: string;
  readonly kind: EmailOrganizationOperationKind;
  readonly emailServiceId: number;
  readonly origin: EmailOrganizationOrigin;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly conversationId?: number | null;
  readonly sourceUserMessageId?: string | null;
  readonly draftId?: number | null;
  readonly messageIds: readonly number[];
  readonly destinations?: Readonly<Record<number, string | null>>;
  readonly policyVersion?: string | null;
}

export type CreateOperationResult =
  | {
      readonly status: "created";
      readonly operation: EmailOrganizationOperationEntity;
      readonly items: EmailOrganizationOperationItemEntity[];
    }
  /** Duplicate invocation: attach to the existing operation. */
  | {
      readonly status: "existing";
      readonly operation: EmailOrganizationOperationEntity;
    };

export interface ClaimItemInput {
  readonly operationId: string;
  readonly messageId: number;
  readonly claimTokenHash: string;
  readonly leaseExpiresAt: Date;
  readonly location: {
    readonly version: number | null;
    readonly folderPath: string | null;
    readonly uidValidity: string | null;
    readonly providerUid: string | null;
  };
  readonly destinationFolderPath: string | null;
}

export type ClaimItemResult =
  | {
      readonly status: "claimed";
      readonly itemId: number;
      readonly attemptId: number;
      readonly attemptNumber: number;
    }
  | { readonly status: "item_not_pending" }
  | { readonly status: "operation_cancelled" }
  | { readonly status: "operation_terminal"; readonly operationStatus: EmailOrganizationOperationStatus };

export interface FinalizeItemInput {
  readonly itemId: number;
  readonly operationId: string;
  readonly status: Exclude<EmailOrganizationItemStatus, "pending" | "claimed">;
  readonly errorCode?: string | null;
  readonly sanitizedError?: string | null;
  readonly acceptedRecipients?: readonly string[];
  readonly rejectedRecipients?: readonly string[];
  readonly unknownRecipients?: readonly string[];
  readonly providerMessageId?: string | null;
  readonly resultJson?: string | null;
  readonly attemptId?: number | null;
}

export class EmailOrganizationOperationModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get operationRepository(): Repository<EmailOrganizationOperationEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationOperationEntity);
  }

  private get itemRepository(): Repository<EmailOrganizationOperationItemEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationOperationItemEntity);
  }

  private get attemptRepository(): Repository<EmailOrganizationAttemptEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationAttemptEntity);
  }

  /**
   * Create an operation with its pending items in one transaction. A unique
   * idempotency key makes duplicate invocations resolve to the existing
   * operation (design §6.3 invariant 7).
   */
  async createOperation(input: CreateOperationInput): Promise<CreateOperationResult> {
    const existing = await this.operationRepository.findOne({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { status: "existing", operation: existing };
    }

    try {
      const created = await runReplyTxn(this.sqliteDb, async (manager) => {
        const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
        const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);

        const stripped = parseAndStrip(
          {
            operationId: input.operationId,
            kind: input.kind,
            emailServiceId: input.emailServiceId,
            origin: input.origin,
            conversationId: input.conversationId ?? null,
            sourceUserMessageId: input.sourceUserMessageId ?? null,
            payloadHash: input.payloadHash,
            idempotencyKey: input.idempotencyKey,
            status: "prepared",
            draftId: input.draftId ?? null,
            pendingCount: input.messageIds.length,
            policyVersion: input.policyVersion ?? null,
            requestedAt: new Date(),
          },
          emailOrganizationOperationWriteSchema()
        ) as unknown as EmailOrganizationOperationEntity;
        const operation = await opRepo.save(opRepo.create(stripped));

        const items: EmailOrganizationOperationItemEntity[] = [];
        for (const messageId of input.messageIds) {
          const itemStripped = parseAndStrip(
            {
              operationId: input.operationId,
              messageId,
              status: "pending",
              beforeFolderPath: null,
              destinationFolderPath: input.destinations?.[messageId] ?? null,
            },
            emailOrganizationOperationItemWriteSchema()
          ) as unknown as EmailOrganizationOperationItemEntity;
          items.push(await itemRepo.save(itemRepo.create(itemStripped)));
        }
        return { operation, items };
      });
      return { status: "created", ...created };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const raced = await this.operationRepository.findOne({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (raced) return { status: "existing", operation: raced };
      }
      throw error;
    }
  }

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<EmailOrganizationOperationEntity | null> {
    return await this.operationRepository.findOne({ where: { idempotencyKey } });
  }

  async read(operationId: string): Promise<EmailOrganizationOperationEntity | null> {
    return await this.operationRepository.findOne({
      where: { operationId },
    });
  }

  async listItems(operationId: string): Promise<EmailOrganizationOperationItemEntity[]> {
    return await this.itemRepository.find({
      where: { operationId },
      order: { id: "ASC" },
    });
  }

  async findItemById(itemId: number): Promise<EmailOrganizationOperationItemEntity | null> {
    return await this.itemRepository.findOne({ where: { id: itemId } });
  }

  /**
   * Transactional claim (design §6.3): conditionally move the item from
   * `pending` to `claimed` and persist the attempt BEFORE any network I/O.
   * Only the winner of the CAS proceeds; a claimed item whose attempt row
   * exists is the durable evidence that dispatch may have happened.
   */
  async claimItem(input: ClaimItemInput): Promise<ClaimItemResult> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
      const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);
      const attemptRepo = manager.getRepository(EmailOrganizationAttemptEntity);

      const operation = await opRepo.findOne({ where: { operationId: input.operationId } });
      if (!operation) return { status: "item_not_pending" } as ClaimItemResult;
      if (operation.status === "cancelled") {
        return { status: "operation_cancelled" } as ClaimItemResult;
      }
      if (this.isTerminal(operation.status)) {
        return {
          status: "operation_terminal",
          operationStatus: operation.status,
        } as ClaimItemResult;
      }

      const claimUpdate = await itemRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationItemEntity)
        .set({
          status: "claimed",
          claimedAt: new Date(),
          beforeLocationVersion: input.location.version,
          beforeFolderPath: input.location.folderPath,
          beforeUidValidity: input.location.uidValidity,
          beforeProviderUid: input.location.providerUid,
          destinationFolderPath: input.destinationFolderPath,
        })
        .where(
          "operationId = :operationId AND messageId = :messageId AND status = :pending",
          { operationId: input.operationId, messageId: input.messageId, pending: "pending" }
        )
        .execute();
      if ((claimUpdate.affected ?? 0) !== 1) {
        return { status: "item_not_pending" } as ClaimItemResult;
      }

      const item = await itemRepo.findOne({
        where: { operationId: input.operationId, messageId: input.messageId },
      });
      if (!item) {
        // Cannot happen after a successful CAS; fail closed.
        throw new Error(
          `claimItem: item vanished after claim (operation=${input.operationId}, message=${input.messageId})`
        );
      }

      const attemptNumber = (await attemptRepo.count({ where: { itemId: item.id } })) + 1;
      const attemptStripped = parseAndStrip(
        {
          itemId: item.id,
          operationId: input.operationId,
          attemptNumber,
          claimTokenHash: input.claimTokenHash,
          phase: "claimed",
          leaseExpiresAt: input.leaseExpiresAt,
        },
        emailOrganizationAttemptWriteSchema()
      ) as unknown as EmailOrganizationAttemptEntity;
      const attempt = await attemptRepo.save(attemptRepo.create(attemptStripped));

      if (operation.status !== "running") {
        await opRepo.update(
          { operationId: input.operationId },
          { status: "running", startedAt: operation.startedAt ?? new Date() }
        );
      }
      return {
        status: "claimed",
        itemId: item.id,
        attemptId: attempt.id,
        attemptNumber,
      } as ClaimItemResult;
    });
  }

  /**
   * Persist the external outcome for one item and re-derive the aggregate
   * status/counts in the same transaction (design §10.3: terminal local
   * updates + audit commit together).
   */
  async finalizeItem(input: FinalizeItemInput): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);
      const attemptRepo = manager.getRepository(EmailOrganizationAttemptEntity);

      // Fenced finalization: a definitive outcome may upgrade a pending claim
      // or an unknown; an unknown may only fill a claim. Nothing ever
      // overwrites a definitive result (design §10.3).
      const resolvable: EmailOrganizationItemStatus[] =
        input.status === "outcome_unknown"
          ? ["claimed"]
          : ["claimed", "outcome_unknown"];
      const update = await itemRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationItemEntity)
        .set({
          status: input.status,
          errorCode: input.errorCode ?? null,
          sanitizedError: input.sanitizedError ?? null,
          acceptedRecipientsJson: input.acceptedRecipients
            ? JSON.stringify(input.acceptedRecipients)
            : undefined,
          rejectedRecipientsJson: input.rejectedRecipients
            ? JSON.stringify(input.rejectedRecipients)
            : undefined,
          unknownRecipientsJson: input.unknownRecipients
            ? JSON.stringify(input.unknownRecipients)
            : undefined,
          completedAt: new Date(),
        })
        .where("id = :itemId AND status IN (:...resolvable)", {
          itemId: input.itemId,
          resolvable,
        })
        .execute();
      if ((update.affected ?? 0) === 0) return;

      if (input.attemptId != null) {
        const attemptUpdate = await attemptRepo
          .createQueryBuilder()
          .update(EmailOrganizationAttemptEntity)
          .set({
            phase: "resolved",
            resolvedAt: new Date(),
            providerMessageId: input.providerMessageId ?? null,
            resultJson: input.resultJson ?? null,
          })
          .where("id = :attemptId AND phase != :resolved", {
            attemptId: input.attemptId,
            resolved: "resolved",
          })
          .execute();
        if ((attemptUpdate.affected ?? 0) === 0) {
          // Attempt already resolved (late duplicate); the item update above
          // was fenced too, so nothing to repair.
        }
      }

      await this.recomputeAggregate(manager, input.operationId);
    });
  }

  /** Mark an attempt as dispatched (before/while network I/O is in flight). */
  async markAttemptDispatched(attemptId: number): Promise<void> {
    await this.attemptRepository
      .createQueryBuilder()
      .update(EmailOrganizationAttemptEntity)
      .set({ phase: "dispatched" })
      .where("id = :attemptId AND phase = :claimed", {
        attemptId,
        claimed: "claimed",
      })
      .execute();
  }

  /**
   * Atomic cancellation request: stamps `cancelRequestedAt` and cancels all
   * still-pending items. Claimed items keep reporting/reconciling (design §11).
   */
  async cancelPending(operationId: string): Promise<boolean> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
      const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);

      const operation = await opRepo.findOne({ where: { operationId } });
      if (!operation) return false;
      if (this.isTerminal(operation.status)) return false;

      await opRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationEntity)
        .set({ cancelRequestedAt: operation.cancelRequestedAt ?? new Date() })
        .where("operationId = :operationId", { operationId })
        .execute();

      await itemRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationItemEntity)
        .set({ status: "cancelled", completedAt: new Date() })
        .where("operationId = :operationId AND status = :pending", {
          operationId,
          pending: "pending",
        })
        .execute();

      await this.recomputeAggregate(manager, operationId);
      return true;
    });
  }

  /** Recompute counts + aggregate status from current item rows. */
  async refreshAggregate(operationId: string): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      await this.recomputeAggregate(manager, operationId);
    });
  }

  async findNonTerminalOperations(): Promise<EmailOrganizationOperationEntity[]> {
    return await this.operationRepository
      .createQueryBuilder("op")
      .where("op.status IN (:...statuses)", {
        statuses: ["prepared", "awaiting_approval", "authorized", "running", "needs_reconciliation"],
      })
      .getMany();
  }

  /** Attempts whose lease expired while not yet resolved (recovery input). */
  async findExpiredClaims(now: Date): Promise<
    Array<{ attempt: EmailOrganizationAttemptEntity; item: EmailOrganizationOperationItemEntity }>
  > {
    const attempts = await this.attemptRepository
      .createQueryBuilder("att")
      .where("att.phase IN (:...phases)", { phases: ["claimed", "dispatched"] })
      .andWhere("att.leaseExpiresAt < :now", { now })
      .getMany();
    if (attempts.length === 0) return [];
    const itemIds = attempts.map((attempt) => attempt.itemId);
    const items = await this.itemRepository.find({ where: { id: In(itemIds) } });
    const byId = new Map(items.map((item) => [item.id, item]));
    return attempts
      .map((attempt) => {
        const item = byId.get(attempt.itemId);
        return item ? { attempt, item } : null;
      })
      .filter((pair): pair is { attempt: EmailOrganizationAttemptEntity; item: EmailOrganizationOperationItemEntity } => pair !== null);
  }

  async listAttemptsForItem(itemId: number): Promise<EmailOrganizationAttemptEntity[]> {
    return await this.attemptRepository.find({
      where: { itemId },
      order: { attemptNumber: "ASC" },
    });
  }

  /** Aggregate derivation against the operation's live items. */
  private async recomputeAggregate(
    manager: EntityManager,
    operationId: string
  ): Promise<void> {
    const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
    const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);
    const operation = await opRepo.findOne({ where: { operationId } });
    if (!operation) return;
    const items = await itemRepo.find({ where: { operationId } });

    const itemStatuses = items.map((item) => item.status);
    const nextStatus = deriveOperationStatus(itemStatuses, operation.cancelRequestedAt !== null);
    const display = countItemsForDisplay(itemStatuses);

    await opRepo
      .createQueryBuilder()
      .update(EmailOrganizationOperationEntity)
      .set({
        status: nextStatus,
        completedCount: display.completed,
        failedCount: display.failed,
        unknownCount: display.unresolved,
        pendingCount: display.pending,
        cancelledCount: display.cancelled,
        completedAt:
          nextStatus !== "running" && nextStatus !== "prepared" && nextStatus !== "awaiting_approval" && nextStatus !== "authorized"
            ? operation.completedAt ?? new Date()
            : null,
      })
      .where("operationId = :operationId", { operationId })
      .execute();
  }

  private isTerminal(status: EmailOrganizationOperationStatus): boolean {
    return (
      status === "succeeded" ||
      status === "partially_succeeded" ||
      status === "failed" ||
      status === "cancelled"
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /UNIQUE constraint failed/i.test(message);
  }
}
