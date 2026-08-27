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
@Index(["emailServiceId", "conversationId", "receivedAt"])
@Index(["emailServiceId", "normalizedMessageId"])
@Index(["messageId"])
@Index(["threadKey"])
export class EmailReceivedMessageEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  emailServiceId: number;

  /** Provider-stable identifier (IMAP UID or POP3 UIDL/hash). Used for dedupe. */
  @Column("varchar", { length: 255 })
  providerUid: string;

  @Column("varchar", { length: 998, nullable: true })
  messageId: string | null;

  /** Normalized thread key derived from References / In-Reply-To / Message-ID. */
  @Column("varchar", { length: 998, nullable: true })
  threadKey: string | null;

  @Column("varchar", { length: 998, nullable: true })
  inReplyTo: string | null;

  @Column("text", { nullable: true })
  referencesHeader: string | null;

  @Column("varchar", { length: 320 })
  fromAddress: string;

  @Column("varchar", { length: 255, nullable: true })
  fromName: string | null;

  @Column("varchar", { length: 320, nullable: true })
  replyToAddress: string | null;

  @Column("text")
  toAddressesJson: string;

  @Column("text", { nullable: true })
  ccAddressesJson: string | null;

  @Column("varchar", { length: 998 })
  subject: string;

  @Column("text", { nullable: true })
  bodyText: string | null;

  @Column("text", { nullable: true })
  bodyHtmlSanitized: string | null;

  @Column("text", { nullable: true })
  snippet: string | null;

  @Column("datetime")
  receivedAt: Date;

  @Column("integer", { default: 1 })
  isUnread: number;

  @Column("varchar", { length: 50, nullable: true })
  classification: EmailMessageClassification | null;

  @Column("real", { nullable: true })
  classificationConfidence: number | null;

  @Column("varchar", { length: 50, default: "not_started" })
  replyStatus: EmailReplyStatus;

  @Column("datetime", { nullable: true })
  processedAt: Date | null;

  // ---- Conversation + normalization extension (P1, technical design §6.2) ----

  /** Conversation this message belongs to (EmailConversationEntity.id). */
  @Column("integer", { nullable: true })
  conversationId: number | null;

  /** Normalized RFC Message-ID (unfolded, validated, length-capped). */
  @Column("varchar", { length: 998, nullable: true })
  normalizedMessageId: string | null;

  @Column("varchar", { length: 998, nullable: true })
  normalizedInReplyTo: string | null;

  /** Serialized normalized References chain (JSON string[]). */
  @Column("text", { nullable: true })
  normalizedReferencesJson: string | null;

  /** Safe plain text used for policy/context (quote/signature reduced). */
  @Column("text", { nullable: true })
  normalizedBodyText: string | null;

  /** The newly-written part of a reply, separated from quoted history. */
  @Column("text", { nullable: true })
  newContentText: string | null;

  // ---- Automated-message header signals (FR-020, P2) ----
  @Column("varchar", { length: 998, nullable: true })
  autoSubmittedHeader: string | null;
  @Column("varchar", { length: 998, nullable: true })
  precedenceHeader: string | null;
  @Column("varchar", { length: 998, nullable: true })
  listIdHeader: string | null;
  @Column("varchar", { length: 998, nullable: true })
  listUnsubscribeHeader: string | null;

  // ---- Attachment metadata (names/types/sizes only; never opened — FR-021) ----
  @Column("integer", { default: 0 })
  hasAttachments: number;
  @Column("text", { nullable: true })
  attachmentMetadataJson: string | null;

  // ---- Classification provenance (FR-007) ----
  @Column("varchar", { length: 30, nullable: true })
  classificationSource: string | null;
  @Column("varchar", { length: 50, nullable: true })
  classificationVersion: string | null;
  @Column("datetime", { nullable: true })
  classifiedAt: Date | null;
}
