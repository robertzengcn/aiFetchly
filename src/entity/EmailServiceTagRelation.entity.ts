import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { EmailServiceEntity } from "./EmailService.entity";
import { EmailServiceTagEntity } from "./EmailServiceTag.entity";

/**
 * Junction entity for the many-to-many relationship between EmailService and EmailServiceTag.
 * Replaces the legacy single-tag EmailServiceEntity.tagId FK column.
 */
@Entity("email_service_tag_relation")
@Unique("UQ_email_service_tag_relation_service_tag", [
  "emailServiceId",
  "tagId",
])
export class EmailServiceTagRelationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index("idx_email_service_tag_relation_service")
  @Column({ type: "integer" })
  emailServiceId: number;

  @Index("idx_email_service_tag_relation_tag")
  @Column({ type: "integer" })
  tagId: number;

  @ManyToOne(() => EmailServiceEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "emailServiceId" })
  emailService: EmailServiceEntity;

  @ManyToOne(() => EmailServiceTagEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tagId" })
  tag: EmailServiceTagEntity;
}