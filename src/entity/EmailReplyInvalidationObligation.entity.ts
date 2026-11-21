import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * R5-04 (design §10.4): a durable obligation to invalidate pending reply
 * approvals for a message whose location changed. When the immediate
 * invalidation write fails after a successful server-side move, the move
 * must NOT be reported as a clean success: the obligation row survives the
 * process, reply admission refuses to send while it is open, and every
 * later repair path retries it until it lands.
 */
@Entity("email_reply_invalidation_obligation")
@Index(["messageId", "resolvedAt"])
@Index(["emailServiceId", "resolvedAt"])
export class EmailReplyInvalidationObligationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  @Column("integer") messageId!: number;

  @Column("integer") emailServiceId!: number;

  /** Destination folder of the move that created the obligation. */
  @Column("varchar", { length: 255 }) destinationFolder!: string;

  /** Monotonic retry counter for the support workflow. */
  @Column("integer", { default: 0 }) attempts!: number;

  /** Null = open (reply sending is refused); set = obligation landed. */
  @Column("datetime", { nullable: true }) resolvedAt!: Date | null;
}
