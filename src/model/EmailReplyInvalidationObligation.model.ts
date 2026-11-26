import { IsNull, Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { EmailReplyInvalidationObligationEntity } from "@/entity/EmailReplyInvalidationObligation.entity";

/**
 * R5-04 (design §10.4): data access for reply-invalidation obligations.
 * An open obligation means "a message moved but its pending reply approvals
 * may still be sendable" — reply admission refuses until the invalidation
 * lands, and repair paths resolve the row once it does.
 */
export class EmailReplyInvalidationObligationModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get repository(): Repository<EmailReplyInvalidationObligationEntity> {
    return this.sqliteDb.connection.getRepository(EmailReplyInvalidationObligationEntity);
  }

  /** Records an open obligation (idempotent per open row: one retry bump). */
  async recordOpen(input: {
    readonly messageId: number;
    readonly emailServiceId: number;
    readonly destinationFolder: string;
  }): Promise<void> {
    const open = await this.repository.findOne({
      where: { messageId: input.messageId, resolvedAt: IsNull() },
      order: { id: "DESC" },
    });
    if (open) {
      await this.repository.update(
        { id: open.id },
        { attempts: open.attempts + 1, destinationFolder: input.destinationFolder }
      );
      return;
    }
    await this.repository.save(
      this.repository.create({
        messageId: input.messageId,
        emailServiceId: input.emailServiceId,
        destinationFolder: input.destinationFolder,
        attempts: 1,
        resolvedAt: null,
      })
    );
  }

  /** True while any open obligation blocks reply sending for this message. */
  async hasOpen(messageId: number): Promise<boolean> {
    const count = await this.repository.count({
      where: { messageId, resolvedAt: IsNull() },
    });
    return count > 0;
  }

  /** Resolves open obligations after a successful invalidation. */
  async resolveAll(messageId: number): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(EmailReplyInvalidationObligationEntity)
      .set({ resolvedAt: new Date() })
      .where("messageId = :messageId AND resolvedAt IS NULL", { messageId })
      .execute();
  }
}
