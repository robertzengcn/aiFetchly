import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity" // Adjust if your video entity has a different name

@Entity("video_caption")
export class VideoCaptionEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    video_id: number;

    @Column("integer",{ nullable: true,default:0 })
    language_id: number;

    @Column("text",{ nullable: true, default: "en" })
    language: string;

    @Column("text")
    caption_path: string;

    @Column("text")
    record_time: string;

    @ManyToOne(() => VideoDownloadEntity)
    @JoinColumn({ name: "video_id" })
    video: VideoDownloadEntity;

    // If you have a language entity, add a relationship to it:
    // @ManyToOne(() => LanguageEntity)
    // @JoinColumn({ name: "language_id" })
    // language: LanguageEntity;
}