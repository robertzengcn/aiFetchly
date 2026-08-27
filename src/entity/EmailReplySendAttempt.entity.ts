import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Append-only ledger of one SMTP send attempt for an approved revision
 * (technical design §6.6, AD-005, AD-007).
 *
 * SMTP is outside SQLite transactions. The lifecycle is:
 *
 *   claimed   — atomic `approved -> sending` transition committed BEFORE SMTP.
 *   submitted — (optional) acknowledged that SMTP sendMail was invoked.
 *   sent      — provider accepted; providerMessageId stored when available.
 *   failed    — definite pre-acceptance rejection only.
 *   delivery_unknown — timeout/disconnect/post-acceptance DB failure; NEVER
 *                automatically retried (FR-019).
 *
 * Successful attempts also serve as immutable outbound conversation turns
 * (FR-002, AD-005); Milestone 2 reads them back into thread context.
 *
 * Never store SMTP credentials, raw transport objects, or full provider
 * responses here — only {@link sanitizedError} and {@link providerMessageId}.
 */
@Entity("email_reply_send_attempt")
@Index(["idempotencyKey"], { unique: true })
@Index(["draftId", "revisionId"])
@Index(["emailServiceId", "createdAt"])
@Index(["status", "claimedAt"])
export class EmailReplySendAttemptEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Deterministic key over (draftId, revisionId, approvedHash) — §15.3. */
  @Column("varchar", { length: 64 })
  idempotencyKey!: string;

  @Column("integer")
  draftId!: number;

  @Column("integer")
  revisionId!: number;

  @Column("integer")
  approvalId!: number;

  @Column("integer")
  messageId!: number;

  /** Conversation the inbound message belongs to. Nullable until Milestone 2. */
  @Column("integer", { nullable: true })
  conversationId!: number | null;

  @Column("integer")
  emailServiceId!: number;

  @Column("varchar", { length: 320 })
  senderAddress!: string;

  @Column("varchar", { length: 320 })
  recipientAddress!: string;

  @Column("varchar", { length: 30 })
  status!: EmailReplySendAttemptStatus;

  @Column("datetime")
  claimedAt!: Date;

  @Column("datetime", { nullable: true })
  submittedAt!: Date | null;

  @Column("datetime", { nullable: true })
  completedAt!: Date | null;

  /** Provider message id, stored on success when the provider returns one. */
  @Column("varchar", { length: 998, nullable: true })
  providerMessageId!: string | null;

  @Column("varchar", { length: 50, nullable: true })
  failureCode!: string | null;

  /** Sanitized, length-bounded diagnostic. No credentials or raw SMTP dumps. */
  @Column("text", { nullable: true })
  sanitizedError!: string | null;
}
