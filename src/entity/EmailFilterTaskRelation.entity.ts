import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";
import { BuckemailTaskEntity } from "./BuckemailTask.entity";
import { EmailFilterEntity } from "./EmailFilter.entity";

@Entity('email_filter_task_relation')
export class EmailFilterTaskRelationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  emailFilterId: number;

  @Column({ type: 'integer' })
  buckemailTaskId: number;

  @Column({ type: 'integer', default: 1 })
  status: number;

  @ManyToOne(() => EmailFilterEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'emailFilterId' })
  emailFilter: EmailFilterEntity;

  @ManyToOne(() => BuckemailTaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buckemailTaskId' })
  buckemailTask: BuckemailTaskEntity;
} 