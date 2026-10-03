import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Design §14.1 / audit R9: persistent dependency binding — WHAT was
 * detected, at which resolved path/version, for which installation. It
 * never claims ownership of shared system packages (the binary stays where
 * the platform put it); the row is the skill-management view of the last
 * verification (PRD §22.3: "Dependencies and detected versions", "Last
 * verification").
 */
@Entity("skill_dependency_bindings")
@Index(
  "uq_skill_dep_binding",
  ["installationId", "dependencyName"],
  { unique: true }
)
@Index("idx_skill_dep_binding_installation", ["installationId"])
export class SkillDependencyBindingEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** The installation this binding was recorded for. */
  @Order(1)
  @Column("varchar", { length: 64, nullable: false })
  installationId!: string;

  /** Plan item name (e.g. "ffmpeg", "python-environment"). */
  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  dependencyName!: string;

  /** DependencyKind at detection time (system-binary, mcp-server, …). */
  @Order(3)
  @Column("varchar", { length: 40, nullable: false })
  kind!: string;

  /** satisfied | missing | incompatible | unknown at last verification. */
  @Order(4)
  @Column("varchar", { length: 20, nullable: false, default: "unknown" })
  status!: string;

  /** The version the probe detected (e.g. "4.4.2"), when parseable. */
  @Order(5)
  @Column("varchar", { length: 40, nullable: true })
  detectedVersion?: string;

  /** Version constraint the plan declared, when one was named. */
  @Order(6)
  @Column("varchar", { length: 40, nullable: true })
  requiredVersion?: string;

  /**
   * The resolved executable path (`which`/`where`) — typed skill
   * configuration, never stored in the repository (PRD §18.3).
   */
  @Order(7)
  @Column("varchar", { length: 500, nullable: true })
  resolvedPath?: string;

  /** How the dependency was provided (catalog manager / managed env). */
  @Order(8)
  @Column("varchar", { length: 200, nullable: true })
  provider?: string;

  /** Redacted probe evidence from the last verification run. */
  @Order(9)
  @Column("text", { nullable: true })
  probeEvidence?: string;

  /** When the probes last ran (last verification time). */
  @Order(10)
  @Column("datetime", { nullable: true })
  verifiedAt?: Date;
}
