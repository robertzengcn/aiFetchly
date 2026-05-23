import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("installed_skills")
export class InstalledSkillEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column("text")
  name: string;

  @Column("text")
  version: string;

  @Column("text")
  source: string;

  @Column("text")
  manifest_json: string;

  @Column("text", { default: "[]" })
  permissions_json: string;

  @Column("integer", { default: 1 })
  enabled: number;
}
