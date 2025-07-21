import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";
import { EmailFilterEntity } from "./EmailFilter.entity";

@Entity('email_filter_detail')
export class EmailFilterDetailEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'integer' })
  filter_id: number;

  @ManyToOne(() => EmailFilterEntity, emailFilter => emailFilter.id)
  @JoinColumn({ name: 'filter_id' })
  emailFilter: EmailFilterEntity;
} 