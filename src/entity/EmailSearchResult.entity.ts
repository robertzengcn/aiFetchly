import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailsearch_result")
export class EmailSearchResultEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;
  @Column("integer")
  task_id: number;

  @Column("text", { nullable: true })
  email: string;

  @Column("text", { nullable: true })
  name: string;

  @Column("text", { nullable: true })
  domain: string;

  @Column("text", { nullable: true })
  url: string;

  @Column("text", { nullable: true })
  title: string;

  @Column("text", { nullable: true })
  record_time: string;

  @Column("text", { nullable: true })
  phone: string;

  @Column("text", { nullable: true })
  address: string;

  @Column("text", { nullable: true })
  socialLinks: string;

  @Column("text", { nullable: true, default: "none" })
  aiEnrichmentStatus: string;

  @Column("text", { nullable: true })
  aiEnrichmentError: string;

  @Column("real", { nullable: true, default: 0 })
  aiConfidence: number;
}
