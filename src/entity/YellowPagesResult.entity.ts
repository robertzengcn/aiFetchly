import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("yellow_pages_result")
export class YellowPagesResultEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer", { nullable: false })
    task_id: number;

    @Column("text", { nullable: false })
    business_name: string;

    @Column("text", { nullable: true })
    email?: string;

    @Column("text", { nullable: true })
    phone?: string;

    @Column("text", { nullable: true })
    website?: string;

    @Column("text", { nullable: true })
    address_street?: string;

    @Column("text", { nullable: true })
    address_city?: string;

    @Column("text", { nullable: true })
    address_state?: string;

    @Column("text", { nullable: true })
    address_zip?: string;

    @Column("text", { nullable: true })
    address_country?: string;

    @Column("text", { nullable: true })
    social_media?: string; // JSON string of social media links array

    @Column("text", { nullable: true })
    categories?: string; // JSON string of categories array

    @Column("text", { nullable: true })
    business_hours?: string; // JSON string of business hours object

    @Column("text", { nullable: true })
    description?: string;

    @Column("decimal", { precision: 3, scale: 2, nullable: true })
    rating?: number;

    @Column("integer", { nullable: true })
    review_count?: number;

    @Column("datetime", { nullable: false })
    scraped_at: Date;

    @Column("text", { nullable: false })
    platform: string;

    @Column("text", { nullable: true })
    raw_data?: string; // JSON string of raw scraped data

    @Column("text", { nullable: true })
    fax_number?: string;

    @Column("text", { nullable: true })
    contact_person?: string;

    @Column("integer", { nullable: true })
    year_established?: number;

    @Column("text", { nullable: true })
    number_of_employees?: string;

    @Column("text", { nullable: true })
    payment_methods?: string; // JSON string of payment methods array

    @Column("text", { nullable: true })
    specialties?: string; // JSON string of specialties array
} 