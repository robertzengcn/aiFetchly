import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { OutboundEmailSendAttemptStatus } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Append-only ledger of one outbound-email send attempt (technical design
 * §7.6). One authorization produces at most one attempt (AD-009); the
 * deterministic `idempotencyKey` is protected by a unique index so duplicate
 * requests cannot duplicate SMTP submission (FR-018).
 *
 * SMTP is outside SQLite transactions. The lifecycle is:
 *   claimed   — atomic claim committed BEFORE SMTP.
 *   worker_starting — worker process spawned.
 *   sending   — worker acknowledged and is sending.
 *   completed — all recipients reached a terminal outcome.
 *   partially_completed — some recipients failed/suppressed.
 *   delivery_unknown — timeout/disconnect; NEVER automatically retried (FR-019).
 *   failed    — definite pre-acceptance rejection only.
 *
 * Never store SMTP credentials, raw transport objects, or full provider
 * responses here — only sanitized error codes and provider message ids.
 */
@Entity("outbound_email_send_attempt")
@Index(["batchId"])
@Index(["idempotencyKey"], { unique: true })
@Index(["status", "claimedAt"])
export class OutboundEmailSendAttemptEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("int")
  batchId: number;

  /** One-time authorization that produced this attempt. */
  @Column("int")
  authorizationId: number;

  /** Verified at claim. */
  @Column("varchar", { length: 64 })
  batchHash: string;

  /** Deterministic key: outbound-email:v1:<batchId>:<authorizationId>:<batchHash> */
  @Column("varchar", { length: 128 })
  idempotencyKey: string;

  @Column("varchar", { length: 40 })
  status: OutboundEmailSendAttemptStatus;

  /** Existing campaign task link. */
  @Column("int", { nullable: true })
  legacyTaskId: number | null;

  /** Diagnostic only. */
  @Column("int", { nullable: true })
  workerPid: number | null;

  @Column("datetime")
  claimedAt: Date;

  @Column("datetime", { nullable: true })
  workerStartedAt: Date | null;

  @Column("datetime", { nullable: true })
  completedAt: Date | null;

  /** Sanitized reason. */
  @Column("varchar", { length: 100, nullable: true })
  lastErrorCode: string | null;
}