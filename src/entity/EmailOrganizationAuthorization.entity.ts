import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailOrganizationOrigin } from "@/entityTypes/emailOrganizationTypes";

/**
 * Request-scoped action authorization (technical design §6.2/§8.1).
 * Issued only after the trusted main process resolved and froze a payload
 * satisfying an explicit user request or UI gesture. Consumed exactly once
 * at execution; payload/identity changes revoke it. Expiry default 15 min.
 */
@Entity("email_organization_authorization")
@Index(["operationId"])
@Index(["payloadHash"])
@Index(["expiresAt", "consumedAt"])
export class EmailOrganizationAuthorizationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  @Column("varchar", { length: 64, nullable: true }) operationId!: string | null;

  /** Forward draft/revision binding when origin authorizes a revision. */
  @Column("integer", { nullable: true }) draftId!: number | null;
  @Column("integer", { nullable: true }) revisionId!: number | null;

  /** Canonical hash of the exact frozen payload this authorization covers. */
  @Column("varchar", { length: 64 }) payloadHash!: string;

  @Column("varchar", { length: 30 }) origin!: EmailOrganizationOrigin;

  /** Persisted user turn / UI event that produced the authorization. */
  @Column("varchar", { length: 255, nullable: true }) userTurnId!: string | null;

  @Column("datetime") expiresAt!: Date;

  @Column("datetime", { nullable: true }) consumedAt!: Date | null;

  @Column("datetime", { nullable: true }) revokedAt!: Date | null;

  @Column("text", { nullable: true }) invalidReason!: string | null;
}
