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
@Index("idx_skill_inst_sess_canonical", ["canonicalUri"])
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

  /**
   * Opaque approval token (review D1): generated at prepare, delivered ONLY
   * through the renderer IPC channel (never in any model-visible tool
   * result), and required by approve() — a prompt-injected model cannot
   * self-approve an installation it planned.
   */
  @Order(12)
  @Column("varchar", { length: 64, nullable: true })
  approvalToken?: string;

  /**
   * Normalized source identity persisted AT CREATION (FR-02/NFR-01): an
   * acquiring session has no plan JSON yet, so idempotent resume and the
   * transactional active-session claim must not depend on planJson.
   */
  @Order(13)
  @Column("varchar", { length: 500, nullable: true })
  canonicalUri?: string;

  /**
   * Mutation lease (design §14.1): the owner token of the process currently
   * mutating this session, with an absolute expiry (epoch ms). An active
   * session whose lease has expired is stale — a fresh claim may take over
   * safely (the previous owner crashed mid-mutation).
   */
  @Order(14)
  @Column("varchar", { length: 64, nullable: true })
  leaseOwner?: string;

  @Order(15)
  @Column("bigint", { nullable: true })
  leaseExpiresAt?: string | null;

  /**
   * Normalized failure cause of the LAST failure (FR-20/§10.1): the
   * three-same-cause stop rule compares against this; a DIFFERENT cause
   * resets the retryCount streak.
   */
  @Order(16)
  @Column("varchar", { length: 64, nullable: true })
  lastFailureCause?: string;
}
