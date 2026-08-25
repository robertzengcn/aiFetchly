import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * One installed skill package (design §14.1). Uniqueness is by source,
 * revision, subdirectory, scope, workspace, and activation mode — never a
 * bare display name, so same-named skills from different sources coexist.
 */
@Entity("skill_installations")
@Index("idx_skill_inst_status", ["status"])
@Index("idx_skill_inst_scope", ["scope", "workspaceId"])
@Index(
  "uq_skill_inst_identity",
  ["sourceUri", "sourceRevision", "sourceSubdirectory", "scope", "workspaceId", "activationMode"],
  { unique: true }
)
export class SkillInstallationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** UUID installation identity. */
  @Order(1)
  @Column("varchar", { length: 64, nullable: false, unique: true })
  installationId!: string;

  @Order(2)
  @Column("varchar", { length: 300, nullable: false })
  name!: string;

  /** prompt | executable | plugin | ambiguous */
  @Order(3)
  @Column("varchar", { length: 20, nullable: false })
  kind!: string;

  @Order(4)
  @Column("varchar", { length: 20, nullable: false, default: "user" })
  scope!: string;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  workspaceId!: number;

  @Order(6)
  @Column("varchar", { length: 1000, nullable: false })
  sourceUri!: string;

  @Order(7)
  @Column("varchar", { length: 128, nullable: false })
  sourceRevision!: string;

  @Order(8)
  @Column("varchar", { length: 500, nullable: false, default: "" })
  sourceSubdirectory!: string;

  /** managed-copy | symbolic-link | junction | legacy-installed */
  @Order(9)
  @Column("varchar", { length: 30, nullable: false })
  activationMode!: string;

  @Order(10)
  @Column("varchar", { length: 1000, nullable: false })
  activationPath!: string;

  @Order(11)
  @Column("varchar", { length: 64, nullable: false })
  contentHash!: string;

  /** requested | ready | disabled | quarantined | revoked | failed */
  @Order(12)
  @Column("varchar", { length: 30, nullable: false, default: "requested" })
  status!: string;

  @Order(13)
  @Column("boolean", { nullable: false, default: true })
  enabled!: boolean;

  /** Non-secret provenance/ownership metadata (JSON). */
  @Order(14)
  @Column("text", { nullable: false, default: "{}" })
  metadataJson!: string;
}
