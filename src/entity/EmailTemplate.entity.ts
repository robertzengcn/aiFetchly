import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";

@Entity('email_template')
export class EmailTemplateEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'integer', default: 1 })
  status: number;
} 