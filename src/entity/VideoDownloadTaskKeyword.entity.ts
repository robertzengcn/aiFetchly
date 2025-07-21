import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity"

@Entity('video_task_keywords')
export class VideoDownloadTaskKeywordEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  @Index()
  task_id: number;

  @Column({ type: 'text' })
  keyword: string;

//   @Column({ type: 'decimal', precision: 5, scale: 2, default: 1.0, nullable: true })
//   relevance_score: number;

//   @Column({ type: 'text', nullable: true })
//   source: string;

//   @Column({ type: 'boolean', default: true })
//   is_active: boolean;

//   @Column({ type: 'text', nullable: true })
//   category: string;
}