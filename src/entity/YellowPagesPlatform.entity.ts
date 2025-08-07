import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("yellow_pages_platform")
export class YellowPagesPlatformEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("text", { nullable: false, unique: true })
    name: string;

    @Column("text", { nullable: false })
    display_name: string;

    @Column("text", { nullable: false })
    base_url: string;

    @Column("text", { nullable: false })
    country: string;

    @Column("text", { nullable: false })
    language: string;

    @Column("boolean", { nullable: false, default: true })
    is_active: boolean;

    @Column("text", { nullable: false, default: "1.0.0" })
    version: string;

    @Column("integer", { nullable: false, default: 100 })
    rate_limit: number; // requests per hour

    @Column("integer", { nullable: false, default: 2000 })
    delay_between_requests: number; // milliseconds

    @Column("integer", { nullable: false, default: 1 })
    max_concurrent_requests: number;

    @Column("text", { nullable: true })
    selectors?: string; // JSON string of platform selectors

    @Column("text", { nullable: true })
    custom_extractors?: string; // JSON string of custom extractors

    @Column("text", { nullable: false, default: "configuration" })
    type: string; // "configuration", "class", or "hybrid"

    @Column("text", { nullable: true })
    class_name?: string; // For class-based platforms

    @Column("text", { nullable: true })
    module_path?: string; // For class-based platforms

    @Column("text", { nullable: true })
    settings?: string; // JSON string of platform settings

    @Column("text", { nullable: true })
    metadata?: string; // JSON string of platform metadata

    @Column("text", { nullable: true })
    description?: string;

    @Column("text", { nullable: true })
    maintainer?: string;

    @Column("text", { nullable: true })
    documentation?: string;
} 