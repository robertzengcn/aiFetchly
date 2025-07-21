import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";
import { BuckemailTaskEntity } from "./BuckemailTask.entity";
import { EmailServiceEntity } from "./EmailService.entity";

@Entity('email_service_task_relation')
export class EmailServiceTaskRelationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  emailServiceId: number;

  @Column({ type: 'integer' })
  buckemailTaskId: number;

  @Column({ type: 'integer', default: 1 })
  status: number;

  @ManyToOne(() => EmailServiceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'emailServiceId' })
  emailService: EmailServiceEntity;

  @ManyToOne(() => BuckemailTaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buckemailTaskId' })
  buckemailTask: BuckemailTaskEntity;
} 