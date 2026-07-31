import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Auto-reply rule for an email service. Rules are stored in MVP even though
 * unattended auto-send is disabled; they drive the policy evaluator's dry-run
 * decisions and the audit UI's "approval_required / blocked / skipped" reasons.
 */
@Entity("email_auto_reply_rule")
@Index(["emailServiceId"])
export class EmailAutoReplyRuleEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  emailServiceId: number;

  @Column("varchar", { length: 255 })
  name: string;

  @Column("integer", { default: 0 })
  enabled: number;

  /** Serialized {@code EmailMessageClassification[]}. */
  @Column("text")
  allowedClassificationsJson: string;

  /** Serialized string[] of sender patterns to block. */
  @Column("text", { nullable: true })
  blockedSenderPatternsJson: string | null;

  /** Serialized string[] of domain patterns to block. */
  @Column("text", { nullable: true })
  blockedDomainPatternsJson: string | null;

  @Column("integer", { default: 10 })
  dailySendLimit: number;

  @Column("integer", { default: 1 })
  perThreadReplyLimit: number;

  @Column("real", { default: 0.7 })
  confidenceThreshold: number;

  /** Serialized quiet-hours window, e.g. {@code { start: "22:00", end: "07:00" }}. */
  @Column("text", { nullable: true })
  quietHoursJson: string | null;

  @Column("real", { default: 0.7 })
  requireApprovalBelowThreshold: number;
}
