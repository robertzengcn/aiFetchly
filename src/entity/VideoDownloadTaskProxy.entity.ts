import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadTaskEntity } from "./VideoDownloadTask.entity"


@Entity("video_download_task_proxy")
export class VideoDownloadTaskProxyEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    task_id: number;

    @Column("integer")
    proxy_id: number;

    @ManyToOne(() => VideoDownloadTaskEntity)
    @JoinColumn({ name: "task_id" })
    task: VideoDownloadTaskEntity;
}