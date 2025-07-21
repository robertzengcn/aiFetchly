import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";
import { EmailFilterDetailEntity } from "./EmailFilterDetail.entity";

@Entity('email_filter')
export class EmailFilterEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  // @Column({ type: 'text' })
  // content: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'integer', default: 1 })
  status: number;

  @OneToMany(() => EmailFilterDetailEntity, emailFilterDetail => emailFilterDetail.emailFilter)
  filterDetails: EmailFilterDetailEntity[];
} 