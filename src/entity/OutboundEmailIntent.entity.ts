import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  OutboundEmailDeliveryMode,
  OutboundEmailIntentReasonCode,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * One resolved delivery-intent decision for a single user message
 * (technical design §7.1). Resolved and persisted once per user message by the
 * AI query engine from trusted user-authored text — never from tool arguments,
 * retrieved content, or assistant messages (AD-003).
 *
 * The unique `(conversationId, sourceUserMessageId)` index makes the decision
 * idempotent across stream retries / restarts: repeated processing loads the
 * existing row instead of re-deciding.
 */
@Entity("outbound_email_intent")
@Index(["conversationId", "sourceUserMessageId"], { unique: true })
@Index(["mode", "createdAt"])
export class OutboundEmailIntentEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 100 })
  conversationId: string;

  @Column("varchar", { length: 100 })
  sourceUserMessageId: string;

  @Column("varchar", { length: 30 })
  mode: OutboundEmailDeliveryMode;

  @Column("varchar", { length: 50 })
  reasonCode: OutboundEmailIntentReasonCode;

  @Column("real")
  confidence: number;

  /** Validated evidence array (JSON-serialized OutboundEmailIntentEvidence[]). */
  @Column("text")
  evidenceJson: string;

  /** SHA-256 of the canonical user-authored text the decision was derived from. */
  @Column("varchar", { length: 64 })
  sourceTextHash: string;

  /** Resolver/evaluation version for audit and re-checks. */
  @Column("varchar", { length: 50 })
  resolverVersion: string;

  /** Only set for a contextual affirmation linking to the prior assistant question. */
  @Column("varchar", { length: 100, nullable: true })
  previousAssistantMessageId: string | null;
}
