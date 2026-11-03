import { Entity, Index, Column, PrimaryColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Frozen bulk-action target set (technical design §6.2/§11, PRD FR-18).
 * Approval refers to exact message IDs and location VERSIONS: later
 * arrivals are excluded, and moved/changed targets are revalidated
 * per-item at execution time. Expiry (15 min default) forces a fresh
 * selection after that.
 */
@Entity("email_organization_selection")
@Index(["emailServiceId", "createdAt"])
export class EmailOrganizationSelectionEntity extends AuditableEntity {
  /** Opaque main-process-generated selection id. */
  @PrimaryColumn("varchar", { length: 64 }) selectionId!: string;

  @Column("integer") emailServiceId!: number;

  /** Intended action the selection was frozen for. */
  @Column("varchar", { length: 20 }) kind!: "trash" | "restore";

  /** Exact application message ids, ascending. */
  @Column("text") messageIdsJson!: string;

  /** Frozen per-message location versions at freeze time. */
  @Column("text") locationVersionsJson!: string;

  /** Restore destinations per message (recorded original folders); trash uses the resolved Trash folder. */
  @Column("text", { nullable: true }) destinationsJson!: string | null;

  /** Canonical hash of the frozen set (ids + versions + destinations). */
  @Column("varchar", { length: 64 }) payloadHash!: string;

  /** Filter/coverage summary of the search that produced the set. */
  @Column("text", { nullable: true }) filtersSummaryJson!: string | null;

  /** Persisted user turn / UI event that authorized the freeze. */
  @Column("varchar", { length: 255, nullable: true }) ownerContext!: string | null;

  @Column("datetime") expiresAt!: Date;
}
