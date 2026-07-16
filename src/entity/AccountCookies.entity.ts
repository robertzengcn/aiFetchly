// filepath: /path/to/AccountCookies.ts
import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
@Entity("account_cookies")
export class AccountCookiesEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "integer" })
  @Index()
  account_id!: number;

  @Column({ type: "text" })
  cookies!: string;

  @Column({ type: "text" })
  partition_path!: string;

  @Column({ type: "text", nullable: true })
  record_time!: string;
}
