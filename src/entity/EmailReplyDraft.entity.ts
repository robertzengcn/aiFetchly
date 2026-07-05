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
}
