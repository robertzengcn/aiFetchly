import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadTaskEntity } from "@/entity/VideoDownloadTask.entity"

@Entity("video_download_task_urls")
export class VideoDownloadTaskUrlsEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    task_id: number;

    @Column("text", { nullable: true })
    url: string | null;

    @ManyToOne(() => VideoDownloadTaskEntity)
    @JoinColumn({ name: "task_id" })
    task: VideoDownloadTaskEntity;
}