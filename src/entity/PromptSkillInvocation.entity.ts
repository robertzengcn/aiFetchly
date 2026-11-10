import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Durable invoked-skill state for one conversation (design §10.10, §14.1).
 *
 * The normalized instruction snapshot is REQUIRED for deterministic
 * compaction recovery: after full conversation compaction the assembler
 * reattaches the STORED block, so a linked skill that changed or vanished
 * mid-conversation cannot silently rewrite past context.
 *
 * Unique active identity: conversationId + agentId + runtimeId + contentHash
 * — repeated same-hash invocation is idempotent; a changed hash creates a
 * new context revision and deactivates the prior record.
 */
@Entity("prompt_skill_invocations")
@Index("idx_prompt_skill_inv_conv_agent", ["conversationId", "agentScope"])
@Index("idx_prompt_skill_inv_active", ["conversationId", "agentScope", "active"])
@Index(
  "uq_prompt_skill_inv_identity",
  ["conversationId", "agentScope", "runtimeId", "contentHash"],
  { unique: true }
)
export class PromptSkillInvocationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId!: string;

  /** "" for the main conversation; agent id for subagent scopes. */
  @Order(2)
  @Column("varchar", { length: 100, nullable: false, default: "" })
  agentScope!: string;

  @Order(3)
  @Column("varchar", { length: 300, nullable: false })
  runtimeId!: string;

  @Order(4)
  @Column("varchar", { length: 64, nullable: false })
  contentHash!: string;

  @Order(5)
  @Column("int", { nullable: false, default: 1 })
  contextRevision!: number;

  /** Verified normalized instruction snapshot (no credential values). */
  @Order(6)
  @Column("text", { nullable: false })
  normalizedInstructions!: string;

  @Order(7)
  @Column("int", { nullable: false, default: 0 })
  tokenEstimate!: number;

  /** Redacted invocation arguments (JSON string). */
  @Order(8)
  @Column("text", { nullable: false, default: "" })
  invocationArgumentsJson!: string;

  @Order(9)
  @Column("varchar", { length: 20, nullable: false })
  invocationSource!: "explicit" | "model" | "legacy-adapter";

  @Order(10)
  @Column("boolean", { nullable: false, default: true })
  active!: boolean;

  @Order(11)
  @Column("datetime", { nullable: false })
  invokedAt!: Date;
}
