import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * One installation workflow run (design §14.1): requested intent, current
 * state, the immutable plan (versioned JSON), redacted failure detail, and
 * the mutation lease. Only SkillInstallationModule changes state.
 */
@Entity("skill_installation_sessions")
@Index("idx_skill_inst_sess_conv", ["conversationId"])
@Index("idx_skill_inst_sess_state", ["state"])
@Index("uq_skill_inst_sess_id", ["sessionId"], { unique: true })
export class SkillInstallationSessionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Order(1)
  @Column("varchar", { length: 64, nullable: false })
  sessionId!: string;

  @Order(2)
  @Column("varchar", { length: 64, nullable: true })
  installationId?: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: false })
  conversationId!: string;

  @Order(4)
  @Column("varchar", { length: 30, nullable: false })
  state!: string;

  /** Optimistic concurrency: bumped on every transition (compare-and-set). */
  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  stateRevision!: number;

  @Order(6)
  @Column("varchar", { length: 64, nullable: false })
  planRevision!: string;

  @Order(7)
  @Column("text", { nullable: true })
  planJson?: string;

  /** Redacted error detail — never secrets or raw URLs. */
  @Order(8)
  @Column("text", { nullable: true })
  failureDetail?: string;

  @Order(9)
  @Column("varchar", { length: 64, nullable: true })
  failureCode?: string;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  retryCount!: number;

  @Order(11)
  @Column("boolean", { nullable: false, default: false })
  approved!: boolean;
}
