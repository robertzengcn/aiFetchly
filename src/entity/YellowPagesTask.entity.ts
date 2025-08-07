import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("yellow_pages_task")
export class YellowPagesTaskEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("text", { nullable: false })
    name: string;

    @Column("text", { nullable: false })
    platform: string;

    @Column("text", { nullable: false })
    keywords: string; // JSON string of keywords array

    @Column("text", { nullable: false })
    location: string;

    @Column("integer", { nullable: false, default: 1 })
    max_pages: number;

    @Column("integer", { nullable: false, default: 1 })
    concurrency: number;

    @Column("integer", { nullable: false, default: 0 })
    status: number; // 0: pending, 1: in-progress, 2: completed, 3: failed, 4: paused

    @Column("datetime", { nullable: true })
    scheduled_at?: Date;

    @Column("datetime", { nullable: true })
    completed_at?: Date;

    @Column("text", { nullable: true })
    error_log?: string;

    @Column("text", { nullable: true })
    run_log?: string;

    @Column("integer", { nullable: true })
    account_id?: number; // Reference to account for cookies

    @Column("text", { nullable: true })
    proxy_config?: string; // JSON string of proxy configuration

    @Column("integer", { nullable: false, default: 2000 })
    delay_between_requests: number; // milliseconds
} 