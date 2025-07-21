import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadTaskEntity } from "@/entity/VideoDownloadTask.entity"

@Entity("video_download_task_accounts")
export class VideoDownloadTaskAccountsEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    task_id: number;

    @Column("integer")
    account_id: number;

    @ManyToOne(() => VideoDownloadTaskEntity)
    @JoinColumn({ name: "task_id" })
    task: VideoDownloadTaskEntity;

}