import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity";

@Entity('email_service')
export class EmailServiceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  from: string;

  @Column({ type: 'varchar', length: 255 })
  password: string;

  @Column({ type: 'varchar', length: 255 })
  host: string;

  @Column({ type: 'varchar', length: 10 })
  port: string;

  @Column({ type: 'integer', default: 1 })
  ssl: number;

  @Column({ type: 'integer', default: 1 })
  status: number;
} 