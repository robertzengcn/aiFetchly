import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { OutboundEmailBatchStatus } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * A durable outbound-email draft batch — the unit of preflight, authorization,
 * and delivery (technical design §7.2). Owned by a single conversation and the
 * user turn that requested the work. One batch holds the per-recipient drafts
 * that become the immutable envelope set authorized for sending.
 */
@Entity("outbound_email_draft_batch")
@Index(["conversationId", "createdAt"])
@Index(["sourceUserMessageId"])
@Index(["status", "updatedAt"])
export class OutboundEmailDraftBatchEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 100 })
  conversationId: string;

  /** User turn that requested the draft work. */
  @Column("varchar", { length: 100 })
  sourceUserMessageId: string;

  /** The resolved intent decision driving this batch. */
  @Column("int")
  intentDecisionId: number;

  @Column("varchar", { length: 40 })
  status: OutboundEmailBatchStatus;

  /** Search result, list, explicit, etc. */
  @Column("varchar", { length: 40 })
  recipientSourceType: string;

  @Column("int", { nullable: true })
  recipientSourceId: number | null;

  /** Materialized recipient count. */
  @Column("int")
  recipientCount: number;

  /** Latest preflight-valid recipient count. */
  @Column("int")
  validRecipientCount: number;

  /** Requested service IDs (JSON-serialized number[]). */
  @Column("text")
  emailServiceIdsJson: string;

  /** Current envelope-set hash. */
  @Column("varchar", { length: 64, nullable: true })
  batchHash: string | null;

  @Column("varchar", { length: 50, nullable: true })
  policyVersion: string | null;

  @Column("varchar", { length: 50, nullable: true })
  validationVersion: string | null;

  @Column("int", { nullable: true })
  authorizationId: number | null;

  @Column("int", { nullable: true })
  legacyTaskId: number | null;

  @Column("int", { nullable: true })
  sendAttemptId: number | null;

  @Column("varchar", { length: 100, nullable: true })
  lastErrorCode: string | null;

  @Column("datetime", { nullable: true })
  authorizedAt: Date | null;

  @Column("datetime", { nullable: true })
  queuedAt: Date | null;

  @Column("datetime", { nullable: true })
  completedAt: Date | null;
}