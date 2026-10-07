import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Durable delegation grant for a child-agent artifact (technical design §8.1).
 *
 * A parent agent may read a child's preserved output ONLY after the child
 * explicitly exported that artifact through its bounded terminal result and
 * recorded a grant here. Sibling agents receive no implicit access, and
 * authorization is never inferred merely because an output id appeared in a
 * prompt. Revoking the owner, or deleting the owner conversation, invalidates
 * the grant.
 */
@Entity("ai_tool_output_grants")
@Unique("uq_tool_output_grant", ["outputId", "granteeConversationId", "granteeAgentId"])
@Index(["outputId"])
export class AIToolOutputGrantEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Order(1)
    @Column("varchar", { length: 64, nullable: false })
    outputId!: string;

    @Order(2)
    @Column("varchar", { length: 100, nullable: false })
    granteeConversationId!: string;

    @Order(3)
    @Column("varchar", { length: 64, nullable: false })
    granteeEpoch!: string;

    @Order(4)
    @Column("varchar", { length: 100, nullable: true })
    granteeAgentId?: string;

    @Order(5)
    @Column("varchar", { length: 200, nullable: false })
    grantReason!: string;

    @Order(6)
    @Column("datetime", { nullable: true })
    revokedAt?: Date;
}
