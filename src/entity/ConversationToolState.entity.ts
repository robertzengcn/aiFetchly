import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Persists per-conversation deferred-tool-catalog discovery state so that
 * tools discovered via `tool_catalog_search` remain exposed across app
 * restart, conversation reload, and compaction (PRD FR-5, AC-8; design §19).
 *
 * One row per conversation (unique on conversationId).
 */
@Entity("conversation_tool_state")
@Index(["conversationId"], { unique: true })
export class ConversationToolStateEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  /** JSON string array of discovered tool names. */
  @Order(2)
  @Column("text", { nullable: false, default: "[]" })
  discoveredToolNamesJson: string;

  /** JSON string array of announced deferred tool names (for delta tracking). */
  @Order(3)
  @Column("text", { nullable: false, default: "[]" })
  announcedDeferredToolNamesJson: string;

  /** Optional hash of the catalog the state was written against. */
  @Order(4)
  @Column("varchar", { length: 128, nullable: true })
  catalogHash?: string;
}
