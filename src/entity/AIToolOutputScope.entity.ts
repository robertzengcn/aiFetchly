import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Per-conversation scope for preserved tool outputs (technical design §5.1).
 *
 * Holds the CURRENT OUTPUT EPOCH. The epoch is a durable generation marker
 * that is invalidated when a conversation is cleared or deleted; every late
 * commit and every read compares against it, so a writer that finishes after
 * the user cleared the conversation cannot publish and a deleted output can
 * never be retrieved again (AC-14).
 *
 * This row exists independently of the recoverable-history archive feature
 * flag: deleting a conversation must fence outputs even when archive support
 * is switched off entirely.
 */
@Entity("ai_tool_output_scopes")
@Index(["profileId", "conversationId"], { unique: true })
export class AIToolOutputScopeEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Order(1)
    @Column("varchar", { length: 100, nullable: false })
    profileId!: string;

    @Order(2)
    @Column("varchar", { length: 100, nullable: false })
    conversationId!: string;

    /**
     * Durable generation marker. Cleared/deleted conversations get a NEW
     * epoch, so recreating a conversation id can never resurrect artifacts
     * from the previous incarnation.
     */
    @Order(3)
    @Column("varchar", { length: 64, nullable: false })
    outputEpoch!: string;

    /** Set when the conversation is cleared/deleted; blocks all late commits. */
    @Order(4)
    @Column("boolean", { nullable: false, default: false })
    invalidated!: boolean;
}
