import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Browser site registry (PRD S-FR-01; technical design §15.1).
 *
 * Replaces the hardcoded platform lists as the source of truth for which
 * sites managed-browser sessions and saved-account sign-in may touch.
 * Seeded rows keep the existing platform IDs (social_accounts.social_type_id
 * already references them); AI/user-created rows start at 100000 so they can
 * never collide with remote `/api/socialplatform/list` IDs.
 */
@Entity("browser_sites")
@Index(["registrableDomain"], { unique: true })
export class BrowserSiteEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 200 })
  name!: string;

  @Column({ type: "varchar", length: 2048, nullable: true })
  homepageUrl!: string | null;

  /** eTLD+1 of the homepage; the credential/cookie release boundary. */
  @Column({ type: "varchar", length: 253 })
  registrableDomain!: string;

  /** JSON array of domain suffixes allowed for cookies/credentials. */
  @Column({ type: "text", nullable: true })
  allowedDomainSuffixes!: string | null;

  /** JSON array of suffixes a viable session must include. */
  @Column({ type: "text", nullable: true })
  requiredDomainSuffixes!: string | null;

  @Column({ type: "varchar", length: 2048, nullable: true })
  loginUrl!: string | null;

  @Column({ type: "varchar", length: 2048, nullable: true })
  verificationUrl!: string | null;

  /** JSON LoginRecipe (technical design §14.3), learned after sign-in. */
  @Column({ type: "text", nullable: true })
  loginRecipe!: string | null;

  @Column({ type: "boolean", default: false })
  browserProfileImportEnabled!: boolean;

  /** builtin | ai | user */
  @Column({ type: "varchar", length: 16, default: "user" })
  source!: string;

  /** unverified | verified */
  @Column({ type: "varchar", length: 16, default: "unverified" })
  status!: string;

  /** Audit: conversation that created the site (AI-created sites). */
  @Column({ type: "varchar", length: 64, nullable: true })
  createdInConversationId!: string | null;
}
