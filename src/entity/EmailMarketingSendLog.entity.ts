import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailmarketing_send_log")
export class EmailMarketingSendLogEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;
  @Column("integer")
  task_id: number;

  @Column("integer")
  status: number;

  @Column("text", { nullable: true })
  receiver: string;

  @Column("text", { nullable: true })
  title: string;

  @Column("text", { nullable: true })
  content: string;
  @Column("text", { nullable: true })
  log: string;

  @Column("text", { nullable: true })
  record_time: string;

  // ---- Identity metadata (FR-014): non-secret, identifies which email
  // service record sent this row and the identity it presented. All
  // nullable: legacy rows written before the identity split have none.
  /** email_service.id of the sender used for this row. */
  @Column("integer", { nullable: true })
  email_service_id: number | null;

  /** Visible From address the recipients saw. */
  @Column("text", { nullable: true })
  from_address: string | null;

  /** Effective SMTP login username (non-secret; FR-014). */
  @Column("text", { nullable: true })
  smtp_username: string | null;

  /** Reply-To address presented on this send (non-secret; FR-014). */
  @Column("text", { nullable: true })
  reply_to: string | null;
}
