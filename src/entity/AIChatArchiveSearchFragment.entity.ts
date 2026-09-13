import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Search fragment: a bounded slice of a source message's content (by code
 * point offsets, with overlap) used for literal substring search. Fragments
 * are bounded to searchFragmentMaxCodePoints so search never materializes
 * full oversized messages. `(conversationId, sourceRowId, field,
 * startCodePoint)` is unique. Optional FTS acceleration can index
 * fragmentText; the base table suffices for bounded LIKE scans.
 */
@Entity("ai_chat_archive_search_fragments")
@Unique("uq_archive_fragments_row_offset", [
  "conversationId",
  "sourceRowId",
  "field",
  "startCodePoint",
])
@Index("idx_archive_fragments_conv_row", [
  "conversationId",
  "sourceRowId",
])
export class AIChatArchiveSearchFragmentEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("int", { nullable: false })
  sourceRowId: number;

  @Order(3)
  @Column("varchar", { length: 20, nullable: false })
  field: string;

  @Order(4)
  @Column("int", { nullable: false })
  startCodePoint: number;

  @Order(5)
  @Column("int", { nullable: false })
  endCodePoint: number;

  @Order(6)
  @Column("text", { nullable: false })
  fragmentText: string;
}
