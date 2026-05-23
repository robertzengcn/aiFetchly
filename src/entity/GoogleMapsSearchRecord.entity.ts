import { Entity, PrimaryGeneratedColumn, Column, Order } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("google_maps_search_records")
export class GoogleMapsSearchRecordEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 255, nullable: false })
  query: string;

  @Order(2)
  @Column("varchar", { length: 255, nullable: false })
  location: string;

  @Order(3)
  @Column("varchar", { length: 20, nullable: false, default: "completed" })
  status: string; // "completed" | "cancelled" | "failed"

  @Order(4)
  @Column("int", { nullable: false, default: 0 })
  totalResults: number;

  @Order(5)
  @Column("text", { nullable: true })
  summary: string;

  @Order(6)
  @Column("text", { nullable: false })
  results: string; // JSON stringified GoogleMapsBusinessResult[]
}
