import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { EmailReceiveProtocol } from "@/entityTypes/emailReceiveTypes";

@Entity("email_service")
export class EmailServiceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 255 })
  from: string;

  @Column({ type: "varchar", length: 255 })
  password: string;

  // ---- SMTP send configuration (existing, unchanged) ----
  @Column({ type: "varchar", length: 255 })
  host: string;

  @Column({ type: "varchar", length: 10 })
  port: string;

  @Column({ type: "integer", default: 1 })
  ssl: number;

  @Column({ type: "integer", default: 1 })
  status: number;

  // ---- Inbound receive configuration (new) ----
  /** Receive protocol. IMAP is preferred; POP3 is supported for providers without IMAP. */
  @Column({ type: "varchar", length: 10, default: "imap" })
  receiveProtocol: EmailReceiveProtocol;

  @Column({ type: "varchar", length: 255, nullable: true })
  imapHost: string | null;

  @Column({ type: "varchar", length: 10, nullable: true })
  imapPort: string | null;

  @Column({ type: "integer", default: 1 })
  imapSsl: number;

  @Column({ type: "varchar", length: 255, nullable: true })
  pop3Host: string | null;

  @Column({ type: "varchar", length: 10, nullable: true })
  pop3Port: string | null;

  @Column({ type: "integer", default: 1 })
  pop3Ssl: number;

  /** Receive username. Falls back to SMTP `from` when null (common for shared mailboxes). */
  @Column({ type: "varchar", length: 255, nullable: true })
  receiveUsername: string | null;

  /** Receive password. Stored separately from the SMTP password unless an explicit toggle reuses it. */
  @Column({ type: "varchar", length: 255, nullable: true })
  receivePassword: string | null;

  /** Folder to monitor. Defaults to INBOX. */
  @Column({ type: "varchar", length: 255, default: "INBOX" })
  receiveFolder: string;

  /** Whether this service is enabled for inbound receive. 0 = disabled, 1 = enabled. */
  @Column({ type: "integer", default: 0 })
  receiveEnabled: number;

  @Column({ type: "datetime", nullable: true })
  lastReceiveSyncAt: Date | null;

  @Column({ type: "text", nullable: true })
  lastReceiveSyncError: string | null;
}
