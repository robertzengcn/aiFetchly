import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type {
  AIChatPendingMessageStatus,
  AIChatSafeBoundary,
} from "@/entityTypes/aiChatV2Types";

/**
 * Durable pending message for the AI Chat V2 per-conversation queue
 * (message-queue technical design §7.1).
 *
 * A row records user intent submitted while a turn was active (or racing an
 * idle dispatch): the display text saved later on the normal user row
 * (`content`), the already-resolved model-facing text (`modelContent`), the
 * lifecycle status, ordering, idempotency, and steering linkage. Rows stay
 * OUT of `ai_chat_messages` until they are dispatched or applied as steering,
 * so `AIChatContextAssembler` never sees undelivered intent (FR-39).
 *
 * `id` (the autoincrement primary key) is the monotonic FIFO sequence inside
 * one user database — no MAX(sequence)+1 query is used (that races).
 */
@Entity("ai_chat_pending_messages")
@Index(["pendingMessageId"], { unique: true })
@Index(["clientRequestId"], { unique: true })
@Index(["conversationId", "status", "id"])
@Index(["status", "updatedAt"])
@Index(["targetAssistantMessageId"])
export class AIChatPendingMessageEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Stable public identifier (never expose the numeric PK). */
  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  pendingMessageId!: string;

  /** Renderer-generated idempotency key; unique per durable intent. */
  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  clientRequestId!: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: false })
  conversationId!: string;

  /**
   * Deterministic future ai_chat_messages.messageId for the delivered user
   * row: `user-pending-<pendingMessageId>`. Allocating it at enqueue lets
   * queued attachment BLOBs live under the same messageId the delivered row
   * will use, so dispatch never moves bytes (design §7.6).
   */
  @Order(4)
  @Column("varchar", { length: 100, nullable: false })
  userMessageId!: string;

  /** Renderer-facing display text (attachment-enriched, no model context). */
  @Order(5)
  @Column("text", { nullable: false })
  content!: string;

  /** Model-facing text (mentions/pastes resolved at send time). */
  @Order(6)
  @Column("text", { nullable: false })
  modelContent!: string;

  @Order(7)
  @Column("varchar", { length: 20, nullable: false })
  status!: AIChatPendingMessageStatus;

  /** JSON: bounded ChatV2 turn options needed to reproduce the request. */
  @Order(8)
  @Column("text", { nullable: true })
  requestOptionsJson?: string;

  /** JSON: ChatV2AttachmentMetadata[] for the pending bubble. */
  @Order(9)
  @Column("text", { nullable: true })
  attachmentMetadataJson?: string;

  /** JSON: ChatV2MessageMetadata saved on the delivered user row. */
  @Order(10)
  @Column("text", { nullable: true })
  messageMetadataJson?: string;

  /** Claim token guarding exactly-once terminal updates. */
  @Order(11)
  @Column("varchar", { length: 100, nullable: true })
  claimToken?: string;

  /** Assistant message id of the turn this row was steered into. */
  @Order(12)
  @Column("varchar", { length: 100, nullable: true })
  targetAssistantMessageId?: string;

  @Order(13)
  @Column("varchar", { length: 30, nullable: true })
  steeringBoundary?: AIChatSafeBoundary;

  /** ai_chat_messages.messageId of the delivered user row. */
  @Order(14)
  @Column("varchar", { length: 100, nullable: true })
  sentMessageId?: string;

  @Order(15)
  @Column("varchar", { length: 80, nullable: true })
  failureCode?: string;

  @Order(16)
  @Column("text", { nullable: true })
  failureMessage?: string;

  @Order(17)
  @Column("varchar", { length: 80, nullable: true })
  recoveryReason?: string;

  @Order(18)
  @Column("int", { default: 0, nullable: false })
  attemptCount!: number;

  @Order(19)
  @Column("datetime", { nullable: true })
  claimedAt?: Date;

  @Order(20)
  @Column("datetime", { nullable: true })
  terminalAt?: Date;
}
