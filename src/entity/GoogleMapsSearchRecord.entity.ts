import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("google_maps_search_records")
export class GoogleMapsSearchRecordEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 255, nullable: false })
  query: string;

  @Column("varchar", { length: 255, nullable: false })
  location: string;

  @Column("varchar", { length: 20, nullable: false, default: "completed" })
  status: string; // "completed" | "cancelled" | "failed"

  @Column("int", { nullable: false, default: 0 })
  totalResults: number;

  @Column("text", { nullable: true })
  summary: string;

  @Column("text", { nullable: false })
  results: string; // JSON stringified GoogleMapsBusinessResult[]
}
