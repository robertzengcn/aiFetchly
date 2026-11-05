import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailForwardDraftStatus } from "@/entityTypes/emailOrganizationTypes";

/**
 * Forward draft (technical design §6.1). Keeps the stable source message ID
 * and points at the current immutable revision. Drafting a forward never
 * mutates the source message's reply/processed state.
 */
@Entity("email_forward_draft")
@Index(["messageId"])
@Index(["emailServiceId", "status"])
export class EmailForwardDraftEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  /** Source received message being forwarded. */
  @Column("integer") messageId!: number;

  /** Account that owns the source message. */
  @Column("integer") emailServiceId!: number;

  @Column("varchar", { length: 20, default: "draft" })
  status!: EmailForwardDraftStatus;

  @Column("integer", { nullable: true }) currentRevisionId!: number | null;

  @Column("integer", { nullable: true }) conversationId!: number | null;

  /** Who created the draft: "ai" (tool) or "user" (manual UI). */
  @Column("varchar", { length: 20, default: "user" }) provenance!: string;

  /** T15: UI locale for generated header labels; reused on every edit. */
  @Column("varchar", { length: 10, default: "en" }) locale!: string;

  @Column("datetime", { nullable: true }) submittedAt!: Date | null;
}
