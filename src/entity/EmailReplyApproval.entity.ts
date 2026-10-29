import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailReplyApprovedByType } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Approval of one exact draft revision (technical design §6.5, AD-004).
 *
 * Approval binds a user gesture (or a confirmed tool-execution event) to the
 * exact current revision, sender, recipient, policy version, and canonical
 * SHA-256 hash (FR-015). It is the precondition for the only `approved ->
 * sending` transition (FR-016).
 *
 * Security:
 *  - Only {@link approvalTokenHash} is persisted. The raw one-time token is
 *    returned once to the trusted caller and never logged (§14.2, §26).
 *  - {@link approvedHash} must match the live revision's `contentHash` at send
 *    time, or send is blocked with `approval_stale`.
 *  - {@link invalidatedAt} is set whenever the underlying revision changes; an
 *    invalidated approval cannot be used to claim a send.
 */
@Entity("email_reply_approval")
@Index(["draftId", "revisionId"])
@Index(["approvalTokenHash"], { unique: true })
export class EmailReplyApprovalEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("integer")
  draftId!: number;

  @Column("integer")
  revisionId!: number;

  @Column("varchar", { length: 20 })
  approvedByType!: EmailReplyApprovedByType;

  /** Renderer-safe actor id (e.g. user id). Null for anonymous tool confirmation. */
  @Column("varchar", { length: 255, nullable: true })
  approvedById!: string | null;

  /** Canonical envelope hash at approval time. Compared again at send time. */
  @Column("varchar", { length: 64 })
  approvedHash!: string;

  /** SHA-256 of the one-time approval token. Unique. */
  @Column("varchar", { length: 64 })
  approvalTokenHash!: string;

  @Column("datetime")
  approvedAt!: Date;

  /** Optional TTL expiry. Null means no automatic expiry (policy may still invalidate). */
  @Column("datetime", { nullable: true })
  expiresAt!: Date | null;

  /** Set when consumed by a send attempt or invalidated by an edit. */
  @Column("datetime", { nullable: true })
  invalidatedAt!: Date | null;

  @Column("text", { nullable: true })
  invalidationReason!: string | null;
}
