import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { Order } from "@/entity/order.decorator";

/**
 * Persisted record of an installed plugin.
 * Source of truth: Design §5.1.
 */
@Entity("installed_plugins")
@Index(["name"], { unique: true })
@Index(["enabled"])
@Index(["health"])
export class InstalledPluginEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("text")
  name: string;

  @Order(2)
  @Column("text", { nullable: true })
  displayName?: string;

  @Order(3)
  @Column("text")
  version: string;

  @Order(4)
  @Column("text", { default: "local" })
  source: string; // PluginSource: "local" | "builtin" | "marketplace"

  @Order(5)
  @Column("text", { nullable: true })
  author?: string;

  @Order(6)
  @Column("text")
  description: string;

  @Order(7)
  @Column("text")
  installPath: string;

  @Order(8)
  @Column("text")
  manifestJson: string;

  @Order(9)
  @Column("text", { default: "[]" })
  permissionsJson: string;

  @Order(10)
  @Column("text", { default: "{}" })
  componentStateJson: string;

  @Order(11)
  @Column("integer", { default: 1 })
  enabled: number;

  @Order(12)
  @Column("text", { default: "healthy" })
  health: string; // PluginHealth

  @Order(13)
  @Column("text", { default: "[]" })
  lastLoadErrorsJson: string;

  @Order(14)
  @Column("text", { default: "local-zip" })
  sourceKind: string; // PluginSourceKind

  @Order(15)
  @Column("text", { nullable: true })
  sourceUri?: string;

  @Order(16)
  @Column("text", { nullable: true })
  sourceRef?: string;

  @Order(17)
  @Column("text", { default: "{}" })
  sourceMetaJson: string;
}
