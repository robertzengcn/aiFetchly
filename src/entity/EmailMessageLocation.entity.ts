import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailMessageLocationState, EmailOrganizationProtocol } from "@/entityTypes/emailOrganizationTypes";

/**
 * Folder-aware provider location of a received message (technical design §5.2).
 *
 * `EmailReceivedMessageEntity.id` stays the stable application message ID;
 * this table answers "where exactly is this message on the server" and gates
 * remote mutation eligibility through `state`. One active location per
 * message in this release (unique messageId).
 *
 * - `uidValidity` is a decimal string to avoid bigint JSON serialization.
 * - `folderPath` is nullable for POP3 / unverified legacy rows.
 * - A verified move updates the existing row (folderPath + version++), it
 *   never creates a second logical message.
 */
@Entity("email_message_location")
@Index(["messageId"], { unique: true })
@Index(["emailServiceId", "folderPath", "uidValidity", "providerUid"], {
  unique: true,
})
@Index(["emailServiceId", "providerUid"])
@Index(["emailServiceId", "state"])
export class EmailMessageLocationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  /** Stable application message ID (FK target is email_received_message.id). */
  @Column("integer") messageId!: number;

  /** Explicit account boundary. */
  @Column("integer") emailServiceId!: number;

  /** Interpretation of the provider identity. */
  @Column("varchar", { length: 10, default: "imap" })
  protocol!: EmailOrganizationProtocol;

  /** Exact provider path; nullable for POP3 / unverified legacy rows. */
  @Column("varchar", { length: 255, nullable: true }) folderPath!: string | null;

  /** Decimal UIDVALIDITY string; null only when unverified / non-IMAP. */
  @Column("varchar", { length: 64, nullable: true }) uidValidity!: string | null;

  /** IMAP UID or POP3 UIDL, as observed by the receive client. */
  @Column("varchar", { length: 255 }) providerUid!: string;

  /** Mutation eligibility state. */
  @Column("varchar", { length: 20, default: "legacy_unverified" })
  state!: EmailMessageLocationState;

  /** Incremented on every location update; stale selections are rejected. */
  @Column("integer", { default: 1 }) version!: number;

  /** Freshness evidence for `verified` rows. */
  @Column("datetime", { nullable: true }) lastVerifiedAt!: Date | null;

  /** Causal link to the organization operation that last moved this row. */
  @Column("varchar", { length: 64, nullable: true }) lastOperationId!: string | null;
}
