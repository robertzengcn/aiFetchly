import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  EmailReplyDraftStatus,
  EmailReplyGenerationSource,
} from "@/entityTypes/emailReceiveTypes";

/**
 * A reply draft for a received message. May be AI-generated (knowledge-grounded)
 * or manually written. Drafts are persisted before being returned and never sent
 * without explicit confirmation in Phase 1.
 */
@Entity("email_reply_draft")
@Index(["messageId"])
@Index(["emailServiceId"])
export class EmailReplyDraftEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  messageId: number;

  @Column("integer", { nullable: true })
  emailServiceId: number | null;

  @Column("varchar", { length: 998 })
  subject: string;

  @Column("text")
  bodyText: string;

  @Column("text", { nullable: true })
  bodyHtml: string | null;

  @Column("varchar", { length: 50, default: "draft" })
  status: EmailReplyDraftStatus;

  @Column("varchar", { length: 20, default: "ai" })
  generationSource: EmailReplyGenerationSource;

  @Column("varchar", { length: 100, nullable: true })
  modelName: string | null;

  @Column("varchar", { length: 50, nullable: true })
  promptVersion: string | null;

  @Column("real", { nullable: true })
  confidence: number | null;

  /** Serialized {@code EmailReplyKnowledgeSourceAudit[]}. */
  @Column("text", { nullable: true })
  knowledgeSourcesJson: string | null;

  @Column("text", { nullable: true })
  ownerStyleProfileJson: string | null;

  @Column("text", { nullable: true })
  warningsJson: string | null;

  @Column("datetime", { nullable: true })
  sentAt: Date | null;

  @Column("text", { nullable: true })
  sendError: string | null;

  // ---- Reliability extension (Milestone 1, technical design §6.3) ----
  // The entity above remains the aggregate + current-revision projection so
  // legacy UI/DTO consumers keep working. The fields below bind the projection
  // to the immutable revision and approval records.

  /** Conversation the source message belongs to. Nullable until Milestone 2. */
  @Column("integer", { nullable: true })
  conversationId: number | null;

  /** Current immutable revision id (EmailReplyDraftRevisionEntity.id). */
  @Column("integer", { nullable: true })
  currentRevisionId: number | null;

  /** Monotonic revision counter; bumped on every edit. */
  @Column("integer", { default: 1 })
  revisionNumber: number;

  /** Sender mailbox address bound to this draft. */
  @Column("varchar", { length: 320, nullable: true })
  senderAddress: string | null;

  /** Resolved reply recipient (Reply-To or from). */
  @Column("varchar", { length: 320, nullable: true })
  recipientAddress: string | null;

  /** Canonical envelope hash of the current revision. */
  @Column("varchar", { length: 64, nullable: true })
  contentHash: string | null;

  /** Policy version last evaluated against this draft. */
  @Column("varchar", { length: 50, nullable: true })
  policyVersion: string | null;

  /** Validator version last applied to the current revision. */
  @Column("varchar", { length: 50, nullable: true })
  validationVersion: string | null;

  /** Thread-context version used when the draft was generated (Milestone 2). */
  @Column("integer", { default: 1 })
  contextVersion: number;

  /** Knowledge-scope version used (Milestone 4). Null until scoped knowledge ships. */
  @Column("integer", { nullable: true })
  knowledgeScopeVersion: number | null;

  /** Timestamp of the most recent approval invalidation (edit / scope change). */
  @Column("datetime", { nullable: true })
  approvalInvalidatedAt: Date | null;
}
