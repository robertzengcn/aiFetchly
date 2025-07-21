import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadTaskEntity } from "@/entity/VideoDownloadTask.entity"

@Entity("video_download_task_detail")
export class VideoDownloadTaskDetailEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    task_id: number;

    @Column("integer", { nullable: true })
    download_type: number | null;

    @Column("integer", { nullable: true })
    cookies_type: number | null;

    @Column("text", { nullable: true })
    browser_type: string | null;

    @Column("integer", { nullable: true })
    proxy_override: number | null;

    @Column("text", { nullable: true, default: "en" })
    video_language: string | null;

    @Column("integer", { nullable: true })
    video_quality: number | null;
    @Column("integer", { nullable: true })
    max_page_number: number | null;

    @OneToOne(() => VideoDownloadTaskEntity)
    @JoinColumn({ name: "task_id" })
    task: VideoDownloadTaskEntity;
}