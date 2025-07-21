import { Entity, Column, PrimaryGeneratedColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"

@Entity("video_download_task")
export class VideoDownloadTaskEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("text", { nullable: true })
    task_name: string | null;

    @Column("text", { nullable: true })
    platform: string | null;

    @Column("text", { nullable: true })
    savepath: string | null;
    // @Column("text", { nullable: true })
    // downloadtype: string | null;

    @Column("text", { nullable: true })
    record_time: string | null;

    @Column("text", { nullable: true })
    runtime_log: string | null;

    @Column("text", { nullable: true })
    error_log: string | null;

    @Column("integer", { nullable: true })
    status: number | null;
}