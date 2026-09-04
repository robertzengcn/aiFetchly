import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  OutboundEmailAuthorizationType,
  OutboundEmailAuthorizationStatus,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * A request-scoped authorization to send a specific batch of outbound emails
 * (technical design §7.5). Binds to the exact authorized envelope set via
 * `batchHash`. One authorization produces at most one send attempt (AD-009).
 *
 * Rules (§7.5):
 *  - direct-send authorization expires after 15 minutes;
 *  - review approval expires after 30 minutes;
 *  - only one active authorization may exist for a batch;
 *  - raw review tokens are returned once and never stored (only the SHA-256
 *    hash is persisted);
 *  - the model never receives the raw token;
 *  - any envelope-affecting edit invalidates the authorization.
 */
@Entity("outbound_email_authorization")
@Index(["batchId"])
export class OutboundEmailAuthorizationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("int")
  batchId: number;

  /** Instruction or review approval. */
  @Column("varchar", { length: 40 })
  type: OutboundEmailAuthorizationType;

  /** Authorization source (the user message that authorized it). */
  @Column("varchar", { length: 100 })
  sourceUserMessageId: string;

  /** Required for direct send. */
  @Column("int", { nullable: true })
  intentDecisionId: number | null;

  /** Exact authorized envelope set hash. */
  @Column("varchar", { length: 64 })
  batchHash: string;

  /** Review approval only; SHA-256 of the one-time token. */
  @Column("varchar", { length: 64, nullable: true })
  tokenHash: string | null;

  @Column("varchar", { length: 20 })
  status: OutboundEmailAuthorizationStatus;

  @Column("datetime")
  expiresAt: Date;

  /** Atomic claim time. */
  @Column("datetime", { nullable: true })
  consumedAt: Date | null;

  /** Edit/policy change time. */
  @Column("datetime", { nullable: true })
  invalidatedAt: Date | null;

  @Column("varchar", { length: 100, nullable: true })
  invalidationReason: string | null;
}