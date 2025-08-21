import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("session_recording")
export class SessionRecordingEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer", { nullable: false })
    task_id: number;

    @Column("text", { nullable: false })
    platform: string;

    @Column("text", { nullable: false })
    keywords: string; // JSON string of keywords array

    @Column("text", { nullable: false })
    location: string;

    @Column("integer", { nullable: false, default: 0 })
    results_count: number;

    @Column("text", { nullable: false })
    session_file_path: string;

    @Column("text", { nullable: false, default: 'completed' })
    status: 'pending' | 'completed' | 'failed';

    @Column("integer", { nullable: false, default: 0 })
    training_data_points: number;

    @Column("integer", { nullable: false, default: 0 })
    file_size: number; // File size in bytes

    @Column("datetime", { nullable: true })
    completed_at?: Date;

    @Column("text", { nullable: true })
    error_log?: string;

    @Column("text", { nullable: true })
    notes?: string; // User annotations about session quality
}
