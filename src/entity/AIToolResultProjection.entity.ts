import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Bounded derived projection over a LEGACY tool-result source row
 * (technical design §10.2).
 *
 * Existing message `content` / `metadata` rows are ORIGINAL EVIDENCE and are
 * never rewritten to make them smaller. Instead, a legacy oversized result is
 * preserved into an artifact and this row records the bounded receipt that
 * replaces it at read time.
 *
 * UNIQUE on (source row identity + policy version) so a rebuilt projection for
 * the same policy is idempotent, while a policy change produces a new
 * projection instead of silently reusing a stale one.
 */
@Entity("ai_tool_result_projections")
@Unique("uq_tool_result_projection", [
    "profileId",
    "sourceRowKey",
    "outputEpoch",
    "policyVersion",
])
@Index(["profileId", "conversationId", "outputEpoch"])
export class AIToolResultProjectionEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Order(1)
    @Column("varchar", { length: 100, nullable: false })
    profileId!: string;

    /** Identity of the legacy source row this projection was derived from. */
    @Order(2)
    @Column("varchar", { length: 100, nullable: false })
    sourceRowKey!: string;

    @Order(3)
    @Column("varchar", { length: 100, nullable: false })
    conversationId!: string;

    @Order(4)
    @Column("varchar", { length: 64, nullable: false })
    outputEpoch!: string;

    @Order(5)
    @Column("varchar", { length: 64, nullable: false })
    policyVersion!: string;

    @Order(6)
    @Column("varchar", { length: 64, nullable: true })
    sourceRevision?: string;

    @Order(7)
    @Column("varchar", { length: 64, nullable: true })
    sourceHash?: string;

    /** Bounded receipt shown instead of the original bulk row. */
    @Order(8)
    @Column("text", { nullable: false })
    content!: string;

    @Order(9)
    @Column("text", { nullable: false, default: "{}" })
    metadataJson!: string;

    /** Output references this projection points at. */
    @Order(10)
    @Column("text", { nullable: false, default: "[]" })
    outputRefsJson!: string;
}
