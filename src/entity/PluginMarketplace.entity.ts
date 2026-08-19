import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { Order } from "@/entity/order.decorator";

/**
 * Persisted plugin marketplace (catalog) record.
 * Source of truth: PRD §9.1, tech design §4.1.
 */
@Entity("plugin_marketplaces")
@Index(["name"], { unique: true })
@Index(["enabled"])
@Index(["health"])
export class PluginMarketplaceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Order(1)
  @Column("text")
  name!: string;

  @Order(2)
  @Column("text", { nullable: true })
  displayName?: string;

  @Order(3)
  @Column("text")
  ownerName!: string;

  @Order(4)
  @Column("text", { nullable: true })
  ownerEmail?: string;

  @Order(5)
  @Column("text", { nullable: true })
  ownerUrl?: string;

  @Order(6)
  @Column("text", { nullable: true })
  description?: string;

  @Order(7)
  @Column("text", { nullable: true })
  version?: string;

  @Order(8)
  @Column("text")
  sourceKind!: string; // PluginMarketplaceSourceKind

  @Order(9)
  @Column("text")
  sourceUri!: string; // redacted for display

  @Order(10)
  @Column("text", { nullable: true })
  sourceRef?: string;

  @Order(11)
  @Column("text", { nullable: true })
  installPath?: string; // marketplace cache root

  @Order(12)
  @Column("text")
  manifestJson!: string; // validated marketplace manifest

  @Order(13)
  @Column("integer", { default: 0 })
  pluginCount!: number;

  @Order(14)
  @Column("integer", { default: 1 })
  enabled!: number;

  @Order(15)
  @Column("integer", { default: 0 })
  autoUpdate!: number; // MVP: stored, not acted on

  @Order(16)
  @Column("text", { default: "healthy" })
  health!: string; // PluginMarketplaceHealth

  @Order(17)
  @Column("text", { default: "[]" })
  lastErrorJson!: string;

  @Order(18)
  @Column("datetime", { nullable: true })
  lastFetchedAt?: Date;

  @Order(19)
  @Column("text", { default: "{}" })
  sourceMetaJson!: string; // non-secret source metadata
}
