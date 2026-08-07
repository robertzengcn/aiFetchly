import "reflect-metadata";
import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Persists a single version of an AI-generated artifact.
 *
 * Rows are scoped by `conversationId` so chat history can reopen prior
 * artifacts. Regeneration creates a new version (or new row) rather than
 * overwriting prior content. Full HTML lives here only — chat message
 * metadata carries just the small `AIArtifactToolMetadata` pointer.
 *
 * `artifactId` is the stable public id (uuid); the numeric `id` is the
 * TypeORM primary key used to order versions for the same logical artifact.
 */
@Entity("ai_artifacts")
@Index(["conversationId", "createdAt"])
@Index(["artifactId"], { unique: true })
export class AIArtifactEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  artifactId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 20, nullable: false, default: "html" })
  type: "html";

  @Order(4)
  @Column("varchar", { length: 160, nullable: false })
  title: string;

  @Order(5)
  @Column("varchar", { length: 500, nullable: true })
  description?: string;

  @Order(6)
  @Column("varchar", { length: 80, nullable: false, default: "text/html" })
  mimeType: "text/html";

  @Order(7)
  @Column("text", { nullable: false })
  content: string;

  @Order(8)
  @Column("int", { nullable: false, default: 1 })
  version: number;
}
