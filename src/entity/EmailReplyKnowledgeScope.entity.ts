import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Mailbox-owned knowledge scope (technical design §6.7, FR-008). Defines which
 * knowledge-library documents are ELIGIBLE for that mailbox's reply generation.
 *
 * Empty-list semantics are explicit: an empty allowlist with
 * `allowAllDocuments = 0` means search NOTHING. It can never be translated
 * into an undefined filter that searches every document.
 */
@Entity("email_reply_knowledge_scope")
@Index(["emailServiceId"], { unique: true })
export class EmailReplyKnowledgeScopeEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  emailServiceId: number;

  /** Bumped on every change; generation metadata records the version used. */
  @Column("integer", { default: 1 })
  version: number;

  /** Serialized number[] of allowed RAG document ids. */
  @Column("text")
  documentIdsJson: string;

  /** Serialized string[] of allowed tags. */
  @Column("text")
  tagsJson: string;

  /** 0 = allowlist only (empty allowlist searches nothing); 1 = all eligible docs. */
  @Column("integer", { default: 0 })
  allowAllDocuments: number;

  /** Exclude documents marked inactive/stale (default on). */
  @Column("integer", { default: 1 })
  excludeInactiveDocuments: number;
}
