import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  EmailReplyAuditAction,
  EmailReplyAuditActor,
} from "@/entityTypes/emailReceiveTypes";

/**
 * Generic append-only audit log for the receive/reply pipeline: message reads,
 * knowledge retrieval, classification, draft creation, sends, skips, blocks,
 * and failures. Never stores full bodies, credentials, or raw prompts.
 */
@Entity("email_reply_audit_log")
@Index(["emailServiceId", "createdAt"])
@Index(["messageId"])
@Index(["draftId"])
export class EmailReplyAuditLogEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("integer")
  emailServiceId!: number;

  @Column("integer", { nullable: true })
  messageId!: number | null;

  @Column("integer", { nullable: true })
  draftId!: number | null;

  @Column("varchar", { length: 50 })
  action!: EmailReplyAuditAction;

  @Column("varchar", { length: 20, default: "system" })
  actor!: EmailReplyAuditActor;

  @Column("text", { nullable: true })
  reason!: string | null;

  /** Sanitized metadata (truncated previews, source counts). No secrets. */
  @Column("text", { nullable: true })
  metadataJson!: string | null;
}
