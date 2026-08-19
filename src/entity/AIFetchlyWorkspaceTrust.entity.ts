import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Persisted per-capability trust flags for an approved workspace (TRS-02 /
 * tech-design §13.2).
 *
 * Replaces Phase 14's in-memory binary `approvalCache`: trust now survives DB
 * reloads (SC3), each of the 5 capabilities is gated independently, and a
 * missing/new row is all-false (fail-closed, T-17-02). The unique key is
 * {@link workspaceRootHash} — SHA-256 of the normalized root path (A1) — so
 * the trust key is stable across path moves and matches what the runtime
 * resolver looks up.
 *
 * Phase 17 writes all five flags as a block (D-TrustUX); granular per-flag
 * writes arrive later. The migration seed (AIFetchlyWorkspaceTrustModule.
 * ensureMigrationSeed) backfills every already-approved WorkspaceEntity to
 * all-true, idempotently (D-Migration).
 */
@Entity("aifetchly_workspace_trust")
@Index(["workspaceRootHash"], { unique: true })
export class AIFetchlyWorkspaceTrustEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** SHA-256 hex of {@link normalizeWorkspaceRoot}({@link workspaceRootPath}). */
  @Order(1)
  @Column("varchar", { length: 128, nullable: false, unique: true })
  workspaceRootHash!: string;

  /** Plaintext root path, also stored for UX surfacing (T-17-03 accept). */
  @Order(2)
  @Column("varchar", { length: 1024, nullable: false })
  workspaceRootPath!: string;

  /** Optional conversation that originated the trust grant (A2 nullable). */
  @Order(3)
  @Column("varchar", { length: 64, nullable: true })
  conversationId!: string | null;

  // ---- 5 per-capability flags (TRS-02 / tech-design §13.2) ---------------
  // Default false + nullable:false => a missing/new row reads all-false.
  @Order(4)
  @Column("boolean", { default: false, nullable: false })
  trustInstructions!: boolean;

  @Order(5)
  @Column("boolean", { default: false, nullable: false })
  trustCommands!: boolean;

  @Order(6)
  @Column("boolean", { default: false, nullable: false })
  trustAgents!: boolean;

  @Order(7)
  @Column("boolean", { default: false, nullable: false })
  trustHooks!: boolean;

  @Order(8)
  @Column("boolean", { default: false, nullable: false })
  trustSkills!: boolean;
}
