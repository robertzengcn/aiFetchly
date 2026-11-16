import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Immutable forward revision (technical design §6.1). Write-once: editing
 * appends a new revision and invalidates prior authorizations. References
 * encrypted artifacts by opaque ID only — never filesystem paths.
 */
@Entity("email_forward_revision")
@Index(["draftId", "revisionNumber"], { unique: true })
@Index(["composedHash"])
export class EmailForwardRevisionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  @Column("integer") draftId!: number;

  @Column("integer") revisionNumber!: number;

  /** Frozen source locator snapshot at materialization time. */
  @Column("text") sourceLocationSnapshotJson!: string;

  /** SHA-256 of the complete fetched source bytes (when available). */
  @Column("varchar", { length: 64, nullable: true }) sourceFullSourceHash!: string | null;

  // ---- Resolved sending identity (part of the approval envelope) ----
  @Column("varchar", { length: 255, nullable: true }) fromName!: string | null;
  @Column("varchar", { length: 320 }) fromAddress!: string;
  @Column("varchar", { length: 320, nullable: true }) replyToAddress!: string | null;
  @Column("varchar", { length: 255, nullable: true }) smtpUsername!: string | null;
  @Column("integer") sendingAccountId!: number;

  // ---- Normalized recipients (JSON string arrays) ----
  @Column("text") toRecipientsJson!: string;
  @Column("text", { nullable: true }) ccRecipientsJson!: string | null;
  /** Bcc lives in the envelope and private review only (PRD §9). */
  @Column("text", { nullable: true }) bccRecipientsJson!: string | null;
  /** Unique envelope recipient list across To/Cc/Bcc. */
  @Column("text") envelopeRecipientsJson!: string;

  @Column("varchar", { length: 998 }) subject!: string;

  @Column("text", { nullable: true }) note!: string | null;

  // ---- Encrypted artifact references (opaque IDs) ----
  @Column("varchar", { length: 64, nullable: true }) bodyTextArtifactId!: string | null;
  @Column("varchar", { length: 64, nullable: true }) bodyHtmlArtifactId!: string | null;
  @Column("varchar", { length: 64, nullable: true }) bodyTextHash!: string | null;
  @Column("varchar", { length: 64, nullable: true }) bodyHtmlHash!: string | null;

  /** Frozen attachment manifest (part IDs, hashes, sizes, selection). */
  @Column("text") attachmentsJson!: string;

  /** Generated outbound Message-ID (new identity, not reply headers). */
  @Column("varchar", { length: 998 }) composedMessageId!: string;

  /** Canonical envelope hash at freeze time — approval binds to this. */
  @Column("varchar", { length: 64 }) composedHash!: string;

  @Column("integer", { nullable: true }) composedByteCount!: number | null;

  @Column("text", { nullable: true }) validationFindingsJson!: string | null;

  /** Review/artifact expiry; expired revisions need fresh materialization. */
  @Column("datetime", { nullable: true }) expiresAt!: Date | null;
}
