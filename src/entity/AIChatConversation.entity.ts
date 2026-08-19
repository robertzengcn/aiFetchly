import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Durable sidebar/conversation metadata projection for the AI Chat Workspace
 * redesign (technical-design §8.1).
 *
 * Message rows are not an efficient source for sidebar rendering. This table
 * holds one row per conversation with bounded, navigation-safe fields. The
 * projection is updated in the same main-process transaction as message
 * persistence where practical; an idempotent backfill repairs legacy rows.
 */
@Entity("ai_chat_conversations")
@Index("idx_aichatconv_workspace_last", ["workspaceKey", "lastMessageAt"])
@Index("idx_aichatconv_last_message", ["lastMessageAt"])
export class AIChatConversationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Stable conversation id (same value as ai_chat_messages.conversationId). */
  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  /** Stable workspace grouping key (WorkspaceKeyService). Null = unassigned. */
  @Order(2)
  @Column("varchar", { length: 255, nullable: true })
  workspaceKey: string | null;

  /** Explicit user rename or persisted generated title. Null = derive. */
  @Order(3)
  @Column("varchar", { length: 200, nullable: true })
  title: string | null;

  /** True when `title` came from an explicit user rename (never overwrite). */
  @Order(4)
  @Column("boolean", { nullable: false, default: false })
  titleIsUserSet: boolean;

  /** Short normalized excerpt for navigation. No tool bodies or secrets. */
  @Order(5)
  @Column("varchar", { length: 300, nullable: false, default: "" })
  preview: string;

  @Order(6)
  @Column("int", { nullable: false, default: 0 })
  messageCount: number;

  @Order(7)
  @Column("datetime", { nullable: true })
  lastMessageAt: Date | null;

  /** Timestamp of the newest persisted assistant result (drives unread). */
  @Order(8)
  @Column("datetime", { nullable: true })
  lastResultAt: Date | null;

  /** Monotonic read marker advanced only after the newest page is displayed. */
  @Order(9)
  @Column("datetime", { nullable: true })
  lastReadAt: Date | null;

  @Order(10)
  @Column("datetime", { nullable: true })
  archivedAt: Date | null;

}
