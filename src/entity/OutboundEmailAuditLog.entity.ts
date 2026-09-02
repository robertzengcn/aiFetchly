import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Append-only audit log of every state-changing event in the outbound-email
 * intent->draft->authorize->deliver pipeline (technical design §7.8). Must not
 * store SMTP passwords, access tokens, complete prompts, or unredacted customer
 * data beyond addresses required for email operation.
 */
@Entity("outbound_email_audit_log")
@Index(["batchId", "createdAt"])
@Index(["eventCode"])
export class OutboundEmailAuditLogEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** `user`, `ai`, or `system`. */
  @Column("varchar", { length: 20 })
  actorType: string;

  /** Stable, machine-readable event code (e.g. `intent_resolved`). */
  @Column("varchar", { length: 100 })
  eventCode: string;

  @Column("varchar", { length: 100, nullable: true })
  conversationId: string | null;

  @Column("varchar", { length: 100, nullable: true })
  sourceUserMessageId: string | null;

  @Column("int", { nullable: true })
  intentDecisionId: number | null;

  @Column("int", { nullable: true })
  batchId: number | null;

  @Column("int", { nullable: true })
  draftId: number | null;

  @Column("int", { nullable: true })
  revisionId: number | null;

  @Column("int", { nullable: true })
  authorizationId: number | null;

  @Column("int", { nullable: true })
  sendAttemptId: number | null;

  /** Policy/validator versions in effect when the event occurred (JSON). */
  @Column("text", { nullable: true })
  versionsJson: string | null;

  /** Sanitized metadata; no secrets, tokens, or full prompts (JSON). */
  @Column("text", { nullable: true })
  metadataJson: string | null;
}