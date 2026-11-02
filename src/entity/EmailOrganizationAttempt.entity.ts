import { Entity, Index, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { EmailOrganizationAttemptPhase } from "@/entityTypes/emailOrganizationTypes";

/**
 * One dispatch attempt of an operation item (technical design §6.2).
 * The attempt is persisted BEFORE network I/O (claim phase); only the
 * winner of the conditional claim proceeds. Expired leases feed
 * reconciliation, never automatic replay.
 */
@Entity("email_organization_attempt")
@Index(["phase", "leaseExpiresAt"])
export class EmailOrganizationAttemptEntity extends AuditableEntity {
  @PrimaryGeneratedColumn() id!: number;

  @Column("integer") itemId!: number;

  @Column("varchar", { length: 64 }) operationId!: string;

  @Column("integer") attemptNumber!: number;

  /** SHA-256 of the one-time claim token; the raw token never persists. */
  @Column("varchar", { length: 64 }) claimTokenHash!: string;

  @Column("varchar", { length: 20, default: "claimed" })
  phase!: EmailOrganizationAttemptPhase;

  @Column("datetime") leaseExpiresAt!: Date;

  /** Provider-assigned Message-ID returned by SMTP when available. */
  @Column("varchar", { length: 998, nullable: true }) providerMessageId!: string | null;

  /** Sanitized protocol result evidence (JSON), no bodies or credentials. */
  @Column("text", { nullable: true }) resultJson!: string | null;

  @Column("datetime", { nullable: true }) resolvedAt!: Date | null;
}
