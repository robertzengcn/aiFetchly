import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Owner-voice profile for an email service. Makes generated replies sound like
 * the real mailbox owner rather than an AI assistant. One profile per service.
 *
 * `discloseAutomation` defaults to 0 (never reveal AI). The profile affects only
 * generated content; it must never bypass send confirmation or safety policy.
 */
@Entity("email_reply_identity_profile")
@Index(["emailServiceId"], { unique: true })
export class EmailReplyIdentityProfileEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  emailServiceId: number;

  @Column("varchar", { length: 255 })
  ownerName: string;

  @Column("varchar", { length: 255, nullable: true })
  ownerRole: string | null;

  @Column("varchar", { length: 255, nullable: true })
  companyName: string | null;

  @Column("varchar", { length: 100, nullable: true })
  preferredTone: string | null;

  @Column("text", { nullable: true })
  signature: string | null;

  @Column("text", { nullable: true })
  styleNotes: string | null;

  /** Serialized string[] of phrases the reply must never contain. */
  @Column("text", { nullable: true })
  forbiddenPhrasesJson: string | null;

  /** 0 = never disclose automation (default), 1 = disclose per configured policy. */
  @Column("integer", { default: 0 })
  discloseAutomation: number;
}
