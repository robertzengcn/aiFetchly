import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { VideoDownloadEntity } from "@/entity/VideoDownload.entity" // Adjust if your video entity has a different name

@Entity("video_description")
export class VideoDescriptionEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    video_id: number;

    @Column("integer", { nullable: true })
    language_id: number;//will be remove in the future

    @Column("text",{ nullable: true , default: "en"})
    language: string;

    @Column("text")
    title: string;

    @Column("text")
    description: string;

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