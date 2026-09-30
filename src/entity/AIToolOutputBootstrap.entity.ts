import "reflect-metadata";
import { Entity, Column, PrimaryColumn, Index } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Versioned, resumable data-bootstrap marker for preserved tool outputs
 * (technical design §5.1, §13.2).
 *
 * The project initializes its schema with TypeORM `synchronize: true` and an
 * EMPTY migration list, so a migration file would never run. This marker is the
 * honest mechanism: it records which data-bootstrap steps have completed and
 * where a backfill stopped, so an interrupted backfill resumes instead of
 * restarting, and a future schema step can be made idempotent without
 * pretending an automatic migration system exists.
 *
 * One row per (profile, bootstrap key). The key is a stable step name, not a
 * version number, so re-running a completed step is a no-op.
 */
@Entity("ai_tool_output_bootstrap")
@Index(["profileId", "bootstrapKey"], { unique: true })
export class AIToolOutputBootstrapEntity extends AuditableEntity {
    @PrimaryColumn()
    id: number;

    @Order(1)
    @Column("varchar", { length: 100, nullable: false })
    profileId: string;

    /** Stable step name, e.g. "additive-entities-v1". */
    @Order(2)
    @Column("varchar", { length: 100, nullable: false })
    bootstrapKey: string;

    @Order(3)
    @Column("int", { nullable: false, default: 0 })
    schemaVersion: number;

    /**
     * Opaque resume position for a bounded, keyset-paged backfill.
     *
     * `null` means the step has not started. Encoded as an opaque cursor so a
     * future backfill can change its page shape without a schema change.
     */
    @Order(4)
    @Column("text", { nullable: true })
    lastPositionJson?: string;

    @Order(5)
    @Column("boolean", { nullable: false, default: false })
    completed: boolean;
}
