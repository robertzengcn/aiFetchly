import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailConversationContextConfidence } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * One canonical, mailbox-scoped email conversation (technical design §6.1,
 * AD-002, FR-001). Identity is always scoped by `emailServiceId` and an exact
 * normalized root message identifier; subject-only grouping is prohibited.
 *
 * `rootMessageKey` is a normalized exact RFC message id, or a deterministic
 * singleton key (`provider:<providerUid>`) when no usable identifiers exist.
 * Singleton keys never merge by subject, so a conversation cannot contain
 * messages from another email service.
 */
@Entity("email_conversation")
@Index(["emailServiceId", "rootMessageKey"], { unique: true })
@Index(["emailServiceId", "lastMessageAt"])
export class EmailConversationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("integer")
  emailServiceId!: number;

  @Column("varchar", { length: 998 })
  rootMessageKey!: string;

  @Column("varchar", { length: 998, nullable: true })
  displaySubject!: string | null;

  @Column("varchar", { length: 20, default: "exact" })
  contextConfidence!: EmailConversationContextConfidence;

  /** Recorded when confidence is partial/ambiguous (FR-001). */
  @Column("text", { nullable: true })
  ambiguityReason!: string | null;

  @Column("datetime")
  lastMessageAt!: Date;

  /** Bumped when the conversation's turn set changes (cache invalidation). */
  @Column("integer", { default: 1 })
  contextVersion!: number;
}
