import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  Index,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { ProxyEntity } from "@/entity/Proxy.entity";

@Entity("social_accounts")
export class SocialAccountEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // @Column({ type: 'varchar', length: 100,nullable: true })
  // social_type: string;

  @Column({ type: "integer" })
  social_type_id!: number;

  // @Column({ type: 'varchar', length: 255, nullable: true })
  // social_type_url: string;

  @Column({ type: "varchar", length: 255 })
  user!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  pass!: string | null;

  @Column({ type: "integer", default: 1 })
  status!: number;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  phone!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  email!: string;

  /** PRD A-FR-03/13: BrowserSite link (backfilled from social_type_id). */
  @Column({ type: "integer", nullable: true })
  @Index()
  site_id!: number | null;

  /** Q-01: per-account opt-in for AI-driven sign-in. */
  @Column({ type: "boolean", default: false })
  ai_use_enabled!: boolean;

  /** A-FR-10: automated sign-in cooldown bookkeeping. */
  @Column({ type: "datetime", nullable: true })
  last_login_failure_at!: Date | null;

  /** A-FR-10: the site the last failure was ON — the cooldown is per account AND site. */
  @Column({ type: "integer", nullable: true })
  last_login_failure_site!: number | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  last_login_failure_reason!: string | null;

  @ManyToMany(() => ProxyEntity)
  @JoinTable({
    name: "social_account_proxies",
    joinColumn: {
      name: "social_account_id",
      referencedColumnName: "id",
    },
    inverseJoinColumn: {
      name: "proxy_id",
      referencedColumnName: "id",
    },
  })
  proxy!: ProxyEntity[];
}
