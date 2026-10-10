import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/** Append-only, ordered transition/approval/activation/rollback audit log. */
@Entity("skill_installation_events")
@Index("idx_skill_inst_evt_session", ["sessionId", "seq"])
export class SkillInstallationEventEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Order(1)
  @Column("varchar", { length: 64, nullable: false })
  sessionId!: string;

  /** Monotonic per-session sequence for deterministic ordering. */
  @Order(2)
  @Column("int", { nullable: false })
  seq!: number;

  @Order(3)
  @Column("varchar", { length: 60, nullable: false })
  eventType!: string;

  @Order(4)
  @Column("varchar", { length: 30, nullable: false })
  fromState?: string;

  @Order(5)
  @Column("varchar", { length: 30, nullable: false })
  toState?: string;

  /** Sanitized detail (no secrets, no authenticated URLs). */
  @Order(6)
  @Column("text", { nullable: true })
  detail?: string;
}
