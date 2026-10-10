import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Durable cumulative retrieval-work allowance for one assistant turn
 * (technical design §8.5).
 *
 * PERSISTED rather than in-memory so a permission pause, a crash, or a resume
 * cannot reset the allowance and hand the model a fresh budget. `version`
 * supports the conditional update that reserves a call BEFORE concurrent
 * retrieval work starts and settles the actual returned tokens afterwards.
 *
 * A new explicit user or scheduled turn receives a new row (hence a new
 * allowance); the model must not get one merely by ending a turn.
 */
@Entity("ai_tool_output_retrieval_budgets")
@Unique("uq_tool_output_budget", [
    "profileId",
    "conversationId",
    "outputEpoch",
    "agentId",
    "turnId",
])
@Index(["profileId", "conversationId", "turnId"])
export class AIToolOutputRetrievalBudgetEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Order(1)
    @Column("varchar", { length: 100, nullable: false })
    profileId!: string;

    @Order(2)
    @Column("varchar", { length: 100, nullable: false })
    conversationId!: string;

    @Order(3)
    @Column("varchar", { length: 64, nullable: false })
    outputEpoch!: string;

    @Order(4)
    @Column("varchar", { length: 100, nullable: false, default: "" })
    agentId!: string;

    @Order(5)
    @Column("varchar", { length: 100, nullable: false })
    turnId!: string;

    @Order(6)
    @Column("int", { nullable: false, default: 0 })
    reservedCalls!: number;

    @Order(7)
    @Column("int", { nullable: false, default: 0 })
    settledCalls!: number;

    @Order(8)
    @Column("int", { nullable: false, default: 0 })
    settledTokens!: number;

    @Order(9)
    @Column("int", { nullable: false, default: 0 })
    version!: number;
}
