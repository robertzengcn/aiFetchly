import { Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity"
import {PublishPlatform,PublishStatus} from "@/entityTypes/videoPublishType"



@Entity("video_publish_record")
export class VideoPublishRecordEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    video_download_id: number;

    @Column({
        type: "varchar",
        default: PublishPlatform.YOUTUBE
    })
    platform: PublishPlatform;

    @Column({
        type: "varchar",
        default: PublishStatus.PENDING
    })
    status: PublishStatus;

    @Column("text", { nullable: true })
    platform_video_id: string | null;

    @Column("text", { nullable: true })
    platform_video_url: string | null;

    @Column("text", { nullable: true })
    error_message: string | null;

    @Column("text", { nullable: true })
    platform_metadata: string | null;

    @ManyToOne(() => VideoDownloadEntity)
    @JoinColumn({ name: "video_download_id" })
    video_download: VideoDownloadEntity;
} 