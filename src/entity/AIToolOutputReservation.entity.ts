import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Quota reservation for an in-flight capture (technical design §5.4).
 *
 * Unknown-length streams reserve in bounded increments and grow the
 * reservation ATOMICALLY BEFORE writing more, so a burst of concurrent
 * captures cannot collectively exceed the conversation/profile quota by
 * writing first and accounting afterwards. Unused reservation is released on
 * failure so a failed write never permanently consumes quota.
 */
@Entity("ai_tool_output_reservations")
@Index(["profileId", "conversationId", "outputEpoch"])
@Index(["executionId"])
export class AIToolOutputReservationEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Order(1)
    @Column("varchar", { length: 64, nullable: false })
    reservationId!: string;

    @Order(2)
    @Column("varchar", { length: 100, nullable: false })
    profileId!: string;

    @Order(3)
    @Column("varchar", { length: 100, nullable: false })
    conversationId!: string;

    @Order(4)
    @Column("varchar", { length: 64, nullable: false })
    outputEpoch!: string;

    @Order(5)
    @Column("varchar", { length: 100, nullable: false })
    executionId!: string;

    @Order(6)
    @Column("int", { nullable: false, default: 0 })
    reservedBytes!: number;

    @Order(7)
    @Column("int", { nullable: false, default: 0 })
    usedBytes!: number;

    @Order(8)
    @Column("datetime", { nullable: true })
    leaseExpiresAt?: Date;

    @Order(9)
    @Column("varchar", { length: 64, nullable: true })
    leaseFence?: string;

    @Order(10)
    @Column("varchar", { length: 32, nullable: false, default: "held" })
    reservationState!: string;
}
