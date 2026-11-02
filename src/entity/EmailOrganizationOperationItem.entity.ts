import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailOrganizationItemStatus } from "@/entityTypes/emailOrganizationTypes";

/**
 * Per-message item of an organization operation (technical design §6.2).
 * Stores the before-locator snapshot (frozen at claim time) plus the
 * intended destination, so reconciliation can verify what actually happened.
 * Unique (operationId, messageId) prevents duplicated items.
 */
@Entity("email_organization_operation_item")
@Index(["operationId", "status"])
@Index(["messageId"])
export class EmailOrganizationOperationItemEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  @Column("varchar", { length: 64 }) operationId!: string;

  @Column("integer") messageId!: number;

  /** Frozen before-locator (version guards against concurrent moves). */
  @Column("integer", { nullable: true }) beforeLocationVersion!: number | null;
  @Column("varchar", { length: 255, nullable: true }) beforeFolderPath!: string | null;
  @Column("varchar", { length: 64, nullable: true }) beforeUidValidity!: string | null;
  @Column("varchar", { length: 255, nullable: true }) beforeProviderUid!: string | null;

  /** Intended destination folder (Trash for trash; original for restore). */
  @Column("varchar", { length: 255, nullable: true }) destinationFolderPath!: string | null;

  @Column("varchar", { length: 30, default: "pending" })
  status!: EmailOrganizationItemStatus;

  /** Per-recipient outcomes for forward submissions (JSON arrays). */
  @Column("text", { nullable: true }) acceptedRecipientsJson!: string | null;
  @Column("text", { nullable: true }) rejectedRecipientsJson!: string | null;
  @Column("text", { nullable: true }) unknownRecipientsJson!: string | null;

  @Column("varchar", { length: 50, nullable: true }) errorCode!: string | null;
  /** Sanitized only: never raw SMTP/IMAP dumps, credentials or bodies. */
  @Column("text", { nullable: true }) sanitizedError!: string | null;

  @Column("datetime", { nullable: true }) claimedAt!: Date | null;
  @Column("datetime", { nullable: true }) completedAt!: Date | null;
}
