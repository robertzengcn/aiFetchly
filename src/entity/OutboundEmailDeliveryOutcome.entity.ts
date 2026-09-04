import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { OutboundEmailRecipientOutcomeStatus } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Per-recipient delivery outcome for a send attempt (technical design §7.7).
 * The unique (sendAttemptId, draftId) index guarantees at most one outcome per
 * recipient per attempt, so a worker event cannot be double-recorded.
 */
@Entity("outbound_email_delivery_outcome")
@Index(["sendAttemptId", "draftId"], { unique: true })
@Index(["batchId", "status"])
export class OutboundEmailDeliveryOutcomeEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("int")
  sendAttemptId: number;

  @Column("int")
  batchId: number;

  /** Unique with attempt. */
  @Column("int")
  draftId: number;

  /** Exact revision sent. */
  @Column("int")
  revisionId: number;

  /** Correlation check against the authorized envelope. */
  @Column("varchar", { length: 64 })
  envelopeHash: string;

  /** Canonical recipient. */
  @Column("varchar", { length: 320 })
  recipientAddress: string;

  @Column("varchar", { length: 30 })
  status: OutboundEmailRecipientOutcomeStatus;

  /** Provider message id, stored when available. */
  @Column("varchar", { length: 500, nullable: true })
  providerMessageId: string | null;

  /** Sanitized error code. */
  @Column("varchar", { length: 100, nullable: true })
  errorCode: string | null;

  /** Provider accepted the request. */
  @Column("datetime", { nullable: true })
  submittedAt: Date | null;

  /** Terminal local status time. */
  @Column("datetime", { nullable: true })
  completedAt: Date | null;
}