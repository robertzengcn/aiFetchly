import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Append-only audit trail for organization operations (technical design §6.2).
 * Never stores bodies, MIME payloads, credentials or full recipient lists —
 * identifiers and reason codes only.
 */
@Entity("email_organization_audit")
@Index(["operationId", "createdAt"])
@Index(["messageId"])
export class EmailOrganizationAuditEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  @Column("varchar", { length: 64, nullable: true }) operationId!: string | null;

  @Column("integer", { nullable: true }) itemId!: number | null;

  /** Message the event concerned, when applicable. */
  @Column("integer", { nullable: true }) messageId!: number | null;

  @Column("integer", { nullable: true }) emailServiceId!: number | null;

  @Column("varchar", { length: 20, default: "system" }) actor!: string;

  @Column("varchar", { length: 50 }) action!: string;

  @Column("varchar", { length: 30, nullable: true }) status!: string | null;

  @Column("varchar", { length: 50, nullable: true }) reasonCode!: string | null;

  /** Sanitized structured metadata (correlation IDs, counts). */
  @Column("text", { nullable: true }) detailJson!: string | null;
}
