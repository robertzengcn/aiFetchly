import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadTaskEntity } from "@/entity/VideoDownloadTask.entity"

@Entity("video_download")
export class VideoDownloadEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("text", { nullable: true })
    url: string | null;

    @Column("text", { nullable: true })
    savepath: string | null;

    @Column("text", { nullable: true })
    record_time: string | null;

    @Column("integer")
    task_id: number;

    @Column("integer", { nullable: true })
    caption_status: number;

    @Column("text", { nullable: true })
    error_log: string | null;

    @Column("integer")
    status: number;
    @Column("text", { nullable: true, default: "en" })
    language: string;

    @ManyToOne(() => VideoDownloadTaskEntity)
    @JoinColumn({ name: "task_id" })
    task: VideoDownloadTaskEntity;
}