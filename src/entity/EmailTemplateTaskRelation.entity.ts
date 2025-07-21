import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";
import { BuckemailTaskEntity } from "./BuckemailTask.entity";
import { EmailTemplateEntity } from "./EmailTemplate.entity";

@Entity('email_template_task_relation')
export class EmailTemplateTaskRelationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  emailTemplateId: number;

  @Column({ type: 'integer' })
  buckemailTaskId: number;

  @Column({ type: 'integer', default: 1 })
  status: number;

  @ManyToOne(() => EmailTemplateEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'emailTemplateId' })
  emailTemplate: EmailTemplateEntity;

  @ManyToOne(() => BuckemailTaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buckemailTaskId' })
  buckemailTask: BuckemailTaskEntity;
} 