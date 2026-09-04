import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { OutboundEmailDraftStatus } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * A single per-recipient outbound-email draft (technical design §7.3). Points
 * at an append-only revision holding the frozen envelope content. The unique
 * (batchId, recipientAddress) index enforces one draft per recipient per batch.
 */
@Entity("outbound_email_draft")
@Index(["batchId", "recipientAddress"], { unique: true })
@Index(["batchId", "status"])
@Index(["currentRevisionId"])
export class OutboundEmailDraftEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("int")
  batchId: number;

  /** Canonicalized (lowercased) recipient email address. */
  @Column("varchar", { length: 320 })
  recipientAddress: string;

  /** UI-only display name; not part of the hashed envelope. */
  @Column("varchar", { length: 320, nullable: true })
  recipientDisplayName: string | null;

  /** Traceability reference without dumping the raw source. */
  @Column("varchar", { length: 200, nullable: true })
  recipientSourceRef: string | null;

  @Column("varchar", { length: 30 })
  status: OutboundEmailDraftStatus;

  /** Pointer to the current immutable revision. */
  @Column("int", { nullable: true })
  currentRevisionId: number | null;

  /** Monotonic revision counter. */
  @Column("int")
  revisionNumber: number;

  /** Current envelope hash (mirror of the current revision's contentHash). */
  @Column("varchar", { length: 64, nullable: true })
  contentHash: string | null;

  @Column("varchar", { length: 100, nullable: true })
  lastErrorCode: string | null;
}