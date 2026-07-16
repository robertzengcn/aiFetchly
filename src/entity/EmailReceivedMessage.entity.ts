import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";

/**
 * A normalized inbound email message stored locally after a receive sync.
 *
 * Unique by `(emailServiceId, providerUid)` so repeated syncs upsert instead of
 * duplicating rows. Bodies are stored sanitized; raw HTML is never persisted.
 */
@Entity("email_received_message")
@Index(["emailServiceId", "providerUid"], { unique: true })
@Index(["emailServiceId", "receivedAt"])
@Index(["messageId"])
@Index(["threadKey"])
export class EmailReceivedMessageEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("integer")
  emailServiceId!: number;

  /** Provider-stable identifier (IMAP UID or POP3 UIDL/hash). Used for dedupe. */
  @Column("varchar", { length: 255 })
  providerUid!: string;

  @Column("varchar", { length: 998, nullable: true })
  messageId!: string | null;

  /** Normalized thread key derived from References / In-Reply-To / Message-ID. */
  @Column("varchar", { length: 998, nullable: true })
  threadKey!: string | null;

  @Column("varchar", { length: 998, nullable: true })
  inReplyTo!: string | null;

  @Column("text", { nullable: true })
  referencesHeader!: string | null;

  @Column("varchar", { length: 320 })
  fromAddress!: string;

  @Column("varchar", { length: 255, nullable: true })
  fromName!: string | null;

  @Column("varchar", { length: 320, nullable: true })
  replyToAddress!: string | null;

  @Column("text")
  toAddressesJson!: string;

  @Column("text", { nullable: true })
  ccAddressesJson!: string | null;

  @Column("varchar", { length: 998 })
  subject!: string;

  @Column("text", { nullable: true })
  bodyText!: string | null;

  @Column("text", { nullable: true })
  bodyHtmlSanitized!: string | null;

  @Column("text", { nullable: true })
  snippet!: string | null;

  @Column("datetime")
  receivedAt!: Date;

  @Column("integer", { default: 1 })
  isUnread!: number;

  @Column("varchar", { length: 50, nullable: true })
  classification!: EmailMessageClassification | null;

  @Column("real", { nullable: true })
  classificationConfidence!: number | null;

  @Column("varchar", { length: 50, default: "not_started" })
  replyStatus!: EmailReplyStatus;

  @Column("datetime", { nullable: true })
  processedAt!: Date | null;
}
