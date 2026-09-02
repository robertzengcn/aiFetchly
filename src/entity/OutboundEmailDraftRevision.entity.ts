import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * An append-only, immutable revision of a draft's frozen envelope content
 * (technical design §7.4). Edits never mutate a revision; they insert a new
 * one and advance the draft pointer. The unique (draftId, revisionNumber)
 * index enforces monotonic appends.
 */
@Entity("outbound_email_draft_revision")
@Index(["draftId", "revisionNumber"], { unique: true })
@Index(["contentHash"])
@Index(["emailServiceId"])
export class OutboundEmailDraftRevisionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("int")
  draftId: number;

  @Column("int")
  revisionNumber: number;

  /** `ai` or `user`. */
  @Column("varchar", { length: 20 })
  actor: string;

  /** Frozen sender service. */
  @Column("int")
  emailServiceId: number;

  /** Frozen envelope sender. */
  @Column("varchar", { length: 320 })
  senderAddress: string;

  /** Frozen envelope recipient. */
  @Column("varchar", { length: 320 })
  recipientAddress: string;

  /** Final rendered subject. */
  @Column("varchar", { length: 500 })
  subject: string;

  /** Final rendered text body. */
  @Column("text")
  bodyText: string;

  /** Final sanitized HTML body. */
  @Column("text", { nullable: true })
  bodyHtml: string | null;

  /** Canonical envelope hash (no timestamps/IDs). */
  @Column("varchar", { length: 64 })
  contentHash: string;

  /** Field-level personalization evidence (JSON). */
  @Column("text", { nullable: true })
  personalizationEvidenceJson: string | null;

  /** Knowledge source identifiers, not secrets (JSON). */
  @Column("text", { nullable: true })
  knowledgeSourcesJson: string | null;

  /** Model/prompt/version metadata (JSON). */
  @Column("text", { nullable: true })
  generationMetadataJson: string | null;

  /** Deterministic preflight results (JSON). */
  @Column("text", { nullable: true })
  validationFindingsJson: string | null;
}