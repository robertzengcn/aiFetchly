import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Design §14.1/§20.3: opaque credential BINDING in SQLite — the record of
 * WHAT is stored and for which installation, never the value. The
 * safeStorage-encrypted value lives in the separate credential store keyed
 * by the bindingRef. Aligned with the specified two-part persistence
 * (TODO 9): SQLite = queryable bindings; store = encrypted values.
 */
@Entity("skill_credential_bindings")
@Index("uq_skill_cred_binding", ["installationId", "environmentVariable"], {
  unique: true,
})
export class SkillCredentialBindingEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Order(1)
  @Column("varchar", { length: 64, nullable: false })
  installationId!: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  environmentVariable!: string;

  /**
   * Opaque reference into the encrypted store — by convention
   * `${installationId}:${environmentVariable}`. Resolving it yields the
   * value ONLY through SkillCredentialService.retrieve.
   */
  @Order(3)
  @Column("varchar", { length: 200, nullable: false })
  bindingRef!: string;

  /** configured | deleted — status without ever holding the value. */
  @Order(4)
  @Column("varchar", { length: 20, nullable: false, default: "configured" })
  status!: string;

  @Order(5)
  @Column("datetime", { nullable: false })
  storedAt!: Date;
}
