import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("buckemail_task")
export class BuckemailTaskEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  type: number;

  @Column({ type: "integer", nullable: true })
  emailtaskentityId: number;

  // Serialized JSON array of EmailItem for direct email sends.
  // Auto-created by TypeORM synchronize on app startup.
  @Column({ type: "text", nullable: true, default: null })
  email_list_json: string | null;

  @Column({ type: "integer", nullable: true })
  notduplicate: number;

  @Column({ type: "text", nullable: true })
  record_time: string;

  @Column({ type: "text", nullable: true })
  log_file: string;

  @Column({ type: "text", nullable: true })
  error_file: string;

  @Column({ type: "integer" })
  status: number;
}
