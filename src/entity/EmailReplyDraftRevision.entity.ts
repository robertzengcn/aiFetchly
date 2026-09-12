import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Immutable snapshot of one revision of a reply draft (technical design §6.4,
 * AD-003).
 *
 * Editing a draft NEVER overwrites a revision row — it creates a new revision
 * with the next `revisionNumber`. This is what lets approval bind to an exact,
 * unchangeable content + envelope (FR-014, FR-015). The {@link EmailReplyDraftEntity}
 * remains the aggregate / current-state projection; new writes update the
 * projection and append a revision in one transaction (§6.3).
 *
 * Revision rows are write-once. Do not mutate after creation.
 */
@Entity("email_reply_draft_revision")
@Index(["draftId", "revisionNumber"], { unique: true })
@Index(["contentHash"])
export class EmailReplyDraftRevisionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  draftId: number;

  @Column("integer")
  revisionNumber: number;

  /** Who produced this revision: the model or a human editor. */
  @Column("varchar", { length: 20 })
  actor: "ai" | "user";

  @Column("varchar", { length: 998 })
  subject: string;

  @Column("text")
  bodyText: string;

  @Column("text", { nullable: true })
  bodyHtml: string | null;

  @Column("varchar", { length: 320 })
  senderAddress: string;

  @Column("varchar", { length: 320 })
  recipientAddress: string;

  /** SHA-256 over the canonical approval envelope (see EmailReplyRevisionHasher). */
  @Column("varchar", { length: 64 })
  contentHash: string;

  /**
   * Envelope schema version bound to this revision (1 = legacy, 2 = identity-bound).
   * Defaults to 1 so existing rows and callers that don't set it stay on the v1
   * hash path (additive, no data loss under TypeORM synchronize).
   */
  @Column("integer", { default: 1 })
  envelopeVersion: 1 | 2;

  /**
   * Effective SMTP login username frozen on this revision (§18.1). Null for v1
   * revisions; populated for v2 revisions by the materializer.
   */
  @Column({ type: "varchar", length: 255, nullable: true })
  smtpUsername: string | null;

  /**
   * Effective Reply-To frozen on this revision (§18.1). Null for v1 revisions
   * and for v2 revisions where the service has no configured Reply-To.
   */
  @Column({ type: "varchar", length: 320, nullable: true })
  replyToAddress: string | null;

  /** Sanitized generation metadata (versions, truncation/summary flags). No prompts. */
  @Column("text", { nullable: true })
  generationMetadataJson: string | null;

  /** Serialized deterministic validation findings. No raw model prose. */
  @Column("text", { nullable: true })
  validationFindingsJson: string | null;
}
