import "reflect-metadata";
import {
  Entity,
  Column,
  OneToMany,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("rag_documents")
@Index(["status", "processingStatus"])
@Index(["fileType"])
@Index(["uploadedAt"])
@Index(["importGroupId"])
@Index(["contentSha256"])
@Index(["sourceUrlSha256"])
@Index(["canonicalUrlSha256"])
export class RAGDocumentEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;
  @Order(1)
  @Column("varchar", { length: 255, nullable: false })
  name: string;

  @Order(2)
  @Column("varchar", { length: 500, nullable: false })
  filePath: string;

  @Order(3)
  @Column("varchar", { length: 50, nullable: false })
  fileType: string;

  @Order(4)
  @Column("bigint", { nullable: false })
  fileSize: number;

  @Order(5)
  @Column("varchar", { length: 20, default: "active", nullable: false })
  status: string; // 'active', 'archived', 'deleted'

  @Order(6)
  @Column("varchar", { length: 20, default: "pending", nullable: false })
  processingStatus: string; // 'pending', 'processing', 'completed', 'failed'

  // Metadata fields
  @Order(7)
  @Column("varchar", { length: 500, nullable: true })
  title?: string;

  @Order(8)
  @Column("text", { nullable: true })
  description?: string;

  @Order(9)
  @Column("text", { nullable: true })
  tags?: string; // JSON string array

  @Order(10)
  @Column("varchar", { length: 255, nullable: true })
  author?: string;

  @Order(11)
  @Column("varchar", { length: 500, nullable: true })
  log?: string; // Error log file path

  // Timestamps
  @Order(12)
  @Column("datetime", { nullable: true })
  uploadedAt?: Date;

  @Order(13)
  @Column("datetime", { nullable: true })
  processedAt?: Date;

  @Order(14)
  @Column("datetime", { nullable: true })
  lastAccessedAt?: Date;

  // Vector database index path
  @Order(15)
  @Column("varchar", { length: 500, nullable: true })
  vectorIndexPath?: string;

  @Order(16)
  @Column("varchar", { length: 500, nullable: true })
  modelName?: string;

  @Order(17)
  @Column("int", { nullable: true })
  vectorDimensions?: number;

  // Website import provenance (nullable: pre-existing uploads leave these null).
  // Used for URL/hash-based duplicate detection, grouping, and future refresh.
  @Order(18)
  @Column("varchar", { length: 40, nullable: true })
  sourceType?: string; // "file" | "attachment" | "webpage"

  @Order(19)
  @Column("varchar", { length: 2048, nullable: true })
  sourceUrl?: string;

  @Order(20)
  @Column("varchar", { length: 64, nullable: true })
  sourceUrlSha256?: string;

  @Order(21)
  @Column("varchar", { length: 2048, nullable: true })
  canonicalUrl?: string;

  @Order(22)
  @Column("varchar", { length: 64, nullable: true })
  canonicalUrlSha256?: string;

  @Order(23)
  @Column("varchar", { length: 2048, nullable: true })
  sourceRootUrl?: string;

  @Order(24)
  @Column("varchar", { length: 120, nullable: true })
  importGroupId?: string;

  @Order(25)
  @Column("varchar", { length: 64, nullable: true })
  contentSha256?: string;

  @Order(26)
  @Column("datetime", { nullable: true })
  crawledAt?: Date;

  // Relationships
  @OneToMany("RAGChunkEntity", "document")
  chunks?: any[];
}
