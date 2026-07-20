import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  EmailAutoReplyAuditAction,
  EmailAutoReplyDecisionStatus,
  EmailMessageClassification,
} from "@/entityTypes/emailReceiveTypes";

/**
 * Audit trail for the AI auto-reply function. This is the data source for the
 * user-facing AI Auto-Replies audit UI. One row is written for every auto-reply
 * evaluation, knowledge search, draft, send, block, skip, and failure.
 *
 * Body previews are truncated and sanitized. Full bodies stay in the
 * message/draft tables. Never stores secrets, raw prompts, or tokens.
 */
@Entity("email_auto_reply_audit_log")
@Index(["emailServiceId", "createdAt"])
@Index(["decisionStatus", "createdAt"])
@Index(["messageId"])
@Index(["draftId"])
export class EmailAutoReplyAuditLogEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  emailServiceId: number;

  @Column("integer")
  messageId: number;

  @Column("integer", { nullable: true })
  draftId: number | null;

  @Column("integer", { nullable: true })
  ruleId: number | null;

  @Column("varchar", { length: 50 })
  action: EmailAutoReplyAuditAction;

  @Column("varchar", { length: 50 })
  decisionStatus: EmailAutoReplyDecisionStatus;

  @Column("varchar", { length: 50, nullable: true })
  classification: EmailMessageClassification | null;

  @Column("real", { nullable: true })
  confidence: number | null;

  @Column("text", { nullable: true })
  reason: string | null;

  @Column("text", { nullable: true })
  knowledgeQuery: string | null;

  /** Serialized {@code EmailReplyKnowledgeSourceAudit[]} (no full body content). */
  @Column("text", { nullable: true })
  knowledgeSourcesJson: string | null;

  @Column("varchar", { length: 998, nullable: true })
  generatedSubject: string | null;

  @Column("text", { nullable: true })
  generatedBodyPreview: string | null;

  @Column("varchar", { length: 998, nullable: true })
  sentSubject: string | null;

  @Column("text", { nullable: true })
  sentBodyPreview: string | null;

  @Column("integer", { default: 1 })
  requiresUserApproval: number;

  @Column("integer", { default: 0 })
  approvedByUser: number;

  @Column("text", { nullable: true })
  errorMessage: string | null;

  @Column("text", { nullable: true })
  metadataJson: string | null;
}
